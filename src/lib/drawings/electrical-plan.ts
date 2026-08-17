/**
 * Pure projection of a `DesignLayout` (+ resolved interiors) into a `Drawing`
 * for the "Rencana Listrik" (electrical plan) sheet — top-view denah, one sheet
 * per floor. Mirrors `ceiling-plan.ts`: room outlines for non-void rooms;
 * bounding box + dim chains derived from ALL rooms (void rooms are excluded
 * from OUTLINES only). No DOM, no three.js — safe to unit test and reuse from
 * SVG/PDF renderers. Plan x/y are used directly as drawing coords (no y-flip —
 * that is the renderer's job).
 *
 * On top of the plan it draws:
 *  - lamp symbols from `interiors[].lighting` (shared `crossLines`/`diamondLines`,
 *    center `room.x + f.x`, `room.y + f.y` — exactly like ceiling-plan);
 *  - electrical-point glyphs (`electrical.ts` `symbolLines`) drawn at each
 *    point's ABSOLUTE x/y, for points whose room is on this floor;
 *  - saklar→lamp relation lines: one `kind: "opening"` line from every
 *    `saklar_*` point to the NEAREST lamp center (euclidean) in the SAME room
 *    — satu garis indikatif per saklar (konvensi gambar kerja: saklar
 *    mengontrol grup); ruang tanpa lampu → tanpa garis;
 *  - a legend + panel schedule table to the RIGHT of the room bbox (x from
 *    `bboxW + 1.0`), columns `Sirkuit | Titik | VA | MCB`, one row per
 *    `buildCircuits()` circuit plus a header. `widthM`/`heightM` are extended so
 *    `sheetPlacement` scales the whole composition onto the sheet.
 *
 * Defensive (T1 carry-forward): the layout save API has no zod, so
 * `layout.electrical` is read without trust — a point with an unknown type, a
 * missing / other-floor room, or a non-finite x/y is skipped (no crash, no
 * garbage geometry).
 */
import type {
  DesignLayout,
  ElectricalPoint,
  ElectricalPointType,
  RoomInteriorPlan,
} from "@/types"
import { round2 } from "@/lib/geometry"
import { symbolLines } from "@/lib/electrical/electrical"
import { buildCircuits } from "@/lib/electrical/circuits"
import { effectiveLamps } from "@/lib/three/lamps"
import { CROSS_TYPES, crossLines, diamondLines } from "./lighting-symbols"
import type { Drawing, DrawLine, DrawLabel, DimChain } from "./types"

const KNOWN_TYPES: ReadonlySet<ElectricalPointType> = new Set([
  "stopkontak",
  "stopkontak_daya",
  "saklar_tunggal",
  "saklar_ganda",
  "panel",
  "data",
])
const SAKLAR_TYPES: ReadonlySet<ElectricalPointType> = new Set(["saklar_tunggal", "saklar_ganda"])

/** Legend entries (Bahasa) naming the symbol families drawn on the sheet. */
const LEGEND_ENTRIES = ["Stopkontak", "Stopkontak Daya", "Saklar", "Titik Lampu", "Panel / Data", "Jalur kabel (skematik)"]

/**
 * Panel-schedule columns + their left offset (m) from the table's left edge.
 * Cell text is anchored "start" at `x + CELL_PAD_M`, so each column must be
 * wide enough for its longest content at the renderer's fixed LABEL_FONT_MM
 * (3 mm ≈ 1.7 mm/char on sheet). At the common 1:100 plan scale 1 m = 10 mm:
 *  - Sirkuit 3.6 m ≈ 36 mm — fits "Penerangan — Lantai 1" (21 chars ≈ 36 mm);
 *  - Titik   1.0 m ≈ 10 mm — 2-digit counts;
 *  - VA      1.2 m ≈ 12 mm — 4-digit loads like "1500" (≈ 7 mm) + padding;
 *  - MCB     1.2 m ≈ 12 mm — "10 A".
 */
const TABLE_COLS: { label: string; x: number }[] = [
  { label: "Sirkuit", x: 0 },
  { label: "Titik", x: 3.6 },
  { label: "VA", x: 4.6 },
  { label: "MCB", x: 5.8 },
]
const TABLE_W_M = 7.0
const ROW_H_M = 0.5
const CELL_PAD_M = 0.1
/** Gap between the plan's right edge and the legend/table block. */
const TABLE_GAP_M = 1.0
/** Gap between the legend block and the panel-schedule table. */
const BLOCK_GAP_M = 0.4

const isFiniteNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n)

export function buildElectricalPlan(
  layout: DesignLayout,
  interiors: RoomInteriorPlan[],
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

  // Non-void room outlines + lamp symbols. Remember each room's lamp centers so
  // the saklar→lamp relation lines can connect to them.
  const lampCentersByRoom = new Map<string, { x: number; y: number }[]>()
  for (const room of rooms) {
    const x0 = round2(room.x)
    const y0 = round2(room.y)
    const x1 = round2(room.x + room.width)
    const y1 = round2(room.y + room.depth)

    lines.push({ x1: x0, y1: y0, x2: x1, y2: y0, kind: "outline" })
    lines.push({ x1: x1, y1: y0, x2: x1, y2: y1, kind: "outline" })
    lines.push({ x1: x1, y1: y1, x2: x0, y2: y1, kind: "outline" })
    lines.push({ x1: x0, y1: y1, x2: x0, y2: y0, kind: "outline" })

    const fixtures = interiors.find((i) => i.roomId === room.id)?.lighting ?? []
    const centers: { x: number; y: number }[] = []
    for (const f of fixtures) {
      const cx = round2(room.x + f.x)
      const cy = round2(room.y + f.y)
      lines.push(...(CROSS_TYPES.has(f.type) ? crossLines(cx, cy) : diamondLines(cx, cy)))
      centers.push({ x: cx, y: cy })
    }
    lampCentersByRoom.set(room.id, centers)
  }

  // Electrical-point glyphs — only points whose room is on this floor, with a
  // known type and finite coords (defensive: layout.electrical has no zod).
  const floorPoints: ElectricalPoint[] = []
  for (const p of layout.electrical ?? []) {
    if (!p) continue
    if (!roomById.has(p.roomId)) continue
    if (!KNOWN_TYPES.has(p.type)) continue
    if (!isFiniteNum(p.x) || !isFiniteNum(p.y)) continue
    floorPoints.push(p)
    lines.push(...symbolLines(p.type, p.x, p.y))
  }

  // saklar→lamp relation: SATU garis dari tiap saklar ke lampu TERDEKAT
  // (euclidean) di ruang yang SAMA. Konvensi gambar kerja nyata: saklar
  // mengontrol grup lampu, cukup satu garis indikatif — bukan ke semua lampu
  // (spaghetti tak terbaca). Ruang tanpa lampu → tanpa garis.
  for (const p of floorPoints) {
    if (!SAKLAR_TYPES.has(p.type)) continue
    const sx = round2(p.x)
    const sy = round2(p.y)
    let nearest: { x: number; y: number } | null = null
    let bestD2 = Infinity
    for (const c of lampCentersByRoom.get(p.roomId) ?? []) {
      const d2 = (c.x - sx) ** 2 + (c.y - sy) ** 2
      if (d2 < bestD2) {
        bestD2 = d2
        nearest = c
      }
    }
    if (nearest) lines.push({ x1: sx, y1: sy, x2: nearest.x, y2: nearest.y, kind: "opening" })
  }

  // Lampu EKSTERIOR (teras/taman/kanopi) — simbol diamond di posisi absolutnya,
  // supaya desain listrik mencerminkan beban nyata di lapangan.
  const exteriorCenters: { x: number; y: number }[] = []
  for (const l of effectiveLamps(layout)) {
    if (l.floorId !== floorId || !isFiniteNum(l.x) || !isFiniteNum(l.y)) continue
    const cx = round2(l.x)
    const cy = round2(l.y)
    lines.push(...diamondLines(cx, cy))
    exteriorCenters.push({ x: cx, y: cy })
  }

  // JALUR KABEL (skematik, rute-L Manhattan) dari panel ke tiap titik BEBAN:
  // stopkontak/daya, lampu pertama tiap ruang, dan lampu eksterior. SAKLAR
  // BUKAN beban (alat kontrol) — tidak diberi homerun, mengurangi silang garis.
  // Digambar hanya bila lantai ini punya titik panel — persis kebiasaan gambar
  // kerja: homerun per grup, bukan tarikan per lampu.
  const panelPt = floorPoints.find((p) => p.type === "panel")
  if (panelPt) {
    const px = round2(panelPt.x)
    const py = round2(panelPt.y)
    const homerun = (tx: number, ty: number) => {
      if (Math.abs(tx - px) > 0.01) lines.push({ x1: px, y1: py, x2: tx, y2: py, kind: "opening" })
      if (Math.abs(ty - py) > 0.01) lines.push({ x1: tx, y1: py, x2: tx, y2: ty, kind: "opening" })
    }
    for (const p of floorPoints) {
      if (p.type === "stopkontak" || p.type === "stopkontak_daya") {
        homerun(round2(p.x), round2(p.y))
      }
    }
    for (const centers of lampCentersByRoom.values()) {
      if (centers[0]) homerun(centers[0].x, centers[0].y)
    }
    for (const c of exteriorCenters) homerun(c.x, c.y)
  }

  const bboxW = round2(allRooms.reduce((m, r) => Math.max(m, r.x + r.width), 0))
  const bboxH = round2(allRooms.reduce((m, r) => Math.max(m, r.y + r.depth), 0))

  // ---- Legend + panel schedule, to the RIGHT of the plan bbox ----
  const circuits = buildCircuits(layout, interiors, floorId)
  const tableX0 = round2(bboxW + TABLE_GAP_M)
  const legendH = LEGEND_ENTRIES.length * ROW_H_M
  const tableRows = circuits.length + 1 // + header
  const tableH = tableRows * ROW_H_M
  const blockH = legendH + BLOCK_GAP_M + tableH
  // Top-align the block with the plan; grow it upward only if it is taller than
  // the plan so nothing crosses y = 0.
  const blockTop = round2(Math.max(bboxH, blockH))

  // Legend (labels only, no glyph lines — keeps the symbol-line count clean).
  // x is the LEFT text edge → anchor "start", or the renderer centres the text
  // on the block's left edge and it bleeds toward the plan.
  labels.push({ x: tableX0, y: round2(blockTop - ROW_H_M / 2), text: "Legenda", kind: "room", anchor: "start" })
  LEGEND_ENTRIES.forEach((text, i) => {
    labels.push({
      x: round2(tableX0 + CELL_PAD_M),
      y: round2(blockTop - (i + 1.5) * ROW_H_M),
      text,
      kind: "room",
      anchor: "start",
    })
  })

  // Panel-schedule table.
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

  // Cell text: header row + one row per circuit. x = the cell's LEFT text
  // edge (column offset + padding) → anchor "start", so numbers stay inside
  // their own column instead of being centred across the separator line.
  const cellLabel = (colX: number, rowTop: number, text: string): DrawLabel => ({
    x: round2(tableX0 + colX + CELL_PAD_M),
    y: round2(rowTop - ROW_H_M / 2),
    text,
    kind: "room",
    anchor: "start",
  })
  for (const col of TABLE_COLS) labels.push(cellLabel(col.x, tableTop, col.label))
  circuits.forEach((c, i) => {
    const rowTop = round2(tableTop - (i + 1) * ROW_H_M)
    labels.push(cellLabel(TABLE_COLS[0].x, rowTop, c.name))
    labels.push(cellLabel(TABLE_COLS[1].x, rowTop, String(c.pointCount)))
    labels.push(cellLabel(TABLE_COLS[2].x, rowTop, String(c.loadVA)))
    labels.push(cellLabel(TABLE_COLS[3].x, rowTop, `${c.mcbA} A`))
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
    title: `Rencana Listrik — ${floor ? floor.name : floorId}`,
  }
}
