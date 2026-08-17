import { describe, it, expect } from "vitest"
import { buildRiserDiagram } from "./riser-diagram"
import type { Drawing } from "./types"
import type { DesignLayout, Floor, Room, WaterPoint } from "@/types"

/** Regression guard for the clip bug: every coordinate the renderer scales/clips
 *  must live inside the declared [0,widthM]×[0,heightM] box. The waste/soil
 *  stacks used to drop to y≈−0.9 (cropped); normalize() shifts them positive. */
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
    inX(l.x1)
    inX(l.x2)
    inY(l.y1)
    inY(l.y2)
  }
  for (const lb of d.labels) {
    inX(lb.x)
    inY(lb.y)
  }
  for (const dc of d.dims) {
    if (dc.axis === "x") {
      inY(dc.at)
      for (const p of dc.points) inX(p)
    } else {
      inX(dc.at)
      for (const p of dc.points) inY(p)
    }
  }
  for (const lv of d.levels) inY(lv.y)
}

const floor = (over: Partial<Floor>): Floor => ({
  id: "f1", level: 0, name: "Lantai 1", heightM: 3, ...over,
})
const room = (over: Partial<Room>): Room => ({
  id: "r", floorId: "f1", name: "R", type: "kamar_mandi",
  x: 0, y: 0, width: 3, depth: 3, areaM2: 9, ...over,
})
const layout = (over: Partial<DesignLayout>): DesignLayout => ({
  id: "l", projectId: "p", versionId: "v",
  floors: [floor({})], rooms: [], walls: [], openings: [], stairs: [], pools: [],
  validation: { passed: true, issues: [] },
  ...over,
})

/**
 * Two-floor scene: f1 (ground) with a bathroom (kloset→limbah, kran→bersih);
 * f2 (upper) with a kitchen (floor_drain + wastafel → both kotor).
 */
function scene(): DesignLayout {
  return layout({
    floors: [
      floor({ id: "f1", level: 0, name: "Lantai 1" }),
      floor({ id: "f2", level: 1, name: "Lantai 2", heightM: 3 }),
    ],
    rooms: [
      room({ id: "r1", floorId: "f1", type: "kamar_mandi" }),
      room({ id: "r2", floorId: "f2", type: "dapur", y: 4 }),
    ],
    water: [
      { id: "w1", roomId: "r1", type: "kloset", x: 0.3, y: 0.3 },
      { id: "w2", roomId: "r1", type: "kran", x: 0.6, y: 0.3 },
      { id: "w3", roomId: "r2", type: "floor_drain", x: 0.3, y: 4.3 },
      { id: "w4", roomId: "r2", type: "wastafel", x: 0.6, y: 4.3 },
    ] as WaterPoint[],
  })
}

describe("buildRiserDiagram", () => {
  it("draws at least one floor line per floor", () => {
    const d = buildRiserDiagram(scene())
    const floorLines = d.lines.filter((l) => l.kind === "slab" && l.y1 === l.y2)
    expect(floorLines.length).toBeGreaterThanOrEqual(2)
  })

  it("labels a vent stack", () => {
    const d = buildRiserDiagram(scene())
    expect(d.labels.some((l) => l.text.toLowerCase().includes("vent"))).toBe(true)
  })

  it("labels pipe diameters for the three systems", () => {
    const d = buildRiserDiagram(scene())
    const text = d.labels.map((l) => l.text).join(" | ")
    expect(text).toMatch(/¾"/) // bersih
    expect(text).toMatch(/2"/) // kotor / vent
    expect(text).toMatch(/4"/) // limbah
  })

  it("aggregates fixtures per floor into branch count labels", () => {
    const d = buildRiserDiagram(scene())
    // f2 has two kotor fixtures (floor_drain + wastafel) → a "2 titik" branch.
    expect(d.labels.some((l) => l.text.includes("2 titik"))).toBe(true)
  })

  it("anchors floor names start; count labels hug their stub side (bersih end, kotor/limbah start)", () => {
    const d = buildRiserDiagram(scene())
    expect(d.labels.find((l) => l.text === "Lantai 1")?.anchor).toBe("start")
    expect(d.labels.find((l) => l.text === "Lantai 2")?.anchor).toBe("start")
    // f2 kotor branch points RIGHT → text starts at the stub tip.
    expect(d.labels.find((l) => l.text === "2 titik")?.anchor).toBe("start")
    // f1 bersih branch (kran) points LEFT → text ENDS at the stub tip.
    expect(d.labels.some((l) => l.text === "1 titik" && l.anchor === "end")).toBe(true)
  })

  it('titles the sheet "Diagram Riser"', () => {
    expect(buildRiserDiagram(scene()).title).toBe("Diagram Riser")
  })

  it("still renders floor lines with no water (defensive)", () => {
    const d = buildRiserDiagram(
      layout({
        floors: [
          floor({ id: "f1", level: 0, name: "Lantai 1" }),
          floor({ id: "f2", level: 1, name: "Lantai 2" }),
        ],
        rooms: [room({ id: "r1", floorId: "f1" })],
        water: undefined,
      }),
    )
    const floorLines = d.lines.filter((l) => l.kind === "slab" && l.y1 === l.y2)
    expect(floorLines.length).toBeGreaterThanOrEqual(2)
    expect(Number.isFinite(d.widthM)).toBe(true)
    expect(Number.isFinite(d.heightM)).toBe(true)
  })

  it("keeps all geometry inside the declared box, incl. the dropped waste/soil stacks (clip guard)", () => {
    const d = buildRiserDiagram(scene())
    // Before normalize the waste/soil stacks dropped to y≈−0.9 and got cropped.
    expect(d.lines.some((l) => l.y1 < 0 || l.y2 < 0)).toBe(false)
    assertInBox(d)
  })
})
