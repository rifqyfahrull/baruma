import { describe, it, expect } from "vitest"
import { pickSheetScale } from "./scale"

describe("pickSheetScale", () => {
  it("picks the smallest architect scale that fits A3", () => {
    expect(pickSheetScale(7, 6)).toBe(50) // 7m→140mm ≤ 380, 6m→120 ≤ 238
    expect(pickSheetScale(25, 9)).toBe(100) // 25m→250 ≤ 380 @1:100
    expect(pickSheetScale(60, 20)).toBe(200)
    expect(pickSheetScale(500, 500)).toBe(500) // fallback terbesar
  })
})
