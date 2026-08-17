import { describe, it, expect } from "vitest"
import {
  sheetPlacement,
  buildLayoutSheet,
  CONTENT_LEFT_MM,
  CONTENT_TOP_MM,
  CONTENT_RIGHT_MM,
  CONTENT_BOTTOM_MM,
} from "./layout-sheet"
import type { DesignLayout, Floor, Opening, Room } from "@/types"
import type { Drawing } from "./types"

const drawing = (widthM: number, heightM: number): Drawing => ({
  widthM,
  heightM,
  lines: [],
  labels: [],
  dims: [],
  levels: [],
  title: "Test",
})

describe("sheetPlacement", () => {
  it("picks the same scale as pickSheetScale for the drawing's footprint", () => {
    expect(sheetPlacement(drawing(7, 6)).scaleN).toBe(50)
    expect(sheetPlacement(drawing(25, 9)).scaleN).toBe(100)
  })

  it("keeps the drawing's bounding box inside the printable content box", () => {
    const p = sheetPlacement(drawing(7, 6))
    const origin = p.toMm(0, 0)
    const farCorner = p.toMm(7, 6)
    expect(origin.x).toBeGreaterThanOrEqual(CONTENT_LEFT_MM - 1e-6)
    expect(origin.y).toBeLessThanOrEqual(CONTENT_BOTTOM_MM + 1e-6)
    expect(farCorner.x).toBeLessThanOrEqual(CONTENT_RIGHT_MM + 1e-6)
    expect(farCorner.y).toBeGreaterThanOrEqual(CONTENT_TOP_MM - 1e-6)
  })

  it("flips y: larger drawing-space y maps to a smaller sheet-mm y", () => {
    const p = sheetPlacement(drawing(7, 6))
    expect(p.toMm(0, 6).y).toBeLessThan(p.toMm(0, 0).y)
  })
})

/* ── buildLayoutSheet (DENAH per lantai) ── */

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

describe("buildLayoutSheet — base denah (outlines, labels, openings, dims)", () => {
  const base = layout({
    rooms: [room({ id: "k", name: "Kamar Tidur", x: 0, y: 0, width: 3, depth: 2, areaM2: 6 })],
    openings: [opening({ id: "w1", wallId: "k:n", positionM: 1.5, widthM: 1.2 })],
  })
  const d = buildLayoutSheet(base, "f1")

  it('titles the sheet "Denah — <floor name>"', () => {
    expect(d.title).toBe("Denah — Lantai 1")
  })

  it("draws the room outline + its name label at the center", () => {
    expect(d.lines.filter((l) => l.kind === "outline")).toHaveLength(4)
    expect(d.labels).toContainEqual({ x: 1.5, y: 1, text: "Kamar Tidur", kind: "room" })
  })

  it("draws each opening as an opening segment on its host wall", () => {
    expect(d.lines).toContainEqual({ x1: 0.9, y1: 0, x2: 2.1, y2: 0, kind: "opening" })
  })

  it("emits x/y DimChains at -0.8 from the room bounds", () => {
    expect(d.dims).toContainEqual({ axis: "x", at: -0.8, points: [0, 3] })
    expect(d.dims).toContainEqual({ axis: "y", at: -0.8, points: [0, 2] })
  })
})

describe("buildLayoutSheet — tangga (tread lines + panah/label NAIK)", () => {
  // Stair 3x1: w >= d, so default stairDirection is "e" (run along x).
  // Fase D4: rise = Floor.heightM fixture (3.0) → steps = round(3/0.18) = 17
  // → 16 interior tread lines. (Dulu rise dipaku 2.95 → 16 anak — bug:
  // tangga tak sampai slab utk tinggi lantai ≠ 2.95.)
  const stairLayout = layout({
    rooms: [room({ id: "st", name: "Tangga", type: "tangga", x: 0, y: 0, width: 3, depth: 1, areaM2: 3 })],
  })
  const d = buildLayoutSheet(stairLayout, "f1")

  it("draws 16 tread lines perpendicular to the run (verticals strictly inside the room)", () => {
    const treads = d.lines.filter(
      (l) => l.kind === "outline" && l.x1 === l.x2 && l.x1 > 0 && l.x1 < 3
    )
    expect(treads).toHaveLength(16)
    // pitch = 3/17 ≈ 0.1765 → tread pertama di x=0.18 (round2).
    expect(treads).toContainEqual({ x1: 0.18, y1: 0, x2: 0.18, y2: 1, kind: "outline" })
  })

  it("draws the NAIK arrow (shaft + 2 head lines, kind opening) along the run centerline", () => {
    expect(d.lines).toContainEqual({ x1: 0.3, y1: 0.5, x2: 2.7, y2: 0.5, kind: "opening" })
    expect(d.lines).toContainEqual({ x1: 2.7, y1: 0.5, x2: 2.5, y2: 0.4, kind: "opening" })
    expect(d.lines).toContainEqual({ x1: 2.7, y1: 0.5, x2: 2.5, y2: 0.6, kind: "opening" })
  })

  it('places the "NAIK" label near the arrow tip (pulled back along the climb)', () => {
    expect(d.labels).toContainEqual({ x: 2.2, y: 0.5, text: "NAIK", kind: "room" })
  })

  it("follows an explicit stairDirection (s = climbing +y → horizontal treads, arrow up the run)", () => {
    const south = buildLayoutSheet(
      layout({
        rooms: [room({ id: "st", name: "Tangga", type: "tangga", x: 0, y: 0, width: 3, depth: 2, areaM2: 6, stairDirection: "s" })],
      }),
      "f1"
    )
    const treads = south.lines.filter(
      (l) => l.kind === "outline" && l.y1 === l.y2 && l.y1 > 0 && l.y1 < 2
    )
    expect(treads).toHaveLength(16)
    // shaft climbs toward the s edge: (1.5, 0.3) → (1.5, 1.7)
    expect(south.lines).toContainEqual({ x1: 1.5, y1: 0.3, x2: 1.5, y2: 1.7, kind: "opening" })
    expect(south.labels).toContainEqual({ x: 1.5, y: 1.2, text: "NAIK", kind: "room" })
  })
})

describe("buildLayoutSheet — railing balkon (garis ganda di sisi terbuka saja)", () => {
  // Kamar (0..3 x 0..2) walls the balcony's w side; n/s/e stay open.
  const balconyLayout = layout({
    rooms: [
      room({ id: "k", name: "Kamar Tidur", x: 0, y: 0, width: 3, depth: 2, areaM2: 6 }),
      room({ id: "b", name: "Balkon", type: "balkon", x: 3, y: 0, width: 2, depth: 2, areaM2: 4 }),
    ],
  })
  const d = buildLayoutSheet(balconyLayout, "f1")

  it("draws a double thin line (edge + 0.05 inset) on each OPEN side (n, s, e)", () => {
    expect(d.lines).toContainEqual({ x1: 3, y1: 0, x2: 5, y2: 0, kind: "opening" })
    expect(d.lines).toContainEqual({ x1: 3, y1: 0.05, x2: 5, y2: 0.05, kind: "opening" })
    expect(d.lines).toContainEqual({ x1: 3, y1: 2, x2: 5, y2: 2, kind: "opening" })
    expect(d.lines).toContainEqual({ x1: 3, y1: 1.95, x2: 5, y2: 1.95, kind: "opening" })
    expect(d.lines).toContainEqual({ x1: 5, y1: 0, x2: 5, y2: 2, kind: "opening" })
    expect(d.lines).toContainEqual({ x1: 4.95, y1: 0, x2: 4.95, y2: 2, kind: "opening" })
  })

  it("draws NO railing on the side walled by the neighbouring room (w)", () => {
    expect(d.lines.some((l) => l.kind === "opening" && l.x1 === 3 && l.x2 === 3)).toBe(false)
  })

  it("treats an adjacent balcony as continuous — no railing on the shared side", () => {
    const two = buildLayoutSheet(
      layout({
        rooms: [
          room({ id: "b", name: "Balkon", type: "balkon", x: 3, y: 0, width: 2, depth: 2, areaM2: 4 }),
          room({ id: "b2", name: "Balkon 2", type: "balkon", x: 3, y: 2, width: 2, depth: 2, areaM2: 4 }),
        ],
      }),
      "f1"
    )
    // b's s inset line (y=1.95) and b2's n inset line (y=2.05) must be absent.
    expect(two.lines.some((l) => l.kind === "opening" && l.y1 === 1.95 && l.y2 === 1.95)).toBe(false)
    expect(two.lines.some((l) => l.kind === "opening" && l.y1 === 2.05 && l.y2 === 2.05)).toBe(false)
  })
})

describe("buildLayoutSheet — kanopi carport (outline + tiang, skip bila tertutup)", () => {
  const carportLayout = layout({
    rooms: [room({ id: "cp", name: "Carport", type: "carport", x: 0, y: 0, width: 3, depth: 5, areaM2: 15 })],
  })

  it("draws the canopy outline at footprint + 0.15 overhang (kind opening)", () => {
    const d = buildLayoutSheet(carportLayout, "f1")
    expect(d.lines).toContainEqual({ x1: -0.15, y1: -0.15, x2: 3.15, y2: -0.15, kind: "opening" })
    expect(d.lines).toContainEqual({ x1: 3.15, y1: -0.15, x2: 3.15, y2: 5.15, kind: "opening" })
    expect(d.lines).toContainEqual({ x1: 3.15, y1: 5.15, x2: -0.15, y2: 5.15, kind: "opening" })
    expect(d.lines).toContainEqual({ x1: -0.15, y1: 5.15, x2: -0.15, y2: -0.15, kind: "opening" })
    expect(d.labels).toContainEqual({ x: 1.5, y: 0.3, text: "KANOPI", kind: "room" })
  })

  it("draws a 0.1 post square (kind cut) at each of the 4 open corners, inset 0.15", () => {
    const d = buildLayoutSheet(carportLayout, "f1")
    expect(d.lines.filter((l) => l.kind === "cut")).toHaveLength(16) // 4 posts x 4 lines
    expect(d.lines).toContainEqual({ x1: 0.1, y1: 0.1, x2: 0.2, y2: 0.1, kind: "cut" })
    expect(d.lines).toContainEqual({ x1: 2.8, y1: 4.8, x2: 2.9, y2: 4.8, kind: "cut" })
  })

  it("skips corners on sides walled by the house (canopy borne by the wall)", () => {
    const d = buildLayoutSheet(
      layout({
        rooms: [
          room({ id: "rm", name: "Kamar Tidur", x: 0, y: 0, width: 3, depth: 3, areaM2: 9 }),
          room({ id: "cp", name: "Carport", type: "carport", x: 0, y: 3, width: 3, depth: 5, areaM2: 15 }),
        ],
      }),
      "f1"
    )
    // n side walled → only the sw/se posts remain (2 posts x 4 lines).
    expect(d.lines.filter((l) => l.kind === "cut")).toHaveLength(8)
    expect(d.lines).toContainEqual({ x1: 0.1, y1: 7.8, x2: 0.2, y2: 7.8, kind: "cut" })
  })

  it("draws NO canopy at all when a floor-above room covers the carport", () => {
    const covered = buildLayoutSheet(
      layout({
        floors: [
          floor({ id: "f1", level: 0, name: "Lantai 1" }),
          floor({ id: "f2", level: 1, name: "Lantai 2" }),
        ],
        rooms: [
          room({ id: "cp", name: "Carport", type: "carport", x: 0, y: 0, width: 3, depth: 5, areaM2: 15 }),
          room({ id: "up", name: "Kamar Atas", floorId: "f2", x: 0, y: 0, width: 3, depth: 5, areaM2: 15 }),
        ],
      }),
      "f1"
    )
    expect(covered.lines.filter((l) => l.kind === "opening")).toHaveLength(0)
    expect(covered.lines.filter((l) => l.kind === "cut")).toHaveLength(0)
    expect(covered.labels.some((l) => l.text === "KANOPI")).toBe(false)
  })

  it("draws NO automatic canopy when carportCanopyMode is none", () => {
    const custom = buildLayoutSheet(
      layout({
        rooms: [
          room({
            id: "cp",
            name: "Carport",
            type: "carport",
            x: 0,
            y: 0,
            width: 3,
            depth: 5,
            areaM2: 15,
            carportCanopyMode: "none",
          }),
        ],
      }),
      "f1",
    )

    expect(custom.lines.filter((l) => l.kind === "opening")).toHaveLength(0)
    expect(custom.lines.filter((l) => l.kind === "cut")).toHaveLength(0)
    expect(custom.labels.some((l) => l.text === "KANOPI")).toBe(false)
  })
})

describe("buildLayoutSheet — exterior site elements", () => {
  it("projects semantic exterior elements with stable refIds and expands drawing bounds", () => {
    const d = buildLayoutSheet(
      layout({
        rooms: [room({ id: "r", name: "Ruang", x: 0, y: 0, width: 3, depth: 3, areaM2: 9 })],
        exteriorElements: [
          {
            id: "gate-1",
            kind: "sliding_gate",
            floorId: "f1",
            label: "Gerbang",
            start: { x: 0, y: 5 },
            end: { x: 4, y: 5 },
            heightM: 1.8,
            structuralRole: "non_structural",
          },
          {
            id: "garden-1",
            kind: "garden_bed",
            floorId: "f1",
            label: "Taman Depan",
            points: [
              { x: 4.5, y: 0 },
              { x: 6, y: 0 },
              { x: 6, y: 2 },
              { x: 4.5, y: 2 },
            ],
            structuralRole: "non_structural",
          },
        ],
      }),
      "f1"
    )

    expect(d.lines).toContainEqual({ x1: 0, y1: 5, x2: 4, y2: 5, kind: "outline", refId: "gate-1" })
    expect(d.lines.filter((line) => line.refId === "garden-1")).toHaveLength(4)
    expect(d.labels).toContainEqual({ x: 2, y: 5, text: "Gerbang", kind: "room", refId: "gate-1" })
    expect(d.labels).toContainEqual({ x: 5.25, y: 1, text: "Taman Depan", kind: "room", refId: "garden-1" })
    expect(d.widthM).toBe(6)
    expect(d.heightM).toBeGreaterThanOrEqual(5)
    expect(d.heightM).toBeLessThan(5.1)
  })
})

describe("buildLayoutSheet — louver band fasad (garis proud 0,15 di sisi luar)", () => {
  it("projects the band segment offset 0.15 OUTWARD from the host wall", () => {
    const d = buildLayoutSheet(
      layout({
        rooms: [room({ id: "k", name: "Kamar Tidur", x: 0, y: 0, width: 3, depth: 2, areaM2: 6 })],
        facadeElements: [
          {
            id: "fe1", wallId: "k:n", floorId: "f1", kind: "louver_band",
            positionM: 1.5, widthM: 2, sillHeightM: 0.5, heightM: 1.2, finish: "kayu",
          },
        ],
      }),
      "f1"
    )
    // openingSegment(k, "n", 1.5, 2) = (0.5,0)–(2.5,0); n outward = -y.
    expect(d.lines).toContainEqual({ x1: 0.5, y1: -0.15, x2: 2.5, y2: -0.15, kind: "opening" })
  })

  it("ignores facadeElements on other floors", () => {
    const d = buildLayoutSheet(
      layout({
        floors: [floor({ id: "f1" }), floor({ id: "f2", level: 1, name: "Lantai 2" })],
        rooms: [room({ id: "k", name: "Kamar Tidur", x: 0, y: 0, width: 3, depth: 2, areaM2: 6 })],
        facadeElements: [
          {
            id: "fe2", wallId: "k:n", floorId: "f2", kind: "louver_band",
            positionM: 1.5, widthM: 2, sillHeightM: 0.5, heightM: 1.2, finish: "kayu",
          },
        ],
      }),
      "f1"
    )
    expect(d.lines.filter((l) => l.kind === "opening")).toHaveLength(0)
  })
})

describe("buildLayoutSheet — penomoran anak tangga", () => {
  it("denah tangga: setiap anak diberi nomor 1..N", () => {
    const l = layout({
      rooms: [
        room({ id: "A", x: 0, y: 0, width: 3, depth: 3, areaM2: 9 }),
        room({
          id: "room-stair",
          name: "Tangga",
          type: "tangga",
          x: 1,
          y: 1,
          width: 2.5,
          depth: 1.0,
          areaM2: 2.5,
          stairDirection: "e",
        }),
      ],
    })
    const d = buildLayoutSheet(l, l.floors[0].id)
    const nums = d.labels.filter((lb) => lb.refId === "room-stair" && /^\d+$/.test(lb.text))
    // steps = max(3, round(3.15/0.18)) tergantung heightM fixture — minimal 3
    expect(nums.length).toBeGreaterThanOrEqual(3)
    expect(nums[0].text).toBe("1")
    expect(nums[nums.length - 1].text).toBe(String(nums.length))
  })
})


describe("buildLayoutSheet — tangga bentuk L", () => {
  it("tread per run, label BORDES, penomoran menerus 1..17", () => {
    const l = layout({
      rooms: [
        room({ id: "A", x: 0, y: 0, width: 5, depth: 5, areaM2: 25 }),
        room({
          id: "room-stair", name: "Tangga", type: "tangga",
          x: 1, y: 1, width: 3, depth: 2.5, areaM2: 7.5,
          stairDirection: "e", stairShape: "L", stairTurn: "kanan",
        }),
      ],
    })
    const d = buildLayoutSheet(l, l.floors[0].id)
    expect(d.labels.some((lb) => lb.refId === "room-stair" && lb.text === "BORDES")).toBe(true)
    const nums = d.labels
      .filter((lb) => lb.refId === "room-stair" && /^\d+$/.test(lb.text))
      .map((lb) => Number(lb.text))
      .sort((a, b) => a - b)
    expect(nums[0]).toBe(1)
    expect(nums[nums.length - 1]).toBe(17) // menerus; rise = heightM fixture 3.0 (D4)
    expect(d.labels.some((lb) => lb.refId === "room-stair" && lb.text === "NAIK")).toBe(true)
  })
})
