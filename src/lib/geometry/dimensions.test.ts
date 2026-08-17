import { describe, it, expect } from "vitest"

import type { Room } from "@/types"
import { clusterEdges, deriveDimensions } from "./dimensions"

const room = (over: Partial<Room>): Room => ({
  id: "r",
  floorId: "f1",
  name: "R",
  type: "ruang_tamu",
  x: 0,
  y: 0,
  width: 1,
  depth: 1,
  areaM2: 1,
  ...over,
})

describe("clusterEdges", () => {
  it("merges exactly-equal positions", () => {
    expect(clusterEdges([0, 0, 3, 3, 6], 0.1)).toEqual([0, 3, 6])
  })

  it("merges near-equal positions within tolerance (shared walls)", () => {
    const out = clusterEdges([2.98, 3.02], 0.1)
    expect(out).toHaveLength(1)
    expect(out[0]).toBeCloseTo(3, 2)
  })

  it("keeps positions further apart than tolerance separate", () => {
    expect(clusterEdges([0, 0.5], 0.1)).toHaveLength(2)
  })

  it("returns [] for no input", () => {
    expect(clusterEdges([])).toEqual([])
  })
})

describe("deriveDimensions", () => {
  it("derives shared axes for adjoining rooms", () => {
    const site = { widthM: 6, depthM: 4 }
    const rooms = [
      room({ id: "a", x: 0, y: 0, width: 3, depth: 4 }),
      room({ id: "b", x: 3, y: 0, width: 3, depth: 4 }),
    ]
    const d = deriveDimensions(rooms, site)

    expect(d.xAxes.map((a) => a.label)).toEqual(["A", "B", "C"])
    expect(d.xSegments.map((s) => s.m)).toEqual([3, 3])
    expect(d.overallX).toBe(6)

    expect(d.yAxes.map((a) => a.label)).toEqual(["1", "2"])
    expect(d.ySegments.map((s) => s.m)).toEqual([4])
    expect(d.overallY).toBe(4)
  })

  it("handles a single room", () => {
    const d = deriveDimensions(
      [room({ x: 0, y: 0, width: 5, depth: 4 })],
      { widthM: 5, depthM: 4 }
    )
    expect(d.xAxes).toHaveLength(2)
    expect(d.xSegments.map((s) => s.m)).toEqual([5])
    expect(d.overallX).toBe(5)
  })

  it("includes the site boundary as outer axes", () => {
    // room smaller than site → extra axes at the site edges
    const d = deriveDimensions(
      [room({ x: 1, y: 1, width: 2, depth: 2 })],
      { widthM: 6, depthM: 6 }
    )
    expect(d.xAxes.map((a) => a.m)).toEqual([0, 1, 3, 6])
    expect(d.xSegments.map((s) => s.m)).toEqual([1, 2, 3])
  })
})
