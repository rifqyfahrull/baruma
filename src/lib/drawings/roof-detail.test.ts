import { describe, it, expect } from "vitest"
import { buildRoofDetail } from "./roof-detail"
import type { DesignLayout, Floor, RoofSpec, Room } from "@/types"

const floor = (over: Partial<Floor>): Floor => ({
  id: "f1", level: 0, name: "Lantai 1", heightM: 3, ...over,
})
const room = (over: Partial<Room>): Room => ({
  id: "r", floorId: "f1", name: "R", type: "kamar_tidur",
  x: 0, y: 0, width: 3, depth: 3, areaM2: 9, ...over,
})
const layout = (over: Partial<DesignLayout>): DesignLayout => ({
  id: "l", projectId: "p", versionId: "v",
  floors: [floor({})], rooms: [], walls: [], openings: [], stairs: [], pools: [],
  validation: { passed: true, issues: [] },
  ...over,
})

// Footprint bbox 8×6 => span = min(8,6) = 6, halfSpan = 3. ov 0.5, slope 30°:
// rise = (3 + 0.5) · tan 30° = 3.5 · 0.577350… = 2.020726 → round2 = 2.02.
const pelana: RoofSpec = { type: "pelana", slopeDeg: 30, overhangM: 0.5, material: "genteng_beton" }
const roofLayout = (roof?: RoofSpec): DesignLayout =>
  layout({
    floors: [floor({ id: "f1", level: 0, heightM: 3 })],
    rooms: [room({ id: "big", x: 0, y: 0, width: 8, depth: 6, areaM2: 48 })],
    roof,
  })

describe("buildRoofDetail — sloped variant (pelana/limasan)", () => {
  it("titles every variant Detail Atap", () => {
    expect(buildRoofDetail(roofLayout(pelana)).title).toBe("Detail Atap")
    expect(buildRoofDetail(roofLayout({ ...pelana, type: "limasan" })).title).toBe("Detail Atap")
    expect(buildRoofDetail(roofLayout()).title).toBe("Detail Atap")
  })

  it("draws the rafter from the eave tip (−ov, 0) to the ridge (halfSpan, rise) with gradient tan(slopeDeg)", () => {
    const d = buildRoofDetail(roofLayout(pelana))
    const rafter = d.lines.find((l) => l.kind === "outline" && l.x1 === -0.5 && l.y1 === 0)
    expect(rafter).toEqual({ x1: -0.5, y1: 0, x2: 3, y2: 2.02, kind: "outline" })
    const gradient = (rafter!.y2 - rafter!.y1) / (rafter!.x2 - rafter!.x1)
    expect(gradient).toBeCloseTo(Math.tan((30 * Math.PI) / 180), 2)
  })

  it("clamps a wild persisted slopeDeg (999 → 40): rafter gradient ≈ tan 40°", () => {
    const d = buildRoofDetail(roofLayout({ ...pelana, slopeDeg: 999 }))
    const rafter = d.lines.find((l) => l.kind === "outline" && l.x1 === -0.5 && l.y1 === 0)!
    expect((rafter.y2 - rafter.y1) / (rafter.x2 - rafter.x1)).toBeCloseTo(Math.tan((40 * Math.PI) / 180), 2)
  })

  it("draws a schematic truss: bottom chord + king post (triangle) + 2 vertical web members", () => {
    const d = buildRoofDetail(roofLayout(pelana))
    expect(d.lines).toContainEqual({ x1: 0, y1: 0, x2: 3, y2: 0, kind: "outline" }) // bottom chord
    expect(d.lines).toContainEqual({ x1: 3, y1: 0, x2: 3, y2: 2.02, kind: "outline" }) // king post
    // Webs at 1/3 and 2/3 of the half-span, up to the rafter:
    // y(1) = (1 + 0.5)·tan30 = 0.866 → 0.87 · y(2) = 2.5·tan30 = 1.443 → 1.44.
    expect(d.lines).toContainEqual({ x1: 1, y1: 0, x2: 1, y2: 0.87, kind: "opening" })
    expect(d.lines).toContainEqual({ x1: 2, y1: 0, x2: 2, y2: 1.44, kind: "opening" })
  })

  it("marks 3 gording points on the rafter as small crosses", () => {
    const d = buildRoofDetail(roofLayout(pelana))
    // 3 crosses × 2 strokes + 2 webs = 8 "opening" lines.
    expect(d.lines.filter((l) => l.kind === "opening")).toHaveLength(8)
    // First gording at 0.25 · halfSpan = 0.75; y = (0.75 + 0.5)·tan30 = 0.7217.
    // Cross stroke: (0.75 ± 0.08, 0.7217 ± 0.08) → (0.67, 0.64)-(0.83, 0.8).
    expect(d.lines).toContainEqual({ x1: 0.67, y1: 0.64, x2: 0.83, y2: 0.8, kind: "opening" })
    expect(d.lines).toContainEqual({ x1: 0.67, y1: 0.8, x2: 0.83, y2: 0.64, kind: "opening" })
  })

  it("labels the material (via ROOF_MATERIALS) and the slope in degrees", () => {
    const d = buildRoofDetail(roofLayout({ ...pelana, material: "genteng_keramik" }))
    expect(d.labels.some((l) => l.text === "Genteng Keramik")).toBe(true)
    expect(d.labels.some((l) => l.text === "30°")).toBe(true)
  })

  it("dimensions overhang + ½ span (x chain) and rise (y chain)", () => {
    const d = buildRoofDetail(roofLayout(pelana))
    expect(d.dims).toContainEqual({ axis: "x", at: -0.9, points: [-0.5, 0, 3] })
    expect(d.dims).toContainEqual({ axis: "y", at: 3.6, points: [0, 2.02] })
  })

  it("sets a sheet-scalable bbox spanning the profile", () => {
    const d = buildRoofDetail(roofLayout(pelana))
    expect(d.widthM).toBe(3.5) // halfSpan + ov
    expect(d.heightM).toBe(2.72) // rise + label headroom
  })
})

describe("buildRoofDetail — partial rooftop plan overview", () => {
  // 8×6 footprint (non-rooftop room), a rooftop floor, and a 4×3 partial deck
  // at (2,1). deckAreaM2 = 12, roofStripsAreaM2 = 48 − 12 = 36.
  const partial = (roof: RoofSpec = pelana): DesignLayout =>
    layout({
      floors: [
        floor({ id: "f1", level: 0, heightM: 3 }),
        floor({ id: "floor-rooftop", level: 1, name: "Rooftop" }),
      ],
      rooms: [room({ id: "big", x: 0, y: 0, width: 8, depth: 6, areaM2: 48 })],
      roof,
      rooftopArea: { x: 2, y: 1, width: 4, depth: 3 },
    })

  it("keeps the section detail (rafter) AND adds a deck rect + ridge + summary", () => {
    const d = buildRoofDetail(partial())
    // Section detail retained: the pelana rafter (halfSpan 3, ov 0.5) is present.
    expect(d.lines).toContainEqual({ x1: -0.5, y1: 0, x2: 3, y2: 2.02, kind: "outline" })
    // Deck rect drawn with the "slab" kind (the section detail uses none).
    expect(d.lines.some((l) => l.kind === "slab")).toBe(true)
    // A strip ridge = a HORIZONTAL "cut" line (wall-stub cuts are vertical).
    expect(d.lines.some((l) => l.kind === "cut" && l.y1 === l.y2 && l.x1 !== l.x2)).toBe(true)
    // Deck label + area summary.
    expect(d.labels.some((l) => l.text === "Deck rooftop")).toBe(true)
    expect(d.labels.some((l) => l.text === "Deck 12 m² · Atap 36 m²")).toBe(true)
    // Summary rows lay out from the footprint's left edge → anchor "start";
    // the deck name stays centred inside the deck rect.
    expect(d.labels.find((l) => l.text === "Deck 12 m² · Atap 36 m²")?.anchor).toBe("start")
    expect(d.labels.find((l) => l.text.startsWith("Atap "))?.anchor).toBe("start")
    expect(d.labels.find((l) => l.text === "Deck rooftop")?.anchor).toBeUndefined()
  })

  it("non-partial (full/absent rooftopArea) output is unchanged — no plan artifacts", () => {
    const d = buildRoofDetail(roofLayout(pelana))
    // Same bbox as the standalone section detail (see the sloped-variant test).
    expect(d.widthM).toBe(3.5)
    expect(d.heightM).toBe(2.72)
    // None of the plan-only primitives leak into a non-partial drawing.
    expect(d.lines.some((l) => l.kind === "slab")).toBe(false)
    expect(d.labels.some((l) => l.text === "Deck rooftop")).toBe(false)
    expect(d.labels.some((l) => l.text.startsWith("Deck "))).toBe(false)
  })
})

describe("buildRoofDetail — explicit roof-zone plan/schedule", () => {
  it("adds zone rectangles, material schedule labels, ridge guides, and total area reconciliation", () => {
    const d = buildRoofDetail({
      ...roofLayout(pelana),
      roofZones: [
        {
          id: "rz-flat",
          type: "datar",
          x: 1.5,
          y: 1.5,
          widthM: 3,
          depthM: 3,
          slopeDeg: 0,
          overhangM: 0.2,
          materialId: "genteng_beton",
        },
        {
          id: "rz-hip",
          type: "limasan",
          x: 4.5,
          y: 1.5,
          widthM: 3,
          depthM: 3,
          slopeDeg: 30,
          overhangM: 0.2,
          materialId: "metal",
        },
      ],
    })

    expect(d.labels.some((l) => l.text === "Jadwal zona atap (2 zona)")).toBe(true)
    expect(d.labels.some((l) => l.text === "Material 21.85 m² · Tangkapan 18 m²")).toBe(true)
    expect(d.labels).toContainEqual(
      expect.objectContaining({
        text: "Atap Datar — Genteng Beton · 9.9 m²",
        refId: "rz-flat",
      })
    )
    expect(d.labels).toContainEqual(
      expect.objectContaining({
        text: "Atap Limasan — Metal · 11.95 m²",
        refId: "rz-hip",
      })
    )
    expect(d.lines.filter((l) => l.refId === "rz-flat" && l.kind === "opening")).toHaveLength(4)
    expect(d.lines.some((l) => l.refId === "rz-hip" && l.kind === "cut")).toBe(true)
  })
})

describe("buildRoofDetail — datar variant", () => {
  const datar: RoofSpec = { type: "datar", slopeDeg: 30, overhangM: 0.5, material: "genteng_beton" }

  it("labels the flat build-up layers: slab + screed + waterproofing (also when roof is absent)", () => {
    for (const l of [roofLayout(datar), roofLayout(undefined)]) {
      const d = buildRoofDetail(l)
      expect(d.labels.some((lb) => /beton/i.test(lb.text))).toBe(true)
      expect(d.labels.some((lb) => /screed/i.test(lb.text))).toBe(true)
      expect(d.labels.some((lb) => /waterproofing/i.test(lb.text))).toBe(true)
    }
  })

  it("draws layer lines across the half-span: slab top 0.15, screed top 0.20, waterproofing 0.22", () => {
    const d = buildRoofDetail(roofLayout(datar))
    expect(d.lines).toContainEqual({ x1: 0, y1: 0.15, x2: 3, y2: 0.15, kind: "outline" })
    expect(d.lines).toContainEqual({ x1: 0, y1: 0.2, x2: 3, y2: 0.2, kind: "opening" })
    expect(d.lines).toContainEqual({ x1: 0, y1: 0.22, x2: 3, y2: 0.22, kind: "opening" })
  })

  it("has no sloped rafter (no diagonal outline lines)", () => {
    const d = buildRoofDetail(roofLayout(datar))
    expect(d.lines.filter((l) => l.kind === "outline" && l.x1 !== l.x2 && l.y1 !== l.y2)).toHaveLength(0)
  })

  it('anchors the layer notes "start" just right of the leader ends (w + 0.9)', () => {
    const d = buildRoofDetail(roofLayout(datar)) // halfSpan w = 3
    for (const re of [/beton/i, /screed/i, /waterproofing/i]) {
      const lb = d.labels.find((l) => re.test(l.text))!
      expect(lb.anchor).toBe("start")
      expect(lb.x).toBeCloseTo(3.9, 5)
    }
  })
})
