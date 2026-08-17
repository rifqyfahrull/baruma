// src/lib/drawings/pool-detail.test.ts
import { describe, expect, it } from "vitest"

import { buildPoolDetail } from "./pool-detail"
import { makeLayout } from "@/test-utils/fixtures"
import type { DesignLayout } from "@/types"

function poolLayout(depth = 1.5): DesignLayout {
  const base = makeLayout()
  return {
    ...base,
    rooms: [...base.rooms, { ...base.rooms[0], id: "room-pool", name: "Kolam",
      type: "kolam", x: 1, y: 1, width: 4, depth: 8, areaM2: 32,
      poolKind: "renang", poolDepthM: depth }],
  }
}

describe("buildPoolDetail", () => {
  it("potongan memuat garis tanah, dinding cut, muka air, level ±0.00 dan -kedalaman", () => {
    const d = buildPoolDetail(poolLayout(1.5))
    expect(d.title).toBe("Detail Kolam")
    expect(d.lines.some((l) => l.kind === "ground")).toBe(true)
    expect(d.lines.some((l) => l.kind === "cut" && l.refId === "room-pool")).toBe(true)
    expect(d.levels.some((lv) => lv.y === 0)).toBe(true)
    expect(d.levels.some((lv) => lv.y === -1.5)).toBe(true)
  })

  it("catatan spesifikasi (K-300, waterproofing, finish) tercantum", () => {
    const texts = buildPoolDetail(poolLayout()).labels.map((l) => l.text).join("\n")
    expect(texts).toContain("K-300")
    expect(texts).toContain("Waterproofing")
    expect(texts).toMatch(/Keramik biru|Finishing/)
  })

  it("dim chain kedalaman & lebar ada", () => {
    const d = buildPoolDetail(poolLayout(1.5))
    expect(d.dims.some((dim) => dim.axis === "y" && dim.points.includes(-1.5))).toBe(true)
    expect(d.dims.some((dim) => dim.axis === "x")).toBe(true)
  })
})

describe("buildPoolDetail — kedalaman bervariasi (Gelombang 2)", () => {
  it("kolam dangkal→dalam: dasar miring + dua level", () => {
    const base = makeLayout()
    const l = { ...base, rooms: [...base.rooms, { ...base.rooms[0], id: "room-pool",
      name: "Kolam", type: "kolam" as const, x: 1, y: 1, width: 4, depth: 8, areaM2: 32,
      poolKind: "renang" as const, poolShallowM: 1.2, poolDeepM: 1.8,
      poolEntrySide: "n" as const }] }
    const d = buildPoolDetail(l)
    expect(d.levels.some((lv) => lv.label === "-1.20")).toBe(true)
    expect(d.levels.some((lv) => lv.label === "-1.80")).toBe(true)
    // garis dasar miring: garis cut dengan y1 ≠ y2 (bukan horizontal/vertikal murni)
    expect(d.lines.some((ln) => ln.refId === "room-pool" && ln.kind === "cut"
      && ln.y1 !== ln.y2 && ln.x1 !== ln.x2)).toBe(true)
  })
})
