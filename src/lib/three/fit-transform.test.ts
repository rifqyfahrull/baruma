import { describe, expect, it } from "vitest"
import { computeFitTransform, computeFitTransformOriented } from "./fit-transform"

describe("computeFitTransform", () => {
  it("scales uniformly to fit within the target footprint (smallest ratio wins)", () => {
    // model 2x2x2 centered at origin, target 1(w) x 4(d) x 4(h) → limiting axis is width → scale 0.5
    const t = computeFitTransform({ size: [2, 2, 2], center: [0, 0, 0] }, { w: 1, d: 4, h: 4 })
    expect(t.scale).toBeCloseTo(0.5, 5)
  })

  it("rests the base at y=0 and centers x/z", () => {
    // model 2x2x2 whose center is at (1, 1, 1) (so it spans 0..2 on each axis), target 2x2x2 → scale 1
    const t = computeFitTransform({ size: [2, 2, 2], center: [1, 1, 1] }, { w: 2, d: 2, h: 2 })
    expect(t.scale).toBeCloseTo(1, 5)
    expect(t.position[0]).toBeCloseTo(-1, 5) // -center.x*scale
    expect(t.position[2]).toBeCloseTo(-1, 5) // -center.z*scale
    // base: center.y=1, size.y/2=1 → (1 - 1)*1 = 0
    expect(t.position[1]).toBeCloseTo(0, 5)
  })

  it("guards degenerate (zero) size without throwing or NaN", () => {
    const t = computeFitTransform({ size: [0, 0, 0], center: [0, 0, 0] }, { w: 1, d: 1, h: 1 })
    expect(Number.isFinite(t.scale)).toBe(true)
    expect(t.scale).toBe(1)
    expect(t.position.every(Number.isFinite)).toBe(true)
  })
})

describe("computeFitTransformOriented", () => {
  it("rotates 90° when the model is authored sideways (car long on X, slot deep on Z)", () => {
    // car GLB: 4.4 long on X, 1.8 tall, 1.7 wide on Z; carport slot: 1.74 wide, 4.1 deep
    const bbox = {
      size: [4.4, 1.8, 1.7] as [number, number, number],
      center: [0, 0.9, 0] as [number, number, number],
    }
    const target = { w: 1.74, d: 4.1, h: 1.86 }

    const oriented = computeFitTransformOriented(bbox, target)
    const legacy = computeFitTransform(bbox, target)

    expect(oriented.rotationY).toBeCloseTo(Math.PI / 2, 5)
    // 90° footprint: z(1.7)→w, x(4.4)→d → min(1.74/1.7, 1.86/1.8, 4.1/4.4)
    expect(oriented.scale).toBeCloseTo(Math.min(1.74 / 1.7, 1.86 / 1.8, 4.1 / 4.4), 5)
    // legacy min-of-all-axes fit shrinks to 1.74/4.4 ≈ 0.395 — oriented is >2x larger
    expect(legacy.scale).toBeCloseTo(1.74 / 4.4, 5)
    expect(oriented.scale).toBeGreaterThan(legacy.scale * 2)
  })

  it("keeps rotationY 0 for a square-footprint model (tie prefers 0°)", () => {
    const bbox = {
      size: [2, 1, 2] as [number, number, number],
      center: [0, 0.5, 0] as [number, number, number],
    }
    const t = computeFitTransformOriented(bbox, { w: 1, d: 3, h: 2 })
    expect(t.rotationY).toBe(0)
    expect(t.scale).toBeCloseTo(0.5, 5)
  })

  it("matches the legacy fit exactly when 0° is already the better orientation", () => {
    // sofa: wide on X in a wide slot — no rotation needed
    const bbox = {
      size: [2.2, 0.9, 1.0] as [number, number, number],
      center: [0.3, 0.45, -0.1] as [number, number, number],
    }
    const target = { w: 2.2, d: 1.0, h: 0.9 }
    const oriented = computeFitTransformOriented(bbox, target)
    const legacy = computeFitTransform(bbox, target)
    expect(oriented.rotationY).toBe(0)
    expect(oriented.scale).toBeCloseTo(legacy.scale, 6)
    expect(oriented.position[0]).toBeCloseTo(legacy.position[0], 6)
    expect(oriented.position[1]).toBeCloseTo(legacy.position[1], 6)
    expect(oriented.position[2]).toBeCloseTo(legacy.position[2], 6)
  })

  it("re-centers an off-origin model correctly after the 90° rotation", () => {
    // model spans x∈[-1,3], y∈[0,2], z∈[1.5,2.5]; center (1,1,2), size (4,2,1)
    // scale0 = min(1/4, 2/2, 4/1) = 0.25; scale90 = min(1/1, 2/2, 4/4) = 1 → rotate
    const bbox = {
      size: [4, 2, 1] as [number, number, number],
      center: [1, 1, 2] as [number, number, number],
    }
    const t = computeFitTransformOriented(bbox, { w: 1, d: 4, h: 2 })
    expect(t.rotationY).toBeCloseTo(Math.PI / 2, 5)
    expect(t.scale).toBeCloseTo(1, 5)
    // rotateY(90°) maps center (1,1,2) → (2,1,-1); position must cancel it on x/z
    expect(t.position[0]).toBeCloseTo(-2, 5)
    expect(t.position[2]).toBeCloseTo(1, 5)
    expect(t.position[1]).toBeCloseTo(0, 5) // base already on y=0

    // verify with the max corner (3, 2, 2.5): rotate → (2.5, 2, -3), translate → (0.5, 2, -2)
    // final bbox must be x∈[-0.5,0.5], y∈[0,2], z∈[-2,2]
    const corner = [3, 2, 2.5]
    const rotated = [corner[2], corner[1], -corner[0]]
    const final = [
      rotated[0] * t.scale + t.position[0],
      rotated[1] * t.scale + t.position[1],
      rotated[2] * t.scale + t.position[2],
    ]
    expect(final[0]).toBeCloseTo(0.5, 5)
    expect(final[1]).toBeCloseTo(2, 5)
    expect(final[2]).toBeCloseTo(-2, 5)
  })

  it("guards degenerate (zero) size without throwing or NaN", () => {
    const t = computeFitTransformOriented(
      { size: [0, 0, 0], center: [0, 0, 0] },
      { w: 1, d: 1, h: 1 }
    )
    expect(Number.isFinite(t.scale)).toBe(true)
    expect(t.scale).toBe(1)
    expect(t.rotationY).toBe(0)
    expect(t.position.every(Number.isFinite)).toBe(true)
  })
})
