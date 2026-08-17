import { describe, it, expect } from "vitest"

import type { ElectricalPointType, LightingFixture } from "@/types"
import { LOAD_VA, LAMP_LOAD_VA, SYM_M, symbolLines } from "./electrical"

const EPS = 1e-9

/** Pinned by the SP4 plan's Global Constraints. */
const EXPECTED_LINE_COUNTS: Record<ElectricalPointType, number> = {
  stopkontak: 6,
  stopkontak_daya: 7,
  saklar_tunggal: 2,
  saklar_ganda: 4,
  panel: 5,
  data: 3,
}

const ALL_TYPES = Object.keys(EXPECTED_LINE_COUNTS) as ElectricalPointType[]

describe("LOAD_VA", () => {
  it("matches the pinned VA table", () => {
    expect(LOAD_VA).toEqual({
      stopkontak: 200,
      stopkontak_daya: 900,
      saklar_tunggal: 0,
      saklar_ganda: 0,
      panel: 0,
      data: 0,
    })
  })
})

describe("LAMP_LOAD_VA", () => {
  it("matches the pinned per-unit lamp VA table", () => {
    expect(LAMP_LOAD_VA).toEqual({
      downlight: 15,
      pendant: 25,
      task: 20,
      wall_lamp: 15,
      indirect: 20,
      outdoor: 30,
    } satisfies Record<LightingFixture["type"], number>)
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
})
