/**
 * Pure projection of a `DesignLayout` into a `Drawing` for the "Rencana Air"
 * (plumbing plan) sheet — top-view denah, one sheet per floor. Mirrors
 * `electrical-plan.ts`: room outlines for non-void rooms; bounding box + dim
 * chains derived from ALL rooms (void rooms are excluded from OUTLINES only).
 * No DOM, no three.js — safe to unit test and reuse from SVG/PDF renderers.
 * Plan x/y are used directly as drawing coords (no y-flip — that is the
 * renderer's job).
 *
 * On top of the plan it draws:
 *  - water-fixture glyphs (`water.ts` `symbolLines`) drawn at each point's
 *    ABSOLUTE x/y, for points whose room is on this floor;
 *  - pipe routing: ONE per-floor "stack" at the first wet room's corner
 *    (wet room = a room with at least one valid water point). Every fixture is
 *    connected to the stack by an orthogonal 2-segment pipe line
 *    (`kind: "opening"`), vertical-first: fixture → (fixture.x, stack.y) →
 *    stack. Systems (bersih/kotor/limbah) are distinguished in the legend, not
 *    by line style (the `Drawing` contract has no style channel);
 *  - a legend + fixture schedule table to the RIGHT of the room bbox (x from
 *    `bboxW + 1.0`), columns `Tipe | Jumlah | Sistem | Ø`, one row per distinct
 *    fixture type present plus a header. `widthM`/`heightM` are extended so
 *    `sheetPlacement` scales the whole composition onto the sheet.
 *
 * Defensive (T1 carry-forward): the layout save API has no zod, so
 * `layout.water` is read without trust — a point with an unknown type, a
 * missing / other-floor room, or a non-finite x/y is skipped (no crash, no
 * garbage geometry).
 */
import type {
  DesignLayout,
  RoomInteriorPlan,
  WaterPoint,
  WaterPointType,
} from "@/types"
import { round2 } from "@/lib/geometry"
import { symbolLines, WATER_SYSTEM, PIPE_DIAMETER } from "@/lib/water/water"
import { WATER_POINT_TYPES } from "@/lib/constants"
import type { Drawing, DrawLine, DrawLabel, DimChain } from "./types"

/** Known fixture types — anything else in `layout.water` is skipped. */
const KNOWN_TYPES: ReadonlySet<WaterPointType> = new Set(
  Object.keys(WATER_SYSTEM) as WaterPointType[],
)
/** Stable output order for legend rows + schedule rows. */
const TYPE_ORDER = Object.keys(WATER_POINT_TYPES) as WaterPointType[]

/** Fixture-schedule columns + their left offset (m) from the table's left edge. */
const TABLE_COLS: { label: string; x: number }[] = [
  { label: "Tipe", x: 0 },
  { label: "Jumlah", x: 3.0 },
  { label: "Sistem", x: 4.5 },
  { label: "Ø", x: 6.0 },
]
const TABLE_W_M = 7.0
const ROW_H_M = 0.5
const CELL_PAD_M = 0.1
/** Gap between the plan's right edge and the legend/table block. */
const TABLE_GAP_M = 1.0
/** Gap between the legend block and the schedule table. */
const BLOCK_GAP_M = 0.4
/** Corner inset (m) of the per-floor stack inside the first wet room. */
const STACK_OFFSET_M = 0.2

const isFiniteNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n)

export function buildPlumbingPlan(
  layout: DesignLayout,
  _interiors: RoomInteriorPlan[],
  floorId: string,
): Drawing {
  const floor = layout.floors.find((f) => f.id === floorId)
  const allRooms = layout.rooms.filter((r) => r.floorId === floorId)
  const rooms = allRooms.filter((r) => r.type !== "void")
  const roomById = new Map(allRooms.map((r) => [r.id, r]))

  const lines: DrawLine[] = []
  const labels: DrawLabel[] = []
  const xPoints = new Set<number>()
  const yPoints = new Set<number>()

  for (const room of allRooms) {
    xPoints.add(round2(room.x))
    xPoints.add(round2(room.x + room.width))
    yPoints.add(round2(room.y))
    yPoints.add(round2(room.y + room.depth))
  }

  // Non-void room outlines.
  for (const room of rooms) {
    const x0 = round2(room.x)
    const y0 = round2(room.y)
    const x1 = round2(room.x + room.width)
    const y1 = round2(room.y + room.depth)

    lines.push({ x1: x0, y1: y0, x2: x1, y2: y0, kind: "outline" })
    lines.push({ x1: x1, y1: y0, x2: x1, y2: y1, kind: "outline" })
    lines.push({ x1: x1, y1: y1, x2: x0, y2: y1, kind: "outline" })
    lines.push({ x1: x0, y1: y1, x2: x0, y2: y0, kind: "outline" })
  }

  // Water-fixture glyphs — only points whose room is on this floor, with a
  // known type and finite coords (defensive: layout.water has no zod).
  const floorPoints: WaterPoint[] = []
  for (const p of layout.water ?? []) {
    if (!p) continue
    if (!roomById.has(p.roomId)) continue
    if (!KNOWN_TYPES.has(p.type)) continue
    if (!isFiniteNum(p.x) || !isFiniteNum(p.y)) continue
    floorPoints.push(p)
    lines.push(...symbolLines(p.type, p.x, p.y))
  }

  // Pipe routing: ONE per-floor stack at the first wet room's corner. Each
  // fixture connects to it by an orthogonal 2-segment (vertical-first) elbow.
  const wetRoomIds = new Set(floorPoints.map((p) => p.roomId))
  const firstWetRoom = allRooms.find((r) => wetRoomIds.has(r.id))
  if (firstWetRoom) {
    const stackX = round2(firstWetRoom.x + STACK_OFFSET_M)
    const stackY = round2(firstWetRoom.y + STACK_OFFSET_M)
    for (const p of floorPoints) {
      const fx = round2(p.x)
      const fy = round2(p.y)
      lines.push({ x1: fx, y1: fy, x2: fx, y2: stackY, kind: "opening" })
      lines.push({ x1: fx, y1: stackY, x2: stackX, y2: stackY, kind: "opening" })
    }
  }

  const bboxW = round2(allRooms.reduce((m, r) => Math.max(m, r.x + r.width), 0))
  const bboxH = round2(allRooms.reduce((m, r) => Math.max(m, r.y + r.depth), 0))

  // Distinct fixture types present, in canonical order, with counts.
  const counts = new Map<WaterPointType, number>()
  for (const p of floorPoints) counts.set(p.type, (counts.get(p.type) ?? 0) + 1)
  const presentTypes = TYPE_ORDER.filter((t) => counts.has(t))

  // ---- Legend + fixture schedule, to the RIGHT of the plan bbox ----
  // Legend names each present type + its piping system (bersih/kotor/limbah) —
  // kran/kran_taman/kran_wudhu share one glyph, so the type name disambiguates.
  const legendEntries = presentTypes.map(
    (t) => `${WATER_POINT_TYPES[t]} — ${WATER_SYSTEM[t]}`,
  )
  const tableX0 = round2(bboxW + TABLE_GAP_M)
  const legendH = legendEntries.length * ROW_H_M
  const tableRows = presentTypes.length + 1 // + header
  const tableH = tableRows * ROW_H_M
  const blockH = legendH + BLOCK_GAP_M + tableH
  // Top-align the block with the plan; grow upward only if it is taller than the
  // plan so nothing crosses y = 0.
  const blockTop = round2(Math.max(bboxH, blockH))

  // x is the LEFT text edge → anchor "start" (same fix as electrical-plan),
  // or the renderer centres the text on the block's left edge.
  labels.push({ x: tableX0, y: round2(blockTop - ROW_H_M / 2), text: "Legenda", kind: "room", anchor: "start" })
  legendEntries.forEach((text, i) => {
    labels.push({
      x: round2(tableX0 + CELL_PAD_M),
      y: round2(blockTop - (i + 1.5) * ROW_H_M),
      text,
      kind: "room",
      anchor: "start",
    })
  })

  // Fixture-schedule table.
  const tableTop = round2(blockTop - legendH - BLOCK_GAP_M)
  const tableX1 = round2(tableX0 + TABLE_W_M)
  const tableBottom = round2(tableTop - tableH)

  // Grid: horizontal row separators + vertical column separators.
  for (let r = 0; r <= tableRows; r++) {
    const y = round2(tableTop - r * ROW_H_M)
    lines.push({ x1: tableX0, y1: y, x2: tableX1, y2: y, kind: "outline" })
  }
  for (const col of TABLE_COLS) {
    const x = round2(tableX0 + col.x)
    lines.push({ x1: x, y1: tableTop, x2: x, y2: tableBottom, kind: "outline" })
  }
  lines.push({ x1: tableX1, y1: tableTop, x2: tableX1, y2: tableBottom, kind: "outline" })

  // Cell text: header row + one row per distinct fixture type. x = the cell's
  // LEFT text edge (column offset + padding) → anchor "start", so values stay
  // inside their own column instead of straddling the separator line.
  const cellLabel = (colX: number, rowTop: number, text: string): DrawLabel => ({
    x: round2(tableX0 + colX + CELL_PAD_M),
    y: round2(rowTop - ROW_H_M / 2),
    text,
    kind: "room",
    anchor: "start",
  })
  for (const col of TABLE_COLS) labels.push(cellLabel(col.x, tableTop, col.label))
  presentTypes.forEach((t, i) => {
    const rowTop = round2(tableTop - (i + 1) * ROW_H_M)
    const system = WATER_SYSTEM[t]
    labels.push(cellLabel(TABLE_COLS[0].x, rowTop, WATER_POINT_TYPES[t]))
    labels.push(cellLabel(TABLE_COLS[1].x, rowTop, String(counts.get(t) ?? 0)))
    labels.push(cellLabel(TABLE_COLS[2].x, rowTop, system))
    labels.push(cellLabel(TABLE_COLS[3].x, rowTop, PIPE_DIAMETER[system]))
  })

  const widthM = round2(Math.max(bboxW, tableX1))
  const heightM = round2(Math.max(bboxH, blockTop))

  const dims: DimChain[] = [
    { axis: "x", at: -0.8, points: Array.from(xPoints).sort((a, b) => a - b) },
    { axis: "y", at: -0.8, points: Array.from(yPoints).sort((a, b) => a - b) },
  ]

  return {
    widthM,
    heightM,
    lines,
    labels,
    dims,
    levels: [],
    title: `Rencana Air — ${floor ? floor.name : floorId}`,
  }
}
