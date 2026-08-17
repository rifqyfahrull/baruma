import { describe, it, expect } from "vitest"
import { buildElevation, buildPartialRoof, roofProfile } from "./elevation"
import { round2 } from "@/lib/geometry"
import { buildingFootprint } from "@/lib/structural/grid"
import {
  clampRooftopArea,
  expandStripForOverhang,
  rooftopStrips,
} from "@/lib/geometry/rooftop"
import type { DesignLayout, Floor, Opening, RoofSpec, RoofZone, Room } from "@/types"

const floor = (over: Partial<Floor>): Floor => ({
  id: "f1", level: 0, name: "Lantai 1", heightM: 3, ...over,
})
const room = (over: Partial<Room>): Room => ({
  id: "r", floorId: "f1", name: "R", type: "kamar_tidur",
  x: 0, y: 0, width: 3, depth: 3, areaM2: 9, ...over,
})
const opening = (over: Partial<Opening>): Opening => ({
  id: "o", floorId: "f1", wallId: "r:s", type: "window", positionM: 1, widthM: 1, heightM: 1, ...over,
})
const layout = (over: Partial<DesignLayout>): DesignLayout => ({
  id: "l", projectId: "p", versionId: "v",
  floors: [floor({})], rooms: [], walls: [], openings: [], stairs: [], pools: [],
  validation: { passed: true, issues: [] },
  ...over,
})

// Fixture: 2 floors. Floor 1: Kamar A (0..4 x 0..3) + Kamar B (4..7 x 0..3),
// touching (union width 7). Carport (OPEN — no walls) south of A, at (0..3, 3..6):
// must NOT contribute to the silhouette or occlude anything. Floor 2: only
// Kamar C (0..4 x 0..3) — a narrower footprint than floor 1.
// Openings: window on A's south wall, window on A's north wall (mirror check,
// nothing occludes it), door on B's south wall.
const baseLayout = layout({
  floors: [
    floor({ id: "f1", level: 0, name: "Lantai 1", heightM: 3 }),
    floor({ id: "f2", level: 1, name: "Lantai 2", heightM: 3 }),
  ],
  rooms: [
    room({ id: "A", floorId: "f1", name: "Kamar A", type: "kamar_tidur", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 }),
    room({ id: "B", floorId: "f1", name: "Kamar B", type: "kamar_tidur", x: 4, y: 0, width: 3, depth: 3, areaM2: 9 }),
    room({ id: "CP", floorId: "f1", name: "Carport", type: "carport", x: 0, y: 3, width: 3, depth: 3, areaM2: 9 }),
    room({ id: "C", floorId: "f2", name: "Kamar C", type: "kamar_tidur", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 }),
  ],
  openings: [
    opening({ id: "winAS", floorId: "f1", wallId: "A:s", type: "window", positionM: 1, widthM: 1.2, heightM: 1.2 }),
    opening({ id: "winAN", floorId: "f1", wallId: "A:n", type: "window", positionM: 1, widthM: 1.2, heightM: 1.2 }),
    opening({ id: "doorBS", floorId: "f1", wallId: "B:s", type: "door", positionM: 0.5, widthM: 0.9, heightM: 2.1 }),
  ],
})

describe("buildElevation — title mapping", () => {
  it("maps side to the Indonesian elevation title", () => {
    expect(buildElevation(baseLayout, "s").title).toBe("Tampak Selatan")
    expect(buildElevation(baseLayout, "n").title).toBe("Tampak Utara")
    expect(buildElevation(baseLayout, "e").title).toBe("Tampak Timur")
    expect(buildElevation(baseLayout, "w").title).toBe("Tampak Barat")
  })
})

describe("buildElevation — south view silhouette", () => {
  it("unions non-OPEN room footprints per floor and excludes OPEN rooms (carport)", () => {
    const d = buildElevation(baseLayout, "s")
    expect(d.widthM).toBe(7) // union of A[0,4] + B[4,7]; carport excluded
    expect(d.heightM).toBe(6) // 2 floors x 3 m, no rooftop

    // Floor 1 block [0,7], y in [0,3]
    expect(d.lines).toContainEqual({ x1: 0, y1: 0, x2: 0, y2: 3, kind: "outline" })
    expect(d.lines).toContainEqual({ x1: 7, y1: 0, x2: 7, y2: 3, kind: "outline" })
    expect(d.lines).toContainEqual({ x1: 0, y1: 3, x2: 7, y2: 3, kind: "outline" })

    // Floor 2 block [0,4] (only room C — narrower than floor 1), y in [3,6]
    expect(d.lines).toContainEqual({ x1: 0, y1: 3, x2: 0, y2: 6, kind: "outline" })
    expect(d.lines).toContainEqual({ x1: 4, y1: 3, x2: 4, y2: 6, kind: "outline" })

    // Inter-floor slab + roof slab (double line) at the true top
    expect(d.lines).toContainEqual({ x1: 0, y1: 3, x2: 4, y2: 3, kind: "slab" })
    expect(d.lines).toContainEqual({ x1: 0, y1: 6, x2: 4, y2: 6, kind: "slab" })
    expect(d.lines).toContainEqual({ x1: 0, y1: 6.15, x2: 4, y2: 6.15, kind: "slab" })

    // Ground line
    expect(d.lines).toContainEqual({ x1: -0.5, y1: 0, x2: 7.5, y2: 0, kind: "ground" })
  })

  it("places window/door rects using build-model's center-based positionM convention", () => {
    const d = buildElevation(baseLayout, "s")
    const openingLines = d.lines.filter((l) => l.kind === "opening")
    expect(openingLines).toHaveLength(8) // 2 rects x 4 lines

    // Window A:s — openingSegment centers positionM(1) with half-width 0.6 =>
    // h in [0.4, 1.6]; sill 0.9 + heightM 1.2 => y in [0.9, 2.1]
    expect(openingLines).toContainEqual({ x1: 0.4, y1: 0.9, x2: 1.6, y2: 0.9, kind: "opening" })
    expect(openingLines).toContainEqual({ x1: 0.4, y1: 2.1, x2: 1.6, y2: 2.1, kind: "opening" })
    expect(openingLines).toContainEqual({ x1: 0.4, y1: 0.9, x2: 0.4, y2: 2.1, kind: "opening" })
    expect(openingLines).toContainEqual({ x1: 1.6, y1: 0.9, x2: 1.6, y2: 2.1, kind: "opening" })

    // Door B:s — centered at room.x(4) + positionM(0.5), half-width 0.45 =>
    // h in [4.05, 4.95]; sill 0 (door) + heightM 2.1 => y in [0, 2.1]
    expect(openingLines).toContainEqual({ x1: 4.05, y1: 0, x2: 4.95, y2: 0, kind: "opening" })
    expect(openingLines).toContainEqual({ x1: 4.05, y1: 2.1, x2: 4.95, y2: 2.1, kind: "opening" })
    expect(openingLines).toContainEqual({ x1: 4.05, y1: 0, x2: 4.05, y2: 2.1, kind: "opening" })
    expect(openingLines).toContainEqual({ x1: 4.95, y1: 0, x2: 4.95, y2: 2.1, kind: "opening" })
  })

  it("emits one x-axis DimChain with union block boundaries + visible opening edges (unique, sorted)", () => {
    const d = buildElevation(baseLayout, "s")
    expect(d.dims).toEqual([{ axis: "x", at: -0.8, points: [0, 0.4, 1.6, 4, 4.05, 4.95, 7] }])
  })

  it("emits a LevelMark per floor baseY plus the roof peak, formatted via formatElevation", () => {
    const d = buildElevation(baseLayout, "s")
    expect(d.levels).toContainEqual({ y: 0, label: "±0 m" })
    expect(d.levels).toContainEqual({ y: 3, label: "+3 m" })
    expect(d.levels).toContainEqual({ y: 6, label: "+6 m" })
  })
})

describe("buildElevation — north view (mirror)", () => {
  it("mirrors the horizontal axis (h = totalW - x) and only shows openings on the n wall", () => {
    const d = buildElevation(baseLayout, "n")
    const openingLines = d.lines.filter((l) => l.kind === "opening")
    // Only winAN (A's north wall) is visible; winAS/doorBS are on the s wall.
    expect(openingLines).toHaveLength(4)
    // A's window x-span [0.4,1.6] mirrors to totalW(7) - [1.6,0.4] = [5.4, 6.6].
    expect(openingLines).toContainEqual({ x1: 5.4, y1: 0.9, x2: 6.6, y2: 0.9, kind: "opening" })
    expect(openingLines).toContainEqual({ x1: 5.4, y1: 2.1, x2: 6.6, y2: 2.1, kind: "opening" })
    expect(openingLines).toContainEqual({ x1: 5.4, y1: 0.9, x2: 5.4, y2: 2.1, kind: "opening" })
    expect(openingLines).toContainEqual({ x1: 6.6, y1: 0.9, x2: 6.6, y2: 2.1, kind: "opening" })
  })
})

describe("buildElevation — occlusion", () => {
  it("hides an opening occluded by a nearer solid room on the same floor", () => {
    const occludedLayout = layout({
      floors: [floor({ id: "f1", level: 0, heightM: 3 })],
      rooms: [
        room({ id: "A", floorId: "f1", name: "Kamar A", type: "kamar_tidur", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 }),
        room({ id: "D", floorId: "f1", name: "Gudang", type: "gudang", x: 0, y: 3, width: 4, depth: 2, areaM2: 8 }),
      ],
      openings: [opening({ id: "winAS", floorId: "f1", wallId: "A:s", type: "window", positionM: 1, widthM: 1.2, heightM: 1.2 })],
    })
    const d = buildElevation(occludedLayout, "s")
    expect(d.lines.filter((l) => l.kind === "opening")).toHaveLength(0)
  })

  it("does not occlude via an OPEN room in the same footprint (carport)", () => {
    const openLayout = layout({
      floors: [floor({ id: "f1", level: 0, heightM: 3 })],
      rooms: [
        room({ id: "A", floorId: "f1", name: "Kamar A", type: "kamar_tidur", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 }),
        room({ id: "D", floorId: "f1", name: "Carport", type: "carport", x: 0, y: 3, width: 4, depth: 2, areaM2: 8 }),
      ],
      openings: [opening({ id: "winAS", floorId: "f1", wallId: "A:s", type: "window", positionM: 1, widthM: 1.2, heightM: 1.2 })],
    })
    const d = buildElevation(openLayout, "s")
    expect(d.lines.filter((l) => l.kind === "opening")).toHaveLength(4)
  })
})

describe("buildElevation — split-level", () => {
  it("draws an extra slab line at a room's levelOffsetM and shifts its opening's y", () => {
    const splitLayout: DesignLayout = {
      ...baseLayout,
      rooms: baseLayout.rooms.map((r) => (r.id === "B" ? { ...r, levelOffsetM: -0.18 } : r)),
    }
    const d = buildElevation(splitLayout, "s")
    expect(d.lines).toContainEqual({ x1: 4, y1: -0.18, x2: 7, y2: -0.18, kind: "slab" })

    const openingLines = d.lines.filter((l) => l.kind === "opening")
    expect(openingLines).toContainEqual({ x1: 4.05, y1: -0.18, x2: 4.95, y2: -0.18, kind: "opening" })
    expect(openingLines).toContainEqual({ x1: 4.05, y1: 1.92, x2: 4.95, y2: 1.92, kind: "opening" })
  })
})

describe("buildElevation — rooftop block", () => {
  it("draws a block above the roof slab for a solid room on floor-rooftop", () => {
    const rooftopLayout = layout({
      floors: [
        floor({ id: "f1", level: 0, name: "Lantai 1", heightM: 3 }),
        floor({ id: "floor-rooftop", level: 1, name: "Rooftop", heightM: 2 }),
      ],
      rooms: [
        room({ id: "A", floorId: "f1", name: "Kamar A", type: "kamar_tidur", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 }),
        room({ id: "R", floorId: "floor-rooftop", name: "Gudang Atap", type: "gudang", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 }),
      ],
    })
    const d = buildElevation(rooftopLayout, "s")
    expect(d.heightM).toBe(5) // 3 (floor 1) + 2 (rooftop)
    expect(d.lines).toContainEqual({ x1: 0, y1: 3, x2: 0, y2: 5, kind: "outline" })
    expect(d.lines).toContainEqual({ x1: 4, y1: 3, x2: 4, y2: 5, kind: "outline" })
    expect(d.lines).toContainEqual({ x1: 0, y1: 5, x2: 4, y2: 5, kind: "slab" })
    expect(d.levels).toContainEqual({ y: 3, label: "+3 m" })
    expect(d.levels).toContainEqual({ y: 5, label: "+5 m" })
  })

  it("does not inflate height/peak when floor-rooftop contains only OPEN rooms (default thin deck)", () => {
    // Mirrors src/lib/mock/layout.ts's default rooftop: a thin (0.3 m) open
    // deck holding only rooftop_lounge (OPEN_TYPES) rooms — nothing solid is
    // ever drawn there, so the roof slab for the last regular floor is the
    // real top of the building.
    const openRooftopLayout = layout({
      floors: [
        floor({ id: "f1", level: 0, name: "Lantai 1", heightM: 3 }),
        floor({ id: "floor-rooftop", level: 1, name: "Rooftop", heightM: 0.3 }),
      ],
      rooms: [
        room({ id: "A", floorId: "f1", name: "Kamar A", type: "kamar_tidur", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 }),
        room({ id: "L", floorId: "floor-rooftop", name: "Rooftop Lounge", type: "rooftop_lounge", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 }),
      ],
    })
    const d = buildElevation(openRooftopLayout, "s")

    // heightM must be derived from the last regular floor (3), not 3 + 0.3.
    expect(d.heightM).toBe(3)

    // Topmost LevelMark is +3 m, not +3,3 m.
    const topLevel = d.levels.reduce((max, l) => (l.y > max.y ? l : max))
    expect(topLevel).toEqual({ y: 3, label: "+3 m" })
    expect(d.levels).not.toContainEqual({ y: 3.3, label: "+3,3 m" })

    // The last regular floor's roof slab (isTrueTop) still fires: a slab
    // line at y=3 and the double roof-slab line at y=3.15 (DRAW_SLAB_M).
    expect(d.lines).toContainEqual({ x1: 0, y1: 3, x2: 4, y2: 3, kind: "slab" })
    expect(d.lines).toContainEqual({ x1: 0, y1: 3.15, x2: 4, y2: 3.15, kind: "slab" })

    // No outline lines exist above y=3.15 (3 + DRAW_SLAB_M) — nothing is
    // drawn for the OPEN-only rooftop.
    const outlinesAboveTop = d.lines.filter((l) => l.kind === "outline" && (l.y1 > 3.15 || l.y2 > 3.15))
    expect(outlinesAboveTop).toEqual([])
  })
})

// ── SP3 Task 5: sloped roof profile ────────────────────────────────────────
// Footprint bbox 8×6 (mirrors T4's gableSite): totalW 8 ≥ totalD 6 => ridge
// along x, span = 6. rise = (6/2 + 0.5) · tan 30° = 3.5 · 0.577350…
// = 2.020726 → round2 = 2.02. Single 3 m floor => topY 3, apex 3 + 2.02 = 5.02.
const roofRoom = room({ id: "big", x: 0, y: 0, width: 8, depth: 6, areaM2: 48 })
const roofLayout = (roof?: RoofSpec): DesignLayout =>
  layout({ floors: [floor({ id: "f1", level: 0, heightM: 3 })], rooms: [roofRoom], roof })
const pelana: RoofSpec = { type: "pelana", slopeDeg: 30, overhangM: 0.5, material: "genteng_beton" }
const limasan: RoofSpec = { ...pelana, type: "limasan" }

describe("buildElevation — roof profile (pelana/limasan)", () => {
  it("keeps output byte-identical for an explicit datar roof vs absent roof (regression, all four sides)", () => {
    const datar: RoofSpec = { type: "datar", slopeDeg: 30, overhangM: 0.5, material: "genteng_beton" }
    for (const side of ["n", "s", "e", "w"] as const) {
      expect(buildElevation({ ...baseLayout, roof: datar }, side)).toEqual(buildElevation(baseLayout, side))
    }
  })

  it("pelana on the facade parallel to the ridge (south): full-width rectangle, ridge at topY + rise = 5.02 exact", () => {
    const d = buildElevation(roofLayout(pelana), "s")
    expect(d.lines).toContainEqual({ x1: -0.5, y1: 3, x2: 8.5, y2: 3, kind: "outline" }) // eave
    expect(d.lines).toContainEqual({ x1: -0.5, y1: 5.02, x2: 8.5, y2: 5.02, kind: "outline" }) // ridge
    expect(d.lines).toContainEqual({ x1: -0.5, y1: 3, x2: -0.5, y2: 5.02, kind: "outline" })
    expect(d.lines).toContainEqual({ x1: 8.5, y1: 3, x2: 8.5, y2: 5.02, kind: "outline" })
    expect(d.heightM).toBe(5.02)
    expect(d.levels.some((l) => l.y === 5.02)).toBe(true)
  })

  it("replaces the flat roof-slab double line when the roof is sloped", () => {
    const d = buildElevation(roofLayout(pelana), "s")
    expect(d.lines.filter((l) => l.kind === "slab")).toHaveLength(0)
  })

  it("pelana on the gable end (east view, looking along the ridge): triangle with apex at h = totalD/2", () => {
    const d = buildElevation(roofLayout(pelana), "e")
    expect(d.lines).toContainEqual({ x1: -0.5, y1: 3, x2: 6.5, y2: 3, kind: "outline" }) // eave
    expect(d.lines).toContainEqual({ x1: -0.5, y1: 3, x2: 3, y2: 5.02, kind: "outline" })
    expect(d.lines).toContainEqual({ x1: 6.5, y1: 3, x2: 3, y2: 5.02, kind: "outline" })
    expect(d.heightM).toBe(5.02)
  })

  it("limasan on the long facade: trapezoid whose top edge is the ridge, length totalW − totalD = [3, 5]", () => {
    const d = buildElevation(roofLayout(limasan), "s")
    expect(d.lines).toContainEqual({ x1: -0.5, y1: 3, x2: 3, y2: 5.02, kind: "outline" }) // left hip slope
    expect(d.lines).toContainEqual({ x1: 8.5, y1: 3, x2: 5, y2: 5.02, kind: "outline" }) // right hip slope
    expect(d.lines).toContainEqual({ x1: 3, y1: 5.02, x2: 5, y2: 5.02, kind: "outline" }) // shortened ridge
  })

  it("limasan on the gable end projects the same triangle silhouette as pelana (hip face lies inside it)", () => {
    const d = buildElevation(roofLayout(limasan), "e")
    expect(d.lines).toContainEqual({ x1: -0.5, y1: 3, x2: 3, y2: 5.02, kind: "outline" })
    expect(d.lines).toContainEqual({ x1: 6.5, y1: 3, x2: 3, y2: 5.02, kind: "outline" })
  })

  it("clamps a wild persisted slopeDeg (999 → 40) before computing the rise", () => {
    const d = buildElevation(roofLayout({ ...pelana, slopeDeg: 999 }), "s")
    // rise = 3.5 · tan 40° = 2.936849 → 2.94; apex 5.94
    expect(d.lines).toContainEqual({ x1: -0.5, y1: 5.94, x2: 8.5, y2: 5.94, kind: "outline" })
    expect(d.heightM).toBe(5.94)
  })

  it("clamps a wild persisted overhangM (5 → 1): eave spans [-1, 9] and rise uses ov = 1", () => {
    const d = buildElevation(roofLayout({ ...pelana, overhangM: 5 }), "s")
    // rise = (3 + 1) · tan 30° = 2.309401 → 2.31; apex 5.31
    expect(d.lines).toContainEqual({ x1: -1, y1: 3, x2: 9, y2: 3, kind: "outline" })
    expect(d.lines).toContainEqual({ x1: -1, y1: 5.31, x2: 9, y2: 5.31, kind: "outline" })
  })
})

// ── SP7 Task 5: partial rooftop (deck + strips) ─────────────────────────────
// Footprint 10×8 (one 3 m regular floor + an empty floor-rooftop). A centred
// 4×4 deck at (3,2) → 4 strips: S{0,0,10,2}, N{0,6,10,2}, W{0,2,3,4}, E{7,2,3,4}.
// topY (top of the regular floors) = 3.
const partialRoof = { slopeDeg: 30, overhangM: 0.5, material: "genteng_beton" as const }
const partialLayout = (roof?: RoofSpec, deck = { x: 3, y: 2, width: 4, depth: 4 }): DesignLayout =>
  layout({
    floors: [
      floor({ id: "f1", level: 0, name: "Lantai 1", heightM: 3 }),
      floor({ id: "floor-rooftop", level: 1, name: "Rooftop", heightM: 3 }),
    ],
    rooms: [room({ id: "base", floorId: "f1", name: "Base", type: "kamar_tidur", x: 0, y: 0, width: 10, depth: 8, areaM2: 80 })],
    roof,
    rooftopArea: deck,
  })
const FP10x8 = { x0: 0, y0: 0, widthM: 10, depthM: 8 }
const identityProject = (rect: { x: number; y: number; width: number; depth: number }) => ({
  h0: rect.x,
  h1: rect.x + rect.width,
  crossExtent: rect.depth,
})

describe("buildPartialRoof — shared helper", () => {
  const datar: RoofSpec = { type: "datar", ...partialRoof }
  const pelanaRoof: RoofSpec = { type: "pelana", ...partialRoof }

  it("emits deck slab + 3 railing lines + one flat slab per strip for a datar roof (4 strips → 8 lines)", () => {
    const { lines, apexY } = buildPartialRoof({
      footprint: FP10x8,
      deck: { x: 3, y: 2, width: 4, depth: 4 },
      roof: datar,
      topY: 3,
      projectRect: identityProject,
      ridgeParallelToH: () => true,
    })
    // deck: 1 slab + 3 outline (railing); each of the 4 strips: 1 flat slab.
    expect(lines).toHaveLength(4 + 4)
    expect(lines.filter((l) => l.kind === "slab")).toHaveLength(1 + 4)
    expect(lines.filter((l) => l.kind === "outline")).toHaveLength(3)
    // sheet apex = deck railing top (topY 3 + DRAW_RAIL_M 1); flat strips add none.
    expect(apexY).toBe(4)
  })

  it("emits fewer strips when the deck is flush on an edge (corner deck → 2 strips → 6 lines)", () => {
    const { lines } = buildPartialRoof({
      footprint: FP10x8,
      deck: { x: 0, y: 0, width: 4, depth: 3 }, // flush S+W → only N + E strips
      roof: datar,
      topY: 3,
      projectRect: identityProject,
      ridgeParallelToH: () => true,
    })
    expect(lines).toHaveLength(4 + 2)
  })

  it("strip apex equals the 3D rise round2(min(ex)/2·tan) — proves 2D == 3D", () => {
    const deck = { x: 3, y: 2, width: 4, depth: 4 }
    const west = rooftopStrips(FP10x8, deck).find((s) => s.x === 0 && s.width === 3)!
    const ex = expandStripForOverhang(west, 0.5) // {x:-0.5,y:2,width:3.5,depth:4}
    const rise3d = round2((Math.min(ex.width, ex.depth) / 2) * Math.tan((30 * Math.PI) / 180))
    const apex3d = round2(3 + rise3d) // 4.01

    const { apexY } = buildPartialRoof({
      footprint: FP10x8,
      deck,
      roof: pelanaRoof,
      topY: 3,
      projectRect: identityProject,
      ridgeParallelToH: (w, d) => w >= d,
      includeRect: (r) => r.x === west.x && r.y === west.y && r.width === west.width, // isolate W strip
    })
    expect(rise3d).toBe(1.01)
    expect(apexY).toBe(apex3d)
  })
})

describe("buildElevation — partial rooftop", () => {
  const datar: RoofSpec = { type: "datar", ...partialRoof }
  const pelanaRoof: RoofSpec = { type: "pelana", ...partialRoof }

  it("partial datar: deck slab + railing + flat strip slabs, no sloped profile, heightM = topY + railing", () => {
    const d = buildElevation(partialLayout(datar), "s")
    expect(d.heightM).toBe(4) // topY 3 + railing 1

    // Deck (x-range [3,7]): flat slab + 1 m railing.
    expect(d.lines).toContainEqual({ x1: 3, y1: 3, x2: 7, y2: 3, kind: "slab" })
    expect(d.lines).toContainEqual({ x1: 3, y1: 3, x2: 3, y2: 4, kind: "outline" })
    expect(d.lines).toContainEqual({ x1: 7, y1: 3, x2: 7, y2: 4, kind: "outline" })
    expect(d.lines).toContainEqual({ x1: 3, y1: 4, x2: 7, y2: 4, kind: "outline" })

    // W strip (ex x-range [-0.5,3]) + E strip (ex x-range [7,10.5]) as flat slabs.
    expect(d.lines).toContainEqual({ x1: -0.5, y1: 3, x2: 3, y2: 3, kind: "slab" })
    expect(d.lines).toContainEqual({ x1: 7, y1: 3, x2: 10.5, y2: 3, kind: "slab" })

    // No sloped ridge/apex above the railing.
    expect(d.lines.filter((l) => l.y1 > 4 || l.y2 > 4)).toEqual([])
  })

  it("partial pelana (south): deck flat + railing; W/E strips project a triangle whose apex == 3D rise", () => {
    const fp = buildingFootprint(partialLayout(pelanaRoof))
    const deck = clampRooftopArea({ x: 3, y: 2, width: 4, depth: 4 }, fp)
    const west = rooftopStrips(fp, deck).find((s) => s.x === 0 && s.width === 3)!
    const ex = expandStripForOverhang(west, 0.5)
    const apex3d = round2(3 + round2((Math.min(ex.width, ex.depth) / 2) * Math.tan((30 * Math.PI) / 180))) // 4.01

    const d = buildElevation(partialLayout(pelanaRoof), "s")
    // Deck flat + railing over its x-projection [3,7].
    expect(d.lines).toContainEqual({ x1: 3, y1: 3, x2: 7, y2: 3, kind: "slab" })
    expect(d.lines).toContainEqual({ x1: 3, y1: 4, x2: 7, y2: 4, kind: "outline" })
    // W strip gable triangle (ridge ⟂ view): apex at ex centre h = 1.25, y = 4.01.
    expect(d.lines).toContainEqual({ x1: -0.5, y1: 3, x2: 1.25, y2: apex3d, kind: "outline" })
    expect(d.lines).toContainEqual({ x1: 3, y1: 3, x2: 1.25, y2: apex3d, kind: "outline" })
    expect(d.heightM).toBe(apex3d)
    expect(d.levels.some((l) => l.y === apex3d)).toBe(true)
  })

  it("full-deck rooftopArea (== footprint) is treated as non-partial: byte-identical to absent, all four sides", () => {
    const base = partialLayout(pelanaRoof)
    const fullDeck: DesignLayout = { ...base, rooftopArea: { x: 0, y: 0, width: 10, depth: 8 } }
    const noArea: DesignLayout = { ...base }
    delete (noArea as { rooftopArea?: unknown }).rooftopArea
    for (const side of ["n", "s", "e", "w"] as const) {
      expect(buildElevation(fullDeck, side)).toEqual(buildElevation(noArea, side))
    }
  })

  it("off-center deck (pelana): the elevation draws the outer silhouette envelope — ONE full-width profile, not two overlapping strips (FIX 1)", () => {
    // Deck {x:2,y:1,w:6,d:4} in 10×8 → S strip depth 1 (apex 3.43) + N strip
    // depth 3 (apex 4.01), BOTH full-width and projecting to the same h-range
    // [-0.5,10.5] at different heights, plus nested W/E side strips. Only the
    // taller N survives the envelope; the shorter S and the enclosed W/E drop.
    const d = buildElevation(partialLayout(pelanaRoof, { x: 2, y: 1, width: 6, depth: 4 }), "s")

    // Exactly ONE distinct roof-apex height among the roof outline lines (the
    // eave sits at y=3; every line rising above it must reach the same apex).
    const roofPeaks = d.lines
      .filter((l) => l.kind === "outline" && Math.max(l.y1, l.y2) > 3)
      .map((l) => round2(Math.max(l.y1, l.y2)))
    expect([...new Set(roofPeaks)]).toEqual([4.01])

    // That single kept profile is the full-width N pelana rectangle.
    expect(d.lines).toContainEqual({ x1: -0.5, y1: 3, x2: 10.5, y2: 3, kind: "outline" }) // eave
    expect(d.lines).toContainEqual({ x1: -0.5, y1: 4.01, x2: 10.5, y2: 4.01, kind: "outline" }) // ridge
    // The shorter S strip's silhouette (apex 3.43) is not painted behind it, and
    // the fully-interior deck's railing is occluded (no railing top at 4.0).
    expect(d.lines.some((l) => l.kind === "outline" && (l.y1 === 3.43 || l.y2 === 3.43))).toBe(false)
    expect(d.lines.some((l) => l.kind === "outline" && (l.y1 === 4 || l.y2 === 4))).toBe(false)
    expect(d.heightM).toBe(4.01)
  })
})

// ── Fitur fasad 3D pada tampak: louver band, railing balkon, kanopi carport,
//    lampu dinding, keterangan cladding (paritas build-model/lamps) ──────────
describe("buildElevation — fitur fasad 3D", () => {
  const louverLayout = layout({
    rooms: [room({ id: "A", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 })],
    facadeElements: [
      {
        id: "fe1", wallId: "A:s", floorId: "f1", kind: "louver_band",
        positionM: 2, widthM: 2, sillHeightM: 0.6, heightM: 1.6, finish: "kayu",
      },
    ],
  })

  it("louver band: persegi band + sirip vertikal pitch 0,25 hanya pada orientasi dinding hostnya", () => {
    const d = buildElevation(louverLayout, "s")
    const ol = d.lines.filter((l) => l.kind === "opening")
    // Band 2 m berpusat di positionM 2 → h [1,3]; sill 0,6 + tinggi 1,6 → y [0.6, 2.2].
    expect(ol).toContainEqual({ x1: 1, y1: 0.6, x2: 3, y2: 0.6, kind: "opening" })
    expect(ol).toContainEqual({ x1: 1, y1: 2.2, x2: 3, y2: 2.2, kind: "opening" })
    expect(ol).toContainEqual({ x1: 1, y1: 0.6, x2: 1, y2: 2.2, kind: "opening" })
    expect(ol).toContainEqual({ x1: 3, y1: 0.6, x2: 3, y2: 2.2, kind: "opening" })
    // 8 sirip (count = floor(span 2 / 0.25), rumus build-model) DI DALAM band.
    const fins = ol.filter((l) => l.x1 === l.x2 && l.x1 > 1 && l.x1 < 3)
    expect(fins).toHaveLength(8)
    expect(fins.map((f) => f.x1)).toContain(1.13) // sirip pertama: 1 + 0.125
    fins.forEach((f) => { expect(f.y1).toBe(0.6); expect(f.y2).toBe(2.2) })

    // Dinding host menghadap selatan → sheet lain tanpa garis louver sama sekali.
    for (const other of ["n", "e", "w"] as const) {
      expect(buildElevation(louverLayout, other).lines.filter((l) => l.kind === "opening")).toEqual([])
    }
  })

  it("railing kaca balkon: panel 1,0 m + handrail hanya pada sisi terbuka yang menghadap view", () => {
    const balconyLayout = layout({
      floors: [
        floor({ id: "f1", level: 0, heightM: 3 }),
        floor({ id: "f2", level: 1, heightM: 3 }),
      ],
      rooms: [
        room({ id: "A", floorId: "f1", x: 0, y: 0, width: 4, depth: 4, areaM2: 16 }),
        room({ id: "K", floorId: "f2", x: 0, y: 0, width: 4, depth: 2, areaM2: 8 }),
        room({ id: "BAL", floorId: "f2", type: "balkon", x: 0, y: 2, width: 4, depth: 2, areaM2: 8 }),
      ],
    })
    const d = buildElevation(balconyLayout, "s")
    // Panel kaca 1,0 m di atas lantai balkon (baseY f2 = 3) sebagai persegi "opening"…
    expect(d.lines).toContainEqual({ x1: 0, y1: 3, x2: 4, y2: 3, kind: "opening" })
    expect(d.lines).toContainEqual({ x1: 0, y1: 4, x2: 4, y2: 4, kind: "opening" })
    expect(d.lines).toContainEqual({ x1: 0, y1: 3, x2: 0, y2: 4, kind: "opening" })
    expect(d.lines).toContainEqual({ x1: 4, y1: 3, x2: 4, y2: 4, kind: "opening" })
    // …+ garis handrail di atas kaca.
    expect(d.lines).toContainEqual({ x1: 0, y1: 4.05, x2: 4, y2: 4.05, kind: "outline" })

    // Sisi utara balkon menempel kamar (tertutup, aturan railg 3D) → Tampak
    // Utara tanpa railing sama sekali.
    expect(buildElevation(balconyLayout, "n").lines.filter((l) => l.kind === "opening")).toEqual([])
  })

  it("kanopi carport: slab 2,5–2,62 m menjorok 0,15 + tiang persegi di sudut terbuka; dari utara terhalang rumah", () => {
    // baseLayout: CP (0..3, 3..6) di selatan Kamar A — sisi utaranya menempel A.
    const d = buildElevation(baseLayout, "s")
    expect(d.lines).toContainEqual({ x1: -0.15, y1: 2.5, x2: 3.15, y2: 2.5, kind: "slab" })
    expect(d.lines).toContainEqual({ x1: -0.15, y1: 2.62, x2: 3.15, y2: 2.62, kind: "slab" })
    // Tiang hanya di sudut selatan (sw h 0.15, se h 2.85 — inset 0.15), lebar 0.1.
    expect(d.lines).toContainEqual({ x1: 0.1, y1: 0, x2: 0.1, y2: 2.5, kind: "outline" })
    expect(d.lines).toContainEqual({ x1: 0.2, y1: 0, x2: 0.2, y2: 2.5, kind: "outline" })
    expect(d.lines).toContainEqual({ x1: 2.8, y1: 0, x2: 2.8, y2: 2.5, kind: "outline" })
    expect(d.lines).toContainEqual({ x1: 2.9, y1: 0, x2: 2.9, y2: 2.5, kind: "outline" })

    // Dari utara carport terhalang massa rumah (isOccluded) → tanpa kanopi.
    const n = buildElevation(baseLayout, "n")
    expect(n.lines.some((l) => l.y1 === 2.5 || l.y2 === 2.5)).toBe(false)
  })

  it("kanopi carport skip bila tertutup ruang lantai atas (coveredAbove)", () => {
    const covered = layout({
      floors: [
        floor({ id: "f1", level: 0, heightM: 3 }),
        floor({ id: "f2", level: 1, heightM: 3 }),
      ],
      rooms: [
        room({ id: "CP", type: "carport", x: 0, y: 0, width: 3, depth: 3, areaM2: 9 }),
        room({ id: "U", floorId: "f2", x: 0, y: 0, width: 3, depth: 3, areaM2: 9 }),
      ],
    })
    const d = buildElevation(covered, "s")
    expect(d.lines.some((l) => l.kind === "slab" && l.y1 === 2.5)).toBe(false)
  })

  it("lampu dinding eksterior: simbol persegi 0,09×0,24 berpusat di mountH, hanya pada orientasi sisinya", () => {
    // lamps.ts menaruh lampu dinding di samping pintu eksterior lantai dasar:
    // pintu A:s (posisi 1, lebar 0.9) → lampu di x = segEnd 1.45 + 0.35, mountH 2.
    const lampLayout = layout({
      rooms: [room({ id: "A", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 })],
      openings: [opening({ id: "door1", wallId: "A:s", type: "door", positionM: 1, widthM: 0.9, heightM: 2.1 })],
    })
    const d = buildElevation(lampLayout, "s")
    // 4 garis outline membentuk persegi kecil di sekitar mountH 2 (y 1.88..2.12).
    const lampLines = d.lines.filter(
      (l) => l.kind === "outline" && Math.min(l.y1, l.y2) >= 1.7 && Math.max(l.y1, l.y2) <= 2.3
    )
    expect(lampLines).toHaveLength(4)
    expect(lampLines.some((l) => l.y1 === 1.88 && l.y2 === 2.12)).toBe(true)
    const xs = lampLines.flatMap((l) => [l.x1, l.x2])
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(0.09, 2)

    // Lampu menempel dinding selatan → Tampak Utara tanpa simbol lampu.
    const north = buildElevation(lampLayout, "n")
    expect(
      north.lines.filter((l) => l.kind === "outline" && Math.min(l.y1, l.y2) >= 1.7 && Math.max(l.y1, l.y2) <= 2.3)
    ).toEqual([])
  })

  it("label cladding muncul di tengah bidang dinding TERLUAR yang menghadap view; dinding terhalang/menghadap lain tidak dilabel", () => {
    const claddingLayout = layout({
      rooms: [
        room({ id: "A", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 }),
        room({ id: "B", x: 0, y: 3, width: 4, depth: 3, areaM2: 12 }),
      ],
      facade: { "B:s": "bata_ekspos", "A:s": "marmer_carrara", "A:n": "batu_andesit" },
    })
    const s = buildElevation(claddingLayout, "s")
    expect(s.labels).toContainEqual({ x: 2, y: 1.5, text: "Bata ekspos", kind: "room" })
    // A:s terhalang massa B yang lebih selatan → bukan dinding terluar dari selatan.
    expect(s.labels.some((l) => l.text === "Marmer carrara")).toBe(false)
    // A:n menghadap utara → tidak ikut sheet selatan…
    expect(s.labels.some((l) => l.text === "Batu andesit")).toBe(false)
    // …tetapi muncul di Tampak Utara (h dimirror: tetap di tengah [0,4] = 2).
    const n = buildElevation(claddingLayout, "n")
    expect(n.labels).toContainEqual({ x: 2, y: 1.5, text: "Batu andesit", kind: "room" })
    expect(n.labels.some((l) => l.text === "Bata ekspos")).toBe(false)
  })
})

describe("buildElevation — cantilever (offsetM lantai)", () => {
  // 2 lantai; lantai 2 (Kamar C, x 0..4) menjorok +1 m di x.
  const cantiLayout = layout({
    floors: [
      floor({ id: "f1", level: 0, name: "Lantai 1", heightM: 3 }),
      floor({ id: "f2", level: 1, name: "Lantai 2", heightM: 3, offsetM: { dx: 1, dy: 0 } }),
    ],
    rooms: [
      room({ id: "A", floorId: "f1", name: "Kamar A", type: "kamar_tidur", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 }),
      room({ id: "C", floorId: "f2", name: "Kamar C", type: "kamar_tidur", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 }),
    ],
  })
  // Layout kembar tanpa offset (baseline pembanding).
  const flatLayout = layout({
    floors: [
      floor({ id: "f1", level: 0, name: "Lantai 1", heightM: 3 }),
      floor({ id: "f2", level: 1, name: "Lantai 2", heightM: 3 }),
    ],
    rooms: [
      room({ id: "A", floorId: "f1", name: "Kamar A", type: "kamar_tidur", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 }),
      room({ id: "C", floorId: "f2", name: "Kamar C", type: "kamar_tidur", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 }),
    ],
  })

  it("tampak selatan (H=x): garis dinding lantai 2 tergeser +dx; lantai 1 tetap", () => {
    const d = buildElevation(cantiLayout, "s")
    // Lantai 2 (y 3..6) tergeser dari [0,4] → [1,5].
    expect(d.lines).toContainEqual({ x1: 1, y1: 3, x2: 1, y2: 6, kind: "outline" })
    expect(d.lines).toContainEqual({ x1: 5, y1: 3, x2: 5, y2: 6, kind: "outline" })
    // Lantai 1 (y 0..3) TIDAK tergeser — tetap [0,4].
    expect(d.lines).toContainEqual({ x1: 0, y1: 0, x2: 0, y2: 3, kind: "outline" })
    expect(d.lines).toContainEqual({ x1: 4, y1: 0, x2: 4, y2: 3, kind: "outline" })
  })

  it("tampak utara (mirror, H=totalW−x): geser +dx site → garis lantai 2 bergeser −dx pada H", () => {
    const d = buildElevation(cantiLayout, "n")
    // totalW = 4 (footprint non-rooftop, tak termasuk cantilever). Lantai 2
    // site x[1,5] → H = 4 − x → [-1, 3]; lantai 1 x[0,4] → H [0,4].
    expect(d.lines).toContainEqual({ x1: -1, y1: 3, x2: -1, y2: 6, kind: "outline" })
    expect(d.lines).toContainEqual({ x1: 3, y1: 3, x2: 3, y2: 6, kind: "outline" })
    expect(d.lines).toContainEqual({ x1: 0, y1: 0, x2: 0, y2: 3, kind: "outline" })
    expect(d.lines).toContainEqual({ x1: 4, y1: 0, x2: 4, y2: 3, kind: "outline" })
  })

  it("offsetM pada sumbu tegak-lurus view tidak menggeser H (dy tak berpengaruh di tampak s)", () => {
    const dyLayout = layout({
      floors: [
        floor({ id: "f1", level: 0, name: "Lantai 1", heightM: 3 }),
        floor({ id: "f2", level: 1, name: "Lantai 2", heightM: 3, offsetM: { dx: 0, dy: 1 } }),
      ],
      rooms: [
        room({ id: "A", floorId: "f1", name: "Kamar A", type: "kamar_tidur", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 }),
        room({ id: "C", floorId: "f2", name: "Kamar C", type: "kamar_tidur", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 }),
      ],
    })
    // Tampak s (H=x): dy tidak mengubah garis dinding lantai 2 → identik flat.
    expect(buildElevation(dyLayout, "s").lines).toEqual(buildElevation(flatLayout, "s").lines)
  })

  it("cantilever hanya menggeser (bukan menambah/menghapus) garis — jumlah garis identik dengan flat, tiap sisi", () => {
    for (const side of ["n", "s", "e", "w"] as const) {
      const canti = buildElevation(cantiLayout, side)
      const flat = buildElevation(flatLayout, side)
      expect(canti.lines).toHaveLength(flat.lines.length)
    }
  })

  it("regresi: menghapus offsetM (lantai tanpa offset) → objek gambar identik dengan yang mendeklarasikan offsetM {0,0}", () => {
    const zeroOffset = layout({
      floors: [
        floor({ id: "f1", level: 0, name: "Lantai 1", heightM: 3 }),
        floor({ id: "f2", level: 1, name: "Lantai 2", heightM: 3, offsetM: { dx: 0, dy: 0 } }),
      ],
      rooms: flatLayout.rooms,
    })
    for (const side of ["n", "s", "e", "w"] as const) {
      expect(buildElevation(zeroOffset, side)).toEqual(buildElevation(flatLayout, side))
    }
  })
})

describe("roofProfile — atap miring (skillion)", () => {
  const miring = (lowSide: "n" | "s" | "w" | "e"): RoofSpec => ({
    type: "miring", slopeDeg: 10, overhangM: 0.5, material: "metal", lowSide,
  })

  it("facing (kemiringan melintang view): persegi penuh setinggi rise bentang penuh", () => {
    const { lines, apexY } = roofProfile({
      roof: miring("s"), hExtent: 7, crossExtent: 3, ridgeParallelToH: true, topY: 6,
      skillionLowAt: "facing",
    })
    // rise = (3 + 2·0.5) × tan10°
    expect(apexY).toBeCloseTo(6 + 4 * Math.tan((10 * Math.PI) / 180), 2)
    expect(lines).toHaveLength(4) // eave + 2 vertikal + garis atas
    expect(lines.filter((l) => l.y1 === apexY && l.y2 === apexY)).toHaveLength(1)
  })

  it("lowAt h0: segitiga siku — muka tinggi di h1, bidang miring dari h0 naik ke h1", () => {
    const { lines, apexY } = roofProfile({
      roof: miring("w"), hExtent: 7, crossExtent: 3, ridgeParallelToH: false, topY: 6,
      skillionLowAt: "h0",
    })
    expect(apexY).toBeCloseTo(6 + 8 * Math.tan((10 * Math.PI) / 180), 2)
    expect(lines).toHaveLength(3) // eave + muka tinggi + hipotenusa
    const vertical = lines.find((l) => l.x1 === l.x2)!
    expect(vertical.x1).toBeCloseTo(7.5, 5) // h1 = hExtent + ov
    const slope = lines.find((l) => l.x1 !== l.x2 && (l.y1 !== l.y2))!
    expect(Math.min(slope.y1, slope.y2)).toBeCloseTo(6, 5)
    expect(Math.max(slope.y1, slope.y2)).toBeCloseTo(apexY, 5)
  })

  it("buildElevation memilih facing vs h0/h1 dari sisi view × lowSide", () => {
    const l = layout({
      floors: [floor({})],
      rooms: [room({ id: "A", width: 7, depth: 3 })],
      roof: { type: "miring", slopeDeg: 10, overhangM: 0.5, material: "metal", lowSide: "e" },
    })
    // Tampak selatan, lowSide e → kemiringan sepanjang h → ada garis hipotenusa miring
    const south = buildElevation(l, "s")
    const sloped = south.lines.filter((ln) => ln.kind === "outline" && ln.x1 !== ln.x2 && ln.y1 !== ln.y2)
    expect(sloped.length).toBeGreaterThan(0)
    // Tampak timur (menghadap muka rendah) → tidak ada garis miring, hanya persegi
    const east = buildElevation(l, "e")
    const slopedE = east.lines.filter((ln) => ln.kind === "outline" && ln.x1 !== ln.x2 && ln.y1 !== ln.y2)
    expect(slopedE).toHaveLength(0)
  })
})

describe("buildElevation — explicit roof zones", () => {
  const roofZones: RoofZone[] = [
    {
      id: "rz-flat",
      floorId: "f1",
      type: "datar",
      x: 1.5,
      y: 1.5,
      widthM: 3,
      depthM: 3,
      slopeDeg: 0,
      overhangM: 0.2,
      materialId: "metal",
    },
    {
      id: "rz-hip",
      floorId: "f1",
      type: "limasan",
      x: 4.5,
      y: 1.5,
      widthM: 3,
      depthM: 3,
      slopeDeg: 30,
      overhangM: 0.2,
      materialId: "genteng_beton",
    },
  ]

  it("projects each explicit zone instead of the legacy global roof slab", () => {
    const d = buildElevation(
      layout({
        floors: [floor({ id: "f1", level: 0, heightM: 3 })],
        rooms: [room({ id: "base", floorId: "f1", x: 0, y: 0, width: 8, depth: 6, areaM2: 48 })],
        roofZones,
      }),
      "s"
    )

    expect(d.lines.some((l) => l.kind === "slab" && l.y1 === 3.15 && l.refId === undefined)).toBe(false)
    expect(d.lines).toContainEqual({ x1: -0.2, y1: 3, x2: 3.2, y2: 3, kind: "slab", refId: "rz-flat" })
    expect(d.lines).toContainEqual({ x1: -0.2, y1: 3.15, x2: 3.2, y2: 3.15, kind: "slab", refId: "rz-flat" })
    expect(d.lines).toContainEqual({ x1: 2.8, y1: 3, x2: 6.2, y2: 3, kind: "outline", refId: "rz-hip" })
    expect(d.lines).toContainEqual({ x1: 2.8, y1: 3, x2: 4.5, y2: 3.98, kind: "outline", refId: "rz-hip" })
    expect(d.levels).toContainEqual({ y: 3.98, label: "+3,98 m" })
    expect(d.heightM).toBe(3.98)
  })
})

describe("buildElevation — porthole (jendela bulat) di tampak", () => {
  // Porthole 0,6×0,6 di dinding selatan Kamar A, terpusat di positionM 2.
  // Sill jendela tampak = WINDOW_SILL_M 0,9 → pusat lingkaran (2 ; 1,2), r 0,3.
  const portholeLayout = layout({
    rooms: [room({ id: "A", name: "Kamar A", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 })],
    openings: [
      opening({
        id: "port",
        wallId: "A:s",
        type: "window",
        kind: "porthole",
        positionM: 2,
        widthM: 0.6,
        heightM: 0.6,
      }),
    ],
  })

  it("menghasilkan poligon lingkaran 16 segmen alih-alih rect 4 garis", () => {
    const d = buildElevation(portholeLayout, "s")
    const op = d.lines.filter((l) => l.kind === "opening")
    expect(op).toHaveLength(16)
    // Tidak ada garis envelope rect (tepi lurus selebar bukaan penuh).
    expect(op).not.toContainEqual({ x1: 1.7, y1: 0.9, x2: 2.3, y2: 0.9, kind: "opening" })
  })

  it("semua titik poligon berjarak ~r dari pusat; diameter = min(w,h)", () => {
    const d = buildElevation(portholeLayout, "s")
    const op = d.lines.filter((l) => l.kind === "opening")
    for (const l of op) {
      // Toleransi longgar karena koordinat dibulatkan round2.
      expect(Math.hypot(l.x1 - 2, l.y1 - 1.2)).toBeCloseTo(0.3, 1)
      expect(Math.hypot(l.x2 - 2, l.y2 - 1.2)).toBeCloseTo(0.3, 1)
    }
  })

  it("poligon tertutup: tiap titik akhir segmen adalah titik awal segmen lain", () => {
    const d = buildElevation(portholeLayout, "s")
    const op = d.lines.filter((l) => l.kind === "opening")
    const starts = new Set(op.map((l) => `${l.x1},${l.y1}`))
    for (const l of op) expect(starts.has(`${l.x2},${l.y2}`)).toBe(true)
  })

  it("rentang horizontal lingkaran (hc±r) masuk DimChain", () => {
    const d = buildElevation(portholeLayout, "s")
    expect(d.dims[0].points).toContain(1.7) // hc − r
    expect(d.dims[0].points).toContain(2.3) // hc + r
  })
})
