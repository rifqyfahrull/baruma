/**
 * Column grid derived from the floor plan (SP6 structural takedown).
 *
 * Pure module — no react / zustand / three. Builds on the load constants
 * (`MAX_SPAN`) and the shared `round2`. Feeds the takedown / sizing / drawing /
 * RAB modules downstream.
 *
 * `buildingFootprint` is the shared footprint helper: the bounding box of the
 * NON-ROOFTOP rooms. The rooftop-exclusion filter (`floorId !== "floor-rooftop"`)
 * matches `sheet-list.ts` `roofAreaOf` and the `/drawings` page + drawings-pack
 * `buildingBounds` exactly, so the grid, sheets, and RAB all agree on which
 * mass the structure carries. Unlike those helpers (which assume the plan starts
 * at the origin and only track max extent) this one also records the minimum
 * corner `x0`/`y0`, so the grid generalises to plans that don't start at (0, 0).
 */
import { round2 } from "@/lib/geometry"
import { floorOffset } from "@/lib/editor/floors"
import type { DesignLayout, Room } from "@/types"
import { MAX_SPAN } from "./loads"

/** The rooftop floor id — shared convention across the drawings/sheet code. */
const ROOFTOP_FLOOR_ID = "floor-rooftop"

export type BuildingFootprint = {
  widthM: number
  depthM: number
  x0: number
  y0: number
}

export type ColumnGrid = {
  columns: { x: number; y: number }[]
  spanX: number
  spanY: number
  nx: number
  ny: number
  widthM: number
  depthM: number
}

/** A room whose position + size are all finite (defensive against malformed PUTs). */
function isFiniteRoom(r: Room): boolean {
  return (
    Number.isFinite(r.x) &&
    Number.isFinite(r.y) &&
    Number.isFinite(r.width) &&
    Number.isFinite(r.depth)
  )
}

/**
 * Bounding footprint (meters) of the building's non-rooftop rooms:
 * `x0`/`y0` = minimum corner, `widthM`/`depthM` = extent. Rooftop rooms are
 * excluded (they don't carry the structure below). Empty / all-malformed →
 * `{ widthM: 0, depthM: 0, x0: 0, y0: 0 }`.
 */
export function buildingFootprint(layout: DesignLayout): BuildingFootprint {
  const rooms = (layout.rooms ?? []).filter(
    (r) => r.floorId !== ROOFTOP_FLOOR_ID && isFiniteRoom(r)
  )
  if (rooms.length === 0) return { widthM: 0, depthM: 0, x0: 0, y0: 0 }

  // Cantilever: footprint = UNION bbox tiap ruang pada posisi EFEKTIFnya
  // (digeser offset lantai) agar atap/slab/RAB menutupi bagian menjorok.
  // Tanpa offsetM di lantai mana pun → identik dgn bbox lama (offset 0).
  const offsetByFloor = new Map<string, { dx: number; dy: number }>(
    (layout.floors ?? []).map((f) => [f.id, floorOffset(f)]),
  )
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const r of rooms) {
    const o = offsetByFloor.get(r.floorId) ?? { dx: 0, dy: 0 }
    const rx = r.x + o.dx
    const ry = r.y + o.dy
    if (rx < minX) minX = rx
    if (ry < minY) minY = ry
    if (rx + r.width > maxX) maxX = rx + r.width
    if (ry + r.depth > maxY) maxY = ry + r.depth
  }

  return {
    x0: round2(minX),
    y0: round2(minY),
    widthM: round2(maxX - minX),
    depthM: round2(maxY - minY),
  }
}

/**
 * Building footprint AREA (m²) = width × depth of the non-rooftop bounding box.
 *
 * The single source of truth for "how much roof/ground the building actually
 * covers", shared by the RAB roof + soakwell lines so they bill the building
 * mass rather than the whole lot (`project.site.areaM2`). Same footprint the
 * column grid is derived from, so RAB (roof, structure) and the drawing sheets
 * all agree on the covered area. Degenerate footprint → 0 (no NaN downstream).
 */
export function buildingFootprintArea(layout: DesignLayout): number {
  const { widthM, depthM } = buildingFootprint(layout)
  return round2(widthM * depthM)
}

/** Number of grid lines along a span of length `len` (min 2 when len > 0). */
function gridLines(len: number): number {
  return Math.max(2, Math.ceil(len / MAX_SPAN) + 1)
}

/**
 * Derives the column grid from the floor-plan footprint. Along each axis the
 * bay count is chosen so no span exceeds `MAX_SPAN` (4 m):
 * `nx = ceil(W / MAX_SPAN) + 1`, `spanX = round2(W / (nx - 1))`; `ny`/`spanY`
 * analogous. Columns sit at every `nx × ny` intersection, absolute-positioned
 * relative to the footprint origin: `x = x0 + col*spanX`, `y = y0 + row*spanY`.
 *
 * Example: an 8×6 footprint → nx3 spanX4.0, ny3 spanY3.0, 9 columns.
 *
 * Degenerate footprint (no valid rooms → W or D = 0): returns an EMPTY grid
 * (no columns, nx/ny/spanX/spanY = 0). Placing overlapping columns on a
 * zero-width axis would be meaningless, and a zero-area footprint yields zero
 * structural volume downstream regardless.
 */
export function deriveColumnGrid(layout: DesignLayout): ColumnGrid {
  const { widthM, depthM, x0, y0 } = buildingFootprint(layout)

  if (widthM <= 0 || depthM <= 0) {
    return { columns: [], spanX: 0, spanY: 0, nx: 0, ny: 0, widthM, depthM }
  }

  const nx = gridLines(widthM)
  const ny = gridLines(depthM)
  const spanX = round2(widthM / (nx - 1))
  const spanY = round2(depthM / (ny - 1))

  const columns: { x: number; y: number }[] = []
  for (let row = 0; row < ny; row++) {
    for (let col = 0; col < nx; col++) {
      columns.push({
        x: round2(x0 + col * spanX),
        y: round2(y0 + row * spanY),
      })
    }
  }

  return { columns, spanX, spanY, nx, ny, widthM, depthM }
}
