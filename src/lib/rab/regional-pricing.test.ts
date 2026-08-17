import { describe, expect, it } from "vitest"

import {
  BASELINE_IKK,
  CITY_IKK_COVERAGE,
  IKK_2024,
  isPriceBookStale,
  PRICE_BOOK_META,
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

  it("resolves real city-level IKK 2024 (Kota Bandung) with high confidence", () => {
    const r = resolveRegion("Bandung", null)
    expect(r.matchLevel).toBe("city")
    expect(r.ikk).toBeCloseTo(117.19, 2)
    expect(r.provinceKey).toBe("jawa_barat")
    expect(r.confidence).toBe("high")
    expect(r.uncertaintyPct).toBe(0.12)
    expect(r.source).not.toContain("perkiraan")
  })

  it("city/kabupaten override beats the provincial average (costly kab in province)", () => {
    // Kab. Puncak (Papua Tengah) IKK 379.81 ≫ its province — priced correctly.
    const r = resolveRegion("Puncak", null)
    expect(r.matchLevel).toBe("city")
    expect(r.regionLabel).toContain("Puncak")
    expect(r.factor).toBeGreaterThan(3) // 379.81 / 114.79 ≈ 3.31
    expect(r.confidence).toBe("low") // extreme remote (ikk ≥ 200)
    expect(r.uncertaintyPct).toBe(0.22)

    // Kab. Kepulauan Mentawai IKK 118.65 vs Sumbar province 93.06.
    const m = resolveRegion("Kepulauan Mentawai", null)
    expect(m.matchLevel).toBe("city")
    expect(m.ikk).toBeCloseTo(118.65, 2)
  })

  it("city wins when consistent with the given province, but explicit conflicting province wins", () => {
    const consistent = resolveRegion("Intan Jaya", "Papua Tengah")
    expect(consistent.matchLevel).toBe("city")
    expect(consistent.regionLabel).toContain("Intan Jaya")

    // Contradictory input (Bandung + Bali) → trust the explicit province.
    const conflict = resolveRegion("Bandung", "Bali")
    expect(conflict.matchLevel).toBe("province")
    expect(conflict.provinceKey).toBe("bali")
  })

  it("unknown city falls back to the provincial IKK", () => {
    const r = resolveRegion("Kota Antah Berantah", "Jawa Barat")
    expect(r.matchLevel).toBe("province")
    expect(r.provinceKey).toBe("jawa_barat")
  })

  it("city dataset covers the vast majority of kab/kota (incl. all major cities)", () => {
    expect(CITY_IKK_COVERAGE).toBeGreaterThan(400)
    for (const c of ["Batam", "Surabaya", "Medan", "Makassar", "Denpasar", "Jayapura"]) {
      expect(resolveRegion(c, null).matchLevel).toBe("city")
    }
  })

  it("isPriceBookStale flips after nextReviewDate", () => {
    const before = new Date(PRICE_BOOK_META.nextReviewDate)
    before.setDate(before.getDate() - 1)
    expect(isPriceBookStale(before)).toBe(false)
    const after = new Date(PRICE_BOOK_META.nextReviewDate)
    after.setDate(after.getDate() + 1)
    expect(isPriceBookStale(after)).toBe(true)
  })
})
