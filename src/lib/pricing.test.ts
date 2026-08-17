import { describe, it, expect } from "vitest"

import { formatPlanPrice, formatPlanPeriod, planCtaLabel } from "./pricing"

describe("formatPlanPrice", () => {
  it("formats zero as Gratis", () => {
    expect(formatPlanPrice(0)).toBe("Gratis")
  })

  it("formats the Pro seed price exactly as the pre-T2 landing copy", () => {
    expect(formatPlanPrice(149000)).toBe("Rp 149rb")
  })

  it("formats the Studio seed price exactly as the pre-T2 landing copy", () => {
    expect(formatPlanPrice(499000)).toBe("Rp 499rb")
  })

  it("formats a millions-range price with a trimmed decimal", () => {
    expect(formatPlanPrice(1_500_000)).toBe("Rp 1.5jt")
    expect(formatPlanPrice(2_000_000)).toBe("Rp 2jt")
  })
})

describe("formatPlanPeriod", () => {
  it("always reads 'selamanya' for a free plan regardless of the stored cycle", () => {
    expect(formatPlanPeriod({ priceIdr: 0, period: "month" })).toBe("selamanya")
    expect(formatPlanPeriod({ priceIdr: 0, period: "year" })).toBe("selamanya")
  })

  it("reads /bulan for monthly paid plans", () => {
    expect(formatPlanPeriod({ priceIdr: 149000, period: "month" })).toBe("/bulan")
  })

  it("reads /tahun for yearly paid plans", () => {
    expect(formatPlanPeriod({ priceIdr: 990000, period: "year" })).toBe("/tahun")
  })
})

describe("planCtaLabel", () => {
  it("reads 'Mulai gratis' for a free plan", () => {
    expect(planCtaLabel({ priceIdr: 0, name: "Free" })).toBe("Mulai gratis")
  })

  it("reads 'Pilih {name}' for a paid plan", () => {
    expect(planCtaLabel({ priceIdr: 149000, name: "Pro" })).toBe("Pilih Pro")
    expect(planCtaLabel({ priceIdr: 499000, name: "Studio" })).toBe("Pilih Studio")
  })
})
