/**
 * Pure projection of a `DesignLayout` (+ resolved interiors) into a
 * `Drawing` for the "Rencana Plafon" (ceiling plan) sheet — top-view
 * denah, one sheet per floor, with per-room ceiling material/height
 * labels and lighting-fixture symbols. No DOM, no three.js — safe to
 * unit test and reuse from SVG/PDF renderers. Mirrors floor-pattern.ts's
 * module style: same outline/bbox/dim-chain conventions, plan x/y used
 * directly as drawing coords (no y-flip — that's the renderer's job).
 *
 * `CEILING_DROP_M` is pinned by
 * docs/superpowers/plans/2026-07-03-sp3-lantai-plafon-atap.md's Global
 * Constraints: a room's ceiling height is
 * `floor.heightM − CEILING_DROP_M + (room.levelOffsetM ?? 0)`, formatted
 * with `formatElevation` (e.g. "+2,6 m", "+2,42 m" with a −0.18
 * levelOffsetM).
 *
 * Each non-void room resolves its ceiling material from
 * `interiors[].materials` (surface === "ceiling"); a room with no
 * matching interior entry (or no ceiling assignment within it) falls
 * back to the fixed name "Gypsum + Cat".
 *
 * Lighting symbols come from `interiors[].lighting`: fixture x/y are
 * ROOM-LOCAL, so the symbol center is `room.x + f.x, room.y + f.y`.
 * downlight/task/outdoor render as a CROSS (2 `kind: "opening"` lines,
 * ±0.12 m along each axis); pendant/indirect/wall_lamp render as a
 * DIAMOND (a 45°-rotated square, 4 lines, vertices ±0.12 m along each
 * axis). When a fixture's `qty > 1`, a small "×N" label sits at
 * `(center.x + 0.15, center.y + 0.15)`.
 *
 * Void rooms are excluded from outlines, materials/height labels and
 * lighting symbols, but (like floor-pattern.ts/kusen-plan.ts) still
 * contribute to the bounding box and dim chains, which are always
 * derived from ALL rooms on the floor.
 */
import type { DesignLayout, LightingFixture, Room, RoomInteriorPlan } from "@/types"
import { round2 } from "@/lib/geometry"
import { formatElevation } from "@/lib/format"
import { CROSS_TYPES, crossLines, diamondLines } from "./lighting-symbols"
import type { Drawing, DrawLine, DrawLabel, DimChain } from "./types"

export const CEILING_DROP_M = 0.4

const FALLBACK_CEILING_MATERIAL_NAME = "Gypsum + Cat"
const QTY_LABEL_OFFSET_M = 0.15

function resolveCeilingMaterialName(room: Room, interiors: RoomInteriorPlan[]): string {
  const assignment = interiors
    .find((i) => i.roomId === room.id)
    ?.materials.find((m) => m.surface === "ceiling")
  return assignment ? assignment.name : FALLBACK_CEILING_MATERIAL_NAME
}

function ceilingHeightLabel(floorHeightM: number, room: Room): string {
  // PLAFON RATA (E2): bidang plafon satu lantai sama utk semua ruang —
  // ruang ber-offset LANTAINYA yang naik, jadi tinggi bersih plafon dari
  // lantai ruang = (heightM − drop) − offset. (Dulu +offset — bertentangan
  // dgn section yang sudah menggambar plafon rata; HC-9 audit.)
  const h = round2(floorHeightM - CEILING_DROP_M - (room.levelOffsetM ?? 0))
  return formatElevation(h, "m")
}

function lightingSymbols(
  room: Room,
  fixtures: LightingFixture[]
): { lines: DrawLine[]; labels: DrawLabel[] } {
  const lines: DrawLine[] = []
  const labels: DrawLabel[] = []
  for (const f of fixtures) {
    const cx = round2(room.x + f.x)
    const cy = round2(room.y + f.y)
    lines.push(...(CROSS_TYPES.has(f.type) ? crossLines(cx, cy) : diamondLines(cx, cy)))
    if (f.qty > 1) {
      labels.push({
        x: round2(cx + QTY_LABEL_OFFSET_M),
        y: round2(cy + QTY_LABEL_OFFSET_M),
        text: `×${f.qty}`,
        kind: "room",
      })
    }
  }
  return { lines, labels }
}

export function buildCeilingPlan(
  layout: DesignLayout,
  interiors: RoomInteriorPlan[],
  floorId: string
): Drawing {
  const floor = layout.floors.find((f) => f.id === floorId)
  const allRooms = layout.rooms.filter((r) => r.floorId === floorId)
  const rooms = allRooms.filter((r) => r.type !== "void")

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

  for (const room of rooms) {
    const x0 = round2(room.x)
    const y0 = round2(room.y)
    const x1 = round2(room.x + room.width)
    const y1 = round2(room.y + room.depth)

    lines.push({ x1: x0, y1: y0, x2: x1, y2: y0, kind: "outline" })
    lines.push({ x1: x1, y1: y0, x2: x1, y2: y1, kind: "outline" })
    lines.push({ x1: x1, y1: y1, x2: x0, y2: y1, kind: "outline" })
    lines.push({ x1: x0, y1: y1, x2: x0, y2: y0, kind: "outline" })

    const materialName = resolveCeilingMaterialName(room, interiors)
    const heightLabel = ceilingHeightLabel(floor ? floor.heightM : 0, room)
    labels.push({
      x: round2(room.x + room.width / 2),
      y: round2(room.y + room.depth / 2),
      text: `${materialName} · ${heightLabel}`,
      kind: "room",
    })

    const fixtures = interiors.find((i) => i.roomId === room.id)?.lighting ?? []
    const symbols = lightingSymbols(room, fixtures)
    lines.push(...symbols.lines)
    labels.push(...symbols.labels)
  }

  const widthM = round2(allRooms.reduce((m, r) => Math.max(m, r.x + r.width), 0))
  const heightM = round2(allRooms.reduce((m, r) => Math.max(m, r.y + r.depth), 0))

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
    title: `Rencana Plafon — ${floor ? floor.name : floorId}`,
  }
}
