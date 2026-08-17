import { describe, it, expect } from "vitest"

import type { DesignLayout } from "@/types"
import { clampToSite, roofAreaForLayout } from "./sanitation-place"

describe("clampToSite", () => {
  const site = { widthM: 10, depthM: 8 }

  it("leaves an in-bounds point unchanged", () => {
    expect(clampToSite(site, 5, 4)).toEqual({ x: 5, y: 4 })
  })

  it("clamps negatives to the lot origin", () => {
    expect(clampToSite(site, -3, -1)).toEqual({ x: 0, y: 0 })
  })

  it("clamps overshoot to the far lot corner (widthM × depthM)", () => {
    expect(clampToSite(site, 99, 99)).toEqual({ x: 10, y: 8 })
  })
})

describe("roofAreaForLayout", () => {
  const layout = (roof?: DesignLayout["roof"]): DesignLayout => ({
    id: "l", projectId: "p", versionId: "v",
    floors: [{ id: "f1", level: 1, name: "Lantai 1", heightM: 3 }],
    rooms: [
      { id: "r1", floorId: "f1", name: "A", type: "ruang_tamu", x: 0, y: 0, width: 8, depth: 8, areaM2: 64 },
    ],
    walls: [], openings: [], stairs: [], pools: [],
    ...(roof ? { roof } : {}),
    validation: { passed: true, issues: [] },
  })

  it("datar (default) = footprint × 1.1", () => {
    // 8 × 8 = 64 footprint → 64 × 1.1 = 70.4
    expect(roofAreaForLayout(layout())).toBe(70.4)
  })

  it("sloped = footprint × (1/cos slope) × 1.15", () => {
    const a = roofAreaForLayout(layout({ type: "pelana", slopeDeg: 30, overhangM: 0.5, material: "genteng_beton" }))
    expect(a).toBeCloseTo(64 * (1 / Math.cos((30 * Math.PI) / 180)) * 1.15, 2)
  })
})
