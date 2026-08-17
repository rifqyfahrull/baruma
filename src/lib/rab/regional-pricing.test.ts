import { describe, expect, it } from "vitest"

import {
  BASELINE_IKK,
  IKK_2024,
  resolveRegion,
} from "./regional-pricing"

describe("resolveRegion", () => {
  it("DKI Jakarta is the baseline → factor exactly 1.0", () => {
    const r = resolveRegion(null, "DKI Jakarta")
    expect(r.provinceKey).toBe("dki_jakarta")
    expect(r.factor).toBe(1)
    expect(r.matchLevel).toBe("province")
  })

  it("scales down for cheaper provinces (Jawa Timur < Jakarta)", () => {
    const r = resolveRegion(null, "Jawa Timur")
    expect(r.factor).toBeLessThan(1)
    expect(r.factor).toBeCloseTo(IKK_2024.jawa_timur / BASELINE_IKK, 4)
  })

  it("scales up sharply for remote high-IKK provinces (Papua Pegunungan)", () => {
    const r = resolveRegion(null, "Papua Pegunungan")
    expect(r.factor).toBeGreaterThan(2)
    expect(r.confidence).toBe("low")
    expect(r.uncertaintyPct).toBeGreaterThanOrEqual(0.2) // widened for ikk>=140
  })

  it("infers province from a known city when province is absent", () => {
    const r = resolveRegion("Bandung", null)
    expect(r.provinceKey).toBe("jawa_barat")
    expect(r.matchLevel).toBe("city")
    expect(r.uncertaintyPct).toBe(0.12) // tighter for a city match
  })

  it("handles common aliases and casing", () => {
    expect(resolveRegion(null, "jabar").provinceKey).toBe("jawa_barat")
    expect(resolveRegion(null, "  DIY ").provinceKey).toBe("di_yogyakarta")
    expect(resolveRegion("Surabaya", null).provinceKey).toBe("jawa_timur")
    expect(resolveRegion("Jakarta Selatan", null).provinceKey).toBe("dki_jakarta")
  })

  it("falls back to national baseline (factor 1, widest band) when unknown", () => {
    const r = resolveRegion("Atlantis", "Wakanda")
    expect(r.provinceKey).toBeNull()
    expect(r.factor).toBe(1)
    expect(r.matchLevel).toBe("none")
    expect(r.uncertaintyPct).toBe(0.2)
    expect(r.confidence).toBe("low")
  })

  it("prefers explicit province over an inferred city", () => {
    // City says Jawa Barat, province says Bali → province wins.
    const r = resolveRegion("Bandung", "Bali")
    expect(r.provinceKey).toBe("bali")
    expect(r.matchLevel).toBe("province")
  })

  it("covers all 38 BPS provinces", () => {
    expect(Object.keys(IKK_2024)).toHaveLength(38)
  })

  it("city/kabupaten override takes precedence over province (costly kab in province)", () => {
    const r = resolveRegion("Puncak", "Papua Tengah")
    expect(r.matchLevel).toBe("city")
    expect(r.regionLabel).toContain("Puncak")
    expect(r.factor).toBeGreaterThan(3) // 361.36 / 114.79 ≈ 3.15
    expect(r.confidence).toBe("low") // approx (2025 basis)
    expect(r.uncertaintyPct).toBe(0.28)
    expect(r.source).toContain("perkiraan")
  })

  it("city override beats an explicit (cheaper) province", () => {
    // Even if province says DKI Jakarta, a known costly kabupaten city wins.
    const r = resolveRegion("Intan Jaya", "DKI Jakarta")
    expect(r.matchLevel).toBe("city")
    expect(r.regionLabel).toContain("Intan Jaya")
  })

  it("unknown city falls back to the provincial IKK", () => {
    const r = resolveRegion("Kota Antah Berantah", "Jawa Barat")
    expect(r.matchLevel).toBe("province")
    expect(r.provinceKey).toBe("jawa_barat")
  })
})
