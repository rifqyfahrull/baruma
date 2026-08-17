import { describe, it, expect } from "vitest"
import { buildSection } from "./section"
import { round2 } from "@/lib/geometry"
import { buildingFootprint } from "@/lib/structural/grid"
import { clampRooftopArea, expandStripForOverhang, rooftopStrips } from "@/lib/geometry/rooftop"
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

// Fixture: 2 floors. Floor 1: Kamar A (0..4 x 0..3) + Kamar B (4..7 x 0..3)
// + Carport (OPEN, 0..3 x 3..5.5). Floor 2: Kamar C (0..4 x 0..3).
// A cut at axis "x", positionM 2 sweeps a plane perpendicular to x: it
// passes through A (x-span [0,4]) and C (x-span [0,4]) but NOT B
// (x-span [4,7]) — and also through the OPEN carport (x-span [0,3]).
// A door on A's south wall (positionM 1.8, width 0.9 => x-span [1.35,2.25])
// straddles the cut; a window on A's north wall (positionM 1, width 1.2 =>
// x-span [0.4,1.6]) does not.
const baseLayout = layout({
  floors: [
    floor({ id: "f1", level: 0, name: "Lantai 1", heightM: 3 }),
    floor({ id: "f2", level: 1, name: "Lantai 2", heightM: 3 }),
  ],
  rooms: [
    room({ id: "A", floorId: "f1", name: "Kamar A", type: "kamar_tidur", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 }),
    room({ id: "B", floorId: "f1", name: "Kamar B", type: "kamar_tidur", x: 4, y: 0, width: 3, depth: 3, areaM2: 9 }),
    room({ id: "CP", floorId: "f1", name: "Carport", type: "carport", x: 0, y: 3, width: 3, depth: 2.5, areaM2: 7.5 }),
    room({ id: "C", floorId: "f2", name: "Kamar C", type: "kamar_tidur", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 }),
  ],
  openings: [
    opening({ id: "doorAS", floorId: "f1", wallId: "A:s", type: "door", positionM: 1.8, widthM: 0.9, heightM: 2.1 }),
    opening({ id: "winAN", floorId: "f1", wallId: "A:n", type: "window", positionM: 1, widthM: 1.2, heightM: 1.2 }),
  ],
})

describe("buildSection — title mapping", () => {
  it("maps axis to the Indonesian section title", () => {
    expect(buildSection(baseLayout, { axis: "x", positionM: 2 }).title).toBe("Potongan A-A")
    expect(buildSection(baseLayout, { axis: "y", positionM: 1.5 }).title).toBe("Potongan B-B")
  })
})

describe("buildSection — axis x cut (hits A & C, not B)", () => {
  const d = buildSection(baseLayout, { axis: "x", positionM: 2 })

  it("reports the drawing's bounding box (h = y for axis x)", () => {
    expect(d.widthM).toBe(5.5) // max(y+depth) across all non-rooftop rooms: CP = 3+2.5
    expect(d.heightM).toBe(6) // 2 floors x 3 m, no rooftop
  })

  it("cuts room A (floor 1) — vertical cut lines at its y-bounds [0,3], slab top/bottom, centered label", () => {
    expect(d.lines).toContainEqual({ x1: 0, y1: 0, x2: 0, y2: 3, kind: "cut" })
    expect(d.lines).toContainEqual({ x1: 3, y1: 0, x2: 3, y2: 3, kind: "cut" })
    expect(d.lines).toContainEqual({ x1: 0, y1: 0, x2: 3, y2: 0, kind: "slab" })
    expect(d.lines).toContainEqual({ x1: 0, y1: 3, x2: 3, y2: 3, kind: "slab" })
    expect(d.labels).toContainEqual({ x: 1.5, y: 1.5, text: "Kamar A", kind: "room" })
  })

  it("cuts room C (floor 2, true top) — cut lines at [0,3], slab at 3/6, doubled roof slab at 6.15", () => {
    expect(d.lines).toContainEqual({ x1: 0, y1: 3, x2: 0, y2: 6, kind: "cut" })
    expect(d.lines).toContainEqual({ x1: 3, y1: 3, x2: 3, y2: 6, kind: "cut" })
    expect(d.lines).toContainEqual({ x1: 0, y1: 3, x2: 3, y2: 3, kind: "slab" })
    expect(d.lines).toContainEqual({ x1: 0, y1: 6, x2: 3, y2: 6, kind: "slab" })
    expect(d.lines).toContainEqual({ x1: 0, y1: 6.15, x2: 3, y2: 6.15, kind: "slab" })
    expect(d.labels).toContainEqual({ x: 1.5, y: 4.5, text: "Kamar C", kind: "room" })
  })

  it("draws the OPEN carport's slab only (no cut lines, no label)", () => {
    expect(d.lines).toContainEqual({ x1: 3, y1: 0, x2: 5.5, y2: 0, kind: "slab" })
    expect(d.lines).toContainEqual({ x1: 3, y1: 3, x2: 5.5, y2: 3, kind: "slab" })
    // No "cut" line uses the carport's h-bounds (3 or 5.5 as an endpoint).
    expect(d.lines.filter((l) => l.kind === "cut" && (l.x1 === 5.5 || l.x2 === 5.5))).toHaveLength(0)
    expect(d.labels.some((l) => l.text === "Carport")).toBe(false)
  })

  it("excludes room B entirely (its x-span [4,7] does not contain the cut) — exact counts", () => {
    // Only A and C are non-OPEN cut rooms => exactly 2 rooms x 2 cut lines = 4.
    expect(d.lines.filter((l) => l.kind === "cut")).toHaveLength(4)
    // Only A and C get room labels (carport is OPEN, B is not cut).
    expect(d.labels.filter((l) => l.kind === "room")).toHaveLength(2)
    expect(d.labels.map((l) => l.text).sort()).toEqual(["Kamar A", "Kamar C"])
  })

  it("shows the door straddling A's south wall as an opening rect on the h=3 cut line", () => {
    const openingLines = d.lines.filter((l) => l.kind === "opening")
    expect(openingLines).toHaveLength(4)
    // hWall = room.y+depth = 3, thickness +-0.06 => h in [2.94, 3.06]; sill 0
    // (door) + heightM 2.1 => y in [0, 2.1].
    expect(openingLines).toContainEqual({ x1: 2.94, y1: 0, x2: 3.06, y2: 0, kind: "opening" })
    expect(openingLines).toContainEqual({ x1: 2.94, y1: 2.1, x2: 3.06, y2: 2.1, kind: "opening" })
    expect(openingLines).toContainEqual({ x1: 2.94, y1: 0, x2: 2.94, y2: 2.1, kind: "opening" })
    expect(openingLines).toContainEqual({ x1: 3.06, y1: 0, x2: 3.06, y2: 2.1, kind: "opening" })
  })

  it("does not show the window on A's north wall (its x-span [0.4,1.6] does not contain the cut)", () => {
    // Only the door's rect is present (asserted above as length 4); if the
    // window were (wrongly) included there would be 8.
    expect(d.lines.filter((l) => l.kind === "opening")).toHaveLength(4)
  })

  it("emits levels like an elevation (each floor base + roof peak)", () => {
    expect(d.levels).toContainEqual({ y: 0, label: "±0 m" })
    expect(d.levels).toContainEqual({ y: 3, label: "+3 m" })
    expect(d.levels).toContainEqual({ y: 6, label: "+6 m" })
  })

  it("emits a vertical DimChain of floor boundaries + a horizontal DimChain of cut-room h-bounds", () => {
    expect(d.dims).toContainEqual({ axis: "y", at: -0.8, points: [0, 3, 6] })
    // h-bounds collected: A[0,3], carport[3,5.5], C[0,3] => unique sorted.
    expect(d.dims).toContainEqual({ axis: "x", at: -0.8, points: [0, 3, 5.5] })
  })
})

describe("buildSection — split-level step", () => {
  it("shifts the cut room's base slab/cut-line/opening-y by levelOffsetM", () => {
    const splitLayout: DesignLayout = {
      ...baseLayout,
      rooms: baseLayout.rooms.map((r) => (r.id === "A" ? { ...r, levelOffsetM: -0.18 } : r)),
    }
    const d = buildSection(splitLayout, { axis: "x", positionM: 2 })

    // Base slab + cut line bottom shift to -0.18; top (floor height) is unchanged.
    expect(d.lines).toContainEqual({ x1: 0, y1: -0.18, x2: 3, y2: -0.18, kind: "slab" })
    expect(d.lines).toContainEqual({ x1: 0, y1: -0.18, x2: 0, y2: 3, kind: "cut" })
    expect(d.lines).toContainEqual({ x1: 3, y1: -0.18, x2: 3, y2: 3, kind: "cut" })

    // Door on A:s (sill 0) shifts its y-range down by the same 0.18 m.
    const openingLines = d.lines.filter((l) => l.kind === "opening")
    expect(openingLines).toContainEqual({ x1: 2.94, y1: -0.18, x2: 3.06, y2: -0.18, kind: "opening" })
    expect(openingLines).toContainEqual({ x1: 2.94, y1: 1.92, x2: 3.06, y2: 1.92, kind: "opening" })
  })
})

describe("buildSection — axis y cut (hits A & B)", () => {
  it("cuts room A and room B on floor 1 (h = x); title + h-bounds correct", () => {
    const d = buildSection(baseLayout, { axis: "y", positionM: 1.5 })
    expect(d.title).toBe("Potongan B-B")
    expect(d.widthM).toBe(7) // max(x+width) across all rooms: B = 4+3

    // Room A h-bounds (x-span) = [0,4].
    expect(d.lines).toContainEqual({ x1: 0, y1: 0, x2: 0, y2: 3, kind: "cut" })
    expect(d.lines).toContainEqual({ x1: 4, y1: 0, x2: 4, y2: 3, kind: "cut" })
    expect(d.labels).toContainEqual({ x: 2, y: 1.5, text: "Kamar A", kind: "room" })

    // Room B h-bounds (x-span) = [4,7] — also cut, since B's y-span [0,3]
    // contains positionM 1.5 just like A's.
    expect(d.lines).toContainEqual({ x1: 4, y1: 0, x2: 4, y2: 3, kind: "cut" })
    expect(d.lines).toContainEqual({ x1: 7, y1: 0, x2: 7, y2: 3, kind: "cut" })
    expect(d.labels).toContainEqual({ x: 5.5, y: 1.5, text: "Kamar B", kind: "room" })
  })
})

// ── SP3 Task 5: sloped roof profile ────────────────────────────────────────
// Footprint bbox 8×6: ridge along x (totalW 8 ≥ totalD 6), span = 6.
// rise = (6/2 + 0.5) · tan 30° = 2.020726 → 2.02. topY 3 => apex 5.02.
const roofLayout = (roof?: RoofSpec): DesignLayout =>
  layout({
    floors: [floor({ id: "f1", level: 0, heightM: 3 })],
    rooms: [room({ id: "big", x: 0, y: 0, width: 8, depth: 6, areaM2: 48 })],
    roof,
  })
const pelana: RoofSpec = { type: "pelana", slopeDeg: 30, overhangM: 0.5, material: "genteng_beton" }
const limasan: RoofSpec = { ...pelana, type: "limasan" }

describe("buildSection — roof profile (pelana/limasan)", () => {
  it("keeps output byte-identical for an explicit datar roof vs absent roof (regression, both axes)", () => {
    const datar: RoofSpec = { type: "datar", slopeDeg: 30, overhangM: 0.5, material: "genteng_beton" }
    expect(buildSection({ ...baseLayout, roof: datar }, { axis: "x", positionM: 2 })).toEqual(
      buildSection(baseLayout, { axis: "x", positionM: 2 })
    )
    expect(buildSection({ ...baseLayout, roof: datar }, { axis: "y", positionM: 1.5 })).toEqual(
      buildSection(baseLayout, { axis: "y", positionM: 1.5 })
    )
  })

  it("axis-x cut crosses the ridge (ridge along x): triangle, apex = topY + rise = 5.02 exact", () => {
    const d = buildSection(roofLayout(pelana), { axis: "x", positionM: 4 })
    expect(d.lines).toContainEqual({ x1: -0.5, y1: 3, x2: 6.5, y2: 3, kind: "outline" }) // eave
    expect(d.lines).toContainEqual({ x1: -0.5, y1: 3, x2: 3, y2: 5.02, kind: "outline" })
    expect(d.lines).toContainEqual({ x1: 6.5, y1: 3, x2: 3, y2: 5.02, kind: "outline" })
    expect(d.heightM).toBe(5.02)
    // The flat roof-slab line at topY + DRAW_SLAB_M is replaced by the profile.
    expect(d.lines.filter((l) => l.kind === "slab" && l.y1 === 3.15)).toHaveLength(0)
    // Apex joins the level marks + the vertical dim chain.
    expect(d.levels.some((l) => l.y === 5.02)).toBe(true)
    expect(d.dims).toContainEqual({ axis: "y", at: -0.8, points: [0, 3, 5.02] })
  })

  it("axis-y cut runs parallel to the ridge: pelana shows the full-length ridge rectangle", () => {
    const d = buildSection(roofLayout(pelana), { axis: "y", positionM: 3 })
    expect(d.lines).toContainEqual({ x1: -0.5, y1: 5.02, x2: 8.5, y2: 5.02, kind: "outline" })
    expect(d.heightM).toBe(5.02)
  })

  it("axis-y cut, limasan: trapezoid with ridge shortened to [3, 5]", () => {
    const d = buildSection(roofLayout(limasan), { axis: "y", positionM: 3 })
    expect(d.lines).toContainEqual({ x1: -0.5, y1: 3, x2: 3, y2: 5.02, kind: "outline" })
    expect(d.lines).toContainEqual({ x1: 8.5, y1: 3, x2: 5, y2: 5.02, kind: "outline" })
    expect(d.lines).toContainEqual({ x1: 3, y1: 5.02, x2: 5, y2: 5.02, kind: "outline" })
  })
})

// ── SP7 Task 5: partial rooftop (deck + strips) ─────────────────────────────
// Footprint 10×8 (one 3 m regular floor + empty floor-rooftop), centred 4×4 deck
// at (3,2) → strips S{0,0,10,2}, N{0,6,10,2}, W{0,2,3,4}, E{7,2,3,4}. topY = 3.
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

describe("buildSection — partial rooftop", () => {
  const pelanaRoof: RoofSpec = { type: "pelana", ...partialRoof }

  it("axis-y cut through the deck (y=4) shows flat deck + railing, flanked by the W/E strip triangles (apex == 3D rise)", () => {
    const fp = buildingFootprint(partialLayout(pelanaRoof))
    const deck = clampRooftopArea({ x: 3, y: 2, width: 4, depth: 4 }, fp)
    const west = rooftopStrips(fp, deck).find((s) => s.x === 0 && s.width === 3)!
    const ex = expandStripForOverhang(west, 0.5)
    const apex3d = round2(3 + round2((Math.min(ex.width, ex.depth) / 2) * Math.tan((30 * Math.PI) / 180))) // 4.01

    const d = buildSection(partialLayout(pelanaRoof), { axis: "y", positionM: 4 })
    // Deck (h = x, deck.x [3,7]): flat slab + railing.
    expect(d.lines).toContainEqual({ x1: 3, y1: 3, x2: 7, y2: 3, kind: "slab" })
    expect(d.lines).toContainEqual({ x1: 3, y1: 3, x2: 3, y2: 4, kind: "outline" })
    expect(d.lines).toContainEqual({ x1: 3, y1: 4, x2: 7, y2: 4, kind: "outline" })
    // W strip triangle (ex x-range [-0.5,3], apex at 1.25) reaches the 3D rise.
    expect(d.lines).toContainEqual({ x1: -0.5, y1: 3, x2: 1.25, y2: apex3d, kind: "outline" })
    expect(d.heightM).toBe(apex3d)
  })

  it("axis-y cut through a strip only (y=1, misses the deck) shows the S-strip roof profile, no deck/railing", () => {
    const d = buildSection(partialLayout(pelanaRoof), { axis: "y", positionM: 1 })
    // S strip (ex 11 wide × 2.5 deep) — ridge along x (∥ h) → full-facade ridge
    // rectangle. span = 2.5 → rise (2.5/2)·tan30 = 0.72; apex 3.72.
    expect(d.lines).toContainEqual({ x1: -0.5, y1: 3.72, x2: 10.5, y2: 3.72, kind: "outline" })
    expect(d.heightM).toBe(3.72)
    // Deck is NOT crossed at y=1 → no deck slab at [3,7] and no 1 m railing top.
    expect(d.lines.some((l) => l.kind === "slab" && l.x1 === 3 && l.x2 === 7 && l.y1 === 3)).toBe(false)
    expect(d.lines.some((l) => l.kind === "outline" && (l.y1 === 4 || l.y2 === 4))).toBe(false)
  })

  it("axis-x cut through the deck (x=5) shows flat deck + railing (h = y, deck.y [2,6])", () => {
    const d = buildSection(partialLayout(pelanaRoof), { axis: "x", positionM: 5 })
    expect(d.lines).toContainEqual({ x1: 2, y1: 3, x2: 6, y2: 3, kind: "slab" })
    expect(d.lines).toContainEqual({ x1: 2, y1: 4, x2: 6, y2: 4, kind: "outline" })
  })

  it("full-deck rooftopArea section is byte-identical to absent (regression, both axes)", () => {
    const base = partialLayout(pelanaRoof)
    const fullDeck: DesignLayout = { ...base, rooftopArea: { x: 0, y: 0, width: 10, depth: 8 } }
    const noArea: DesignLayout = { ...base }
    delete (noArea as { rooftopArea?: unknown }).rooftopArea
    for (const c of [{ axis: "x", positionM: 2 }, { axis: "y", positionM: 3 }] as const) {
      expect(buildSection(fullDeck, c)).toEqual(buildSection(noArea, c))
    }
  })

  it("axis-y cut exactly on the deck's south boundary (y=deck.y) belongs to ONE piece — no double-drawn S strip (FIX 2)", () => {
    // y=2 is the shared edge between the S strip (its north edge) and the deck /
    // W / E band (their south edge). The half-open boundary test assigns it to
    // the deck band; the S strip's full-width profile must NOT also be drawn
    // (which previously overlapped a full-width ridge on top of the deck).
    const d = buildSection(partialLayout(pelanaRoof), { axis: "y", positionM: 2 })

    // The S strip's full-width ridge (apex 3.72, span [-0.5,10.5]) is absent —
    // no roof outline at that apex at all.
    expect(d.lines).not.toContainEqual({ x1: -0.5, y1: 3.72, x2: 10.5, y2: 3.72, kind: "outline" })
    expect(d.lines.some((l) => l.kind === "outline" && (l.y1 === 3.72 || l.y2 === 3.72))).toBe(false)

    // The deck (which owns the boundary) + its flanking W/E strip triangles ARE
    // drawn — one coherent, non-overlapping set of roof pieces.
    expect(d.lines).toContainEqual({ x1: 3, y1: 3, x2: 7, y2: 3, kind: "slab" }) // deck flat
    expect(d.lines).toContainEqual({ x1: 3, y1: 4, x2: 7, y2: 4, kind: "outline" }) // railing top
    expect(d.lines).toContainEqual({ x1: -0.5, y1: 3, x2: 1.25, y2: 4.01, kind: "outline" }) // W triangle
  })

  it("partial rooftop + a solid room on floor-rooftop: suppresses the deck slab at topY, keeps the strips (FIX 3)", () => {
    // A SOLID rooftop room fills the deck (hasRooftopBlock) → the block already
    // draws its own base slab at topY; the deck must not draw a second one.
    const blockLayout = layout({
      floors: [
        floor({ id: "f1", level: 0, name: "Lantai 1", heightM: 3 }),
        floor({ id: "floor-rooftop", level: 1, name: "Rooftop", heightM: 3 }),
      ],
      rooms: [
        room({ id: "base", floorId: "f1", name: "Base", type: "kamar_tidur", x: 0, y: 0, width: 10, depth: 8, areaM2: 80 }),
        room({ id: "blk", floorId: "floor-rooftop", name: "Gudang Atap", type: "gudang", x: 3, y: 2, width: 4, depth: 4, areaM2: 16 }),
      ],
      roof: pelanaRoof,
      rooftopArea: { x: 3, y: 2, width: 4, depth: 4 },
    })
    const d = buildSection(blockLayout, { axis: "y", positionM: 4 })

    // The rooftop block draws its base slab at topY (y=3) over x[3,7]; the deck
    // must NOT draw a second identical slab there → exactly one.
    const deckSlab = d.lines.filter(
      (l) => l.kind === "slab" && l.x1 === 3 && l.x2 === 7 && l.y1 === 3 && l.y2 === 3
    )
    expect(deckSlab).toHaveLength(1)

    // Strip roof pieces are still emitted (W strip triangle, apex 4.01) …
    expect(d.lines).toContainEqual({ x1: -0.5, y1: 3, x2: 1.25, y2: 4.01, kind: "outline" })
    // … and the deck railing (not the suppressed slab) is still drawn.
    expect(d.lines).toContainEqual({ x1: 3, y1: 4, x2: 7, y2: 4, kind: "outline" })
  })
})

describe("buildSection — explicit roof zones", () => {
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

  it("cuts explicit roof zones and suppresses the legacy global roof slab", () => {
    const d = buildSection(
      layout({
        floors: [floor({ id: "f1", level: 0, heightM: 3 })],
        rooms: [room({ id: "base", floorId: "f1", x: 0, y: 0, width: 8, depth: 6, areaM2: 48 })],
        roofZones,
      }),
      { axis: "y", positionM: 1.5 }
    )

    expect(d.lines.some((l) => l.kind === "slab" && l.y1 === 3.15 && l.refId === undefined)).toBe(false)
    expect(d.lines).toContainEqual({ x1: -0.2, y1: 3, x2: 3.2, y2: 3, kind: "slab", refId: "rz-flat" })
    expect(d.lines).toContainEqual({ x1: -0.2, y1: 3.15, x2: 3.2, y2: 3.15, kind: "slab", refId: "rz-flat" })
    expect(d.lines).toContainEqual({ x1: 2.8, y1: 3, x2: 6.2, y2: 3, kind: "outline", refId: "rz-hip" })
    expect(d.lines).toContainEqual({ x1: 2.8, y1: 3, x2: 4.5, y2: 3.98, kind: "outline", refId: "rz-hip" })
    expect(d.levels).toContainEqual({ y: 3.98, label: "+3,98 m" })
    expect(d.heightM).toBe(3.98)
  })

  it("uses half-open cuts so a section on a roof-zone far edge does not double-draw it", () => {
    const d = buildSection(
      layout({
        floors: [floor({ id: "f1", level: 0, heightM: 3 })],
        rooms: [room({ id: "base", floorId: "f1", x: 0, y: 0, width: 8, depth: 6, areaM2: 48 })],
        roofZones,
      }),
      { axis: "y", positionM: 3 }
    )

    expect(d.lines.some((l) => l.refId === "rz-flat")).toBe(false)
    expect(d.lines.some((l) => l.refId === "rz-hip")).toBe(false)
  })

describe("buildSection — profil tangga", () => {
  it("memotong ruang tangga → profil anak tangga tergambar (kind cut, refId room)", () => {
    const l = layout({
      rooms: [
        room({ id: "A", x: 0, y: 0, width: 3, depth: 3, areaM2: 9 }),
        room({
          id: "room-stair",
          name: "Tangga",
          type: "tangga",
          x: 1,
          y: 1,
          width: 2.5,
          depth: 1.0,
          areaM2: 2.5,
          stairDirection: "s", // run sepanjang y → sejajar bidang potong axis "x"
        }),
      ],
    })
    const drawing = buildSection(l, { axis: "x", positionM: 2 }) // 1 ≤ 2 ≤ 3.5 → terpotong
    const stairLines = drawing.lines.filter((ln) => ln.refId === "room-stair" && ln.kind === "cut")
    // 2*steps garis zig-zag; steps ≥ 3 → minimal 6 garis
    expect(stairLines.length).toBeGreaterThanOrEqual(6)
  })

  it("run tegak lurus bidang potong → tidak menggambar profil (tidak crash)", () => {
    const l = layout({
      rooms: [
        room({ id: "A", x: 0, y: 0, width: 3, depth: 3, areaM2: 9 }),
        room({
          id: "room-stair2",
          name: "Tangga",
          type: "tangga",
          x: 1,
          y: 1,
          width: 2.5,
          depth: 1.0,
          areaM2: 2.5,
          stairDirection: "e", // run sepanjang x → tegak lurus potong axis "x"
        }),
      ],
    })
    const drawing = buildSection(l, { axis: "x", positionM: 2 })
    expect(drawing.lines.filter((ln) => ln.refId === "room-stair2").length).toBe(0)
  })
})

})

describe("buildSection — tangga bentuk L", () => {
  it("run sejajar bidang tergambar + garis bordes datar; run tegak lurus tidak", () => {
    const l = layout({
      rooms: [
        room({ id: "A", x: 0, y: 0, width: 5, depth: 5, areaM2: 25 }),
        room({
          id: "room-stair", name: "Tangga", type: "tangga",
          x: 1, y: 1, width: 3, depth: 2.5, areaM2: 7.5,
          stairDirection: "s", stairShape: "L", stairTurn: "kanan",
        }),
      ],
    })
    // dir s, belok kanan → run1 di strip timur (x∈[2.75,4]); potong x=3.5
    const d = buildSection(l, { axis: "x", positionM: 3.5 })
    const cutLines = d.lines.filter((ln) => ln.refId === "room-stair" && ln.kind === "cut")
    expect(cutLines.length).toBeGreaterThanOrEqual(6)
  })
})

describe("buildSection — cantilever (offsetM lantai)", () => {
  // 2 lantai; lantai 2 menjorok +1 m di x (offsetM {dx:1}).
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

  it("potongan sumbu y (H=x): dinding cut lantai 2 tergeser +dx; lantai 1 tetap", () => {
    const d = buildSection(cantiLayout, { axis: "y", positionM: 1.5 })
    // Lantai 2 (baseY 3..6) x[0,4] → geser dx → x[1,5].
    expect(d.lines).toContainEqual({ x1: 1, y1: 3, x2: 1, y2: 6, kind: "cut" })
    expect(d.lines).toContainEqual({ x1: 5, y1: 3, x2: 5, y2: 6, kind: "cut" })
    // Lantai 1 (baseY 0..3) tetap x[0,4].
    expect(d.lines).toContainEqual({ x1: 0, y1: 0, x2: 0, y2: 3, kind: "cut" })
    expect(d.lines).toContainEqual({ x1: 4, y1: 0, x2: 4, y2: 3, kind: "cut" })
  })

  it("potongan sumbu x (H=y): komponen dy menggeser H; dx hanya menggeser bidang potong", () => {
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
    // Cut axis x di positionM 2 (∈ x[0,4] kedua lantai). Lantai 2 H=y digeser
    // dy → y-bounds [0,3] → [1,4]; lantai 1 tetap [0,3].
    const d = buildSection(dyLayout, { axis: "x", positionM: 2 })
    expect(d.lines).toContainEqual({ x1: 1, y1: 3, x2: 1, y2: 6, kind: "cut" })
    expect(d.lines).toContainEqual({ x1: 4, y1: 3, x2: 4, y2: 6, kind: "cut" })
    expect(d.lines).toContainEqual({ x1: 0, y1: 0, x2: 0, y2: 3, kind: "cut" })
    expect(d.lines).toContainEqual({ x1: 3, y1: 0, x2: 3, y2: 3, kind: "cut" })
  })

  it("cantilever hanya menggeser garis — jumlah garis identik dengan flat (kedua sumbu)", () => {
    for (const c of [{ axis: "x", positionM: 2 }, { axis: "y", positionM: 1.5 }] as const) {
      expect(buildSection(cantiLayout, c).lines).toHaveLength(buildSection(flatLayout, c).lines.length)
    }
  })

  it("regresi: offsetM {0,0} identik dengan lantai tanpa offset (kedua sumbu)", () => {
    const zeroOffset = layout({
      floors: [
        floor({ id: "f1", level: 0, name: "Lantai 1", heightM: 3 }),
        floor({ id: "f2", level: 1, name: "Lantai 2", heightM: 3, offsetM: { dx: 0, dy: 0 } }),
      ],
      rooms: flatLayout.rooms,
    })
    for (const c of [{ axis: "x", positionM: 2 }, { axis: "y", positionM: 1.5 }] as const) {
      expect(buildSection(zeroOffset, c)).toEqual(buildSection(flatLayout, c))
    }
  })
})

describe("buildSection — mezzanine (E9)", () => {
  it("platform mezzanine digambar sebagai band slab pada elevasinya; tumpukan lantai penuh utuh", () => {
    const layout: DesignLayout = {
      id: "l", projectId: "p", versionId: "v",
      floors: [
        { id: "f1", level: 1, name: "L1", heightM: 2.95 },
        { id: "mz", level: 1.5, name: "Mezzanine", heightM: 2.2, kind: "mezzanine", baseOffsetM: 1.5 },
        { id: "f2", level: 2, name: "L2", heightM: 2.95 },
      ],
      rooms: [
        { id: "a", floorId: "f1", name: "Studio", type: "ruang_keluarga", x: 0, y: 0, width: 6, depth: 3, areaM2: 18 },
        { id: "p1", floorId: "mz", name: "Platform", type: "balkon", x: 3, y: 0, width: 3, depth: 3, areaM2: 9 },
        { id: "b", floorId: "f2", name: "Atas", type: "kamar_tidur", x: 0, y: 0, width: 6, depth: 3, areaM2: 18 },
      ],
      walls: [], openings: [], stairs: [], pools: [],
      validation: { passed: true, issues: [] },
    }
    const d = buildSection(layout, { axis: "y", positionM: 1.5 })
    // Band slab platform di y=1.5 & 1.65, hanya sepanjang ruang platform (x 3..6).
    expect(d.lines).toContainEqual({ x1: 3, y1: 1.5, x2: 6, y2: 1.5, kind: "slab" })
    expect(d.lines).toContainEqual({ x1: 3, y1: 1.65, x2: 6, y2: 1.65, kind: "slab" })
    // Lantai 2 tetap di 2.95 (mezzanine tak menambah tumpukan).
    expect(d.lines.some((l) => l.kind === "slab" && Math.abs(l.y1 - 2.95) < 1e-6)).toBe(true)
    expect(d.labels.some((l) => l.text.startsWith("MEZZANINE"))).toBe(true)
  })
})
