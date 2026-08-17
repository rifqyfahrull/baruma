import { describe, it, expect } from "vitest"

import { buildStructuralCalc } from "./structural-calc"
import { deriveColumnGrid } from "@/lib/structural/grid"
import { columnLoad } from "@/lib/structural/takedown"
import { SOIL_DEFAULT_KPA } from "@/lib/structural/loads"
import type { Drawing } from "./types"
import type { DesignLayout, Floor, Room } from "@/types"

const floor = (over: Partial<Floor>): Floor => ({
  id: "f1", level: 0, name: "Lantai 1", heightM: 3, ...over,
})
const room = (over: Partial<Room>): Room => ({
  id: "r", floorId: "f1", name: "R", type: "kamar_tidur",
  x: 0, y: 0, width: 3, depth: 3, areaM2: 9, ...over,
})
const layout = (over: Partial<DesignLayout>): DesignLayout => ({
  id: "l", projectId: "p", versionId: "v",
  floors: [floor({})], rooms: [], walls: [], openings: [], stairs: [], pools: [],
  validation: { passed: true, issues: [] },
  ...over,
})

const footprint8x6 = layout({
  rooms: [
    room({ id: "A", x: 0, y: 0, width: 8, depth: 3, areaM2: 24 }),
    room({ id: "B", x: 0, y: 3, width: 8, depth: 3, areaM2: 24 }),
  ],
})

const hasLabel = (d: Drawing, sub: string) => d.labels.some((l) => l.text.includes(sub))

describe("buildStructuralCalc", () => {
  it("stacks the assumptions, steps and results as label rows", () => {
    const d = buildStructuralCalc(footprint8x6, 2)
    // Assumptions.
    expect(hasLabel(d, "f'c") || hasLabel(d, "25")).toBe(true)
    expect(hasLabel(d, String(SOIL_DEFAULT_KPA))).toBe(true) // σ = 150
    // Steps.
    expect(hasLabel(d, "Pu")).toBe(true)
    expect(hasLabel(d, "telapak")).toBe(true) // "A telapak = Ps/σ"
  })

  it("shows a Pu that matches columnLoad(4,3,2).Pu = 261.6 (ties calc to the modules)", () => {
    const grid = deriveColumnGrid(footprint8x6)
    const { Pu } = columnLoad(grid.spanX, grid.spanY, 2)
    expect(Pu).toBe(261.6)
    expect(hasLabel(buildStructuralCalc(footprint8x6, 2), String(Pu))).toBe(true)
  })

  it("carries the mandatory PBG disclaimer verbatim", () => {
    const d = buildStructuralCalc(footprint8x6, 2)
    expect(hasLabel(d, "diverifikasi insinyur struktur")).toBe(true)
    expect(hasLabel(d, "PBG")).toBe(true)
    expect(
      hasLabel(
        d,
        "Perhitungan pendekatan — wajib diverifikasi insinyur struktur berlisensi sebelum konstruksi (persyaratan PBG).",
      ),
    ).toBe(true)
  })

  it('titles the sheet "Perhitungan Struktur"', () => {
    expect(buildStructuralCalc(footprint8x6, 2).title).toBe("Perhitungan Struktur")
  })

  it('anchors EVERY table row "start" — x is the left cell edge, so a centred row would poke out left of the frame', () => {
    const d = buildStructuralCalc(footprint8x6, 2)
    expect(d.labels.length).toBeGreaterThan(10)
    for (const lb of d.labels) expect(lb.anchor).toBe("start")
  })

  it("all coordinates land inside the declared box after normalize (clip guard)", () => {
    const d = buildStructuralCalc(footprint8x6, 2)
    for (const lb of d.labels) {
      expect(lb.x).toBeGreaterThanOrEqual(0)
      expect(lb.x).toBeLessThanOrEqual(d.widthM)
      expect(lb.y).toBeGreaterThanOrEqual(0)
      expect(lb.y).toBeLessThanOrEqual(d.heightM)
    }
    for (const l of d.lines) {
      expect(Math.min(l.x1, l.x2)).toBeGreaterThanOrEqual(0)
      expect(Math.max(l.x1, l.x2)).toBeLessThanOrEqual(d.widthM)
      expect(Math.min(l.y1, l.y2)).toBeGreaterThanOrEqual(0)
      expect(Math.max(l.y1, l.y2)).toBeLessThanOrEqual(d.heightM)
    }
  })
})
