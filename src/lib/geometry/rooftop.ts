/**
 * Partial-rooftop geometry (SP7 Task 1) — the single source of truth for
 * decomposing a roof footprint into a deck rectangle + the surrounding roof
 * strips. Pure module: no react / zustand / three, only plain arithmetic on the
 * shared footprint helper and the round2/clamp primitives.
 *
 * A layout with a `floor-rooftop` floor can carry an optional `rooftopArea`
 * rectangle (site metres, same coordinate frame as rooms). When present and
 * smaller than the building footprint, the deck covers only that rectangle and
 * the remaining L/U ring of the footprint is covered by `layout.roof`. This
 * module clamps the deck inside the footprint and cuts the remainder into up to
 * four non-overlapping strips (guillotine, horizontal cut first) that every
 * downstream consumer (3D, elevations, sections, roof detail, RAB, loads) reads
 * from — so they all agree on which mass is deck and which is roof.
 */
import { round2, clamp } from "@/lib/geometry"
import { buildingFootprint, type BuildingFootprint } from "@/lib/structural/grid"
import type { DesignLayout } from "@/types"

/** Round to 1 decimal (perimeters / lengths — matches the RAB `round1`). */
function round1(n: number): number {
  return Math.round(n * 10) / 10
}

export type RooftopArea = { x: number; y: number; width: number; depth: number }

export type RooftopStrip = {
  x: number
  y: number
  width: number
  depth: number
  /** Which sides of this strip lie on the footprint boundary (→ overhang there). */
  touches: { n: boolean; s: boolean; w: boolean; e: boolean }
}

/** The rooftop floor id — shared convention across the drawings/sheet code. */
const ROOFTOP_FLOOR_ID = "floor-rooftop"
/** Tolerance (metres) for "on the boundary" / "same edge" comparisons. */
const EPS = 0.01
/** Minimum deck dimension (metres) — a deck thinner than this is unusable. */
export const MIN_DECK_M = 1.5

/** True when this layout has a rooftop floor at all. */
export function hasRooftopFloor(layout: DesignLayout): boolean {
  return (layout.floors ?? []).some((f) => f.id === ROOFTOP_FLOOR_ID)
}

/**
 * Clamp a deck rect inside the footprint: each dimension is at least 1.5 m (or
 * the full footprint dimension if that is smaller), and the rect is fully
 * contained. All outputs are round2'd.
 */
export function clampRooftopArea(
  area: RooftopArea,
  fp: BuildingFootprint
): RooftopArea {
  // Corrupted persisted rooftopArea (NaN in any field) → fall back to a
  // full-footprint deck (full deck → 0 strips → treated as non-partial, the
  // safe/legacy behaviour) instead of silently producing NaN geometry.
  if (
    !Number.isFinite(area.x) ||
    !Number.isFinite(area.y) ||
    !Number.isFinite(area.width) ||
    !Number.isFinite(area.depth)
  ) {
    return {
      x: round2(fp.x0),
      y: round2(fp.y0),
      width: round2(fp.widthM),
      depth: round2(fp.depthM),
    }
  }

  const fx0 = fp.x0
  const fy0 = fp.y0
  const fw = fp.widthM
  const fd = fp.depthM

  // Width/depth: at least MIN_DECK_M, but never wider than the footprint.
  const width = clamp(area.width, Math.min(MIN_DECK_M, fw), fw)
  const depth = clamp(area.depth, Math.min(MIN_DECK_M, fd), fd)

  // Position: keep the (possibly grown) rect fully inside the footprint.
  const x = clamp(area.x, fx0, fx0 + fw - width)
  const y = clamp(area.y, fy0, fy0 + fd - depth)

  return {
    x: round2(x),
    y: round2(y),
    width: round2(width),
    depth: round2(depth),
  }
}

/**
 * A sensible DEFAULT partial deck for a building whose rooftop currently covers
 * the WHOLE footprint (full flat deck → pitched roof suppressed). Puts a terrace
 * strip full-width on the BACK (max-y) side, ~45% deep, leaving the front for a
 * pitched roof. Both the deck and the leftover roof strip get ≥ MIN_DECK_M.
 * Returns null when the footprint is too shallow to split into deck + roof — the
 * caller should then keep the rooftop full (a pitched roof simply isn't possible
 * without shrinking the building).
 */
export function defaultDeckArea(fp: BuildingFootprint): RooftopArea | null {
  if (fp.widthM < MIN_DECK_M || fp.depthM < 2 * MIN_DECK_M) return null
  const deckDepth = round2(clamp(fp.depthM * 0.45, MIN_DECK_M, fp.depthM - MIN_DECK_M))
  return {
    x: round2(fp.x0),
    y: round2(fp.y0 + fp.depthM - deckDepth),
    width: round2(fp.widthM),
    depth: deckDepth,
  }
}

/**
 * True when this layout has a rooftop floor AND `rooftopArea` is present AND the
 * clamped deck covers strictly less than the footprint (so roof strips exist).
 */
export function isPartialRooftop(layout: DesignLayout): boolean {
  if (!hasRooftopFloor(layout) || !layout.rooftopArea) return false
  const fp = buildingFootprint(layout)
  if (fp.widthM <= 0 || fp.depthM <= 0) return false
  const deck = clampRooftopArea(layout.rooftopArea, fp)
  // Derived DIRECTLY from the strip decomposition so isPartialRooftop and
  // rooftopStrips can never disagree (a partial deck ⇔ at least one roof strip).
  return rooftopStrips(fp, deck).length > 0
}

/**
 * Decompose `footprint − deck` into ≤ 4 non-overlapping strips (guillotine,
 * horizontal cut first): a full-width South strip (below the deck) + North strip
 * (above the deck), then West + East strips spanning only the deck's y-range.
 * Returns `[]` when the deck covers the whole footprint. The deck is assumed
 * clamped ⊆ footprint, but is re-intersected here so slight rounding overruns
 * stay safe.
 */
export function rooftopStrips(
  fp: BuildingFootprint,
  deck: RooftopArea
): RooftopStrip[] {
  const fx0 = fp.x0
  const fy0 = fp.y0
  const fx1 = fp.x0 + fp.widthM
  const fy1 = fp.y0 + fp.depthM

  // Intersect the deck with the footprint (defensive against rounding overruns).
  const dx0 = clamp(deck.x, fx0, fx1)
  const dy0 = clamp(deck.y, fy0, fy1)
  const dx1 = clamp(deck.x + deck.width, fx0, fx1)
  const dy1 = clamp(deck.y + deck.depth, fy0, fy1)

  const strips: RooftopStrip[] = []

  const withTouches = (r: {
    x: number
    y: number
    width: number
    depth: number
  }): RooftopStrip => ({
    ...r,
    touches: {
      n: r.y + r.depth >= fy1 - EPS,
      s: r.y <= fy0 + EPS,
      w: r.x <= fx0 + EPS,
      e: r.x + r.width >= fx1 - EPS,
    },
  })

  // South strip (below the deck, full footprint width).
  if (dy0 - fy0 > EPS) {
    strips.push(
      withTouches({
        x: fx0,
        y: fy0,
        width: fp.widthM,
        depth: round2(dy0 - fy0),
      })
    )
  }

  // North strip (above the deck, full footprint width).
  if (fy1 - dy1 > EPS) {
    strips.push(
      withTouches({
        x: fx0,
        y: round2(dy1),
        width: fp.widthM,
        depth: round2(fy1 - dy1),
      })
    )
  }

  // West strip (left of the deck, spanning only the deck's y-range).
  if (dx0 - fx0 > EPS) {
    strips.push(
      withTouches({
        x: fx0,
        y: round2(dy0),
        width: round2(dx0 - fx0),
        depth: round2(dy1 - dy0),
      })
    )
  }

  // East strip (right of the deck, spanning only the deck's y-range).
  if (fx1 - dx1 > EPS) {
    strips.push(
      withTouches({
        x: round2(dx1),
        y: round2(dy0),
        width: round2(fx1 - dx1),
        depth: round2(dy1 - dy0),
      })
    )
  }

  return strips
}

/**
 * Expand a strip by `overhangM` ONLY on sides touching the footprint boundary,
 * so the roof over the strip overhangs its eaves/verges (the building's outer
 * edges) but its deck-facing edge stays flush with the deck (no clash with the
 * deck slab/railing). Returns a rect in footprint/site coords (round2'd).
 */
export function expandStripForOverhang(
  strip: RooftopStrip,
  overhangM: number
): RooftopArea {
  const ov = Math.max(0, overhangM)
  const x = strip.x - (strip.touches.w ? ov : 0)
  const y = strip.y - (strip.touches.s ? ov : 0)
  const width = strip.width + (strip.touches.w ? ov : 0) + (strip.touches.e ? ov : 0)
  const depth = strip.depth + (strip.touches.s ? ov : 0) + (strip.touches.n ? ov : 0)
  return { x: round2(x), y: round2(y), width: round2(width), depth: round2(depth) }
}

/**
 * The clamped deck rect for a layout that has a rooftop floor — or `null` when
 * this layout has no rooftop floor / degenerate footprint. Shared by the area
 * helpers below so they resolve the deck exactly once, the same way.
 */
function resolvedDeck(
  layout: DesignLayout
): { fp: BuildingFootprint; deck: RooftopArea; partial: boolean } | null {
  if (!hasRooftopFloor(layout)) return null
  const fp = buildingFootprint(layout)
  if (fp.widthM <= 0 || fp.depthM <= 0) return null
  // No explicit rooftopArea → the deck covers the whole footprint (legacy full
  // rooftop). Otherwise clamp it and let the strip decomposition decide whether
  // it is actually partial (deck < footprint ⇔ ≥ 1 roof strip).
  if (!layout.rooftopArea) {
    return {
      fp,
      deck: { x: fp.x0, y: fp.y0, width: fp.widthM, depth: fp.depthM },
      partial: false,
    }
  }
  const deck = clampRooftopArea(layout.rooftopArea, fp)
  const partial = rooftopStrips(fp, deck).length > 0
  return {
    fp,
    deck: partial ? deck : { x: fp.x0, y: fp.y0, width: fp.widthM, depth: fp.depthM },
    partial,
  }
}

/**
 * Walk-on deck area (m²): partial rooftop → the `rooftopArea` rectangle; full
 * rooftop (rooftopArea absent OR == footprint) → the building footprint area;
 * no rooftop floor → 0. This is what the RAB rooftop waterproofing/finishing
 * line bills (rebased from the old whole-lot area).
 */
export function deckAreaM2(layout: DesignLayout): number {
  const r = resolvedDeck(layout)
  if (!r) return 0
  return round2(r.deck.width * r.deck.depth)
}

/**
 * Deck perimeter (m): partial → `2·(w+d)` of the `rooftopArea`; full rooftop →
 * `2·(w+d)` of the building footprint; no rooftop floor → 0. This is what the
 * RAB rooftop railing line bills (rebased from the old whole-lot perimeter).
 */
export function deckPerimeterM(layout: DesignLayout): number {
  const r = resolvedDeck(layout)
  if (!r) return 0
  return round1(2 * (r.deck.width + r.deck.depth))
}

/**
 * Total footprint area of the ROOFED strips (m²) = `footprint − deck`, PARTIAL
 * rooftops only; full rooftop / non-rooftop → 0. Summed from the strip
 * decomposition (disjoint, exactly tiling `footprint − deck`), so this equals
 * `buildingFootprintArea − deckAreaM2` for a partial deck. This is what the RAB
 * roof-material line bills for a partial rooftop.
 */
export function roofStripsAreaM2(layout: DesignLayout): number {
  const r = resolvedDeck(layout)
  if (!r || !r.partial) return 0
  const strips = rooftopStrips(r.fp, r.deck)
  return round2(strips.reduce((t, s) => t + s.width * s.depth, 0))
}
