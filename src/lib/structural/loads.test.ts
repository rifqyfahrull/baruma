import { describe, it, expect } from "vitest"

import {
  DL_FLOOR,
  DL_ROOF,
  LL_FLOOR,
  LL_ROOF,
  FC_MPA,
  FY_MPA,
  MAX_SPAN,
  SOIL_DEFAULT_KPA,
  wu,
  ws,
  floorWu,
  roofWu,
  floorWs,
  roofWs,
  roundUp50,
  roundUp,
} from "@/lib/structural/loads"

describe("structural loads — constants (SNI, disederhanakan)", () => {
  it("exports the exact load & material constants", () => {
    expect(DL_FLOOR).toBe(5.0)
    expect(DL_ROOF).toBe(1.5)
    expect(LL_FLOOR).toBe(2.0)
    expect(LL_ROOF).toBe(1.0)
    expect(FC_MPA).toBe(25)
    expect(FY_MPA).toBe(400)
    expect(MAX_SPAN).toBe(4.0)
    expect(SOIL_DEFAULT_KPA).toBe(150)
  })
})

describe("structural loads — kombinasi beban", () => {
  it("wu = 1.2*DL + 1.6*LL (clean, no FP dust)", () => {
    expect(wu(5.0, 2.0)).toBe(9.2)
    expect(wu(1.5, 1.0)).toBe(3.4)
  })

  it("ws = DL + LL", () => {
    expect(ws(5.0, 2.0)).toBe(7.0)
    expect(ws(1.5, 1.0)).toBe(2.5)
  })

  it("floor/roof factored combos", () => {
    expect(floorWu()).toBe(9.2)
    expect(roofWu()).toBe(3.4)
  })

  it("floor/roof service combos", () => {
    expect(floorWs()).toBe(7.0)
    expect(roofWs()).toBe(2.5)
  })
})

describe("structural loads — rounding helpers", () => {
  it("roundUp50 rounds up to the next 50", () => {
    expect(roundUp50(178)).toBe(200)
    expect(roundUp50(200)).toBe(200)
    expect(roundUp50(151)).toBe(200)
    expect(roundUp50(150)).toBe(150)
  })

  it("roundUp rounds up to the next step (FP-safe)", () => {
    expect(roundUp(1.149, 0.1)).toBe(1.2)
    expect(roundUp(1.2, 0.1)).toBe(1.2)
    expect(roundUp(1.32, 0.1)).toBe(1.4)
    expect(roundUp(0.8, 0.1)).toBe(0.8)
    expect(roundUp(178, 50)).toBe(200)
  })
})
