/**
 * Pure projection of a `DesignLayout` (+ resolved interiors) into a
 * `Drawing` for the "Pola Lantai" plan (floor tile pattern, top-view denah,
 * one sheet per floor). No DOM, no three.js — safe to unit test and reuse
 * from SVG/PDF renderers. Mirrors kusen-plan.ts's module style: same
 * outline/bbox/dim-chain conventions, plan x/y used directly as drawing
 * coords (no y-flip — that's the renderer's job).
 *
 * Tile sizes are pinned by
 * docs/superpowers/plans/2026-07-03-sp3-lantai-plafon-atap.md's Global
 * Constraints (TILE_SIZES, in metres):
 *   floor-cream-tile 0.6×0.6 · bathroom-tile 0.4×0.4 ·
 *   floor-vinyl-oak 0.18×1.2 (plank) · outdoor-deck 0.14×2.2 ·
 *   floor-polished-concrete → seamless (null, no grid) ·
 *   unknown material id → fallback 0.4×0.4.
 * Tile count uses the same waste formula everywhere in this module:
 * `ceil(areaM2 / (tw*th) * 1.1)` (10% waste allowance).
 *
 * Each non-void room resolves its floor material from
 * `interiors[].materials` (surface === "floor"); a room with no matching
 * interior entry falls back to `floor-cream-tile` / "Homogeneous Tile
 * Cream" using the room's own `areaM2`. The grout grid is drawn as
 * `kind: "opening"` lines (vertical at `room.x + k·tw` for k ≥ 1 while
 * `k·tw < room.width`, horizontal analog with `th`/`room.depth`), clipped
 * to the room's rect; seamless materials draw no grid at all.
 *
 * Void rooms are excluded from outlines, materials and room labels, but
 * (like kusen-plan.ts) still contribute to the bounding box and dim
 * chains, which are always derived from ALL rooms on the floor.
 */
import type { DesignLayout, Room, RoomInteriorPlan } from "@/types"
import { round2 } from "@/lib/geometry"
import type { Drawing, DrawLine, DrawLabel, DimChain } from "./types"

export type TileSize = { w: number; h: number }

const FALLBACK_MATERIAL_ID = "floor-cream-tile"
const FALLBACK_MATERIAL_NAME = "Homogeneous Tile Cream"
const FALLBACK_TILE: TileSize = { w: 0.4, h: 0.4 }
const WASTE_FACTOR = 1.1

/** null = seamless (no grout grid). */
const TILE_SIZES: Record<string, TileSize | null> = {
  "floor-cream-tile": { w: 0.6, h: 0.6 },
  "bathroom-tile": { w: 0.4, h: 0.4 },
  "floor-vinyl-oak": { w: 0.18, h: 1.2 },
  "outdoor-deck": { w: 0.14, h: 2.2 },
  "floor-polished-concrete": null,
}

/** Tile footprint for a material id — null means seamless (no grid/nat). Unknown ids fall back to 0.4×0.4. */
export function tileSizeFor(materialId: string): TileSize | null {
  if (materialId in TILE_SIZES) return TILE_SIZES[materialId]
  return FALLBACK_TILE
}

type ResolvedFloorMaterial = { materialId: string; name: string; areaM2: number }

function resolveFloorMaterial(room: Room, interiors: RoomInteriorPlan[]): ResolvedFloorMaterial {
  const assignment = interiors
    .find((i) => i.roomId === room.id)
    ?.materials.find((m) => m.surface === "floor")
  if (assignment) {
    return { materialId: assignment.materialId, name: assignment.name, areaM2: assignment.areaM2 }
  }
  return { materialId: FALLBACK_MATERIAL_ID, name: FALLBACK_MATERIAL_NAME, areaM2: room.areaM2 }
}

function tileCount(areaM2: number, tile: TileSize): number {
  return Math.ceil((areaM2 / (tile.w * tile.h)) * WASTE_FACTOR)
}

function floorLabelText(name: string, tile: TileSize | null, areaM2: number): string {
  if (!tile) return `${name} · tanpa nat`
  const wCm = Math.round(tile.w * 100)
  const hCm = Math.round(tile.h * 100)
  return `${name} · ${wCm}×${hCm} · ${tileCount(areaM2, tile)} pcs`
}

/** Grout grid lines for a room, clipped to its rect. Empty when seamless. */
function gridLines(room: Room, tile: TileSize): DrawLine[] {
  const x0 = round2(room.x)
  const y0 = round2(room.y)
  const x1 = round2(room.x + room.width)
  const y1 = round2(room.y + room.depth)
  const lines: DrawLine[] = []

  for (let k = 1; round2(k * tile.w) < room.width; k++) {
    const x = round2(room.x + k * tile.w)
    lines.push({ x1: x, y1: y0, x2: x, y2: y1, kind: "opening" })
  }
  for (let k = 1; round2(k * tile.h) < room.depth; k++) {
    const y = round2(room.y + k * tile.h)
    lines.push({ x1: x0, y1: y, x2: x1, y2: y, kind: "opening" })
  }
  return lines
}

export function buildFloorPatternPlan(
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

    const material = resolveFloorMaterial(room, interiors)
    const tile = tileSizeFor(material.materialId)
    if (tile) lines.push(...gridLines(room, tile))

    labels.push({
      x: round2(room.x + room.width / 2),
      y: round2(room.y + room.depth / 2),
      text: floorLabelText(material.name, tile, material.areaM2),
      kind: "room",
    })
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
    title: `Pola Lantai — ${floor ? floor.name : floorId}`,
  }
}
