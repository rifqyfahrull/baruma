import { describe, it, expect } from "vitest"

import type { Room } from "@/types"
import { roomAt, clampToRoom } from "./electrical-place"

function room(id: string, x: number, y: number, width: number, depth: number): Room {
  return { id, floorId: "f1", name: id, type: "kamar_tidur", x, y, width, depth, areaM2: width * depth }
}

describe("roomAt", () => {
  const a = room("a", 0, 0, 4, 3)
  const b = room("b", 4, 0, 4, 3)

  it("returns the room containing the point", () => {
    expect(roomAt([a, b], 1, 1)?.id).toBe("a")
    expect(roomAt([a, b], 5, 2)?.id).toBe("b")
  })

  it("returns null on empty canvas", () => {
    expect(roomAt([a, b], 20, 20)).toBeNull()
  })

  it("includes the room edges (inclusive bounds)", () => {
    expect(roomAt([a], 0, 0)?.id).toBe("a")
    expect(roomAt([a], 4, 3)?.id).toBe("a")
  })

  it("prefers the last (top-most) room on overlap", () => {
    const over = room("over", 0, 0, 4, 3)
    expect(roomAt([a, over], 1, 1)?.id).toBe("over")
  })
})

describe("clampToRoom", () => {
  const r = room("a", 2, 1, 4, 3) // x∈[2,6], y∈[1,4]

  it("keeps interior points unchanged", () => {
    expect(clampToRoom(r, 3, 2)).toEqual({ x: 3, y: 2 })
  })

  it("clamps points outside the bbox to the nearest edge", () => {
    expect(clampToRoom(r, -5, -5)).toEqual({ x: 2, y: 1 })
    expect(clampToRoom(r, 99, 99)).toEqual({ x: 6, y: 4 })
    expect(clampToRoom(r, 3, 99)).toEqual({ x: 3, y: 4 })
  })
})
