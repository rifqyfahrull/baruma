import { describe, it, expect } from "vitest"
import { zoneColor } from "./zones"

describe("zoneColor", () => {
  it("is stable per id and varies across ids", () => {
    expect(zoneColor("z1")).toBe(zoneColor("z1"))
    expect(zoneColor("z1")).not.toBe(zoneColor("z2"))
    expect(zoneColor("z1")).toMatch(/^#[0-9a-fA-F]{6}$/)
  })
})
