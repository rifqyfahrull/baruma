import { describe, it, expect } from "vitest"
import { CEILING_DROP_M, buildCeilingPlan } from "./ceiling-plan"
import type {
  DesignLayout,
  Floor,
  LightingFixture,
  MaterialAssignment,
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
const materialAssignment = (over: Partial<MaterialAssignment>): MaterialAssignment => ({
  id: "m", roomId: "r", surface: "ceiling", materialId: "gypsum-cat",
  name: "Gypsum + Cat", areaM2: 9, priceRange: { low: 0, mid: 0, high: 0 },
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

describe("CEILING_DROP_M", () => {
  it("is pinned to 0.4 m per the Global Constraints", () => {
    expect(CEILING_DROP_M).toBe(0.4)
  })
})

describe("buildCeilingPlan — title + bounding box", () => {
  const base = layout({
    rooms: [room({ id: "r1", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 })],
  })

  it('titles the sheet "Rencana Plafon — <floor name>"', () => {
    expect(buildCeilingPlan(base, [], "f1").title).toBe("Rencana Plafon — Lantai 1")
  })

  it("sizes widthM/heightM to the bounding box of ALL the floor's rooms, including void", () => {
    const withVoid = layout({
      rooms: [
        room({ id: "r1", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 }),
        room({ id: "void1", type: "void", x: 0, y: 3, width: 4, depth: 1, areaM2: 4 }),
      ],
    })
    const d = buildCeilingPlan(withVoid, [], "f1")
    expect(d.widthM).toBe(4)
    expect(d.heightM).toBe(4) // void extends past the real room's 3 to 4
  })

  it("draws outline lines only for non-void rooms, but extends bbox/dims to void rooms", () => {
    const withVoid = layout({
      rooms: [
        room({ id: "r1", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 }),
        room({ id: "void1", name: "Void Tangga", type: "void", x: 4, y: 0, width: 2, depth: 3, areaM2: 6 }),
      ],
    })
    const d = buildCeilingPlan(withVoid, [], "f1")
    expect(d.lines.filter((line) => line.kind === "outline")).toHaveLength(4)
    expect(d.labels.some((l) => l.text.startsWith("Void"))).toBe(false)
    expect(d.widthM).toBe(6)
    const xDim = d.dims.find((dc) => dc.axis === "x")!
    expect(xDim.points).toContain(6)
  })
})

describe("buildCeilingPlan — room label: ceiling material + height", () => {
  it('labels a room with no interior entry using the fallback material name "Gypsum + Cat"', () => {
    const l = layout({
      rooms: [room({ id: "r1", name: "Kamar Tidur", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 })],
    })
    const d = buildCeilingPlan(l, [], "f1")
    // floor.heightM 3, CEILING_DROP_M 0.4, no levelOffsetM -> h = 2.6 -> formatElevation -> "+2,6 m"
    expect(d.labels).toContainEqual({ x: 2, y: 1.5, text: "Gypsum + Cat · +2,6 m", kind: "room" })
  })

  it("uses the ceiling material from interiors (surface === ceiling) when present", () => {
    const l = layout({
      rooms: [room({ id: "r1", name: "Ruang Tamu", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 })],
    })
    const interiors: RoomInteriorPlan[] = [
      interiorPlan({
        roomId: "r1",
        materials: [materialAssignment({ roomId: "r1", materialId: "gypsum-premium", name: "Gypsum Board Premium", areaM2: 12 })],
      }),
    ]
    const d = buildCeilingPlan(l, interiors, "f1")
    expect(d.labels).toContainEqual({ x: 2, y: 1.5, text: "Gypsum Board Premium · +2,6 m", kind: "room" })
  })

  it("ignores non-ceiling material assignments and falls back", () => {
    const l = layout({
      rooms: [room({ id: "r1", name: "Dapur", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 })],
    })
    const interiors: RoomInteriorPlan[] = [
      interiorPlan({
        roomId: "r1",
        materials: [materialAssignment({ roomId: "r1", surface: "floor", materialId: "floor-cream-tile", name: "Homogeneous Tile Cream", areaM2: 12 })],
      }),
    ]
    const d = buildCeilingPlan(l, interiors, "f1")
    expect(d.labels).toContainEqual({ x: 2, y: 1.5, text: "Gypsum + Cat · +2,6 m", kind: "room" })
  })

  it("plafon RATA (E2): offset -0.18 → tinggi bersih dari lantai ruang +2,78 m", () => {
    const l = layout({
      rooms: [room({ id: "r1", name: "Split Level", x: 0, y: 0, width: 4, depth: 3, areaM2: 12, levelOffsetM: -0.18 })],
    })
    const d = buildCeilingPlan(l, [], "f1")
    // h = (heightM 3 − drop 0.4) − offset(−0.18) = 2.78 — lantai ruang turun,
    // plafon tetap di bidang yang sama (selaras section; HC-9 ditutup).
    expect(d.labels).toContainEqual({ x: 2, y: 1.5, text: "Gypsum + Cat · +2,78 m", kind: "room" })
  })

  it("uses the floor's own heightM (not a hardcoded 3m) for the height calculation", () => {
    const l = layout({
      floors: [floor({ id: "f1", heightM: 3.5 })],
      rooms: [room({ id: "r1", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 })],
    })
    const d = buildCeilingPlan(l, [], "f1")
    // 3.5 - 0.4 = 3.1 -> "+3,1 m"
    expect(d.labels).toContainEqual({ x: 2, y: 1.5, text: "Gypsum + Cat · +3,1 m", kind: "room" })
  })
})

describe("buildCeilingPlan — lighting symbols: position", () => {
  it("places the symbol center at room.x + fixture.x, room.y + fixture.y (exact)", () => {
    const l = layout({
      rooms: [room({ id: "r1", x: 2, y: 1, width: 4, depth: 3, areaM2: 12 })],
    })
    const interiors: RoomInteriorPlan[] = [
      interiorPlan({ roomId: "r1", lighting: [fixture({ roomId: "r1", type: "downlight", x: 1.5, y: 0.5, qty: 1 })] }),
    ]
    const d = buildCeilingPlan(l, interiors, "f1")
    const symbolLines = d.lines.filter((line) => line.kind === "opening")
    expect(symbolLines).toHaveLength(2) // cross = 2 lines
    expect(symbolLines).toContainEqual({ x1: 3.38, y1: 1.5, x2: 3.62, y2: 1.5, kind: "opening" })
    expect(symbolLines).toContainEqual({ x1: 3.5, y1: 1.38, x2: 3.5, y2: 1.62, kind: "opening" })
  })
})

describe("buildCeilingPlan — lighting symbols: type -> shape mapping", () => {
  const l = layout({
    rooms: [room({ id: "r1", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 })],
  })

  it("downlight, task, outdoor -> cross (2 lines)", () => {
    for (const type of ["downlight", "task", "outdoor"] as const) {
      const interiors: RoomInteriorPlan[] = [
        interiorPlan({ roomId: "r1", lighting: [fixture({ roomId: "r1", type, x: 1, y: 1, qty: 1 })] }),
      ]
      const d = buildCeilingPlan(l, interiors, "f1")
      expect(d.lines.filter((line) => line.kind === "opening")).toHaveLength(2)
    }
  })

  it("pendant, indirect, wall_lamp -> diamond (4 lines)", () => {
    for (const type of ["pendant", "indirect", "wall_lamp"] as const) {
      const interiors: RoomInteriorPlan[] = [
        interiorPlan({ roomId: "r1", lighting: [fixture({ roomId: "r1", type, x: 1, y: 1, qty: 1 })] }),
      ]
      const d = buildCeilingPlan(l, interiors, "f1")
      expect(d.lines.filter((line) => line.kind === "opening")).toHaveLength(4)
    }
  })

  it("builds the diamond as a rotated square with exact ±0.12 vertices", () => {
    const interiors: RoomInteriorPlan[] = [
      interiorPlan({ roomId: "r1", lighting: [fixture({ roomId: "r1", type: "pendant", x: 1, y: 1, qty: 1 })] }),
    ]
    const d = buildCeilingPlan(l, interiors, "f1")
    const diamond = d.lines.filter((line) => line.kind === "opening")
    // center (1,1): top(1,1.12) right(1.12,1) bottom(1,0.88) left(0.88,1)
    expect(diamond).toContainEqual({ x1: 1, y1: 1.12, x2: 1.12, y2: 1, kind: "opening" })
    expect(diamond).toContainEqual({ x1: 1.12, y1: 1, x2: 1, y2: 0.88, kind: "opening" })
    expect(diamond).toContainEqual({ x1: 1, y1: 0.88, x2: 0.88, y2: 1, kind: "opening" })
    expect(diamond).toContainEqual({ x1: 0.88, y1: 1, x2: 1, y2: 1.12, kind: "opening" })
  })
})

describe("buildCeilingPlan — lighting symbols: qty label", () => {
  const l = layout({
    rooms: [room({ id: "r1", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 })],
  })

  it("adds a ×N label at (pos.x+0.15, pos.y+0.15) when qty > 1", () => {
    const interiors: RoomInteriorPlan[] = [
      interiorPlan({ roomId: "r1", lighting: [fixture({ roomId: "r1", type: "downlight", x: 1, y: 1, qty: 3 })] }),
    ]
    const d = buildCeilingPlan(l, interiors, "f1")
    expect(d.labels).toContainEqual({ x: 1.15, y: 1.15, text: "×3", kind: "room" })
  })

  it("adds no ×N label when qty is 1", () => {
    const interiors: RoomInteriorPlan[] = [
      interiorPlan({ roomId: "r1", lighting: [fixture({ roomId: "r1", type: "downlight", x: 1, y: 1, qty: 1 })] }),
    ]
    const d = buildCeilingPlan(l, interiors, "f1")
    expect(d.labels.some((label) => label.text.startsWith("×"))).toBe(false)
  })
})

describe("buildCeilingPlan — no-interior room still labeled", () => {
  it("labels a room with fallback material even when interiors is empty and draws no lighting symbols", () => {
    const l = layout({
      rooms: [room({ id: "r1", name: "Gudang", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 })],
    })
    const d = buildCeilingPlan(l, [], "f1")
    expect(d.labels).toContainEqual({ x: 2, y: 1.5, text: "Gypsum + Cat · +2,6 m", kind: "room" })
    expect(d.lines.filter((line) => line.kind === "opening")).toHaveLength(0)
  })

  it("falls back the same way when interiors exist for other rooms but not this one", () => {
    const l = layout({
      rooms: [room({ id: "r1", name: "Gudang", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 })],
    })
    const interiors: RoomInteriorPlan[] = [interiorPlan({ roomId: "other-room", materials: [], lighting: [] })]
    const d = buildCeilingPlan(l, interiors, "f1")
    expect(d.labels).toContainEqual({ x: 2, y: 1.5, text: "Gypsum + Cat · +2,6 m", kind: "room" })
  })
})

describe("buildCeilingPlan — dim chains", () => {
  it("emits x/y DimChains at -0.8 with sorted-unique bounds from ALL rooms", () => {
    const l = layout({
      rooms: [
        room({ id: "r1", x: 0, y: 0, width: 5, depth: 4, areaM2: 20 }),
        room({ id: "r2", x: 5, y: 0, width: 3, depth: 4, areaM2: 12 }),
      ],
    })
    const d = buildCeilingPlan(l, [], "f1")
    expect(d.dims).toContainEqual({ axis: "x", at: -0.8, points: [0, 5, 8] })
    expect(d.dims).toContainEqual({ axis: "y", at: -0.8, points: [0, 4] })
  })
})

describe("buildCeilingPlan — floor scoping", () => {
  it("only includes rooms for the requested floor", () => {
    const l = layout({
      floors: [floor({ id: "f1", name: "Lantai 1" }), floor({ id: "f2", name: "Lantai 2", heightM: 3 })],
      rooms: [
        room({ id: "r1", floorId: "f1", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 }),
        room({ id: "r2", floorId: "f2", x: 0, y: 0, width: 5, depth: 5, areaM2: 25 }),
      ],
    })
    const d = buildCeilingPlan(l, [], "f2")
    expect(d.title).toBe("Rencana Plafon — Lantai 2")
    expect(d.lines.filter((line) => line.kind === "outline")).toHaveLength(4)
    expect(d.widthM).toBe(5)
  })
})

describe("buildCeilingPlan — levels", () => {
  it("emits an empty levels array", () => {
    const l = layout({ rooms: [room({ id: "r1" })] })
    expect(buildCeilingPlan(l, [], "f1").levels).toEqual([])
  })
})
