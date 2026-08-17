import { describe, it, expect } from "vitest"

import { buildFoundationPlan, buildColumnPlan, buildBeamPlan } from "./structural-plan"
import { deriveColumnGrid } from "@/lib/structural/grid"
import { columnLoad } from "@/lib/structural/takedown"
import { sizeColumn, sizeBeam } from "@/lib/structural/sizing"
import { sizeFooting } from "@/lib/structural/foundation"
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

/** Rooms tiling an 8×6 footprint from the origin (two rooms). */
const footprint8x6 = layout({
  rooms: [
    room({ id: "A", x: 0, y: 0, width: 8, depth: 3, areaM2: 24 }),
    room({ id: "B", x: 0, y: 3, width: 8, depth: 3, areaM2: 24 }),
  ],
})

const hasLabel = (d: Drawing, sub: string) => d.labels.some((l) => l.text.includes(sub))
const hasDimSpan = (d: Drawing, v: number) =>
  d.dims.some((dc) => {
    const span = Math.round((Math.max(...dc.points) - Math.min(...dc.points)) * 100) / 100
    return Math.abs(span - v) < 1e-6
  })

/** Regression guard for the clip bug (SP5): after normalize() every coordinate
 *  the renderer scales/clips must live inside [0,widthM]×[0,heightM]. */
function assertInBox(d: Drawing): void {
  const inX = (v: number) => {
    expect(v).toBeGreaterThanOrEqual(0)
    expect(v).toBeLessThanOrEqual(d.widthM)
  }
  const inY = (v: number) => {
    expect(v).toBeGreaterThanOrEqual(0)
    expect(v).toBeLessThanOrEqual(d.heightM)
  }
  for (const l of d.lines) {
    inX(l.x1); inX(l.x2); inY(l.y1); inY(l.y2)
  }
  for (const lb of d.labels) { inX(lb.x); inY(lb.y) }
  for (const dc of d.dims) {
    if (dc.axis === "x") { inY(dc.at); for (const p of dc.points) inX(p) }
    else { inX(dc.at); for (const p of dc.points) inY(p) }
  }
  for (const lv of d.levels) inY(lv.y)
}

describe("buildFoundationPlan", () => {
  // 8×6 footprint, 2 floors → grid 3×3 = 9 columns; corner bay span 4×3.
  const grid = deriveColumnGrid(footprint8x6)
  const { Ps } = columnLoad(grid.spanX, grid.spanY, 2)
  const footing = sizeFooting(Ps, SOIL_DEFAULT_KPA)

  it("draws one footing square per column (9 for the 8×6 grid)", () => {
    const d = buildFoundationPlan(footprint8x6, 2)
    const footings = d.lines.filter((l) => l.kind === "slab").length / 4
    expect(grid.columns).toHaveLength(9)
    expect(footings).toBe(grid.columns.length)
    expect(footings).toBe(9)
  })

  it("reflects a real footing side (sizeFooting output) as a dim/label", () => {
    const d = buildFoundationPlan(footprint8x6, 2)
    // Ps=198, σ=150 → side 1.2 m.
    expect(footing.side).toBe(1.2)
    expect(hasDimSpan(d, footing.side) || hasLabel(d, String(footing.side))).toBe(true)
  })

  it("calls out the soil bearing σ (default 150 kPa)", () => {
    expect(hasLabel(buildFoundationPlan(footprint8x6, 2), String(SOIL_DEFAULT_KPA))).toBe(true)
  })

  it('titles the sheet "Rencana Pondasi"', () => {
    expect(buildFoundationPlan(footprint8x6, 2).title).toBe("Rencana Pondasi")
  })

  it("keeps all geometry inside the declared box (clip guard)", () => {
    assertInBox(buildFoundationPlan(footprint8x6, 2))
  })
})

describe("buildColumnPlan", () => {
  const grid = deriveColumnGrid(footprint8x6)
  const { Pu } = columnLoad(grid.spanX, grid.spanY, 2)
  const col = sizeColumn(Pu)

  it("draws one column square per grid intersection (9)", () => {
    const d = buildColumnPlan(footprint8x6, 2, "f1")
    const cols = d.lines.filter((l) => l.kind === "outline").length / 4
    expect(cols).toBe(grid.columns.length)
    expect(cols).toBe(9)
  })

  it("labels a real column dimension AND the factored load Pu (261.6 kN)", () => {
    const d = buildColumnPlan(footprint8x6, 2, "f1")
    // Non-tautological: Pu shown must equal columnLoad(4,3,2).Pu.
    expect(Pu).toBe(261.6)
    expect(col.side).toBe(200)
    expect(hasLabel(d, String(col.side))).toBe(true) // "200"
    expect(hasLabel(d, "Pu")).toBe(true)
    expect(hasLabel(d, "261.6")).toBe(true)
  })

  it('titles the sheet "Rencana Kolom — <floor>"', () => {
    expect(buildColumnPlan(footprint8x6, 2, "f1").title).toBe("Rencana Kolom — Lantai 1")
  })

  it("keeps all geometry inside the declared box (clip guard)", () => {
    assertInBox(buildColumnPlan(footprint8x6, 2, "f1"))
  })
})

describe("buildBeamPlan", () => {
  const grid = deriveColumnGrid(footprint8x6)
  const beamX = sizeBeam(grid.spanX)

  it("draws beam lines connecting the grid", () => {
    const d = buildBeamPlan(footprint8x6, 2, "f1")
    expect(d.lines.filter((l) => l.kind === "outline").length).toBeGreaterThan(0)
  })

  it("labels a beam b×h (sizeBeam of the x-span → 200×350)", () => {
    const d = buildBeamPlan(footprint8x6, 2, "f1")
    expect(beamX).toEqual({ b: 200, h: 350 })
    expect(hasLabel(d, `${beamX.b}×${beamX.h}`)).toBe(true)
  })

  it('titles the sheet "Rencana Balok — <floor>"', () => {
    expect(buildBeamPlan(footprint8x6, 2, "f1").title).toBe("Rencana Balok — Lantai 1")
  })

  it("keeps all geometry inside the declared box (clip guard)", () => {
    assertInBox(buildBeamPlan(footprint8x6, 2, "f1"))
  })
})

describe("info-block labels — anti strike-through (SP7 sheet cleanup)", () => {
  const plans = () => [
    buildFoundationPlan(footprint8x6, 2),
    buildColumnPlan(footprint8x6, 2, "f1"),
    buildBeamPlan(footprint8x6, 2, "f1"),
  ]

  it('anchors every info row "start" while axis bubbles stay centred (no anchor)', () => {
    for (const d of plans()) {
      // Info rows = the long text labels; axis bubbles are 1–2 chars (A/B/1/2).
      const info = d.labels.filter((l) => l.text.length > 2)
      const bubbles = d.labels.filter((l) => l.text.length <= 2)
      expect(info.length).toBeGreaterThan(2)
      expect(bubbles.length).toBeGreaterThan(0)
      for (const lb of info) expect(lb.anchor).toBe("start")
      for (const lb of bubbles) expect(lb.anchor).toBeUndefined()
    }
  })

  it("stacks every info row ≥ 0.25 m ABOVE the topmost line — no label sits on a grid/beam line", () => {
    for (const d of plans()) {
      const topLine = Math.max(...d.lines.flatMap((l) => [l.y1, l.y2]))
      const info = d.labels.filter((l) => l.anchor === "start")
      expect(info.length).toBeGreaterThan(0)
      for (const lb of info) {
        expect(lb.y).toBeGreaterThanOrEqual(topLine + 0.25 - 1e-9)
      }
    }
  })

  it("beam plan: Balok/Sloof callout y never coincides with any beam/axis line y", () => {
    const d = buildBeamPlan(footprint8x6, 2, "f1")
    const callouts = d.labels.filter((l) => /Balok|Sloof/.test(l.text))
    expect(callouts).toHaveLength(3)
    const lineYs = new Set(d.lines.flatMap((l) => [l.y1, l.y2]))
    for (const lb of callouts) expect(lineYs.has(lb.y)).toBe(false)
  })
})
