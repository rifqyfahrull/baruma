import { describe, expect, it } from "vitest"

import { sunPosition } from "./sun"

describe("sunPosition", () => {
  it("points straight up at 90° elevation (zenith)", () => {
    const [x, y, z] = sunPosition(135, 90)
    expect(x).toBeCloseTo(0, 6)
    expect(y).toBeCloseTo(1, 6)
    expect(z).toBeCloseTo(0, 6)
  })

  it("sits on the horizon (y≈0) at 0° elevation", () => {
    const [, y] = sunPosition(217, 0)
    expect(y).toBeCloseTo(0, 6)
  })

  it("azimuth 0° faces +z on the horizon", () => {
    const [x, y, z] = sunPosition(0, 0)
    expect(x).toBeCloseTo(0, 6)
    expect(y).toBeCloseTo(0, 6)
    expect(z).toBeCloseTo(1, 6)
  })

  it("azimuth 90° faces +x on the horizon", () => {
    const [x, , z] = sunPosition(90, 0)
    expect(x).toBeCloseTo(1, 6)
    expect(z).toBeCloseTo(0, 6)
  })

  it("azimuth 180° faces -z on the horizon", () => {
    const [x, , z] = sunPosition(180, 0)
    expect(x).toBeCloseTo(0, 6)
    expect(z).toBeCloseTo(-1, 6)
  })

  it("returns a unit vector by default and scales with radius", () => {
    const v = sunPosition(200, 33)
    expect(Math.hypot(v[0], v[1], v[2])).toBeCloseTo(1, 6)
    const v2 = sunPosition(200, 33, 10)
    expect(Math.hypot(v2[0], v2[1], v2[2])).toBeCloseTo(10, 6)
  })

  it("resolves the default sun (az 135°, el 45°) to expected xyz", () => {
    const [x, y, z] = sunPosition(135, 45)
    expect(x).toBeCloseTo(0.5, 6)
    expect(y).toBeCloseTo(Math.SQRT1_2, 6)
    expect(z).toBeCloseTo(-0.5, 6)
  })
})
