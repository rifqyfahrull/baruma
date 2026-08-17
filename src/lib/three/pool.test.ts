import { describe, expect, it } from "vitest"

import { effectivePoolDepthRange } from "./pool"
import { poolCirculation } from "./pool-circulation"
import { poolElectrical } from "./pool-electrical"

describe("effectivePoolDepthRange", () => {
  it("absent → uniform = effectivePoolDepth", () => {
    const r = effectivePoolDepthRange({ poolKind: "renang" })
    expect(r).toEqual({ shallowM: 1.5, deepM: 1.5, avgM: 1.5 })
  })

  it("dangkal/dalam di-clamp ke rentang tipe dan diurutkan", () => {
    const r = effectivePoolDepthRange({ poolKind: "renang", poolShallowM: 3.5, poolDeepM: 1.0 })
    expect(r.shallowM).toBe(1.0)
    expect(r.deepM).toBe(2.5) // 3.5 di-clamp ke max renang 2.5
    expect(r.avgM).toBeCloseTo(1.75, 5)
  })

  it("hanya salah satu terisi → uniform (fallback poolDepthM)", () => {
    const r = effectivePoolDepthRange({ poolKind: "renang", poolShallowM: 1.0, poolDepthM: 2.0 })
    expect(r).toEqual({ shallowM: 2.0, deepM: 2.0, avgM: 2.0 })
  })
})

describe("poolCirculation dengan kedalaman bervariasi", () => {
  it("volume memakai kedalaman rata-rata", () => {
    const c = poolCirculation({
      width: 4, depth: 8, areaM2: 32, poolKind: "renang",
      poolShallowM: 1.0, poolDeepM: 1.6,
    })
    expect(c.avgDepthM).toBeCloseTo(1.3, 5)
    expect(c.volumeM3).toBeCloseTo(41.6, 1)
    expect(c.flowM3h).toBeCloseTo(6.9, 1)
  })

  it("uniform tetap identik dengan perilaku lama", () => {
    const c = poolCirculation({ width: 4, depth: 8, areaM2: 32, poolKind: "renang" })
    expect(c.avgDepthM).toBe(1.5)
    expect(c.volumeM3).toBeCloseTo(48, 1)
  })
})

describe("poolCirculation — sistem overflow (KL-4)", () => {
  const base = { width: 4, depth: 8, areaM2: 32, poolKind: "renang" as const }

  it("skimmer (default) — perilaku lama, tanpa gutter/balancing", () => {
    const c = poolCirculation(base)
    expect(c.circulationType).toBe("skimmer")
    expect(c.gutterM).toBe(0)
    expect(c.balancingTankM3).toBe(0)
    expect(c.skimmers).toBeGreaterThan(0)
  })

  it("overflow — skimmer 0, gutter keliling, balancing tank 7% volume", () => {
    const c = poolCirculation({ ...base, poolCirculationType: "overflow" })
    expect(c.circulationType).toBe("overflow")
    expect(c.skimmers).toBe(0)
    expect(c.gutterM).toBe(24) // 2*(4+8)
    expect(c.balancingTankM3).toBeCloseTo(3.36, 2) // volume 48 * 0.07
  })
})

describe("poolCirculation — filter cartridge spa/plunge (KL-7)", () => {
  it("spa → cartridge", () => {
    const c = poolCirculation({ width: 2, depth: 2, areaM2: 4, poolKind: "spa" })
    expect(c.filterKind).toBe("cartridge")
  })
  it("renang → tetap pasir", () => {
    const c = poolCirculation({ width: 4, depth: 8, areaM2: 32, poolKind: "renang" })
    expect(c.filterKind).toBe("pasir")
  })
})

describe("poolElectrical — beban spa (KL-7)", () => {
  const spa = { width: 2, depth: 2, areaM2: 4, poolKind: "spa" as const }
  it("tanpa opsi → jet/heater/chlorinator 0", () => {
    const e = poolElectrical(spa)
    expect(e.jetBlowerW).toBe(0)
    expect(e.heaterW).toBe(0)
    expect(e.chlorinatorW).toBe(0)
  })
  it("dengan opsi → watt sesuai + totalLoadW termasuk", () => {
    const e = poolElectrical({ ...spa, poolHasJets: true, poolHeater: true, poolSaltChlorinator: true })
    expect(e.jetBlowerW).toBe(1500)
    expect(e.heaterW).toBe(3000)
    expect(e.chlorinatorW).toBe(150)
    expect(e.totalLoadW).toBeGreaterThanOrEqual(1500 + 3000 + 150)
  })
})
