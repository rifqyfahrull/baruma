import { describe, expect, it } from "vitest"

import { makeSegmentElement, makeSurfaceElement } from "@/lib/exterior/factories"
import type { DesignLayout } from "@/types"
import { buildSitePlan } from "./site-plan"

const layout: DesignLayout = {
  id: "l",
  projectId: "p",
  versionId: "v",
  floors: [{ id: "floor-1", level: 0, name: "Lantai 1", heightM: 3 }],
  rooms: [
    { id: "r1", floorId: "floor-1", name: "Ruang", type: "ruang_tamu", x: 1, y: 1, width: 4, depth: 3, areaM2: 12 },
    { id: "cp", floorId: "floor-1", name: "Carport", type: "carport", x: 1, y: 4, width: 3, depth: 3, areaM2: 9 },
  ],
  walls: [],
  openings: [],
  stairs: [],
  pools: [],
  exteriorElements: [
    makeSegmentElement("sliding_gate", { x: 1, y: 7.5 }, { x: 4, y: 7.5 }, { id: "gate-1", label: "Gerbang" }),
    makeSurfaceElement("garden_bed", [
      { x: 5, y: 4 },
      { x: 7, y: 4 },
      { x: 7, y: 6 },
      { x: 5, y: 6 },
    ], { id: "garden-1", label: "Taman" }),
  ],
  validation: { passed: true, issues: [] },
}

describe("buildSitePlan", () => {
  it("draws site boundary, ground floor footprint, and exterior refs", () => {
    const drawing = buildSitePlan(layout, { widthM: 8, depthM: 10 })

    expect(drawing.title).toBe("Rencana Tapak")
    expect(drawing.widthM).toBe(8)
    expect(drawing.heightM).toBe(10)
    expect(drawing.lines).toContainEqual({ x1: 0, y1: 0, x2: 8, y2: 0, kind: "ground", refId: "site-boundary" })
    expect(drawing.lines.some((line) => line.refId === "r1" && line.kind === "outline")).toBe(true)
    expect(drawing.lines.some((line) => line.refId === "cp" && line.kind === "opening")).toBe(true)
    expect(drawing.lines.some((line) => line.refId === "gate-1")).toBe(true)
    expect(drawing.lines.filter((line) => line.refId === "garden-1")).toHaveLength(4)
    expect(drawing.labels).toContainEqual({ x: 2.5, y: 7.5, text: "Gerbang", kind: "room", refId: "gate-1" })
    expect(drawing.dims).toContainEqual({ axis: "x", at: -0.8, points: [0, 8] })
    expect(drawing.dims).toContainEqual({ axis: "y", at: -0.8, points: [0, 10] })
  })

  it("derives site bounds from layout and exterior elements when project site is absent", () => {
    const drawing = buildSitePlan(layout)

    expect(drawing.widthM).toBe(7)
    expect(drawing.heightM).toBeGreaterThanOrEqual(7.5)
  })

  it("excludes carport from the BANGUNAN footprint outline even though it's adjacent to the house", () => {
    // r1 (ruang_tamu) spans x:1-5,y:1-4; cp (carport) is adjacent right below
    // (x:1-4,y:4-7). Before the fix, the footprint union merged both into an
    // L-shape; the carport must not extend the building outline.
    const drawing = buildSitePlan(layout, { widthM: 8, depthM: 10 })
    const footprintLines = drawing.lines.filter((line) => line.refId === "building-footprint")
    const maxY = Math.max(...footprintLines.flatMap((line) => [line.y1, line.y2]))
    // r1 alone bottoms out at y=4; the carport (bottoming at y=7) must not appear.
    expect(maxY).toBe(4)
  })
})
