import { describe, it, expect } from "vitest"

import {
  formatArea,
  formatDimensions,
  formatElevation,
  formatIDR,
  formatIDRCompact,
  formatIDRRange,
  formatLength,
  formatLengthPair,
  formatNumber,
} from "@/lib/format"

describe("format", () => {
  it("formats area in m²", () => {
    expect(formatArea(64)).toBe("64 m²")
  })

  it("formats dimensions", () => {
    expect(formatDimensions(8, 12)).toBe("8 × 12 m")
  })

  it("formats compact rupiah by magnitude", () => {
    expect(formatIDRCompact(1_250_000_000)).toContain("M")
    expect(formatIDRCompact(850_000_000)).toContain("jt")
    expect(formatIDRCompact(500_000)).toContain("rb")
  })

  it("formats a rupiah range", () => {
    const r = formatIDRRange(1_000_000_000, 1_400_000_000)
    expect(r).toContain("–")
    expect(r).toContain("M")
  })

  it("prefixes rupiah with Rp", () => {
    expect(formatIDR(1_000_000)).toContain("Rp")
  })

  it("formats numbers as strings", () => {
    expect(formatNumber(1234.5)).toBeTypeOf("string")
  })

  it("formats a length in metric units", () => {
    expect(formatLength(1.25, "m")).toBe("1,25 m")
    expect(formatLength(1.2, "cm")).toBe("120 cm")
    expect(formatLength(1.2, "mm")).toBe("1200 mm")
  })

  it("formats a length in imperial units", () => {
    expect(formatLength(1, "in")).toContain("″")
    expect(formatLength(1, "ft")).toBe("3′3″") // 1 m ≈ 3 ft 3 in
  })

  it("formats a width×depth pair with the unit shown once (metric)", () => {
    expect(formatLengthPair(3.5, 4, "m")).toBe("3,5 × 4 m")
    expect(formatLengthPair(3.5, 4, "mm")).toBe("3500 × 4000 mm")
  })

  it("formats an imperial pair with inline symbols", () => {
    expect(formatLengthPair(1, 1, "in")).toMatch(/″ × .*″/)
  })

  it("formats elevation with a sign, baseline ±, and unit", () => {
    expect(formatElevation(0, "m")).toBe("±0 m")
    expect(formatElevation(-0.18, "m")).toBe("-0,18 m")
    expect(formatElevation(0.18, "m")).toBe("+0,18 m")
    expect(formatElevation(-0.18, "mm")).toBe("-180 mm")
  })
})
