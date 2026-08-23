// @vitest-environment node
import { describe, expect, it } from "vitest"

import type { DesignLayout, Floor, Opening, Room } from "@/types"
import { buildLayoutSheet } from "@/lib/drawings/layout-sheet"
import { buildDxfEntities, buildDxfBlob, buildLayoutDxf, floorDxfOffsets } from "./dxf"

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

// 2 regular floors + 1 rooftop pseudo-floor (must be excluded from the DXF).
const twoFloorLayout = layout({
  floors: [
    floor({ id: "f1", level: 0, name: "Lantai 1", heightM: 3 }),
    floor({ id: "f2", level: 1, name: "Lantai 2", heightM: 3 }),
    floor({ id: "floor-rooftop", level: 2, name: "Rooftop", heightM: 0 }),
  ],
  rooms: [
    room({ id: "A", floorId: "f1", name: "Kamar A", type: "kamar_tidur", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 }),
    room({ id: "B", floorId: "f1", name: "Kamar B", type: "kamar_tidur", x: 4, y: 0, width: 3, depth: 3, areaM2: 9 }),
    room({ id: "C", floorId: "f2", name: "Kamar C", type: "kamar_tidur", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 }),
  ],
  openings: [
    opening({ id: "doorAS", floorId: "f1", wallId: "A:s", type: "door", positionM: 1.8, widthM: 0.9, heightM: 2.1 }),
  ],
})

// count LINE / TEXT entities from a group-code array (each entity starts
// with group code "0" followed by its type name).
function countEntities(entities: string[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (let i = 0; i < entities.length; i += 2) {
    if (entities[i] === "0") {
      const type = entities[i + 1]
      counts[type] = (counts[type] ?? 0) + 1
    }
  }
  return counts
}

describe("buildDxfEntities", () => {
  it("emits one LINE per DrawLine (both floors) plus dim-chain lines, and one TEXT per DrawLabel plus floor titles/dim labels", () => {
    const d1 = buildLayoutSheet(twoFloorLayout, "f1")
    const d2 = buildLayoutSheet(twoFloorLayout, "f2")
    const entities = buildDxfEntities(twoFloorLayout)
    const counts = countEntities(entities)

    // Each DimChain with >=2 points contributes: 1 extension line + N tick
    // lines (one per point) + (N-1) segment-length TEXT labels.
    const dimLineCount = (dims: typeof d1.dims) =>
      dims.reduce((s, d) => (d.points.length < 2 ? s : s + 1 + d.points.length), 0)
    const dimTextCount = (dims: typeof d1.dims) =>
      dims.reduce((s, d) => (d.points.length < 2 ? s : s + (d.points.length - 1)), 0)

    const expectedLines = d1.lines.length + d2.lines.length + dimLineCount(d1.dims) + dimLineCount(d2.dims)
    const expectedTexts = d1.labels.length + d2.labels.length + dimTextCount(d1.dims) + dimTextCount(d2.dims) + 2 // + 2 floor titles

    expect(counts.LINE).toBe(expectedLines)
    expect(counts.TEXT).toBe(expectedTexts)
  })

  it("excludes the rooftop pseudo-floor entirely", () => {
    const entities = buildDxfEntities(twoFloorLayout).join("\n")
    expect(entities).not.toContain("Rooftop")
  })

  it("offsets the second floor's plan along X by the first floor's width + gap (meters, real scale)", () => {
    const offsets = floorDxfOffsets(twoFloorLayout)
    const d1 = buildLayoutSheet(twoFloorLayout, "f1")
    expect(offsets.f1).toBe(0)
    expect(offsets.f2).toBe(d1.widthM + 4)

    // Floor 1's first room outline corner (0,0) stays at x=0; a floor-2 line
    // must appear shifted by exactly the same offset.
    const entities = buildDxfEntities(twoFloorLayout)
    const joined = entities.join("\n")
    expect(joined).toContain(`10\n${offsets.f2.toFixed(3)}`)
  })

  it("puts outline lines on layer OUTLINE and opening lines on layer OPENING", () => {
    const entities = buildDxfEntities(twoFloorLayout)
    // Find at least one LINE entity's layer group (code "8") for each kind
    // by scanning sequential group pairs.
    let sawOutlineLayer = false
    let sawOpeningLayer = false
    for (let i = 0; i < entities.length - 1; i++) {
      if (entities[i] === "8" && entities[i + 1] === "OUTLINE") sawOutlineLayer = true
      if (entities[i] === "8" && entities[i + 1] === "OPENING") sawOpeningLayer = true
    }
    expect(sawOutlineLayer).toBe(true)
    expect(sawOpeningLayer).toBe(true)
  })
})

describe("buildLayoutDxf", () => {
  const dxf = buildLayoutDxf(twoFloorLayout)

  it("is a parseable ASCII DXF: HEADER, TABLES/LAYER, ENTITIES sections and a trailing EOF", () => {
    expect(dxf).toContain("0\nSECTION\n2\nHEADER")
    expect(dxf).toContain("$ACADVER")
    expect(dxf).toContain("AC1009")
    expect(dxf).toContain("0\nSECTION\n2\nTABLES")
    expect(dxf).toContain("0\nTABLE\n2\nLAYER")
    expect(dxf).toContain("0\nENDTAB")
    expect(dxf).toContain("0\nSECTION\n2\nENTITIES")
    expect(dxf.trim().endsWith("0\nEOF")).toBe(true)
    // Sections close in order: every SECTION has a matching ENDSEC before EOF.
    const sectionCount = (dxf.match(/\nSECTION\n/g) ?? []).length
    const endsecCount = (dxf.match(/\nENDSEC\n/g) ?? []).length
    expect(sectionCount).toBe(endsecCount)
    expect(sectionCount).toBe(3) // HEADER, TABLES, ENTITIES
  })

  it("declares $INSUNITS=6 (meters) — coordinates are real-world meters, not sheet mm", () => {
    expect(dxf).toContain("$INSUNITS\n70\n6")
  })

  it("declares every layer used by the writer in the LAYER table", () => {
    for (const layerName of ["OUTLINE", "SLAB", "OPENING", "CUT", "GROUND", "DIMENSIONS", "LABELS"]) {
      expect(dxf).toContain(`2\n${layerName}\n70\n0`)
    }
  })

  it("keeps LINE coordinates in true meters — a 4m-wide room outline shows an 4.000 x-extent, not a sheet-mm-scaled value", () => {
    // Room A is 0..4 x 0..3 (meters) on floor 1 — its top edge is a LINE
    // from (0,0) to (4,0).
    expect(dxf).toContain("10\n0.000\n20\n0.000")
    expect(dxf).toContain("11\n4.000\n21\n0.000")
  })
})

describe("buildDxfBlob", () => {
  it("returns a non-empty Blob with an application/dxf MIME type", () => {
    const blob = buildDxfBlob(twoFloorLayout)
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.size).toBeGreaterThan(0)
    expect(blob.type).toBe("application/dxf")
  })

  it("is byte-identical to buildLayoutDxf's string, UTF-8 encoded", async () => {
    const blob = buildDxfBlob(twoFloorLayout)
    const text = await blob.text()
    expect(text).toBe(buildLayoutDxf(twoFloorLayout))
  })
})
