import { describe, it, expect } from "vitest"

import type { BOQItem } from "@/types"
import { round1k, summarizeRab } from "./summarize"

/* ------------------------------------------------------------------ */
/* round1k                                                              */
/* ------------------------------------------------------------------ */

describe("round1k", () => {
  it("rounds to nearest 1000 — exact multiple", () => {
    expect(round1k(5_000_000)).toBe(5_000_000)
  })

  it("rounds up when >= 500", () => {
    expect(round1k(5_000_500)).toBe(5_001_000)
  })

  it("rounds down when < 500", () => {
    expect(round1k(5_000_499)).toBe(5_000_000)
  })

  it("handles zero", () => {
    expect(round1k(0)).toBe(0)
  })

  it("handles negative numbers", () => {
    // Math.round(-1.5) = -1 (rounds toward +∞), so -1500 → -1000
    expect(round1k(-1500)).toBe(-1_000)
  })
})

/* ------------------------------------------------------------------ */
/* summarizeRab                                                         */
/* ------------------------------------------------------------------ */

function makeItem(overrides: Partial<BOQItem> = {}): BOQItem {
  return {
    id: "test-1",
    category: "struktur",
    item: "Pondasi",
    volume: 10,
    unit: "m²",
    unitPriceIDR: 1_000_000,
    totalIDR: 10_000_000, // will be recomputed
    confidence: "medium",
    ...overrides,
  }
}

describe("summarizeRab", () => {
  it("recomputes each item totalIDR = round1k(unitPriceIDR * volume)", () => {
    const item = makeItem({ volume: 3, unitPriceIDR: 1_100_000 })
    const { items } = summarizeRab([item], 100)
    // 3 * 1_100_000 = 3_300_000 → already multiple of 1k
    expect(items[0].totalIDR).toBe(round1k(3 * 1_100_000))
  })

  it("mid equals sum of recomputed totals", () => {
    const a = makeItem({ id: "a", volume: 2, unitPriceIDR: 500_000 })
    const b = makeItem({ id: "b", volume: 5, unitPriceIDR: 300_000 })
    const { items, summary } = summarizeRab([a, b], 50)
    const expected = items.reduce((s, i) => s + i.totalIDR, 0)
    expect(summary.midIDR).toBe(round1k(expected))
  })

  it("low = mid * 0.88, high = mid * 1.15 (rounded to 1k)", () => {
    const item = makeItem({ volume: 10, unitPriceIDR: 1_000_000 })
    const { summary } = summarizeRab([item], 100)
    expect(summary.lowIDR).toBe(round1k(summary.midIDR * 0.88))
    expect(summary.highIDR).toBe(round1k(summary.midIDR * 1.15))
  })

  it("perM2IDR = round1k(mid / area)", () => {
    const item = makeItem({ volume: 10, unitPriceIDR: 1_000_000 })
    const { summary } = summarizeRab([item], 80)
    expect(summary.perM2IDR).toBe(round1k(summary.midIDR / 80))
  })

  it("areaM2 = 0 guard — uses 1 instead (no divide-by-zero)", () => {
    const item = makeItem({ volume: 1, unitPriceIDR: 500_000 })
    const { summary } = summarizeRab([item], 0)
    expect(summary.perM2IDR).toBe(round1k(summary.midIDR / 1))
    expect(isFinite(summary.perM2IDR)).toBe(true)
  })

  it("confidence is 'low' when any item has confidence 'low'", () => {
    const a = makeItem({ id: "a", confidence: "medium" })
    const b = makeItem({ id: "b", confidence: "low" })
    const { summary } = summarizeRab([a, b], 100)
    expect(summary.confidence).toBe("low")
  })

  it("confidence is 'medium' when no items have confidence 'low'", () => {
    const a = makeItem({ id: "a", confidence: "medium" })
    const b = makeItem({ id: "b", confidence: "high" })
    const { summary } = summarizeRab([a, b], 100)
    expect(summary.confidence).toBe("medium")
  })

  it("handles empty items array", () => {
    const { items, summary } = summarizeRab([], 100)
    expect(items).toHaveLength(0)
    expect(summary.midIDR).toBe(0)
    expect(summary.lowIDR).toBe(0)
    expect(summary.highIDR).toBe(0)
    expect(summary.perM2IDR).toBe(0)
    expect(summary.confidence).toBe("medium")
  })
})
