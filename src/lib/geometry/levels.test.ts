import { describe, it, expect } from "vitest"
import { roomsAdjacentOnSide, snapLevelOffset, levelStepWarning } from "./index"

const r = (x: number, y: number, width: number, depth: number, id = "") => ({ x, y, width, depth, id })

describe("roomsAdjacentOnSide", () => {
  it("finds the room sharing the east edge with overlap", () => {
    const a = r(0, 0, 3, 3)
    const b = r(3, 0, 3, 3, "b")
    expect(roomsAdjacentOnSide(a, "e", [b])?.id).toBe("b")
    expect(roomsAdjacentOnSide(b, "w", [a as never]) ).not.toBeNull()
  })
  it("returns null when edges don't touch or don't overlap", () => {
    const a = r(0, 0, 3, 3)
    expect(roomsAdjacentOnSide(a, "e", [r(4, 0, 3, 3, "far")])).toBeNull() // gap
    expect(roomsAdjacentOnSide(a, "e", [r(3, 5, 3, 3, "noovl")])).toBeNull() // no y-overlap
  })
})

describe("snapLevelOffset / levelStepWarning", () => {
  it("snaps to multiples of the riser height", () => {
    expect(snapLevelOffset(0)).toBe(0)
    expect(snapLevelOffset(-0.16)).toBe(-0.18)
    expect(snapLevelOffset(0.2)).toBe(0.18)
    expect(snapLevelOffset(-0.35)).toBe(-0.36)
  })
  it("warns only when beyond one comfortable step", () => {
    expect(levelStepWarning(-0.18)).toBeNull()
    expect(levelStepWarning(-0.36)).not.toBeNull()
  })
})
