import { describe, it, expect } from "vitest"

import type {
  DesignLayout,
  ElectricalPoint,
  Floor,
  LightingFixture,
  Room,
  RoomInteriorPlan,
} from "@/types"
import { MCB_STANDARDS, buildCircuits, mcbFor } from "./circuits"

/* ------------------------------------------------------------------ */
/* Fixtures (ceiling-plan.test.ts style)                              */
/* ------------------------------------------------------------------ */

const floor = (over: Partial<Floor>): Floor => ({
  id: "f1", level: 1, name: "Lantai 1", heightM: 3, ...over,
})
const room = (over: Partial<Room>): Room => ({
  id: "r", floorId: "f1", name: "R", type: "kamar_tidur",
  x: 0, y: 0, width: 4, depth: 4, areaM2: 16, ...over,
})
const layout = (over: Partial<DesignLayout>): DesignLayout => ({
  id: "l", projectId: "p", versionId: "v",
  floors: [floor({}), floor({ id: "f2", level: 2, name: "Lantai 2" })],
  rooms: [
    room({ id: "r-kt", floorId: "f1" }),
    room({ id: "r-dp", floorId: "f1", type: "dapur", x: 4 }),
    room({ id: "r-up", floorId: "f2" }),
  ],
  walls: [], openings: [], stairs: [], pools: [],
  validation: { passed: true, issues: [] },
  ...over,
})
const point = (over: Partial<ElectricalPoint>): ElectricalPoint => ({
  id: "elec-1", roomId: "r-kt", type: "stopkontak", x: 1, y: 1, ...over,
})
const fixture = (over: Partial<LightingFixture>): LightingFixture => ({
  id: "light-1", roomId: "r-kt", type: "downlight", x: 1, y: 1, heightM: 2.6,
  colorTemperature: "warm", qty: 1, priceRange: { low: 0, mid: 0, high: 0 },
  ...over,
})
const interiorPlan = (over: Partial<RoomInteriorPlan>): RoomInteriorPlan => ({
  roomId: "r-kt", roomName: "R", roomType: "kamar_tidur", floorId: "f1",
  style: "modern_tropical", furniture: [], materials: [], lighting: [],
  colorPalette: { primary: "#fff", secondary: "#fff", accent: "#fff", wood: "#fff", metal: "#fff", fabric: "#fff" },
  warnings: [],
  budgetEstimate: { lowIDR: 0, midIDR: 0, highIDR: 0, lines: [] },
  score: { clearance: 0, usability: 0, styleMatch: 0, cost: 0, naturalLight: 0, circulation: 0 },
  ...over,
})

/** The plan's worked floor: 6 downlights + 8 stopkontak + 1 stopkontak_daya on f1. */
const workedLayout = (): DesignLayout =>
  layout({
    electrical: [
      ...Array.from({ length: 8 }, (_, i) =>
        point({ id: `elec-s${i}`, roomId: i < 4 ? "r-kt" : "r-dp", x: 0.5 + i * 0.4, y: 0.3 })),
      point({ id: "elec-d1", roomId: "r-dp", type: "stopkontak_daya", x: 5, y: 1 }),
    ],
  })
const workedInteriors = (): RoomInteriorPlan[] => [
  interiorPlan({ roomId: "r-kt", lighting: [fixture({ qty: 6 })] }),
]

/* ------------------------------------------------------------------ */
/* mcbFor                                                             */
/* ------------------------------------------------------------------ */

describe("mcbFor", () => {
  it("uses the pinned MCB standards", () => {
    expect(MCB_STANDARDS).toEqual([2, 4, 6, 10, 16, 20, 25])
  })

  it("90 VA → 2 A (worked example)", () => {
    expect(mcbFor(90)).toBe(2) // (90/220)*1.25 ≈ 0.51
  })

  it("1600 VA → 10 A (worked example)", () => {
    expect(mcbFor(1600)).toBe(10) // (1600/220)*1.25 ≈ 9.09
  })

  it("900 VA → 6 A (worked example)", () => {
    expect(mcbFor(900)).toBe(6) // (900/220)*1.25 ≈ 5.11
  })

  it("picks the standard on an exact boundary (≥, not >)", () => {
    expect(mcbFor(352)).toBe(2) // (352/220)*1.25 = 2.0 exactly
  })

  it("caps at 25 A when the computed amperage exceeds every standard", () => {
    expect(mcbFor(10000)).toBe(25) // (10000/220)*1.25 ≈ 56.8
  })
})

/* ------------------------------------------------------------------ */
/* buildCircuits                                                      */
/* ------------------------------------------------------------------ */

describe("buildCircuits — the plan's worked floor", () => {
  it("returns exactly [penerangan, stopkontak, khusus] with pinned counts/VA/MCB, Bahasa names and stable ids", () => {
    const circuits = buildCircuits(workedLayout(), workedInteriors(), "f1")
    expect(circuits).toEqual([
      {
        id: "circ-penerangan-f1",
        name: "Penerangan — Lantai 1",
        kind: "penerangan",
        pointCount: 6,
        loadVA: 90, // 6 downlights × 15 VA
        mcbA: 2,
      },
      {
        id: "circ-stopkontak-f1",
        name: "Stopkontak — Lantai 1",
        kind: "stopkontak",
        pointCount: 8,
        loadVA: 1600, // 8 × 200 VA
        mcbA: 10,
      },
      {
        id: "circ-khusus-f1-1",
        name: "Daya Khusus 1",
        kind: "khusus",
        pointCount: 1,
        loadVA: 900,
        mcbA: 6,
      },
    ])
  })

  it("saklar/panel/data points add NO circuit and 0 load", () => {
    const l = workedLayout()
    l.electrical = [
      ...(l.electrical ?? []),
      point({ id: "elec-sw", type: "saklar_tunggal", roomId: "r-kt" }),
      point({ id: "elec-sw2", type: "saklar_ganda", roomId: "r-dp" }),
      point({ id: "elec-pn", type: "panel", roomId: "r-kt" }),
      point({ id: "elec-dt", type: "data", roomId: "r-dp" }),
    ]
    expect(buildCircuits(l, workedInteriors(), "f1")).toEqual(
      buildCircuits(workedLayout(), workedInteriors(), "f1"),
    )
  })
})

describe("buildCircuits — scoping + edge cases", () => {
  it("a lighting fixture with qty > 1 counts as qty points and qty × unit load", () => {
    const interiors = [
      interiorPlan({
        roomId: "r-kt",
        lighting: [fixture({ qty: 2 }), fixture({ id: "light-2", type: "pendant", qty: 3 })],
      }),
    ]
    const circuits = buildCircuits(layout({}), interiors, "f1")
    expect(circuits).toHaveLength(1)
    expect(circuits[0]).toMatchObject({
      kind: "penerangan",
      pointCount: 5, // 2 + 3
      loadVA: 105, // 2×15 + 3×25
      mcbA: 2, // (105/220)*1.25 ≈ 0.60
    })
  })

  it("numbers multiple khusus circuits in array order with 1-based stable ids", () => {
    const l = layout({
      electrical: [
        point({ id: "elec-d1", type: "stopkontak_daya", roomId: "r-dp" }),
        point({ id: "elec-d2", type: "stopkontak_daya", roomId: "r-kt" }),
      ],
    })
    const circuits = buildCircuits(l, [], "f1")
    expect(circuits.map((c) => c.id)).toEqual(["circ-khusus-f1-1", "circ-khusus-f1-2"])
    expect(circuits.map((c) => c.name)).toEqual(["Daya Khusus 1", "Daya Khusus 2"])
    expect(circuits.every((c) => c.kind === "khusus" && c.pointCount === 1 && c.loadVA === 900 && c.mcbA === 6)).toBe(true)
  })

  it("omits the penerangan circuit when the floor has no lamps, and stopkontak when no outlets", () => {
    const outletsOnly = buildCircuits(workedLayout(), [], "f1")
    expect(outletsOnly.map((c) => c.kind)).toEqual(["stopkontak", "khusus"])

    const lampsOnly = buildCircuits(layout({}), workedInteriors(), "f1")
    expect(lampsOnly.map((c) => c.kind)).toEqual(["penerangan"])
  })

  it("returns [] for a floor with no points and no lamps", () => {
    expect(buildCircuits(layout({}), [], "f1")).toEqual([])
    // f2 has a room but neither points nor lamps.
    expect(buildCircuits(workedLayout(), workedInteriors(), "f2")).toEqual([])
  })

  it("excludes points and lamps that belong to another floor", () => {
    const l = workedLayout()
    l.electrical = [
      ...(l.electrical ?? []),
      point({ id: "elec-up1", roomId: "r-up" }),
      point({ id: "elec-up2", type: "stopkontak_daya", roomId: "r-up" }),
    ]
    const interiors = [
      ...workedInteriors(),
      interiorPlan({ roomId: "r-up", floorId: "f2", lighting: [fixture({ id: "light-up", roomId: "r-up", qty: 4 })] }),
    ]
    // f1 is unchanged by f2's points/lamps…
    expect(buildCircuits(l, interiors, "f1")).toEqual(
      buildCircuits(workedLayout(), workedInteriors(), "f1"),
    )
    // …and f2 only sees its own.
    const up = buildCircuits(l, interiors, "f2")
    expect(up.map((c) => c.kind)).toEqual(["penerangan", "stopkontak", "khusus"])
    expect(up[0]).toMatchObject({ pointCount: 4, loadVA: 60, name: "Penerangan — Lantai 2" })
    expect(up[1]).toMatchObject({ pointCount: 1, loadVA: 200, id: "circ-stopkontak-f2" })
  })

  it("resolves an interior entry's floor via layout.rooms when its floorId is missing", () => {
    const interiors = [
      interiorPlan({ roomId: "r-kt", floorId: "" as string, lighting: [fixture({ qty: 6 })] }),
    ]
    const circuits = buildCircuits(layout({}), interiors, "f1")
    expect(circuits).toHaveLength(1)
    expect(circuits[0]).toMatchObject({ kind: "penerangan", pointCount: 6, loadVA: 90 })
  })

  it("tolerates malformed points without crashing (carry-forward: PUT has no zod)", () => {
    const l = workedLayout()
    l.electrical = [
      ...(l.electrical ?? []),
      point({ id: "elec-bad1", type: "alien" as ElectricalPoint["type"] }), // unknown type → 0 load, no circuit
      point({ id: "elec-bad2", roomId: "r-gone" }), // missing room → not on this floor
      point({ id: "elec-bad3", roomId: undefined as unknown as string }),
      // valid type/room but garbage coords → skipped so the schedule matches
      // the drawn plan (electrical-plan.ts also skips non-finite coords).
      point({ id: "elec-bad4", type: "stopkontak", roomId: "r-kt", x: NaN }),
      point({ id: "elec-bad5", type: "stopkontak_daya", roomId: "r-dp", y: Infinity }),
      null as unknown as ElectricalPoint,
    ]
    expect(buildCircuits(l, workedInteriors(), "f1")).toEqual(
      buildCircuits(workedLayout(), workedInteriors(), "f1"),
    )
  })
})
