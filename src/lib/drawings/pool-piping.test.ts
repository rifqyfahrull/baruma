// src/lib/drawings/pool-piping.test.ts
import { describe, expect, it } from "vitest"

import { buildPoolPiping } from "./pool-piping"
import { poolCirculation } from "@/lib/three/pool-circulation"
import { makeLayout } from "@/test-utils/fixtures"
import type { DesignLayout } from "@/types"

function poolLayout(): DesignLayout {
  const base = makeLayout()
  return {
    ...base,
    rooms: [
      ...base.rooms,
      { ...base.rooms[0], id: "room-pool", name: "Kolam", type: "kolam",
        x: 1, y: 1, width: 4, depth: 8, areaM2: 32, poolKind: "renang" },
    ],
  }
}

describe("buildPoolPiping", () => {
  it("menggambar outline kolam + fitting + jalur hisap/balik ber-refId", () => {
    const d = buildPoolPiping(poolLayout())
    const c = poolCirculation({ width: 4, depth: 8, areaM2: 32, poolKind: "renang" })
    expect(d.title).toBe("Denah Pipa Kolam")
    const poolLines = d.lines.filter((l) => l.refId === "room-pool")
    expect(poolLines.some((l) => l.kind === "cut")).toBe(true)     // pipa hisap
    expect(poolLines.some((l) => l.kind === "opening")).toBe(true) // pipa balik
    // label fitting: 1 per skimmer/inlet/drain + equipment
    const fittingLabels = d.labels.filter((lb) => lb.refId === "room-pool" &&
      ["Skimmer", "Inlet", "Main drain", "Pompa & filter"].includes(lb.text))
    expect(fittingLabels.length).toBe(c.skimmers + c.returns + c.mainDrains + 1)
  })

  it("skedul MEP memuat angka pompa/filter/pipa/MCB persis dari kalkulasi", () => {
    const d = buildPoolPiping(poolLayout())
    const c = poolCirculation({ width: 4, depth: 8, areaM2: 32, poolKind: "renang" })
    const texts = d.labels.map((l) => l.text).join("\n")
    expect(texts).toContain(`Pompa ${c.pumpHp} HP`)
    expect(texts).toContain(`Filter pasir Ø${c.filterDiaInch}"`)
    expect(texts).toContain(`Hisap Ø${c.suctionPipeMm} / balik Ø${c.returnPipeMm} mm`)
    expect(texts).toContain(`Turnover ${c.turnoverHours} jam`)
  })

  it("tanpa kolam → drawing kosong berjudul benar (tidak crash)", () => {
    const d = buildPoolPiping(makeLayout())
    expect(d.lines).toHaveLength(0)
  })
})

describe("buildPoolPiping — sistem overflow (KL-4)", () => {
  it("skedul memuat gutter + balancing tank, tanpa skimmer", () => {
    const base = poolLayout()
    base.rooms = base.rooms.map((r) =>
      r.id === "room-pool" ? { ...r, poolCirculationType: "overflow" as const } : r)
    const d = buildPoolPiping(base)
    const texts = d.labels.map((l) => l.text).join("\n")
    expect(texts).toContain("Balancing tank")
    expect(texts).toContain("Gutter keliling")
    expect(texts).not.toContain("Skimmer")
  })
})
