/**
 * Slab-with-holes geometry — decompose a floor slab rectangle MINUS a set of
 * void openings (stairwell/atrium) into non-overlapping solid rectangles, so a
 * staircase actually breaks through to the floor above (a real vertical access)
 * instead of rising into a solid ceiling. Pure module (plain arithmetic); the
 * single source of truth shared by the 3D slab prims and any future
 * section/plan consumer.
 */
import { round2 } from "@/lib/geometry"

export type SlabRect = { x: number; y: number; width: number; depth: number }

const EPS = 1e-6

/** `outer` minus one hole → up to 4 surrounding strips (guillotine: S/N full
 *  width, then W/E only across the hole's y-range). No overlap → no hole. */
function subtractOne(r: SlabRect, h: SlabRect): SlabRect[] {
  const ix0 = Math.max(r.x, h.x)
  const iy0 = Math.max(r.y, h.y)
  const ix1 = Math.min(r.x + r.width, h.x + h.width)
  const iy1 = Math.min(r.y + r.depth, h.y + h.depth)
  if (ix0 >= ix1 - EPS || iy0 >= iy1 - EPS) return [r] // no real overlap
  const out: SlabRect[] = []
  if (iy0 - r.y > EPS) out.push({ x: r.x, y: r.y, width: r.width, depth: iy0 - r.y }) // south
  if (r.y + r.depth - iy1 > EPS) out.push({ x: r.x, y: iy1, width: r.width, depth: r.y + r.depth - iy1 }) // north
  if (ix0 - r.x > EPS) out.push({ x: r.x, y: iy0, width: ix0 - r.x, depth: iy1 - iy0 }) // west
  if (r.x + r.width - ix1 > EPS) out.push({ x: ix1, y: iy0, width: r.x + r.width - ix1, depth: iy1 - iy0 }) // east
  return out
}

/**
 * `outer` minus every hole → non-overlapping solid strips. Each hole carves all
 * current strips in turn, so overlapping/adjacent holes never produce
 * overlapping output. Returns `[outer]` (rounded) when there are no holes —
 * callers can then keep the legacy single-slab prim byte-identical. All coords
 * round2'd. Degenerate outer (≤0) → `[]`.
 */
export function subtractRectHoles(outer: SlabRect, holes: SlabRect[]): SlabRect[] {
  if (outer.width <= EPS || outer.depth <= EPS) return []
  let rects: SlabRect[] = [outer]
  for (const h of holes) {
    if (h.width <= EPS || h.depth <= EPS) continue
    rects = rects.flatMap((r) => subtractOne(r, h))
  }
  return rects.map((r) => ({
    x: round2(r.x),
    y: round2(r.y),
    width: round2(r.width),
    depth: round2(r.depth),
  }))
}
