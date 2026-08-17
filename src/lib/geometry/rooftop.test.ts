import { describe, it, expect } from "vitest"

import { rectsOverlap } from "@/lib/geometry"
import {
  clampRooftopArea,
  deckAreaM2,
  deckPerimeterM,
  defaultDeckArea,
  expandStripForOverhang,
  isPartialRooftop,
  rooftopStrips,
  roofStripsAreaM2,
  type RooftopArea,
  type RooftopStrip,
} from "@/lib/geometry/rooftop"
import { validateLayout } from "@/lib/validation"
import type { BuildingFootprint } from "@/lib/structural/grid"
import type { DesignLayout, Floor, Room } from "@/types"

/* ── fixtures ── */

const FP: BuildingFootprint = { x0: 0, y0: 0, widthM: 10, depthM: 8 }

const room = (over: Partial<Room>): Room => ({
  id: "r",
  floorId: "floor-1",
  name: "R",
  type: "ruang_tamu",
  x: 0,
  y: 0,
  width: 3,
  depth: 3,
  areaM2: 9,
  ...over,
})

const REG_FLOOR: Floor = { id: "floor-1", level: 1, name: "Lantai 1", heightM: 3 }
const RT_FLOOR: Floor = { id: "floor-rooftop", level: 2, name: "Rooftop", heightM: 3 }

/** Minimal DesignLayout with a 10×8 footprint from the origin (base room on
 *  floor-1) plus whatever extra rooms / floors / rooftopArea are supplied. */
const layout = (over: {
  floors?: Floor[]
  rooms?: Room[]
  rooftopArea?: RooftopArea
}): DesignLayout =>
  ({
    id: "l",
    projectId: "p",
    versionId: "v",
    floors: over.floors ?? [REG_FLOOR, RT_FLOOR],
    rooms: over.rooms ?? [room({ id: "base", x: 0, y: 0, width: 10, depth: 8, areaM2: 80 })],
    walls: [],
    openings: [],
    stairs: [],
    pools: [],
    ...(over.rooftopArea ? { rooftopArea: over.rooftopArea } : {}),
    validation: { passed: true, issues: [] },
  }) as DesignLayout

/** Sum the areas of a set of strips. */
const stripsArea = (strips: RooftopStrip[]): number =>
  strips.reduce((t, s) => t + s.width * s.depth, 0)

/** Assert no two strips overlap. */
const assertDisjoint = (strips: RooftopStrip[]) => {
  for (let i = 0; i < strips.length; i++) {
    for (let j = i + 1; j < strips.length; j++) {
      expect(rectsOverlap(strips[i], strips[j])).toBe(false)
    }
  }
}

/* ── defaultDeckArea ── */

describe("defaultDeckArea", () => {
  it("returns a full-width back strip ~45% deep that is genuinely partial", () => {
    // 10×8: deckDepth = clamp(8*0.45=3.6, 1.5, 6.5) = 3.6; on the back (max-y).
    const deck = defaultDeckArea(FP)
    expect(deck).toEqual({ x: 0, y: 4.4, width: 10, depth: 3.6 })
    // Feeding it back as rooftopArea yields a partial rooftop (roof strips exist).
    expect(isPartialRooftop(layout({ rooftopArea: deck! }))).toBe(true)
    // Already valid → clampRooftopArea leaves it unchanged.
    expect(clampRooftopArea(deck!, FP)).toEqual(deck)
  })

  it("returns null when the footprint is too shallow to split (deck + roof)", () => {
    expect(defaultDeckArea({ x0: 0, y0: 0, widthM: 10, depthM: 2.5 })).toBeNull()
    expect(defaultDeckArea({ x0: 0, y0: 0, widthM: 1, depthM: 8 })).toBeNull()
  })
})

/* ── clampRooftopArea ── */

describe("clampRooftopArea", () => {
  it("leaves a within-bounds rect unchanged", () => {
    expect(clampRooftopArea({ x: 2, y: 2, width: 4, depth: 3 }, FP)).toEqual({
      x: 2,
      y: 2,
      width: 4,
      depth: 3,
    })
  })

  it("clamps an oversized rect to the footprint", () => {
    expect(clampRooftopArea({ x: 0, y: 0, width: 20, depth: 20 }, FP)).toEqual({
      x: 0,
      y: 0,
      width: 10,
      depth: 8,
    })
  })

  it("grows a below-minimum rect to 1.5 m per dimension", () => {
    expect(clampRooftopArea({ x: 2, y: 2, width: 0.5, depth: 0.3 }, FP)).toEqual({
      x: 2,
      y: 2,
      width: 1.5,
      depth: 1.5,
    })
  })

  it("shifts an off-corner rect fully inside the footprint", () => {
    // 3×3 rect placed at (9,7) would overrun 10×8 → shifted to (7,5).
    expect(clampRooftopArea({ x: 9, y: 7, width: 3, depth: 3 }, FP)).toEqual({
      x: 7,
      y: 5,
      width: 3,
      depth: 3,
    })
  })

  it("clamps to the footprint dimension when the footprint is smaller than 1.5 m", () => {
    const tiny: BuildingFootprint = { x0: 0, y0: 0, widthM: 1, depthM: 1 }
    expect(clampRooftopArea({ x: 0, y: 0, width: 5, depth: 5 }, tiny)).toEqual({
      x: 0,
      y: 0,
      width: 1,
      depth: 1,
    })
  })

  it("falls back to the full footprint when a field is not finite (NaN guard)", () => {
    // A corrupted persisted rect (NaN x) → full-footprint deck (finite, == footprint).
    const out = clampRooftopArea({ x: NaN, y: 2, width: 4, depth: 3 }, FP)
    expect(out).toEqual({ x: 0, y: 0, width: 10, depth: 8 })
    expect(Number.isFinite(out.x)).toBe(true)
    expect(Number.isFinite(out.y)).toBe(true)
    expect(Number.isFinite(out.width)).toBe(true)
    expect(Number.isFinite(out.depth)).toBe(true)
  })
})

/* ── isPartialRooftop ── */

describe("isPartialRooftop", () => {
  it("is false without a floor-rooftop floor", () => {
    expect(
      isPartialRooftop(layout({ floors: [REG_FLOOR], rooftopArea: { x: 2, y: 2, width: 4, depth: 3 } }))
    ).toBe(false)
  })

  it("is false when rooftopArea is absent", () => {
    expect(isPartialRooftop(layout({}))).toBe(false)
  })

  it("is false when the deck covers the whole footprint", () => {
    expect(isPartialRooftop(layout({ rooftopArea: { x: 0, y: 0, width: 10, depth: 8 } }))).toBe(false)
  })

  it("is true when the deck is smaller than the footprint", () => {
    expect(isPartialRooftop(layout({ rooftopArea: { x: 2, y: 2, width: 4, depth: 3 } }))).toBe(true)
  })

  it("agrees with rooftopStrips for a deck with a 1 cm gap on one side (FIX-1 invariant)", () => {
    // Old area-epsilon predicate said "partial" here while rooftopStrips cut 0
    // strips → a roof toggle with nothing to toggle. Both must now agree.
    const deck: RooftopArea = { x: 0, y: 0.01, width: 10, depth: 7.99 }
    const viaPredicate = isPartialRooftop(layout({ rooftopArea: deck }))
    const viaStrips = rooftopStrips(FP, clampRooftopArea(deck, FP)).length > 0
    expect(viaPredicate).toBe(viaStrips)
  })
})

/* ── rooftopStrips ── */

describe("rooftopStrips", () => {
  it("decomposes a centred deck into 4 strips with correct rects + touches", () => {
    const deck: RooftopArea = { x: 3, y: 2, width: 4, depth: 4 }
    const strips = rooftopStrips(FP, deck)
    expect(strips).toHaveLength(4)

    // Order: South, North, West, East.
    expect(strips[0]).toEqual({
      x: 0, y: 0, width: 10, depth: 2,
      touches: { n: false, s: true, w: true, e: true },
    })
    expect(strips[1]).toEqual({
      x: 0, y: 6, width: 10, depth: 2,
      touches: { n: true, s: false, w: true, e: true },
    })
    // West strip touches only its outer (west) edge.
    expect(strips[2]).toEqual({
      x: 0, y: 2, width: 3, depth: 4,
      touches: { n: false, s: false, w: true, e: false },
    })
    // East strip touches only its outer (east) edge.
    expect(strips[3]).toEqual({
      x: 7, y: 2, width: 3, depth: 4,
      touches: { n: false, s: false, w: false, e: true },
    })

    assertDisjoint(strips)
    expect(stripsArea(strips) + deck.width * deck.depth).toBeCloseTo(FP.widthM * FP.depthM, 6)
  })

  it("decomposes a corner deck into 2 strips", () => {
    const deck: RooftopArea = { x: 0, y: 0, width: 4, depth: 3 }
    const strips = rooftopStrips(FP, deck)
    expect(strips).toHaveLength(2)

    // North strip (full width above the deck).
    expect(strips[0]).toEqual({
      x: 0, y: 3, width: 10, depth: 5,
      touches: { n: true, s: false, w: true, e: true },
    })
    // East strip (right of the deck, only over the deck's y-range).
    expect(strips[1]).toEqual({
      x: 4, y: 0, width: 6, depth: 3,
      touches: { n: false, s: true, w: false, e: true },
    })

    assertDisjoint(strips)
    expect(stripsArea(strips) + deck.width * deck.depth).toBeCloseTo(FP.widthM * FP.depthM, 6)
  })

  it("decomposes a deck flush against one full-width edge into 3 strips", () => {
    // Deck flush on the south edge (y=0) but not full width → North (full width)
    // + West + East, no South strip.
    const fp: BuildingFootprint = { x0: 0, y0: 0, widthM: 8, depthM: 6 }
    const deck: RooftopArea = { x: 2, y: 0, width: 3, depth: 4 }
    const strips = rooftopStrips(fp, deck)
    expect(strips).toHaveLength(3)

    // Order: North, West, East (South is skipped — deck is flush there).
    expect(strips[0]).toEqual({
      x: 0, y: 4, width: 8, depth: 2,
      touches: { n: true, s: false, w: true, e: true },
    })
    expect(strips[1]).toEqual({
      x: 0, y: 0, width: 2, depth: 4,
      touches: { n: false, s: true, w: true, e: false },
    })
    expect(strips[2]).toEqual({
      x: 5, y: 0, width: 3, depth: 4,
      touches: { n: false, s: true, w: false, e: true },
    })

    assertDisjoint(strips)
    expect(stripsArea(strips) + deck.width * deck.depth).toBeCloseTo(fp.widthM * fp.depthM, 6)
  })

  it("decomposes a full-width edge deck into 1 strip", () => {
    const deck: RooftopArea = { x: 0, y: 0, width: 10, depth: 3 }
    const strips = rooftopStrips(FP, deck)
    expect(strips).toHaveLength(1)
    expect(strips[0]).toEqual({
      x: 0, y: 3, width: 10, depth: 5,
      touches: { n: true, s: false, w: true, e: true },
    })
    expect(stripsArea(strips) + deck.width * deck.depth).toBeCloseTo(FP.widthM * FP.depthM, 6)
  })

  it("returns no strips when the deck equals the footprint", () => {
    expect(rooftopStrips(FP, { x: 0, y: 0, width: 10, depth: 8 })).toEqual([])
  })
})

/* ── expandStripForOverhang ── */

describe("expandStripForOverhang", () => {
  const strip = (touches: RooftopStrip["touches"]): RooftopStrip => ({
    x: 3,
    y: 2,
    width: 4,
    depth: 3,
    touches,
  })

  it("expands on all four sides for a fully-interior strip touching every edge", () => {
    const s = strip({ n: true, s: true, w: true, e: true })
    expect(expandStripForOverhang(s, 0.5)).toEqual({
      x: 2.5, // 3 - 0.5 (w)
      y: 1.5, // 2 - 0.5 (s)
      width: 5, // 4 + 0.5 (w) + 0.5 (e)
      depth: 4, // 3 + 0.5 (s) + 0.5 (n)
    })
  })

  it("expands only the west side for a strip touching w only", () => {
    const s = strip({ n: false, s: false, w: true, e: false })
    expect(expandStripForOverhang(s, 0.5)).toEqual({
      x: 2.5, // 3 - 0.5
      y: 2, // unchanged (s not touching)
      width: 4.5, // 4 + 0.5 (w only)
      depth: 3, // unchanged
    })
  })

  it("leaves the strip unchanged for 0 overhang", () => {
    const s = strip({ n: true, s: true, w: true, e: true })
    expect(expandStripForOverhang(s, 0)).toEqual({ x: 3, y: 2, width: 4, depth: 3 })
  })

  it("treats a negative overhang as 0 (no shrink)", () => {
    const s = strip({ n: true, s: true, w: true, e: true })
    expect(expandStripForOverhang(s, -1)).toEqual({ x: 3, y: 2, width: 4, depth: 3 })
  })
})

/* ── deck / strip area helpers (RAB + struktur consumers) ── */

describe("deckAreaM2 / deckPerimeterM / roofStripsAreaM2", () => {
  /** An 8×6 footprint (base room) with a rooftop floor + a 4×3 partial deck. */
  const partial8x6 = () =>
    layout({
      rooms: [room({ id: "base", x: 0, y: 0, width: 8, depth: 6, areaM2: 48 })],
      rooftopArea: { x: 2, y: 1, width: 4, depth: 3 },
    })

  it("partial: deck 4×3 in an 8×6 footprint → deckArea 12, strips 36, perimeter 14", () => {
    const l = partial8x6()
    expect(isPartialRooftop(l)).toBe(true)
    expect(deckAreaM2(l)).toBe(12) // 4 × 3
    expect(roofStripsAreaM2(l)).toBe(36) // 48 − 12 (Σ strip w×d)
    expect(deckPerimeterM(l)).toBe(14) // 2 × (4 + 3)
    // Deck + strips reconstitute the whole footprint exactly.
    expect(deckAreaM2(l) + roofStripsAreaM2(l)).toBe(48)
  })

  it("full rooftop (rooftopArea absent) → deckArea = footprintArea, strips 0", () => {
    // Base room 10×8 → footprint 80 m², rooftop floor present, no rooftopArea.
    const l = layout({})
    expect(isPartialRooftop(l)).toBe(false)
    expect(deckAreaM2(l)).toBe(80)
    expect(deckPerimeterM(l)).toBe(36) // 2 × (10 + 8)
    expect(roofStripsAreaM2(l)).toBe(0)
  })

  it("full rooftop (rooftopArea == footprint) → deckArea = footprintArea, strips 0", () => {
    const l = layout({ rooftopArea: { x: 0, y: 0, width: 10, depth: 8 } })
    expect(isPartialRooftop(l)).toBe(false)
    expect(deckAreaM2(l)).toBe(80)
    expect(roofStripsAreaM2(l)).toBe(0)
  })

  it("non-rooftop (no floor-rooftop) → all 0", () => {
    const l = layout({ floors: [REG_FLOOR] })
    expect(deckAreaM2(l)).toBe(0)
    expect(deckPerimeterM(l)).toBe(0)
    expect(roofStripsAreaM2(l)).toBe(0)
  })
})

/* ── validateLayout: rooftop-outside warning ── */

describe("validateLayout — rooftop room outside deck", () => {
  const bigSite = { widthM: 20, depthM: 20 }
  const rooms = [
    room({ id: "base", x: 0, y: 0, width: 10, depth: 8, areaM2: 80 }),
    room({ id: "rt-in", floorId: "floor-rooftop", x: 3, y: 2, width: 2, depth: 2, areaM2: 4 }),
    room({ id: "rt-out", floorId: "floor-rooftop", x: 8, y: 6, width: 3, depth: 3, areaM2: 9 }),
  ]

  it("warns for a rooftop room outside the clamped deck", () => {
    const res = validateLayout(layout({ rooms, rooftopArea: { x: 2, y: 2, width: 5, depth: 4 } }), bigSite)
    expect(res.issues.some((i) => i.id === "rooftop-outside:rt-out")).toBe(true)
  })

  it("does not warn for a rooftop room inside the deck", () => {
    const res = validateLayout(layout({ rooms, rooftopArea: { x: 2, y: 2, width: 5, depth: 4 } }), bigSite)
    expect(res.issues.some((i) => i.id === "rooftop-outside:rt-in")).toBe(false)
  })

  it("does not warn at all when rooftopArea is absent (full deck)", () => {
    const res = validateLayout(layout({ rooms }), bigSite)
    expect(res.issues.some((i) => i.id.startsWith("rooftop-outside:"))).toBe(false)
  })
})
