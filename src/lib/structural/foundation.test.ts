import { describe, it, expect } from "vitest"

import { sizeFooting } from "@/lib/structural/foundation"

const DEEP_NOTE = "pertimbangkan pondasi dalam (tiang/strauss) — konsultasi ahli"

describe("structural foundation — sizeFooting (telapak persegi dari σ)", () => {
  it("Ps 198 kN, σ 150 kPa → side 1.2, thickness 0.25, area 1.32, no deepNote", () => {
    // A = 198/150 = 1.32; √1.32 = 1.149; roundUp(_,0.1) = 1.2; max(0.8,1.2)=1.2
    const r = sizeFooting(198, 150)
    expect(r.side).toBe(1.2)
    expect(r.thickness).toBe(0.25)
    expect(r.area).toBe(1.32)
    expect(r.deepNote).toBeUndefined()
  })

  it("Ps 1000 kN, σ 100 kPa → side 3.2, area 10 (>4) → deepNote present", () => {
    // A = 10; √10 = 3.162; roundUp(_,0.1) = 3.2; max(0.8,3.2)=3.2
    const r = sizeFooting(1000, 100)
    expect(r.side).toBe(3.2)
    expect(r.area).toBe(10)
    expect(r.thickness).toBe(0.25)
    expect(r.deepNote).toBe(DEEP_NOTE)
  })

  it("Ps 50 kN, σ 150 kPa → side 0.8 minimum (A=0.33 → √0.574 → 0.6 → max(0.8,0.6))", () => {
    const r = sizeFooting(50, 150)
    expect(r.area).toBe(0.33)
    expect(r.side).toBe(0.8)
    expect(r.thickness).toBe(0.25)
    expect(r.deepNote).toBeUndefined()
  })

  it("σ ≤ 0 → clamped to SOIL_DEFAULT_KPA (150), no crash (matches σ=150)", () => {
    const r = sizeFooting(198, 0)
    expect(Number.isFinite(r.side)).toBe(true)
    expect(r.side).toBe(1.2)
    expect(r.area).toBe(1.32)
    expect(r.thickness).toBe(0.25)
  })

  it("non-finite Ps → safe minimal footing (side 0.8, area 0, no note)", () => {
    const r = sizeFooting(Number.NaN, 150)
    expect(r.side).toBe(0.8)
    expect(r.area).toBe(0)
    expect(r.thickness).toBe(0.25)
    expect(r.deepNote).toBeUndefined()
  })
})
