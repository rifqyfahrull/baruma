import { describe, it, expect } from "vitest"
import { buildPlumbingPlan } from "./plumbing-plan"
import type {
  DesignLayout,
  Floor,
  Room,
  RoomInteriorPlan,
  WaterPoint,
  WaterPointType,
} from "@/types"

const floor = (over: Partial<Floor>): Floor => ({
  id: "f1", level: 0, name: "Lantai 1", heightM: 3, ...over,
})
const room = (over: Partial<Room>): Room => ({
  id: "r", floorId: "f1", name: "R", type: "kamar_mandi",
  x: 0, y: 0, width: 4, depth: 4, areaM2: 16, ...over,
})
const layout = (over: Partial<DesignLayout>): DesignLayout => ({
  id: "l", projectId: "p", versionId: "v",
  floors: [floor({})], rooms: [], walls: [], openings: [], stairs: [], pools: [],
  validation: { passed: true, issues: [] },
  ...over,
})

/** Both endpoints of `l` within `r` metres of (cx, cy) — isolates a symbol glyph. */
const near = (v: number, target: number, r = 0.2) => Math.abs(v - target) <= r
const lineNear = (
  l: { x1: number; y1: number; x2: number; y2: number },
  cx: number,
  cy: number,
) => near(l.x1, cx) && near(l.y1, cy) && near(l.x2, cx) && near(l.y2, cy)

/**
 * Canonical scene: floor f1 with a real wet room (r1, kamar_mandi) + a void
 * (excluded from outlines) + a room on another floor (r2); water = 1 kloset +
 * 1 wastafel on r1, plus a leaked other-floor point, an unknown-type point, a
 * non-finite point and a ghost-room point that must all be skipped.
 */
function scene() {
  const base = layout({
    floors: [floor({ id: "f1", name: "Lantai 1" }), floor({ id: "f2", name: "Lantai 2", heightM: 3 })],
    rooms: [
      room({ id: "r1", floorId: "f1", type: "kamar_mandi", x: 0, y: 0, width: 4, depth: 4, areaM2: 16 }),
      room({ id: "void1", floorId: "f1", name: "Void", type: "void", x: 4, y: 0, width: 2, depth: 3, areaM2: 6 }),
      room({ id: "r2", floorId: "f2", type: "kamar_mandi", x: 0, y: 0, width: 4, depth: 4, areaM2: 16 }),
    ],
    water: [
      { id: "w1", roomId: "r1", type: "kloset", x: 1, y: 1 },
      { id: "w2", roomId: "r1", type: "wastafel", x: 2, y: 2 },
      { id: "w3", roomId: "r2", type: "kloset", x: 3.5, y: 3.5 }, // other floor -> excluded
      { id: "w4", roomId: "r1", type: "alien" as WaterPointType, x: 1.5, y: 1.5 }, // unknown -> skipped
      { id: "w5", roomId: "r1", type: "kloset", x: NaN, y: 1 }, // non-finite -> skipped
      { id: "w6", roomId: "ghost", type: "kloset", x: 1, y: 1 }, // missing room -> skipped
    ] as WaterPoint[],
  })
  const interiors: RoomInteriorPlan[] = []
  return { base, interiors }
}

describe("buildPlumbingPlan — plan geometry", () => {
  it("draws the non-void room outline and excludes the void room from outlines", () => {
    const { base, interiors } = scene()
    const d = buildPlumbingPlan(base, interiors, "f1")
    expect(d.lines).toContainEqual({ x1: 0, y1: 0, x2: 4, y2: 0, kind: "outline" })
    expect(
      d.lines.some((l) => l.kind === "outline" && l.x1 === 4 && l.y1 === 0 && l.x2 === 6 && l.y2 === 0),
    ).toBe(false)
  })

  it("draws each fixture glyph at its absolute x/y (kloset 6, wastafel 4 lines)", () => {
    const { base, interiors } = scene()
    const d = buildPlumbingPlan(base, interiors, "f1")
    const opening = d.lines.filter((l) => l.kind === "opening")
    expect(opening.filter((l) => lineNear(l, 1, 1))).toHaveLength(6) // kloset
    expect(opening.filter((l) => lineNear(l, 2, 2))).toHaveLength(4) // wastafel
  })

  it("routes an orthogonal 2-segment pipe from each fixture to the per-floor stack", () => {
    const { base, interiors } = scene()
    const d = buildPlumbingPlan(base, interiors, "f1")
    // stack = first wet room's corner = (0.2, 0.2). Elbow: fixture -> (fx, stackY) -> stack.
    expect(
      d.lines.some((l) => l.kind === "opening" && l.x1 === 1 && l.y1 === 1 && l.x2 === 1 && l.y2 === 0.2),
    ).toBe(true) // kloset vertical drop
    expect(
      d.lines.some((l) => l.kind === "opening" && l.x2 === 0.2 && l.y2 === 0.2),
    ).toBe(true) // a pipe reaches the stack
  })

  it("emits exactly the expected opening lines — no leakage from malformed / other-floor points", () => {
    const { base, interiors } = scene()
    const d = buildPlumbingPlan(base, interiors, "f1")
    const opening = d.lines.filter((l) => l.kind === "opening")
    // kloset glyph 6 + wastafel glyph 4 + pipes (2 fixtures x 2 segments) 4 = 14
    expect(opening).toHaveLength(14)
    // other-floor kloset at (3.5, 3.5) must not appear
    expect(opening.filter((l) => lineNear(l, 3.5, 3.5))).toHaveLength(0)
  })

  it("does not crash on malformed points and yields finite bounds", () => {
    const { base, interiors } = scene()
    const d = buildPlumbingPlan(base, interiors, "f1")
    expect(Number.isFinite(d.widthM)).toBe(true)
    expect(Number.isFinite(d.heightM)).toBe(true)
  })
})

describe("buildPlumbingPlan — legend + fixture schedule", () => {
  it("draws a legend naming the fixture types present incl. Kloset + system", () => {
    const { base, interiors } = scene()
    const d = buildPlumbingPlan(base, interiors, "f1")
    expect(d.labels.some((l) => l.kind === "room" && l.text === "Legenda")).toBe(true)
    expect(d.labels.some((l) => l.kind === "room" && l.text.includes("Kloset"))).toBe(true)
    // system names surface in the legend/schedule
    expect(d.labels.some((l) => l.kind === "room" && l.text.includes("limbah"))).toBe(true)
  })

  it("draws a fixture schedule table with a Ø column to the right of the plan bbox", () => {
    const { base, interiors } = scene()
    const d = buildPlumbingPlan(base, interiors, "f1")
    expect(d.labels.some((l) => l.kind === "room" && l.text.includes("Ø"))).toBe(true)
    // grid uses outline lines to the RIGHT of the plan bbox (x >= 7)
    expect(d.lines.some((l) => l.kind === "outline" && l.x1 >= 7 && l.x2 >= 7)).toBe(true)
  })

  it("extends widthM beyond the room bbox to cover the table", () => {
    const { base, interiors } = scene()
    const d = buildPlumbingPlan(base, interiors, "f1")
    expect(d.widthM).toBeGreaterThan(6) // room bbox width (incl. void) is 6
  })

  it('anchors every legend + schedule label "start" (x = left text edge, not a centre point)', () => {
    const { base, interiors } = scene()
    const d = buildPlumbingPlan(base, interiors, "f1")
    // The legend/table block starts at bboxW (6) + gap (1) = x ≥ 7.
    const blockLabels = d.labels.filter((l) => l.x >= 7)
    expect(blockLabels.length).toBeGreaterThan(4) // "Legenda" + entries + cells
    for (const lb of blockLabels) expect(lb.anchor).toBe("start")
  })
})

describe("buildPlumbingPlan — title", () => {
  it('titles the sheet "Rencana Air — <floor name>"', () => {
    const { base, interiors } = scene()
    expect(buildPlumbingPlan(base, interiors, "f1").title).toBe("Rencana Air — Lantai 1")
  })

  it("falls back to the floorId when the floor is missing", () => {
    const { base, interiors } = scene()
    expect(buildPlumbingPlan(base, interiors, "nope").title).toBe("Rencana Air — nope")
  })
})
