import { describe, it, expect } from "vitest"
import { buildElectricalPlan } from "./electrical-plan"
import type {
  DesignLayout,
  ElectricalPoint,
  ElectricalPointType,
  Floor,
  LightingFixture,
  Room,
  RoomInteriorPlan,
} from "@/types"

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
const fixture = (over: Partial<LightingFixture>): LightingFixture => ({
  id: "light-1", roomId: "r", type: "downlight", x: 1.5, y: 0.5, heightM: 2.6,
  colorTemperature: "warm", qty: 1, priceRange: { low: 0, mid: 0, high: 0 },
  ...over,
})
const interiorPlan = (over: Partial<RoomInteriorPlan>): RoomInteriorPlan => ({
  roomId: "r", roomName: "R", roomType: "kamar_tidur", floorId: "f1",
  style: "modern_tropical", furniture: [], materials: [], lighting: [],
  colorPalette: { primary: "#fff", secondary: "#fff", accent: "#fff", wood: "#fff", metal: "#fff", fabric: "#fff" },
  warnings: [],
  budgetEstimate: { lowIDR: 0, midIDR: 0, highIDR: 0, lines: [] },
  score: { clearance: 0, usability: 0, styleMatch: 0, cost: 0, naturalLight: 0, circulation: 0 },
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
 * Canonical scene: floor f1 with a real room (r1) + a void (excluded from
 * outlines) + a room on another floor (r2); electrical = 1 stopkontak + 1
 * saklar on r1, plus a leaked other-floor point, an unknown-type point, a
 * non-finite point and a ghost-room point that must all be skipped; interiors
 * = 1 downlight in r1.
 */
function scene() {
  const base = layout({
    floors: [floor({ id: "f1", name: "Lantai 1" }), floor({ id: "f2", name: "Lantai 2", heightM: 3 })],
    rooms: [
      room({ id: "r1", floorId: "f1", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 }),
      room({ id: "void1", floorId: "f1", name: "Void", type: "void", x: 4, y: 0, width: 2, depth: 3, areaM2: 6 }),
      room({ id: "r2", floorId: "f2", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 }),
    ],
    electrical: [
      { id: "e1", roomId: "r1", type: "stopkontak", x: 0.3, y: 0.3 },
      { id: "e2", roomId: "r1", type: "saklar_tunggal", x: 0.3, y: 2.7 },
      { id: "e3", roomId: "r2", type: "stopkontak", x: 3.9, y: 2.9 }, // other floor -> excluded
      { id: "e4", roomId: "r1", type: "alien" as ElectricalPointType, x: 1, y: 1 }, // unknown type -> skipped
      { id: "e5", roomId: "r1", type: "stopkontak", x: NaN, y: 1 }, // non-finite -> skipped
      { id: "e6", roomId: "ghost", type: "stopkontak", x: 1, y: 1 }, // missing room -> skipped
    ] as ElectricalPoint[],
  })
  const interiors: RoomInteriorPlan[] = [
    interiorPlan({ roomId: "r1", floorId: "f1", lighting: [fixture({ roomId: "r1", type: "downlight", x: 2, y: 1.5, qty: 1 })] }),
  ]
  return { base, interiors }
}

describe("buildElectricalPlan — plan geometry", () => {
  it("draws the non-void room outline and excludes the void room from outlines", () => {
    const { base, interiors } = scene()
    const d = buildElectricalPlan(base, interiors, "f1")
    // r1 top edge present
    expect(d.lines).toContainEqual({ x1: 0, y1: 0, x2: 4, y2: 0, kind: "outline" })
    // void (4,0)-(6,0) top edge must NOT be an outline
    expect(d.lines.some((l) => l.kind === "outline" && l.x1 === 4 && l.y1 === 0 && l.x2 === 6 && l.y2 === 0)).toBe(false)
  })

  it("draws each valid point's glyph at its absolute x/y (6 stopkontak, 2 saklar lines)", () => {
    const { base, interiors } = scene()
    const d = buildElectricalPlan(base, interiors, "f1")
    const opening = d.lines.filter((l) => l.kind === "opening")
    expect(opening.filter((l) => lineNear(l, 0.3, 0.3))).toHaveLength(6) // stopkontak
    expect(opening.filter((l) => lineNear(l, 0.3, 2.7))).toHaveLength(2) // saklar_tunggal
  })

  it("draws the lamp cross symbol at room.x + f.x, room.y + f.y (2 lines)", () => {
    const { base, interiors } = scene()
    const d = buildElectricalPlan(base, interiors, "f1")
    const opening = d.lines.filter((l) => l.kind === "opening")
    expect(opening.filter((l) => lineNear(l, 2, 1.5))).toHaveLength(2)
  })

  it("draws a saklar->lamp relation line from the switch to the (nearest = only) lamp center", () => {
    const { base, interiors } = scene()
    const d = buildElectricalPlan(base, interiors, "f1")
    expect(
      d.lines.some((l) => l.kind === "opening" && l.x1 === 0.3 && l.y1 === 2.7 && l.x2 === 2 && l.y2 === 1.5),
    ).toBe(true)
  })

  it("saklar with 3 lamps in the room → exactly 1 relation line, to the NEAREST lamp", () => {
    const base = layout({
      rooms: [room({ id: "r1", width: 4, depth: 3, areaM2: 12 })],
      electrical: [{ id: "sw", roomId: "r1", type: "saklar_tunggal", x: 0.3, y: 2.7 }],
    })
    const interiors = [
      interiorPlan({
        roomId: "r1",
        lighting: [
          fixture({ id: "L1", roomId: "r1", x: 2, y: 1.5 }), // abs (2, 1.5)
          fixture({ id: "L2", roomId: "r1", x: 1, y: 2.5 }), // abs (1, 2.5) ← terdekat
          fixture({ id: "L3", roomId: "r1", x: 3.5, y: 0.5 }), // abs (3.5, 0.5)
        ],
      }),
    ]
    const d = buildElectricalPlan(base, interiors, "f1")
    // Garis relasi = "opening" yang berawal di saklar dan PANJANG (> 0.5 m) —
    // menyaring glyph saklar (±0,15 m) yang juga berawal di titik yang sama.
    const relations = d.lines.filter(
      (l) =>
        l.kind === "opening" &&
        l.x1 === 0.3 &&
        l.y1 === 2.7 &&
        Math.abs(l.x2 - l.x1) + Math.abs(l.y2 - l.y1) > 0.5,
    )
    expect(relations).toHaveLength(1)
    expect(relations[0]).toMatchObject({ x2: 1, y2: 2.5 })
  })

  it("saklar in a room without lamps → no relation line", () => {
    const base = layout({
      rooms: [room({ id: "r1" })],
      electrical: [{ id: "sw", roomId: "r1", type: "saklar_tunggal", x: 0.3, y: 2.7 }],
    })
    const d = buildElectricalPlan(base, [], "f1")
    const long = d.lines.filter(
      (l) => l.kind === "opening" && Math.abs(l.x2 - l.x1) + Math.abs(l.y2 - l.y1) > 0.5,
    )
    expect(long).toEqual([])
  })

  it("emits exactly the expected opening lines — no leakage from malformed / other-floor points", () => {
    const { base, interiors } = scene()
    const d = buildElectricalPlan(base, interiors, "f1")
    const opening = d.lines.filter((l) => l.kind === "opening")
    // stopkontak 6 + saklar 2 + lamp cross 2 + relation (1 lampu terdekat) 1 = 11
    expect(opening).toHaveLength(11)
    // other-floor point at (3.9, 2.9) must not appear
    expect(opening.filter((l) => lineNear(l, 3.9, 2.9))).toHaveLength(0)
  })

  it("does not crash on malformed points and yields finite bounds", () => {
    const { base, interiors } = scene()
    const d = buildElectricalPlan(base, interiors, "f1")
    expect(Number.isFinite(d.widthM)).toBe(true)
    expect(Number.isFinite(d.heightM)).toBe(true)
  })
})

describe("buildElectricalPlan — legend + panel schedule", () => {
  it("draws a legend naming symbol types (incl. Stopkontak)", () => {
    const { base, interiors } = scene()
    const d = buildElectricalPlan(base, interiors, "f1")
    expect(d.labels.some((l) => l.kind === "room" && l.text === "Legenda")).toBe(true)
    expect(d.labels.some((l) => l.kind === "room" && l.text.includes("Stopkontak"))).toBe(true)
  })

  it("draws a panel-schedule table with an MCB column and circuit rows", () => {
    const { base, interiors } = scene()
    const d = buildElectricalPlan(base, interiors, "f1")
    expect(d.labels.some((l) => l.kind === "room" && l.text.includes("MCB"))).toBe(true)
    // buildCircuits yields a Penerangan + Stopkontak circuit for this scene
    expect(d.labels.some((l) => l.kind === "room" && l.text.includes("Penerangan"))).toBe(true)
    // table grid uses outline lines to the RIGHT of the plan bbox (x >= 6)
    expect(d.lines.some((l) => l.kind === "outline" && l.x1 >= 6 && l.x2 >= 6)).toBe(true)
  })

  it("extends widthM beyond the room bbox to cover the table", () => {
    const { base, interiors } = scene()
    const d = buildElectricalPlan(base, interiors, "f1")
    expect(d.widthM).toBeGreaterThan(6) // room bbox width (incl. void) is 6
  })

  it('anchors every legend + schedule label "start" (x = left text edge, not a centre point)', () => {
    const { base, interiors } = scene()
    const d = buildElectricalPlan(base, interiors, "f1")
    // The legend/table block starts at bboxW (6) + gap (1) = x ≥ 7.
    const blockLabels = d.labels.filter((l) => l.x >= 7)
    expect(blockLabels.length).toBeGreaterThan(6) // "Legenda" + 6 entries + cells
    for (const lb of blockLabels) expect(lb.anchor).toBe("start")
    // Room-name-style centred labels are untouched (no anchor override).
    const planLabels = d.labels.filter((l) => l.x < 7)
    for (const lb of planLabels) expect(lb.anchor).toBeUndefined()
  })

  it("widens the schedule columns so 4-digit VA values fit start-anchored (Sirkuit 3.6 · Titik 1.0 · VA 1.2 · MCB 1.2)", () => {
    const { base, interiors } = scene()
    const d = buildElectricalPlan(base, interiors, "f1")
    const tableX0 = 7 // bboxW 6 + TABLE_GAP 1
    // Vertical column separators at the widened offsets (incl. right border at 7.0).
    const vertX = d.lines
      .filter((l) => l.kind === "outline" && l.x1 === l.x2)
      .map((l) => l.x1)
    for (const off of [0, 3.6, 4.6, 5.8, 7.0]) {
      expect(vertX).toContain(Math.round((tableX0 + off) * 100) / 100)
    }
    // Header cells start just inside their own column (offset + 0.1 pad).
    const header = (text: string) => d.labels.find((l) => l.text === text)!
    expect(header("Sirkuit").x).toBeCloseTo(tableX0 + 0 + 0.1, 5)
    expect(header("Titik").x).toBeCloseTo(tableX0 + 3.6 + 0.1, 5)
    expect(header("VA").x).toBeCloseTo(tableX0 + 4.6 + 0.1, 5)
    expect(header("MCB").x).toBeCloseTo(tableX0 + 5.8 + 0.1, 5)
  })
})

describe("buildElectricalPlan — title", () => {
  it('titles the sheet "Rencana Listrik — <floor name>"', () => {
    const { base, interiors } = scene()
    expect(buildElectricalPlan(base, interiors, "f1").title).toBe("Rencana Listrik — Lantai 1")
  })

  it("falls back to the floorId when the floor is missing", () => {
    const { base, interiors } = scene()
    expect(buildElectricalPlan(base, interiors, "nope").title).toBe("Rencana Listrik — nope")
  })
})

describe("buildElectricalPlan — jalur kabel & lampu eksterior", () => {
  it("draws L-shaped homerun lines from the panel to loads and exterior lamp symbols", () => {
    const l = layout({
      rooms: [room({ id: "ra" }), room({ id: "rb", x: 4 })],
      electrical: [
        { id: "pnl", roomId: "ra", type: "panel", x: 1, y: 1 },
        { id: "sk1", roomId: "rb", type: "stopkontak", x: 5, y: 2 },
      ],
      exteriorLamps: [{ id: "el1", kind: "bollard", x: 6, y: 1, mountH: 0, floorId: "f1" }],
    })
    const d = buildElectricalPlan(l, [], "f1")
    // homerun stopkontak: (1,1)→(5,1)→(5,2)
    expect(d.lines.some((ln) => ln.kind === "opening" && ln.x1 === 1 && ln.y1 === 1 && ln.x2 === 5 && ln.y2 === 1)).toBe(true)
    expect(d.lines.some((ln) => ln.kind === "opening" && ln.x1 === 5 && ln.y1 === 1 && ln.x2 === 5 && ln.y2 === 2)).toBe(true)
    // homerun lampu eksterior: (1,1)→(6,1)
    expect(d.lines.some((ln) => ln.kind === "opening" && ln.x1 === 1 && ln.y1 === 1 && ln.x2 === 6 && ln.y2 === 1)).toBe(true)
  })

  it("does NOT draw a homerun to a saklar (saklar bukan beban)", () => {
    const l = layout({
      rooms: [room({ id: "ra" })],
      electrical: [
        { id: "pnl", roomId: "ra", type: "panel", x: 1, y: 1 },
        { id: "sw", roomId: "ra", type: "saklar_tunggal", x: 2.5, y: 2.5 },
      ],
    })
    const d = buildElectricalPlan(l, [], "f1")
    // Tanpa beban (tidak ada stopkontak/lampu), garis "opening" panjang tidak
    // boleh ada — saklar tidak mendapat homerun.
    const long = d.lines.filter(
      (ln) => ln.kind === "opening" && Math.abs(ln.x2 - ln.x1) + Math.abs(ln.y2 - ln.y1) > 0.5,
    )
    expect(long).toEqual([])
  })

  it("no panel on the floor → no homerun lines", () => {
    const l = layout({
      rooms: [room({ id: "ra" })],
      electrical: [{ id: "sk1", roomId: "ra", type: "stopkontak", x: 2, y: 2 }],
    })
    const d = buildElectricalPlan(l, [], "f1")
    // Glyph simbol juga kind "opening" (pendek ±0,15 m) — tanpa panel tidak
    // boleh ada garis "opening" PANJANG (jalur kabel).
    const long = d.lines.filter(
      (ln) => ln.kind === "opening" && Math.abs(ln.x2 - ln.x1) + Math.abs(ln.y2 - ln.y1) > 0.5
    )
    expect(long).toEqual([])
  })
})
