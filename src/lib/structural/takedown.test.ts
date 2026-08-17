import { describe, it, expect } from "vitest"

import { columnLoad } from "@/lib/structural/takedown"

describe("structural takedown — columnLoad (per kolom terbawah)", () => {
  it("floors 2: Atrib = spanX*spanY, Pu/Ps from loads.ts combos", () => {
    // Atrib = 4.0*3.0 = 12
    // Pu = 12*(2*9.2 + 3.4) = 12*21.8 = 261.6
    // Ps = 12*(2*7.0 + 2.5) = 12*16.5 = 198
    const r = columnLoad(4.0, 3.0, 2)
    expect(r.Atrib).toBe(12)
    expect(r.Pu).toBe(261.6)
    expect(r.Ps).toBe(198)
  })

  it("floors 1: single-floor + roof", () => {
    // Pu = 12*(9.2 + 3.4) = 12*12.6 = 151.2
    // Ps = 12*(7.0 + 2.5) = 12*9.5 = 114
    const r = columnLoad(4.0, 3.0, 1)
    expect(r.Atrib).toBe(12)
    expect(r.Pu).toBe(151.2)
    expect(r.Ps).toBe(114)
  })

  it("floors < 1 is clamped to 1 (minimum one floor)", () => {
    const r = columnLoad(4.0, 3.0, 0)
    expect(r.Atrib).toBe(12)
    expect(r.Pu).toBe(151.2)
    expect(r.Ps).toBe(114)
  })

  it("non-finite span → all zero (safe, no NaN/crash)", () => {
    const r = columnLoad(Number.NaN, 3.0, 2)
    expect(r.Atrib).toBe(0)
    expect(r.Pu).toBe(0)
    expect(r.Ps).toBe(0)
    expect(Number.isFinite(r.Pu)).toBe(true)
    expect(Number.isFinite(r.Ps)).toBe(true)
  })
})
