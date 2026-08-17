import { describe, it, expect } from "vitest"

import { subtractRectHoles, type SlabRect } from "@/lib/geometry/slab"

const area = (rs: SlabRect[]) => rs.reduce((s, r) => s + r.width * r.depth, 0)
const overlaps = (a: SlabRect, b: SlabRect) =>
  a.x < b.x + b.width - 1e-6 && b.x < a.x + a.width - 1e-6 &&
  a.y < b.y + b.depth - 1e-6 && b.y < a.y + a.depth - 1e-6

describe("subtractRectHoles", () => {
  const outer: SlabRect = { x: 0, y: 0, width: 10, depth: 8 }

  it("returns the outer rect unchanged when there are no holes", () => {
    expect(subtractRectHoles(outer, [])).toEqual([outer])
  })

  it("carves a central hole into 4 strips whose area = outer − hole, no overlap", () => {
    const hole: SlabRect = { x: 3, y: 3, width: 2, depth: 2 }
    const strips = subtractRectHoles(outer, [hole])
    expect(strips.length).toBe(4)
    expect(area(strips)).toBeCloseTo(10 * 8 - 2 * 2, 5)
    // the hole is genuinely empty — no strip overlaps it
    expect(strips.every((s) => !overlaps(s, hole))).toBe(true)
    // strips are mutually disjoint
    for (let i = 0; i < strips.length; i++)
      for (let j = i + 1; j < strips.length; j++)
        expect(overlaps(strips[i], strips[j])).toBe(false)
  })

  it("an edge hole (touching a boundary) yields fewer strips, still correct area", () => {
    const hole: SlabRect = { x: 0, y: 3, width: 2, depth: 2 } // on the west edge
    const strips = subtractRectHoles(outer, [hole])
    expect(area(strips)).toBeCloseTo(10 * 8 - 2 * 2, 5)
    expect(strips.every((s) => !overlaps(s, hole))).toBe(true)
  })

  it("two separate holes both carved, area = outer − both, no overlaps", () => {
    const h1: SlabRect = { x: 1, y: 1, width: 2, depth: 2 }
    const h2: SlabRect = { x: 6, y: 4, width: 2, depth: 2 }
    const strips = subtractRectHoles(outer, [h1, h2])
    expect(area(strips)).toBeCloseTo(10 * 8 - 4 - 4, 5)
    expect(strips.every((s) => !overlaps(s, h1) && !overlaps(s, h2))).toBe(true)
    for (let i = 0; i < strips.length; i++)
      for (let j = i + 1; j < strips.length; j++)
        expect(overlaps(strips[i], strips[j])).toBe(false)
  })

  it("degenerate outer → empty; zero-size holes ignored", () => {
    expect(subtractRectHoles({ x: 0, y: 0, width: 0, depth: 5 }, [])).toEqual([])
    expect(subtractRectHoles(outer, [{ x: 1, y: 1, width: 0, depth: 0 }])).toEqual([outer])
  })
})
