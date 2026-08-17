import { describe, it, expect } from "vitest"

import { buildingFootprint, buildingFootprintArea, deriveColumnGrid } from "@/lib/structural/grid"
import { MAX_SPAN } from "@/lib/structural/loads"
import type { DesignLayout, Floor, Room } from "@/types"

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

/** Rooms tiling an 8×6 footprint from the origin (two rooms). */
const footprint8x6 = layout({
  rooms: [
    room({ id: "A", x: 0, y: 0, width: 8, depth: 3, areaM2: 24 }),
    room({ id: "B", x: 0, y: 3, width: 8, depth: 3, areaM2: 24 }),
  ],
})

describe("buildingFootprint", () => {
  it("bbox over non-rooftop rooms (8×6 from origin)", () => {
    expect(buildingFootprint(footprint8x6)).toEqual({
      widthM: 8, depthM: 6, x0: 0, y0: 0,
    })
  })

  it("excludes rooftop rooms (matches the shared floor-rooftop filter)", () => {
    const withRooftop = layout({
      floors: [
        floor({ id: "f1", level: 0 }),
        floor({ id: "floor-rooftop", level: 1, name: "Atap" }),
      ],
      rooms: [
        room({ id: "A", x: 0, y: 0, width: 8, depth: 3, areaM2: 24 }),
        room({ id: "B", x: 0, y: 3, width: 8, depth: 3, areaM2: 24 }),
        // A huge rooftop room that would blow the bbox up if not excluded.
        room({ id: "RT", floorId: "floor-rooftop", type: "rooftop_lounge", x: 0, y: 0, width: 20, depth: 20, areaM2: 400 }),
      ],
    })
    expect(buildingFootprint(withRooftop)).toEqual({
      widthM: 8, depthM: 6, x0: 0, y0: 0,
    })
  })

  it("captures a non-zero origin (x0/y0 = min corner)", () => {
    const offset = layout({
      rooms: [
        room({ id: "A", x: 2, y: 3, width: 8, depth: 6, areaM2: 48 }),
      ],
    })
    expect(buildingFootprint(offset)).toEqual({
      widthM: 8, depthM: 6, x0: 2, y0: 3,
    })
  })

  it("empty rooms → safe zero footprint", () => {
    expect(buildingFootprint(layout({ rooms: [] }))).toEqual({
      widthM: 0, depthM: 0, x0: 0, y0: 0,
    })
  })

  it("tolerates malformed rooms with non-finite dims", () => {
    const malformed = layout({
      rooms: [
        room({ id: "A", x: 0, y: 0, width: 8, depth: 6, areaM2: 48 }),
        room({ id: "NaN", x: Number.NaN, y: 0, width: Number.POSITIVE_INFINITY, depth: 3 }),
      ],
    })
    expect(buildingFootprint(malformed)).toEqual({
      widthM: 8, depthM: 6, x0: 0, y0: 0,
    })
  })
})

describe("buildingFootprintArea", () => {
  it("width × depth of the non-rooftop bbox (8×6 → 48 m²)", () => {
    expect(buildingFootprintArea(footprint8x6)).toBe(48)
  })

  it("degenerate empty rooms → 0 (no NaN downstream)", () => {
    expect(buildingFootprintArea(layout({ rooms: [] }))).toBe(0)
  })
})

describe("deriveColumnGrid", () => {
  it("8×6 → nx3 spanX4.0 ny3 spanY3.0, 9 columns at exact intersections", () => {
    const g = deriveColumnGrid(footprint8x6)
    expect(g.nx).toBe(3)
    expect(g.ny).toBe(3)
    expect(g.spanX).toBe(4.0)
    expect(g.spanY).toBe(3.0)
    expect(g.widthM).toBe(8)
    expect(g.depthM).toBe(6)
    expect(g.columns).toHaveLength(9)
    // First column at the footprint origin, opposite corner at (8, 6).
    expect(g.columns[0]).toEqual({ x: 0, y: 0 })
    expect(g.columns[g.columns.length - 1]).toEqual({ x: 8, y: 6 })
    // Every column sits on a grid intersection within the footprint.
    for (const c of g.columns) {
      expect(c.x).toBeGreaterThanOrEqual(0)
      expect(c.x).toBeLessThanOrEqual(8)
      expect(c.y).toBeGreaterThanOrEqual(0)
      expect(c.y).toBeLessThanOrEqual(6)
    }
  })

  it("places columns relative to a non-zero footprint origin", () => {
    const offset = layout({
      rooms: [room({ id: "A", x: 2, y: 3, width: 8, depth: 6, areaM2: 48 })],
    })
    const g = deriveColumnGrid(offset)
    expect(g.columns[0]).toEqual({ x: 2, y: 3 })
    expect(g.columns[g.columns.length - 1]).toEqual({ x: 10, y: 9 })
  })

  it("12×10 → nx4 spanX4.0 ny4 spanY3.33, 16 columns, all spans ≤ 4", () => {
    const big = layout({
      rooms: [room({ id: "A", x: 0, y: 0, width: 12, depth: 10, areaM2: 120 })],
    })
    const g = deriveColumnGrid(big)
    expect(g.nx).toBe(4)
    expect(g.ny).toBe(4)
    expect(g.spanX).toBe(4.0)
    expect(g.spanY).toBe(3.33)
    expect(g.columns).toHaveLength(16)
    expect(g.spanX).toBeLessThanOrEqual(MAX_SPAN)
    expect(g.spanY).toBeLessThanOrEqual(MAX_SPAN)
  })

  it("degenerate empty rooms → safe (no crash, empty column grid)", () => {
    const g = deriveColumnGrid(layout({ rooms: [] }))
    expect(g.columns).toEqual([])
    expect(g.widthM).toBe(0)
    expect(g.depthM).toBe(0)
    expect(() => deriveColumnGrid(layout({ rooms: [] }))).not.toThrow()
  })
})

describe("buildingFootprint — cantilever offset-aware (Track B)", () => {
  it("footprint = union bbox posisi efektif (lantai atas menjorok +1 di x)", () => {
    const l: DesignLayout = {
      id: "l", projectId: "p", versionId: "v",
      floors: [
        { id: "f1", level: 1, name: "L1", heightM: 2.95 },
        { id: "f2", level: 2, name: "L2", heightM: 2.95, offsetM: { dx: 1, dy: 0 } },
      ],
      rooms: [
        { id: "a", floorId: "f1", name: "A", type: "ruang_tamu", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 },
        { id: "b", floorId: "f2", name: "B", type: "kamar_tidur", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 },
      ],
      walls: [], openings: [], stairs: [], pools: [],
      validation: { passed: true, issues: [] },
    }
    // f1 x 0..4; f2 tergeser → x 1..5 → union 0..5.
    expect(buildingFootprint(l)).toEqual({ x0: 0, y0: 0, widthM: 5, depthM: 3 })
  })

  it("tanpa offsetM → identik bbox lama (offset 0)", () => {
    const l: DesignLayout = {
      id: "l", projectId: "p", versionId: "v",
      floors: [{ id: "f1", level: 1, name: "L1", heightM: 2.95 }],
      rooms: [{ id: "a", floorId: "f1", name: "A", type: "ruang_tamu", x: 0.5, y: 0.5, width: 4, depth: 3, areaM2: 12 }],
      walls: [], openings: [], stairs: [], pools: [],
      validation: { passed: true, issues: [] },
    }
    expect(buildingFootprint(l)).toEqual({ x0: 0.5, y0: 0.5, widthM: 4, depthM: 3 })
  })
})
