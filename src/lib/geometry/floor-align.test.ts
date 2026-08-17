// @vitest-environment node
import { describe, it, expect } from "vitest"
import type { Room } from "@/types"
import { indoorFootprintBBox, alignFloorRoomsToFootprint } from "./floor-align"

const r = (over: Partial<Room>): Room => ({
  id: "r", floorId: "f2", name: "R", type: "kamar_tidur",
  x: 0, y: 0, width: 3, depth: 3, areaM2: 9, ...over,
})

describe("indoorFootprintBBox", () => {
  it("returns null for empty / all-outdoor rooms", () => {
    expect(indoorFootprintBBox([])).toBeNull()
    expect(indoorFootprintBBox([r({ type: "carport" }), r({ type: "taman" })])).toBeNull()
  })

  it("bboxes indoor rooms only (outdoor excluded)", () => {
    const rooms = [
      r({ id: "a", x: 0, y: 0, width: 4, depth: 2 }),
      r({ id: "b", x: 2, y: 2, width: 3, depth: 3 }),
      r({ id: "c", type: "taman", x: 0, y: 20, width: 5, depth: 5 }),
    ]
    expect(indoorFootprintBBox(rooms)).toEqual({ x: 0, y: 0, width: 5, depth: 5 })
  })
})

describe("alignFloorRoomsToFootprint", () => {
  it("grows exposed east rooms to the target east edge (multi-band)", () => {
    const rooms = [
      r({ id: "k1", x: 0, y: 0, width: 3, depth: 3 }),
      r({ id: "k2", x: 0, y: 3, width: 3, depth: 3 }),
    ]
    const target = { x: 0, y: 0, width: 6, depth: 6 }
    const res = alignFloorRoomsToFootprint(rooms, target)
    expect(res.rooms.map((rr) => [rr.id, rr.width])).toEqual([["k1", 6], ["k2", 6]])
    expect(res.summary.grown).toEqual(["k1", "k2"])
    expect(res.rooms.every((rr) => rr.areaM2 === rr.width * rr.depth)).toBe(true)
  })

  it("shrinks rooms overhanging the target south edge", () => {
    const rooms = [r({ id: "s", x: 0, y: 0, width: 3, depth: 8 })]
    const target = { x: 0, y: 0, width: 3, depth: 5 }
    const res = alignFloorRoomsToFootprint(rooms, target)
    expect(res.rooms[0].depth).toBe(5)
    expect(res.summary.shrunk).toEqual(["s"])
  })

  it("leaves interior (non-exposed) rooms untouched", () => {
    const rooms = [
      r({ id: "out", x: 0, y: 0, width: 3, depth: 3 }),   // neighbor "in" tepat di timur → TIDAK ekspos east
      r({ id: "in", x: 3, y: 0, width: 3, depth: 3 }),     // neighbor "edge" di timur → TIDAK ekspos east
      r({ id: "edge", x: 6, y: 0, width: 3, depth: 3 }),   // ekspos east → digrow ke target 12
    ]
    const target = { x: 0, y: 0, width: 12, depth: 3 }
    const res = alignFloorRoomsToFootprint(rooms, target)
    const byId = Object.fromEntries(res.rooms.map((rr) => [rr.id, rr]))
    expect(byId["in"].width).toBe(3) // interior unchanged
    expect(byId["out"].width).toBe(3) // out punya neighbor timur → tidak digrow
    expect(byId["edge"].width).toBe(6) // edge room grows to target (6→12)
  })

  it("removes rooms that become degenerate (fully beyond target)", () => {
    const rooms = [r({ id: "hang", x: 0, y: 10, width: 3, depth: 3 })]
    const target = { x: 0, y: 0, width: 3, depth: 5 }
    const res = alignFloorRoomsToFootprint(rooms, target)
    expect(res.rooms).toHaveLength(0)
    expect(res.summary.removed).toEqual(["hang"])
  })

  it("returns input unchanged when already aligned", () => {
    const rooms = [r({ id: "a", x: 0, y: 0, width: 3, depth: 3 })]
    const target = { x: 0, y: 0, width: 3, depth: 3 }
    const res = alignFloorRoomsToFootprint(rooms, target)
    expect(res.rooms[0]).toEqual(rooms[0])
    expect(res.summary).toEqual({ grown: [], shrunk: [], removed: [] })
  })
})
