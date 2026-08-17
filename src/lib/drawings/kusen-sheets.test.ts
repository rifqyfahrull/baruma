import { describe, it, expect } from "vitest"
import { buildKusenScheduleDrawing, buildKusenDetails } from "./kusen-sheets"
import type { DesignLayout, Floor, Opening } from "@/types"

const floor = (over: Partial<Floor>): Floor => ({
  id: "f1", level: 0, name: "Lantai 1", heightM: 3, ...over,
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

// Fixture T1 (same shape as kusen.test.ts's baseLayout): 2 floors, 4 kusen
// types after grouping: P1 (0.9x2.1 door, count 3, perFloor f1:2/f2:1),
// P2 (0.8x2.1 door, count 1, perFloor f1:1), J1 (1.2x1.2 window, count 2,
// perFloor f1:1/f2:1), J2 (0.6x0.6 window, count 1, perFloor f2:1).
const t1Layout = layout({
  floors: [
    floor({ id: "f1", level: 0, name: "Lantai 1", heightM: 3 }),
    floor({ id: "f2", level: 1, name: "Lantai 2", heightM: 3 }),
  ],
  openings: [
    opening({ id: "d1", floorId: "f1", wallId: "A:s", type: "door", widthM: 0.9, heightM: 2.1 }),
    opening({ id: "d2", floorId: "f1", wallId: "B:s", type: "door", widthM: 0.9, heightM: 2.1 }),
    opening({ id: "d3", floorId: "f1", wallId: "C:s", type: "door", widthM: 0.8, heightM: 2.1 }),
    opening({ id: "w1", floorId: "f1", wallId: "D:s", type: "window", widthM: 1.2, heightM: 1.2 }),
    opening({ id: "d4", floorId: "f2", wallId: "E:s", type: "door", widthM: 0.9, heightM: 2.1 }),
    opening({ id: "w2", floorId: "f2", wallId: "F:s", type: "window", widthM: 1.2, heightM: 1.2 }),
    opening({ id: "w3", floorId: "f2", wallId: "G:s", type: "window", widthM: 0.6, heightM: 0.6 }),
  ],
})

// Fixture with 7 distinct kusen types (4 doors + 3 windows), for the
// detail-sheet paging case (6 panels max per sheet -> 2 sheets).
const sevenTypeLayout = layout({
  floors: [floor({ id: "f1", level: 0, name: "Lantai 1", heightM: 3 })],
  openings: [
    opening({ id: "d1", floorId: "f1", wallId: "A:s", type: "door", widthM: 1.1, heightM: 2.1 }),
    opening({ id: "d2", floorId: "f1", wallId: "B:s", type: "door", widthM: 0.9, heightM: 2.1 }),
    opening({ id: "d3", floorId: "f1", wallId: "C:s", type: "door", widthM: 0.8, heightM: 2.1 }),
    opening({ id: "d4", floorId: "f1", wallId: "D:s", type: "door", widthM: 0.7, heightM: 2.1 }),
    opening({ id: "w1", floorId: "f1", wallId: "E:s", type: "window", widthM: 1.5, heightM: 1.5 }),
    opening({ id: "w2", floorId: "f1", wallId: "F:s", type: "window", widthM: 1.2, heightM: 1.2 }),
    opening({ id: "w3", floorId: "f1", wallId: "G:s", type: "window", widthM: 0.6, heightM: 0.6 }),
  ],
})

describe("buildKusenScheduleDrawing — sheet extents + title", () => {
  it('titles the sheet "Daftar Kusen"', () => {
    expect(buildKusenScheduleDrawing(t1Layout).title).toBe("Daftar Kusen")
  })

  it("sizes the table to 10 m wide, (rows+1)*0.6 m tall — 4 rows -> 3 m", () => {
    const d = buildKusenScheduleDrawing(t1Layout)
    expect(d.widthM).toBe(10)
    expect(d.heightM).toBe(3)
  })

  it("has no dim chains or level marks — it's a table, not a floor/elevation", () => {
    const d = buildKusenScheduleDrawing(t1Layout)
    expect(d.dims).toEqual([])
    expect(d.levels).toEqual([])
  })
})

describe("buildKusenScheduleDrawing — grid line counts", () => {
  const d = buildKusenScheduleDrawing(t1Layout)

  it("draws (rows+2) horizontal outline lines — 4 types -> 6", () => {
    const horizontals = d.lines.filter((l) => l.kind === "outline" && l.y1 === l.y2)
    expect(horizontals).toHaveLength(6)
  })

  it("draws 7 vertical outline lines (6 columns)", () => {
    const verticals = d.lines.filter((l) => l.kind === "outline" && l.x1 === l.x2)
    expect(verticals).toHaveLength(7)
  })

  it("every grid line is kind:outline (no stray kinds)", () => {
    expect(d.lines.every((l) => l.kind === "outline")).toBe(true)
    expect(d.lines).toHaveLength(13)
  })
})

describe("buildKusenScheduleDrawing — header row", () => {
  it("emits 6 kind:title labels: Kode/Jenis/Lebar/Tinggi/Jumlah/Per Lantai, centered in the top row", () => {
    const d = buildKusenScheduleDrawing(t1Layout)
    const header = d.labels.filter((l) => l.kind === "title")
    expect(header).toHaveLength(6)
    expect(header.map((l) => l.text)).toEqual([
      "Kode", "Jenis", "Lebar", "Tinggi", "Jumlah", "Per Lantai",
    ])
    expect(header.every((l) => l.y === 2.7)).toBe(true)
    expect(header.map((l) => l.x)).toEqual([0.5, 1.8, 3.4, 5, 6.3, 8.4])
  })
})

describe("buildKusenScheduleDrawing — data rows", () => {
  const d = buildKusenScheduleDrawing(t1Layout)
  const rows = d.labels.filter((l) => l.kind === "room")

  it("emits 6 kind:room cell labels per KusenType (4 types -> 24)", () => {
    expect(rows).toHaveLength(24)
  })

  it("P1 row: code/jenis/lebar/tinggi/jumlah/per-lantai, using formatLength(_, mm) for dims", () => {
    const p1Row = rows.filter((l) => l.y === 2.1)
    expect(p1Row.map((l) => l.text)).toEqual([
      "P1", "Pintu", "900 mm", "2100 mm", "3", "Lantai 1: 2, Lantai 2: 1",
    ])
    expect(p1Row.map((l) => l.x)).toEqual([0.5, 1.8, 3.4, 5, 6.3, 8.4])
  })

  it("P2 row: single-floor per-lantai text (only nonzero floors)", () => {
    const p2Row = rows.filter((l) => l.y === 1.5)
    expect(p2Row.map((l) => l.text)).toEqual([
      "P2", "Pintu", "800 mm", "2100 mm", "1", "Lantai 1: 1",
    ])
  })

  it("J1 row: window jenis label + two-floor per-lantai text", () => {
    const j1Row = rows.filter((l) => l.y === 0.9)
    expect(j1Row.map((l) => l.text)).toEqual([
      "J1", "Jendela", "1200 mm", "1200 mm", "2", "Lantai 1: 1, Lantai 2: 1",
    ])
  })

  it("J2 row: only appears on Lantai 2", () => {
    const j2Row = rows.filter((l) => l.y === 0.3)
    expect(j2Row.map((l) => l.text)).toEqual([
      "J2", "Jendela", "600 mm", "600 mm", "1", "Lantai 2: 1",
    ])
  })
})

describe("buildKusenDetails — single-sheet case (4 types)", () => {
  const sheets = buildKusenDetails(t1Layout)

  it("produces exactly 1 Drawing", () => {
    expect(sheets).toHaveLength(1)
  })

  it('titles the lone sheet "Detail Kusen" (no pagination suffix)', () => {
    expect(sheets[0].title).toBe("Detail Kusen")
  })

  it("sizes the sheet from the shared cell size (maxW=1.2,maxH=2.1 + 0.6 margin -> 1.8x2.7/cell), 3x2 grid but only 2 rows used", () => {
    // 4 panels -> 3 cols used (row 0 full), 2 rows used.
    expect(sheets[0].widthM).toBe(5.4) // 3 * 1.8
    expect(sheets[0].heightM).toBe(5.4) // 2 * 2.7
  })

  it("emits exactly 4 code+size labels, one per panel, formatted 'CODE — W × H m'", () => {
    const codeLabels = sheets[0].labels.filter((l) => l.text.includes(" — "))
    expect(codeLabels.map((l) => l.text).sort()).toEqual([
      "J1 — 1,2 × 1,2 m",
      "J2 — 0,6 × 0,6 m",
      "P1 — 0,9 × 2,1 m",
      "P2 — 0,8 × 2,1 m",
    ])
  })
})

describe("buildKusenDetails — P1 panel geometry (door, origin (0,2.7))", () => {
  const d = buildKusenDetails(t1Layout)[0]
  const inPanel = (x0: number, y0: number, x1: number, y1: number, kind: string) =>
    d.lines.filter(
      (l) => l.kind === kind && Math.min(l.x1, l.x2) >= x0 - 0.01 && Math.max(l.x1, l.x2) <= x1 + 0.01 &&
        Math.min(l.y1, l.y2) >= y0 - 0.01 && Math.max(l.y1, l.y2) <= y1 + 0.01
    )

  it("draws a double-rect frame: 4 outer + 4 inner (inset 0.05) outline lines", () => {
    const outline = inPanel(0, 2.7, 0.9, 4.8, "outline")
    expect(outline).toHaveLength(8)
    expect(outline).toContainEqual({ x1: 0, y1: 2.7, x2: 0.9, y2: 2.7, kind: "outline" })
    expect(outline).toContainEqual({ x1: 0.9, y1: 2.7, x2: 0.9, y2: 4.8, kind: "outline" })
    expect(outline).toContainEqual({ x1: 0.9, y1: 4.8, x2: 0, y2: 4.8, kind: "outline" })
    expect(outline).toContainEqual({ x1: 0, y1: 4.8, x2: 0, y2: 2.7, kind: "outline" })
    expect(outline).toContainEqual({ x1: 0.05, y1: 2.75, x2: 0.85, y2: 2.75, kind: "outline" })
    expect(outline).toContainEqual({ x1: 0.85, y1: 2.75, x2: 0.85, y2: 4.75, kind: "outline" })
    expect(outline).toContainEqual({ x1: 0.85, y1: 4.75, x2: 0.05, y2: 4.75, kind: "outline" })
    expect(outline).toContainEqual({ x1: 0.05, y1: 4.75, x2: 0.05, y2: 2.75, kind: "outline" })
  })

  it("draws a leaf diagonal + 8-segment swing arc (9 opening lines) from the hinge corner (0.05,2.75)", () => {
    const opening = inPanel(0, 2.7, 0.95, 3.65, "opening")
    expect(opening).toHaveLength(9)
    // The leaf diagonal is the one line starting exactly at the hinge whose
    // far end is NOT itself the hinge-radius start/end point.
    expect(opening[0]).toEqual({ x1: 0.05, y1: 2.75, x2: 0.69, y2: 3.39, kind: "opening" })
  })

  it("the swing arc sweeps a quarter circle of radius min(w,h)=0.9 from (0.95,2.75) to (0.05,3.65)", () => {
    const opening = d.lines.filter(
      (l) => l.kind === "opening" && l.x1 >= -0.01 && l.x2 <= 1 && l.y1 >= 2.7 - 0.01 && l.y2 <= 4.8
    )
    const arc = opening.slice(1) // drop the leaf diagonal
    expect(arc).toHaveLength(8)
    expect(arc[0]).toEqual({ x1: 0.95, y1: 2.75, x2: 0.93, y2: 2.93, kind: "opening" })
    expect(arc[arc.length - 1]).toEqual({ x1: 0.23, y1: 3.63, x2: 0.05, y2: 3.65, kind: "opening" })
    // Contiguous polyline: each segment's end is the next segment's start.
    for (let i = 0; i < arc.length - 1; i++) {
      expect(arc[i].x2).toBe(arc[i + 1].x1)
      expect(arc[i].y2).toBe(arc[i + 1].y1)
    }
    // Every arc point sits at (approximately) the swing radius from the hinge.
    const hx = 0.05
    const hy = 2.75
    for (const seg of arc) {
      expect(Math.hypot(seg.x1 - hx, seg.y1 - hy)).toBeCloseTo(0.9, 1)
      expect(Math.hypot(seg.x2 - hx, seg.y2 - hy)).toBeCloseTo(0.9, 1)
    }
  })

  it("emits width (below) and height (beside) dim chains for the panel", () => {
    expect(d.dims).toContainEqual({ axis: "x", at: 2.35, points: [0, 0.9] })
    expect(d.dims).toContainEqual({ axis: "y", at: 1.25, points: [2.7, 4.8] })
  })

  it("no sill line/label for a door panel", () => {
    expect(d.lines.some((l) => l.kind === "slab" && l.y1 === 2.7 && l.x2 === 0.9)).toBe(false)
    expect(d.labels.some((l) => l.text === "sill 900" && l.x === 0.45)).toBe(false)
  })
})

describe("buildKusenDetails — J1 panel geometry (window, origin (3.6,2.7))", () => {
  const d = buildKusenDetails(t1Layout)[0]

  it("draws an X (2 diagonals, kind:opening)", () => {
    const opening = d.lines.filter(
      (l) => l.kind === "opening" && Math.min(l.x1, l.x2) >= 3.59 && Math.max(l.x1, l.x2) <= 4.81
    )
    expect(opening).toHaveLength(2)
    expect(opening).toContainEqual({ x1: 3.6, y1: 2.7, x2: 4.8, y2: 3.9, kind: "opening" })
    expect(opening).toContainEqual({ x1: 4.8, y1: 2.7, x2: 3.6, y2: 3.9, kind: "opening" })
  })

  it('draws a sill line (kind:slab) at the panel base + a "sill 900" label', () => {
    expect(d.lines).toContainEqual({ x1: 3.6, y1: 2.7, x2: 4.8, y2: 2.7, kind: "slab" })
    expect(d.labels).toContainEqual({ x: 4.2, y: 2.55, text: "sill 900", kind: "room" })
  })

  it("labels the panel \"J1 — 1,2 × 1,2 m\" above the frame", () => {
    expect(d.labels).toContainEqual({ x: 4.2, y: 4.1, text: "J1 — 1,2 × 1,2 m", kind: "room" })
  })

  it("emits width/height dim chains", () => {
    expect(d.dims).toContainEqual({ axis: "x", at: 2.35, points: [3.6, 4.8] })
    expect(d.dims).toContainEqual({ axis: "y", at: 5.15, points: [2.7, 3.9] })
  })
})

describe("buildKusenDetails — J2 panel (window, smallest, origin (0,0) row 1)", () => {
  const d = buildKusenDetails(t1Layout)[0]

  it("sits in the second grid row at the sheet's origin", () => {
    const outline = d.lines.filter(
      (l) => l.kind === "outline" && Math.max(l.x1, l.x2) <= 0.61 && Math.max(l.y1, l.y2) <= 0.61
    )
    expect(outline).toContainEqual({ x1: 0, y1: 0, x2: 0.6, y2: 0, kind: "outline" })
    expect(outline).toContainEqual({ x1: 0.6, y1: 0, x2: 0.6, y2: 0.6, kind: "outline" })
  })

  it('labels "J2 — 0,6 × 0,6 m" and "sill 900"', () => {
    expect(d.labels).toContainEqual({ x: 0.3, y: 0.8, text: "J2 — 0,6 × 0,6 m", kind: "room" })
    expect(d.labels).toContainEqual({ x: 0.3, y: -0.15, text: "sill 900", kind: "room" })
  })
})

describe("buildKusenDetails — paging (7 types -> 2 sheets of 6 + 1)", () => {
  const sheets = buildKusenDetails(sevenTypeLayout)

  it("produces exactly 2 Drawings", () => {
    expect(sheets).toHaveLength(2)
  })

  it('titles them "Detail Kusen (1/2)" and "Detail Kusen (2/2)"', () => {
    expect(sheets[0].title).toBe("Detail Kusen (1/2)")
    expect(sheets[1].title).toBe("Detail Kusen (2/2)")
  })

  it("sheet 1 holds 6 panels (P1..P4, J1, J2); sheet 2 holds the remaining 1 (J3)", () => {
    const codesOf = (d: (typeof sheets)[number]) =>
      d.labels.filter((l) => l.text.includes(" — ")).map((l) => l.text[0] + l.text[1])
    expect(codesOf(sheets[0]).sort()).toEqual(["J1", "J2", "P1", "P2", "P3", "P4"])
    expect(codesOf(sheets[1])).toEqual(["J3"])
  })

  it("sizes each sheet from the SAME global cell size (max across all 7 types: 1.5x2.1 + 0.6 margin -> 2.1x2.7/cell)", () => {
    expect(sheets[0].widthM).toBe(6.3) // 3 cols used * 2.1
    expect(sheets[0].heightM).toBe(5.4) // 2 rows used * 2.7
    expect(sheets[1].widthM).toBe(2.1) // 1 col used * 2.1
    expect(sheets[1].heightM).toBe(2.7) // 1 row used * 2.7
  })

  it("sheet 2's lone panel (J3, 0.6x0.6) sits at the sheet's own origin", () => {
    expect(sheets[1].labels).toContainEqual({ x: 0.3, y: 0.8, text: "J3 — 0,6 × 0,6 m", kind: "room" })
  })
})
