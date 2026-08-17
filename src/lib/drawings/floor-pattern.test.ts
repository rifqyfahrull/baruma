import { describe, it, expect } from "vitest"
import { tileSizeFor, buildFloorPatternPlan } from "./floor-pattern"
import type { DesignLayout, Floor, MaterialAssignment, Room, RoomInteriorPlan } from "@/types"

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
  id: "m", roomId: "r", surface: "floor", materialId: "floor-cream-tile",
  name: "Homogeneous Tile Cream", areaM2: 9, priceRange: { low: 0, mid: 0, high: 0 },
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

describe("tileSizeFor", () => {
  it("returns the pinned TILE_SIZES for known materials", () => {
    expect(tileSizeFor("floor-cream-tile")).toEqual({ w: 0.6, h: 0.6 })
    expect(tileSizeFor("bathroom-tile")).toEqual({ w: 0.4, h: 0.4 })
    expect(tileSizeFor("floor-vinyl-oak")).toEqual({ w: 0.18, h: 1.2 })
    expect(tileSizeFor("outdoor-deck")).toEqual({ w: 0.14, h: 2.2 })
  })

  it("returns null (seamless) for floor-polished-concrete", () => {
    expect(tileSizeFor("floor-polished-concrete")).toBeNull()
  })

  it("falls back to 0.4×0.4 for an unknown material id", () => {
    expect(tileSizeFor("some-unknown-material")).toEqual({ w: 0.4, h: 0.4 })
  })
})

describe("buildFloorPatternPlan — title + bounding box", () => {
  const base = layout({
    rooms: [room({ id: "r1", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 })],
  })

  it('titles the sheet "Pola Lantai — <floor name>"', () => {
    expect(buildFloorPatternPlan(base, [], "f1").title).toBe("Pola Lantai — Lantai 1")
  })

  it("sizes widthM/heightM to the bounding box of ALL the floor's rooms, including void", () => {
    const withVoid = layout({
      rooms: [
        room({ id: "r1", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 }),
        room({ id: "void1", type: "void", x: 0, y: 3, width: 4, depth: 1, areaM2: 4 }),
      ],
    })
    const d = buildFloorPatternPlan(withVoid, [], "f1")
    expect(d.widthM).toBe(4)
    expect(d.heightM).toBe(4) // void extends past the real room's 3 to 4
  })
})

describe("buildFloorPatternPlan — grid nat for a 4×3 room, 0.6×0.6 tile", () => {
  const l = layout({
    rooms: [room({ id: "r1", name: "Ruang Tamu", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 })],
  })
  const interiors: RoomInteriorPlan[] = [
    interiorPlan({
      roomId: "r1",
      materials: [materialAssignment({ roomId: "r1", materialId: "floor-cream-tile", name: "Homogeneous Tile Cream", areaM2: 12 })],
    }),
  ]
  const d = buildFloorPatternPlan(l, interiors, "f1")
  const gridLines = d.lines.filter((line) => line.kind === "opening")
  const verticals = gridLines.filter((line) => line.x1 === line.x2).sort((a, b) => a.x1 - b.x1)
  const horizontals = gridLines.filter((line) => line.y1 === line.y2).sort((a, b) => a.y1 - b.y1)

  it("draws 6 vertical nat lines at x = 0.6..3.6", () => {
    expect(verticals).toHaveLength(6)
    expect(verticals.map((line) => line.x1)).toEqual([0.6, 1.2, 1.8, 2.4, 3, 3.6])
  })

  it("clips each vertical line to the room's y-span (0..3)", () => {
    for (const line of verticals) {
      expect(line.y1).toBe(0)
      expect(line.y2).toBe(3)
    }
  })

  it("draws 4 horizontal nat lines at y = 0.6..2.4", () => {
    expect(horizontals).toHaveLength(4)
    expect(horizontals.map((line) => line.y1)).toEqual([0.6, 1.2, 1.8, 2.4])
  })

  it("clips each horizontal line to the room's x-span (0..4)", () => {
    for (const line of horizontals) {
      expect(line.x1).toBe(0)
      expect(line.x2).toBe(4)
    }
  })

  it('labels the room "Homogeneous Tile Cream · 60×60 · 37 pcs" (waste formula: ceil(12/0.36*1.1))', () => {
    expect(d.labels).toContainEqual({ x: 2, y: 1.5, text: "Homogeneous Tile Cream · 60×60 · 37 pcs", kind: "room" })
  })
})

describe("buildFloorPatternPlan — vinyl plank orientation (tw 0.18 along x, th 1.2 along y)", () => {
  const l = layout({
    rooms: [room({ id: "r1", name: "Kamar Tidur", x: 0, y: 0, width: 1, depth: 1, areaM2: 1 })],
  })
  const interiors: RoomInteriorPlan[] = [
    interiorPlan({
      roomId: "r1",
      materials: [materialAssignment({ roomId: "r1", materialId: "floor-vinyl-oak", name: "Vinyl Motif Oak", areaM2: 1 })],
    }),
  ]
  const d = buildFloorPatternPlan(l, interiors, "f1")
  const gridLines = d.lines.filter((line) => line.kind === "opening")
  const verticals = gridLines.filter((line) => line.x1 === line.x2)
  const horizontals = gridLines.filter((line) => line.y1 === line.y2)

  it("spaces verticals by tw=0.18 along x: 5 lines (0.18*6=1.08 exceeds the 1m room)", () => {
    expect(verticals.map((line) => line.x1).sort((a, b) => a - b)).toEqual([0.18, 0.36, 0.54, 0.72, 0.9])
  })

  it("spaces horizontals by th=1.2 along y: none fit inside a 1m-deep room", () => {
    expect(horizontals).toHaveLength(0)
  })
})

describe("buildFloorPatternPlan — seamless material (polished concrete)", () => {
  const l = layout({
    rooms: [room({ id: "r1", name: "Ruang Keluarga", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 })],
  })
  const interiors: RoomInteriorPlan[] = [
    interiorPlan({
      roomId: "r1",
      materials: [materialAssignment({ roomId: "r1", materialId: "floor-polished-concrete", name: "Polished Concrete", areaM2: 12 })],
    }),
  ]
  const d = buildFloorPatternPlan(l, interiors, "f1")

  it("draws no grid ('opening') lines", () => {
    expect(d.lines.filter((line) => line.kind === "opening")).toHaveLength(0)
  })

  it('labels the room "Polished Concrete · tanpa nat"', () => {
    expect(d.labels).toContainEqual({ x: 2, y: 1.5, text: "Polished Concrete · tanpa nat", kind: "room" })
  })
})

describe("buildFloorPatternPlan — fallback material when interiors lack the room", () => {
  const l = layout({
    rooms: [room({ id: "r1", name: "Dapur", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 })],
  })

  it("falls back to floor-cream-tile / Homogeneous Tile Cream using the room's own areaM2, when interiors is empty", () => {
    const d = buildFloorPatternPlan(l, [], "f1")
    expect(d.labels).toContainEqual({ x: 2, y: 1.5, text: "Homogeneous Tile Cream · 60×60 · 37 pcs", kind: "room" })
  })

  it("falls back the same way when interiors exist for other rooms but not this one", () => {
    const interiors: RoomInteriorPlan[] = [interiorPlan({ roomId: "other-room", materials: [] })]
    const d = buildFloorPatternPlan(l, interiors, "f1")
    expect(d.labels).toContainEqual({ x: 2, y: 1.5, text: "Homogeneous Tile Cream · 60×60 · 37 pcs", kind: "room" })
  })

  it("falls back when the room's interior entry has no floor material assignment", () => {
    const interiors: RoomInteriorPlan[] = [
      interiorPlan({ roomId: "r1", materials: [materialAssignment({ roomId: "r1", surface: "wall", materialId: "wall-warm-white", name: "Cat Warm White Washable", areaM2: 20 })] }),
    ]
    const d = buildFloorPatternPlan(l, interiors, "f1")
    expect(d.labels).toContainEqual({ x: 2, y: 1.5, text: "Homogeneous Tile Cream · 60×60 · 37 pcs", kind: "room" })
  })
})

describe("buildFloorPatternPlan — void rooms excluded from outlines but included in bbox", () => {
  const l = layout({
    rooms: [
      room({ id: "r1", name: "Ruang Tamu", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 }),
      room({ id: "void1", name: "Void Tangga", type: "void", x: 4, y: 0, width: 2, depth: 3, areaM2: 6 }),
    ],
  })
  const d = buildFloorPatternPlan(l, [], "f1")

  it("draws outline lines only for the non-void room", () => {
    expect(d.lines.filter((line) => line.kind === "outline")).toHaveLength(4)
  })

  it("creates no room label for the void room", () => {
    expect(d.labels.some((line) => line.text.startsWith("Void"))).toBe(false)
  })

  it("still extends the bbox/dim chains to include the void room's far edge", () => {
    expect(d.widthM).toBe(6)
    const xDim = d.dims.find((dc) => dc.axis === "x")!
    expect(xDim.points).toContain(6)
  })
})

describe("buildFloorPatternPlan — dim chains", () => {
  it("emits x/y DimChains at -0.8 with sorted-unique bounds from ALL rooms", () => {
    const l = layout({
      rooms: [
        room({ id: "r1", x: 0, y: 0, width: 5, depth: 4, areaM2: 20 }),
        room({ id: "r2", x: 5, y: 0, width: 3, depth: 4, areaM2: 12 }),
      ],
    })
    const d = buildFloorPatternPlan(l, [], "f1")
    expect(d.dims).toContainEqual({ axis: "x", at: -0.8, points: [0, 5, 8] })
    expect(d.dims).toContainEqual({ axis: "y", at: -0.8, points: [0, 4] })
  })
})

describe("buildFloorPatternPlan — floor scoping", () => {
  it("only includes rooms for the requested floor", () => {
    const l = layout({
      floors: [floor({ id: "f1", name: "Lantai 1" }), floor({ id: "f2", name: "Lantai 2" })],
      rooms: [
        room({ id: "r1", floorId: "f1", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 }),
        room({ id: "r2", floorId: "f2", x: 0, y: 0, width: 5, depth: 5, areaM2: 25 }),
      ],
    })
    const d = buildFloorPatternPlan(l, [], "f2")
    expect(d.title).toBe("Pola Lantai — Lantai 2")
    expect(d.lines.filter((line) => line.kind === "outline")).toHaveLength(4)
    expect(d.widthM).toBe(5)
  })
})
