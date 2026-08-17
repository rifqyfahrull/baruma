import { describe, expect, it } from "vitest"
import { BOW_FLOOR_SEGMENTS, BOW_RAIL_SEGMENTS, bowFloorStrips, bowRailSegments } from "./balcony-bow"

describe("bowFloorStrips", () => {
  it("returns no strips when bowM is 0 or absent (lurus lama, byte-identik)", () => {
    expect(bowFloorStrips(4, 0)).toEqual([])
    expect(bowFloorStrips(4, -1)).toEqual([])
    expect(bowFloorStrips(0, 0.5)).toEqual([])
  })

  it("splits the edge into BOW_FLOOR_SEGMENTS equal-width strips spanning the full length", () => {
    const strips = bowFloorStrips(4, 0.5)
    expect(strips).toHaveLength(BOW_FLOOR_SEGMENTS)
    const totalU = strips.reduce((sum, s) => sum + s.uLen, 0)
    expect(totalU).toBeCloseTo(4, 6)
    // Strips tile the edge left-to-right with no gaps/overlaps.
    let cursor = -2
    for (const s of strips) {
      expect(s.uMid).toBeCloseTo(cursor + s.uLen / 2, 6)
      cursor += s.uLen
    }
    expect(cursor).toBeCloseTo(2, 6)
  })

  it("the center strip protrudes exactly edgeBowM (odd segment count guarantees a centered strip)", () => {
    const bowM = 0.5
    const strips = bowFloorStrips(4, bowM)
    const mid = strips[(BOW_FLOOR_SEGMENTS - 1) / 2]
    expect(mid.uMid).toBeCloseTo(0, 9)
    expect(mid.vDepth).toBeCloseTo(bowM, 9)
  })

  it("end strips protrude far less than the center (fan/step silhouette tapering to the straight corners)", () => {
    const strips = bowFloorStrips(4, 0.5)
    const center = strips[(BOW_FLOOR_SEGMENTS - 1) / 2].vDepth
    expect(strips[0].vDepth).toBeLessThan(center)
    expect(strips[strips.length - 1].vDepth).toBeLessThan(center)
    expect(strips[0].vDepth).toBeCloseTo(strips[strips.length - 1].vDepth, 9) // symmetric
  })

  it("clamps an unreasonable bow to half the edge length", () => {
    const strips = bowFloorStrips(2, 10)
    const mid = strips[(BOW_FLOOR_SEGMENTS - 1) / 2]
    expect(mid.vDepth).toBeCloseTo(1, 9) // clamped to lenM/2
  })
})

describe("bowRailSegments", () => {
  it("returns no segments when bowM is 0 or absent", () => {
    expect(bowRailSegments(4, 0)).toEqual([])
    expect(bowRailSegments(4, -0.2)).toEqual([])
  })

  it("produces BOW_RAIL_SEGMENTS chord segments whose length sums to more than the straight chord (curve, not a line)", () => {
    const segs = bowRailSegments(4, 0.5)
    expect(segs).toHaveLength(BOW_RAIL_SEGMENTS)
    const totalLen = segs.reduce((sum, s) => sum + s.length, 0)
    expect(totalLen).toBeGreaterThan(4)
  })

  it("the middle node sits exactly edgeBowM out (even segment count guarantees a centered node)", () => {
    const bowM = 0.5
    const segs = bowRailSegments(4, bowM)
    const centerIdx = BOW_RAIL_SEGMENTS / 2
    // uMid/vMid of the two segments flanking the center node average to the node itself;
    // check the shared vertex directly via the segment endpoints instead.
    const before = segs[centerIdx - 1]
    const after = segs[centerIdx]
    const nodeV = before.vMid + (before.length * before.dirV) / 2
    const nodeVFromAfter = after.vMid - (after.length * after.dirV) / 2
    expect(nodeV).toBeCloseTo(bowM, 6)
    expect(nodeVFromAfter).toBeCloseTo(bowM, 6)
  })

  it("segments are angled (non-zero dirV) except right at the ends where the tangent flattens out", () => {
    const segs = bowRailSegments(4, 0.5)
    const midSeg = segs[Math.floor(segs.length / 2)]
    expect(Math.abs(midSeg.dirV)).toBeGreaterThan(0)
    expect(midSeg.dirU * midSeg.dirU + midSeg.dirV * midSeg.dirV).toBeCloseTo(1, 9) // unit vector
  })

  it("clamps an unreasonable bow to half the edge length", () => {
    const segs = bowRailSegments(2, 10)
    const maxV = Math.max(...segs.map((s) => s.vMid))
    expect(maxV).toBeLessThanOrEqual(1 + 1e-6)
  })
})
