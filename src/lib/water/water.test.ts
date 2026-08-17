import { describe, it, expect } from "vitest"

import type { WaterPointType, WaterSystem } from "@/types"
import { SYM_M, WATER_SYSTEM, PIPE_DIAMETER, symbolLines } from "./water"

const EPS = 1e-9

/** Pinned by the SP5 plan's Global Constraints. */
const EXPECTED_LINE_COUNTS: Record<WaterPointType, number> = {
  kloset: 6,
  wastafel: 4,
  shower: 5,
  kran: 3,
  kran_taman: 3,
  kran_wudhu: 3,
  floor_drain: 6,
  sink_dapur: 5,
}

const ALL_TYPES = Object.keys(EXPECTED_LINE_COUNTS) as WaterPointType[]

describe("WATER_SYSTEM", () => {
  it("maps each fixture to its SNI piping system", () => {
    expect(WATER_SYSTEM).toEqual({
      kloset: "limbah",
      wastafel: "kotor",
      shower: "kotor",
      floor_drain: "kotor",
      sink_dapur: "kotor",
      kran: "bersih",
      kran_taman: "bersih",
      kran_wudhu: "bersih",
    } satisfies Record<WaterPointType, WaterSystem>)
  })

  it.each(ALL_TYPES)("%s maps to a valid system", (type) => {
    expect(["bersih", "kotor", "limbah"]).toContain(WATER_SYSTEM[type])
  })
})

describe("PIPE_DIAMETER", () => {
  it("matches the pinned per-system diameters", () => {
    expect(PIPE_DIAMETER).toEqual({
      bersih: '¾"',
      kotor: '2"',
      limbah: '4"',
    } satisfies Record<WaterSystem, string>)
  })
})

describe("symbolLines", () => {
  it("SYM_M is 0.15", () => {
    expect(SYM_M).toBe(0.15)
  })

  it.each(ALL_TYPES)("%s has the pinned line count", (type) => {
    expect(symbolLines(type, 0, 0)).toHaveLength(EXPECTED_LINE_COUNTS[type])
  })

  it("every line has kind 'opening'", () => {
    for (const type of ALL_TYPES) {
      for (const line of symbolLines(type, 0, 0)) {
        expect(line.kind).toBe("opening")
      }
    }
  })

  it("all coordinates stay within ±SYM_M of the center (origin)", () => {
    for (const type of ALL_TYPES) {
      for (const line of symbolLines(type, 0, 0)) {
        for (const v of [line.x1, line.x2]) expect(Math.abs(v)).toBeLessThanOrEqual(SYM_M + EPS)
        for (const v of [line.y1, line.y2]) expect(Math.abs(v)).toBeLessThanOrEqual(SYM_M + EPS)
      }
    }
  })

  it("all coordinates stay within ±SYM_M of an arbitrary center", () => {
    const cx = 3.7
    const cy = 2.4
    for (const type of ALL_TYPES) {
      for (const line of symbolLines(type, cx, cy)) {
        for (const v of [line.x1, line.x2]) expect(Math.abs(v - cx)).toBeLessThanOrEqual(SYM_M + EPS)
        for (const v of [line.y1, line.y2]) expect(Math.abs(v - cy)).toBeLessThanOrEqual(SYM_M + EPS)
      }
    }
  })

  it("all coordinates are round2 (at most 2 decimals)", () => {
    for (const type of ALL_TYPES) {
      for (const line of symbolLines(type, 3.7, 2.4)) {
        for (const v of [line.x1, line.y1, line.x2, line.y2]) {
          expect(Math.round(v * 100) / 100).toBe(v)
        }
      }
    }
  })

  it("gives kran, kran_taman and kran_wudhu the same 3-line faucet glyph", () => {
    expect(symbolLines("kran_taman", 0, 0)).toEqual(symbolLines("kran", 0, 0))
    expect(symbolLines("kran_wudhu", 0, 0)).toEqual(symbolLines("kran", 0, 0))
  })
})
