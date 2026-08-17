import { describe, it, expect } from "vitest"
import { buildKusenPlan } from "./kusen-plan"
import type { DesignLayout, Floor, Opening, Room } from "@/types"

const floor = (over: Partial<Floor>): Floor => ({
  id: "f1", level: 0, name: "Lantai 1", heightM: 3, ...over,
})
const room = (over: Partial<Room>): Room => ({
  id: "r", floorId: "f1", name: "R", type: "kamar_tidur",
  x: 0, y: 0, width: 3, depth: 3, areaM2: 9, ...over,
})
const opening = (over: Partial<Opening>): Opening => ({
  id: "o", floorId: "f1", wallId: "r:s", type: "window", positionM: 1, widthM: 1, heightM: 1, ...over,
})
const layout = (over: Partial<DesignLayout>): DesignLayout => ({
  id: "l", projectId: "p", versionId: "v",
  floors: [floor({})], rooms: [], walls: [], openings: [], stairs: [], pools: [],
  validation: { passed: true, issues: [] },
  ...over,
})

// Fixture T1: floor f1 has 2 real rooms (Ruang Tamu 0..5 x 0..4, Kamar
// Tidur 5..8 x 0..4) + 1 void room (0..8 x 4..5 — contributes to the
// bbox/dim chains like any other room, but is skipped for outlines and
// its name label). Floor f2 has an unrelated room (verifies floor
// filtering).
//
// 4 openings on f1, one per wall side, so every inset direction is
// exercised:
//   d1 (door, living:s, w0.9)  -> segment mid (2.5, 4)   -> inset -y -> (2.5, 3.75)
//   w2 (window, living:n, w1.2) -> segment mid (2.5, 0)  -> inset +y -> (2.5, 0.25)
//   w1 (window, bedroom:e, w1.0) -> segment mid (8, 2)   -> inset -x -> (7.75, 2)
//   d2 (door, bedroom:w, w0.8)  -> segment mid (5, 2)     -> inset +x -> (5.25, 2)
//
// kusenSchedule over these 4 openings (only door/window group in the
// layout): doors sorted width desc -> d1(0.9)=P1, d2(0.8)=P2; windows
// sorted width desc -> w2(1.2)=J1, w1(1.0)=J2.
const baseLayout = layout({
  floors: [
    floor({ id: "f1", level: 0, name: "Lantai 1", heightM: 3 }),
    floor({ id: "f2", level: 1, name: "Lantai 2", heightM: 3 }),
  ],
  rooms: [
    room({ id: "living", floorId: "f1", name: "Ruang Tamu", type: "ruang_tamu", x: 0, y: 0, width: 5, depth: 4, areaM2: 20 }),
    room({ id: "bedroom", floorId: "f1", name: "Kamar Tidur", type: "kamar_tidur", x: 5, y: 0, width: 3, depth: 4, areaM2: 12 }),
    room({ id: "void1", floorId: "f1", name: "Void", type: "void", x: 0, y: 4, width: 8, depth: 1, areaM2: 8 }),
    room({ id: "other", floorId: "f2", name: "Lantai 2 Room", type: "ruang_tamu", x: 0, y: 0, width: 5, depth: 5, areaM2: 25 }),
  ],
  openings: [
    opening({ id: "d1", floorId: "f1", wallId: "living:s", type: "door", positionM: 2.5, widthM: 0.9, heightM: 2.1 }),
    opening({ id: "w2", floorId: "f1", wallId: "living:n", type: "window", positionM: 2.5, widthM: 1.2, heightM: 1.2 }),
    opening({ id: "w1", floorId: "f1", wallId: "bedroom:e", type: "window", positionM: 2.0, widthM: 1.0, heightM: 1.2 }),
    opening({ id: "d2", floorId: "f1", wallId: "bedroom:w", type: "door", positionM: 2.0, widthM: 0.8, heightM: 2.1 }),
  ],
})

describe("buildKusenPlan — title + bounding box", () => {
  it('titles the sheet "Rencana Kusen — <floor name>"', () => {
    expect(buildKusenPlan(baseLayout, "f1").title).toBe("Rencana Kusen — Lantai 1")
  })

  it("sizes widthM/heightM to the bounding box of ALL the floor's rooms, including void", () => {
    const d = buildKusenPlan(baseLayout, "f1")
    expect(d.widthM).toBe(8) // max(x+width): bedroom 5+3 (== void1's 0+8)
    expect(d.heightM).toBe(5) // max(y+depth): void1 4+1 = 5, past living/bedroom's 4
  })
})

describe("buildKusenPlan — room outlines", () => {
  const d = buildKusenPlan(baseLayout, "f1")

  it("draws exactly 4 outline lines per non-void room (void1 skipped)", () => {
    expect(d.lines.filter((l) => l.kind === "outline")).toHaveLength(8)
  })

  it("traces the living room's rect (0,0)-(5,4)", () => {
    const outlines = d.lines.filter((l) => l.kind === "outline")
    expect(outlines).toContainEqual({ x1: 0, y1: 0, x2: 5, y2: 0, kind: "outline" })
    expect(outlines).toContainEqual({ x1: 5, y1: 0, x2: 5, y2: 4, kind: "outline" })
    expect(outlines).toContainEqual({ x1: 5, y1: 4, x2: 0, y2: 4, kind: "outline" })
    expect(outlines).toContainEqual({ x1: 0, y1: 4, x2: 0, y2: 0, kind: "outline" })
  })

  it("traces the bedroom's rect (5,0)-(8,4)", () => {
    const outlines = d.lines.filter((l) => l.kind === "outline")
    expect(outlines).toContainEqual({ x1: 5, y1: 0, x2: 8, y2: 0, kind: "outline" })
    expect(outlines).toContainEqual({ x1: 8, y1: 0, x2: 8, y2: 4, kind: "outline" })
    expect(outlines).toContainEqual({ x1: 8, y1: 4, x2: 5, y2: 4, kind: "outline" })
    expect(outlines).toContainEqual({ x1: 5, y1: 4, x2: 5, y2: 0, kind: "outline" })
  })

  it("excludes the void room and any room on another floor", () => {
    // 2 rooms x 4 = 8 total outline lines, already asserted above; also
    // no room-name label for the void room or the other floor's room.
    expect(d.labels.some((l) => l.text === "Void")).toBe(false)
    expect(d.labels.some((l) => l.text === "Lantai 2 Room")).toBe(false)
  })
})

describe("buildKusenPlan — room name labels", () => {
  it("places a room label at each (non-void) room's center", () => {
    const d = buildKusenPlan(baseLayout, "f1")
    expect(d.labels).toContainEqual({ x: 2.5, y: 2, text: "Ruang Tamu", kind: "room" })
    expect(d.labels).toContainEqual({ x: 6.5, y: 2, text: "Kamar Tidur", kind: "room" })
  })
})

describe("buildKusenPlan — opening segments", () => {
  const d = buildKusenPlan(baseLayout, "f1")
  const openingLines = d.lines.filter((l) => l.kind === "opening")

  it("emits one opening line per opening, matching openingSegment's coords", () => {
    expect(openingLines).toHaveLength(4)
    expect(openingLines).toContainEqual({ x1: 2.05, y1: 4, x2: 2.95, y2: 4, kind: "opening" }) // d1: living:s
    expect(openingLines).toContainEqual({ x1: 1.9, y1: 0, x2: 3.1, y2: 0, kind: "opening" }) // w2: living:n
    expect(openingLines).toContainEqual({ x1: 8, y1: 1.5, x2: 8, y2: 2.5, kind: "opening" }) // w1: bedroom:e
    expect(openingLines).toContainEqual({ x1: 5, y1: 1.6, x2: 5, y2: 2.4, kind: "opening" }) // d2: bedroom:w
  })
})

describe("buildKusenPlan — kusen code labels", () => {
  const d = buildKusenPlan(baseLayout, "f1")

  it("labels each opening's midpoint, inset 0.25 m toward the room interior, with its schedule code", () => {
    expect(d.labels).toContainEqual({ x: 2.5, y: 3.75, text: "P1", kind: "room" }) // d1 south -> -y
    expect(d.labels).toContainEqual({ x: 2.5, y: 0.25, text: "J1", kind: "room" }) // w2 north -> +y
    expect(d.labels).toContainEqual({ x: 7.75, y: 2, text: "J2", kind: "room" }) // w1 east -> -x
    expect(d.labels).toContainEqual({ x: 5.25, y: 2, text: "P2", kind: "room" }) // d2 west -> +x
  })

  it("places P1 (the widest door, d1) at the correct opening — not any arbitrary door", () => {
    const p1 = d.labels.find((l) => l.text === "P1")!
    expect(p1).toEqual({ x: 2.5, y: 3.75, text: "P1", kind: "room" })
  })
})

describe("buildKusenPlan — dim chains", () => {
  it("emits x/y DimChains at -0.8 with sorted-unique bounds from ALL rooms, including void", () => {
    const d = buildKusenPlan(baseLayout, "f1")
    expect(d.dims).toContainEqual({ axis: "x", at: -0.8, points: [0, 5, 8] })
    expect(d.dims).toContainEqual({ axis: "y", at: -0.8, points: [0, 4, 5] }) // 5 from void1 (y 4..5)
  })
})

describe("buildKusenPlan — void rooms extend the bbox/dim chains but not outlines/labels", () => {
  const voidLayout = layout({
    floors: [floor({ id: "f1", level: 0, name: "Lantai 1", heightM: 3 })],
    rooms: [
      room({ id: "r1", floorId: "f1", name: "Ruang Tamu", type: "ruang_tamu", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 }),
      room({ id: "void1", floorId: "f1", name: "Void Tangga", type: "void", x: 4, y: 0, width: 2, depth: 3, areaM2: 6 }),
    ],
  })

  it("extends widthM past the real room's edge to include the void room (6, not 4)", () => {
    const d = buildKusenPlan(voidLayout, "f1")
    expect(d.widthM).toBe(6)
  })

  it("includes the void room's far edge (x=6) in the x DimChain", () => {
    const d = buildKusenPlan(voidLayout, "f1")
    const xDim = d.dims.find((dc) => dc.axis === "x")!
    expect(xDim.points).toContain(6)
  })

  it("draws no outline lines for the void room's rect", () => {
    const d = buildKusenPlan(voidLayout, "f1")
    const outlines = d.lines.filter((l) => l.kind === "outline")
    expect(outlines).toHaveLength(4) // only r1's 4 lines
    expect(outlines.some((l) => l.x1 === 6 || l.x2 === 6)).toBe(false)
  })

  it("creates no room-name label for the void room", () => {
    const d = buildKusenPlan(voidLayout, "f1")
    expect(d.labels.some((l) => l.text.startsWith("Void"))).toBe(false)
  })
})

describe("buildKusenPlan — floor scoping", () => {
  it("only includes rooms/openings/labels for the requested floor", () => {
    const d = buildKusenPlan(baseLayout, "f2")
    expect(d.title).toBe("Rencana Kusen — Lantai 2")
    expect(d.lines.filter((l) => l.kind === "outline")).toHaveLength(4)
    expect(d.lines.filter((l) => l.kind === "opening")).toHaveLength(0)
    expect(d.labels).toEqual([{ x: 2.5, y: 2.5, text: "Lantai 2 Room", kind: "room" }])
  })
})
