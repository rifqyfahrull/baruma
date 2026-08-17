import { describe, it, expect } from "vitest"
import {
  snapAxis, resizeCandidatesX, resizeCandidatesY, moveCandidatesX, snapMove,
} from "./alignment"

const site = { widthM: 10, depthM: 12 }

describe("snapAxis", () => {
  it("snaps to the nearest candidate within tol", () => {
    const r = snapAxis(3.27, [{ value: 3.3, kind: "edge" }, { value: 5, kind: "edge" }], 0.1)
    expect(r.value).toBeCloseTo(3.3, 5)
    expect(r.guide?.kind).toBe("edge")
  })
  it("does not snap when all candidates are outside tol", () => {
    const r = snapAxis(3.27, [{ value: 3.6, kind: "edge" }], 0.1)
    expect(r.value).toBe(3.27)
    expect(r.guide).toBeNull()
  })
})

describe("resizeCandidatesX", () => {
  const room = { x: 1, y: 1, width: 4, depth: 3 }
  const others = [{ x: 2, y: 6, width: 3.27, depth: 2 }]
  it("includes the neighbor's left/right/center + site bounds", () => {
    const vals = resizeCandidatesX(room, others, site, "right").map((c) => c.value)
    expect(vals).toEqual(expect.arrayContaining([2, 5.27, 3.635, 0, 10, 5]))
  })
  it("adds an equal-width position for the moving right edge (x + other.width)", () => {
    const eq = resizeCandidatesX(room, others, site, "right").find((c) => c.kind === "equal")!
    expect(eq.value).toBeCloseTo(room.x + 3.27, 5) // 4.27 → width becomes 3.27
  })
  it("equal-width for the left edge keeps the right edge fixed", () => {
    const eq = resizeCandidatesX(room, others, site, "left").find((c) => c.kind === "equal")!
    expect(eq.value).toBeCloseTo(room.x + room.width - 3.27, 5) // 5 - 3.27 = 1.73
  })
})

describe("resizeCandidatesY", () => {
  it("includes neighbor top/bottom/center on the Y axis", () => {
    const vals = resizeCandidatesY({ x: 0, y: 0, width: 2, depth: 2 }, [{ x: 0, y: 4, width: 2, depth: 3 }], site, "bottom").map((c) => c.value)
    expect(vals).toEqual(expect.arrayContaining([4, 7, 5.5]))
  })
})

describe("moveCandidatesX", () => {
  it("has edges + center + site but NO equal-size", () => {
    const cands = moveCandidatesX([{ x: 2, y: 0, width: 4, depth: 2 }], site)
    expect(cands.some((c) => c.kind === "equal")).toBe(false)
    expect(cands.map((c) => c.value)).toEqual(expect.arrayContaining([2, 6, 4, 0, 10, 5]))
  })
})

describe("snapMove", () => {
  it("shifts the room so its nearest reference (left/right/center) lands on a candidate", () => {
    // room x=5 width=3 → left 5, right 8, center 6.5; candidate 9 within tol 1.5 → align right edge → x=6
    const r = snapMove(5, 3, [{ value: 9, kind: "edge" }], 1.5)
    expect(r.value).toBeCloseTo(6, 5)
    expect(r.guide?.value).toBe(9)
  })
  it("returns the position unchanged when nothing is within tol", () => {
    const r = snapMove(5, 3, [{ value: 20, kind: "edge" }], 0.2)
    expect(r.value).toBe(5)
    expect(r.guide).toBeNull()
  })
})
