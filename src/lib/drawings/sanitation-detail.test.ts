import { describe, it, expect } from "vitest"
import {
  buildSepticDetail,
  buildSoakwellDetail,
  buildControlBoxDetail,
} from "./sanitation-detail"
import { sizeControlBoxes } from "@/lib/water/sanitation"
import type { Drawing } from "./types"
import type { DesignLayout, Floor, Room } from "@/types"

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

const DISCLAIMER = "diverifikasi ahli"
// A dim's absolute coordinates shift under normalize(), but its SPAN
// (max − min of the running-axis points) is a real, position-independent
// measurement — the value the sheet actually calls out.
const hasDimSpan = (d: { dims: { points: number[] }[] }, v: number) =>
  d.dims.some((dc) => {
    const span = Math.round((Math.max(...dc.points) - Math.min(...dc.points)) * 100) / 100
    return Math.abs(span - v) < 1e-6
  })
const hasLabel = (d: { labels: { text: string }[] }, sub: string) =>
  d.labels.some((l) => l.text.includes(sub))

/** Regression guard for the clip bug: after normalize() every coordinate the
 *  renderer scales/clips must live inside the declared [0,widthM]×[0,heightM]
 *  box — no line endpoint, label point or dim-chain coord escapes. */
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

describe("buildSepticDetail", () => {
  // 4 bedrooms → occupantsOf = max(4, 4×2) = 8 → W 1.2 · L 2.4 · capacity 4.32.
  const septicLayout = layout({
    rooms: [
      room({ id: "a", type: "kamar_tidur" }),
      room({ id: "b", type: "kamar_tidur" }),
      room({ id: "c", type: "kamar_tidur" }),
      room({ id: "d", type: "kamar_tidur" }),
    ],
  })

  it("reflects the SNI worked example (length 2.4, capacity 4.32, occupants 8)", () => {
    const d = buildSepticDetail(septicLayout, 70.4)
    expect(hasDimSpan(d, 2.4)).toBe(true) // lengthM
    expect(hasLabel(d, "4.32")).toBe(true) // capacity m³
    expect(hasLabel(d, "8")).toBe(true) // occupants
  })

  it("carries the mandatory SNI disclaimer", () => {
    expect(hasLabel(buildSepticDetail(septicLayout, 70.4), DISCLAIMER)).toBe(true)
  })

  it('titles the sheet "Detail Septic Tank"', () => {
    expect(buildSepticDetail(septicLayout, 70.4).title).toBe("Detail Septic Tank")
  })

  it("keeps all geometry inside the declared box (clip guard)", () => {
    assertInBox(buildSepticDetail(septicLayout, 70.4))
  })

  it('anchors the stacked note rows "start" while chamber labels stay centred', () => {
    const d = buildSepticDetail(septicLayout, 70.4)
    expect(d.labels.find((l) => l.text.includes(DISCLAIMER))?.anchor).toBe("start")
    expect(d.labels.find((l) => l.text.includes("penghuni"))?.anchor).toBe("start")
    expect(d.labels.find((l) => l.text.startsWith("Dimensi"))?.anchor).toBe("start")
    expect(d.labels.find((l) => l.text.startsWith("Outlet"))?.anchor).toBe("start")
    // Point-centred labels keep the legacy middle anchor (no override).
    expect(d.labels.find((l) => l.text === "Ruang 1")?.anchor).toBeUndefined()
    expect(d.labels.find((l) => l.text === "Ruang 2")?.anchor).toBeUndefined()
  })
})

describe("buildSoakwellDetail", () => {
  // roofArea 70.4 → Vr 3.52 · D clamp(1.5→1.4) · H 2.
  it("reflects diameter 1.4 and roof-area basis / capacity", () => {
    const d = buildSoakwellDetail(layout({}), 70.4)
    expect(hasDimSpan(d, 1.4)).toBe(true) // diameter
    expect(hasLabel(d, "3.52")).toBe(true) // capacity m³
    expect(hasLabel(d, "70.4")).toBe(true) // roof-area basis
  })

  it("carries the mandatory SNI disclaimer", () => {
    expect(hasLabel(buildSoakwellDetail(layout({}), 70.4), DISCLAIMER)).toBe(true)
  })

  it('titles the sheet "Detail Sumur Resapan"', () => {
    expect(buildSoakwellDetail(layout({}), 70.4).title).toBe("Detail Sumur Resapan")
  })

  it("keeps all geometry inside the declared box (clip guard)", () => {
    assertInBox(buildSoakwellDetail(layout({}), 70.4))
  })

  it('anchors the stacked note rows "start" while fill labels stay centred', () => {
    const d = buildSoakwellDetail(layout({}), 70.4)
    expect(d.labels.find((l) => l.text.includes(DISCLAIMER))?.anchor).toBe("start")
    expect(d.labels.find((l) => l.text.startsWith("Kapasitas"))?.anchor).toBe("start")
    expect(d.labels.find((l) => l.text === "Kerikil")?.anchor).toBeUndefined()
    expect(d.labels.find((l) => l.text === "Ijuk")?.anchor).toBeUndefined()
  })
})

describe("buildControlBoxDetail", () => {
  // 1 wet room (kamar_mandi) + dry rooms → count = wetRoom + 1 = 2.
  const boxLayout = layout({
    rooms: [
      room({ id: "a", type: "kamar_mandi" }),
      room({ id: "b", type: "kamar_tidur" }),
      room({ id: "c", type: "kamar_tidur" }),
    ],
  })

  it("reflects the control-box count (wetRoom + 1)", () => {
    const count = sizeControlBoxes(1).count // 2
    expect(hasLabel(buildControlBoxDetail(boxLayout), String(count))).toBe(true)
  })

  it("carries the mandatory SNI disclaimer", () => {
    expect(hasLabel(buildControlBoxDetail(boxLayout), DISCLAIMER)).toBe(true)
  })

  it('titles the sheet "Detail Bak Kontrol"', () => {
    expect(buildControlBoxDetail(boxLayout).title).toBe("Detail Bak Kontrol")
  })

  it("keeps all geometry inside the declared box (clip guard)", () => {
    assertInBox(buildControlBoxDetail(boxLayout))
  })

  it('anchors the stacked note rows "start" while the channel label stays centred', () => {
    const d = buildControlBoxDetail(boxLayout)
    expect(d.labels.find((l) => l.text.includes(DISCLAIMER))?.anchor).toBe("start")
    expect(d.labels.find((l) => l.text.startsWith("Jumlah bak"))?.anchor).toBe("start")
    expect(d.labels.find((l) => l.text === "Outlet")?.anchor).toBe("start")
    expect(d.labels.find((l) => l.text === "Saluran")?.anchor).toBeUndefined()
  })
})
