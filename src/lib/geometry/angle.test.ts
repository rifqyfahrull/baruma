import { describe, expect, it } from "vitest"

import { normalizeAngle } from "./angle"

describe("normalizeAngle", () => {
  it("wraps into [0,360)", () => {
    expect(normalizeAngle(-90)).toBe(270)
    expect(normalizeAngle(450)).toBe(90)
  })
  it("snaps to the given step", () => {
    expect(normalizeAngle(47, 15)).toBe(45)
    expect(normalizeAngle(8, 15)).toBe(15)
  })
})
