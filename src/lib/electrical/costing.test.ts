import { describe, it, expect } from "vitest"
import { computeElectricalCosting, deriveApplianceLoads, exteriorLampWatt, lampUnitPriceIDR } from "./costing"
import { makeLayout } from "@/test-utils/fixtures"
import type { ExteriorLamp, RoomInteriorPlan } from "@/types"

const lamp = (over: Partial<ExteriorLamp> = {}): ExteriorLamp => ({
  id: "l1", kind: "wall", x: 1, y: 1, mountH: 2, floorId: "floor-1", ...over,
})

const interiorPlan = (watt?: number): RoomInteriorPlan[] => [
  {
    roomId: "r1", roomName: "Ruang tamu", roomType: "ruang_tamu", floorId: "floor-1",
    style: "modern_tropical", furniture: [], materials: [],
    lighting: [{ id: "lf1", roomId: "r1", type: "downlight", x: 1, y: 1, heightM: 2.8, colorTemperature: "warm", qty: 4, priceRange: { low: 0, mid: 0, high: 0 }, ...(watt ? { watt } : {}) }],
    colorPalette: { primary: "#fff", secondary: "#fff", accent: "#fff", wood: "#fff", fabric: "#fff", metal: "#fff" },
    warnings: [], budgetEstimate: { lowIDR: 0, midIDR: 0, highIDR: 0, lines: [] },
    score: { clearance: 0, usability: 0, styleMatch: 0, cost: 0, naturalLight: 0, circulation: 0 },
  },
]

describe("computeElectricalCosting", () => {
  it("menghitung beban, rekomendasi VA PLN, biaya titik, dan energi bulanan", () => {
    const layout = makeLayout()
    layout.electrical = [
      { id: "e1", roomId: "r1", type: "stopkontak", x: 1, y: 1 },
      { id: "e2", roomId: "r1", type: "saklar_tunggal", x: 1, y: 2 },
      { id: "e3", roomId: "r2", type: "panel", x: 4, y: 0.5 },
    ]
    const res = computeElectricalCosting(layout, interiorPlan(), [lamp()])

    expect(res.counts.titikLampuInterior).toBe(4)
    expect(res.counts.titikLampuEksterior).toBe(1)
    expect(res.counts.titikStopkontak).toBe(1)
    expect(res.counts.titikSaklar).toBe(1)
    // makeLayout: ruang tamu + dapur → kulkas + rice cooker + TV masuk asumsi
    expect(res.appliances.some((a) => a.id === "kulkas")).toBe(true)
    expect(res.totalVA).toBeGreaterThan(res.totalLampWatt)
    expect(res.recommendedPlnVA).toBeGreaterThanOrEqual(900)
    expect(res.costs.total).toBe(
      res.costs.instalasiTitik + res.costs.kabelConduit + res.costs.panelMcbGrounding + res.costs.unitLampu
    )
    expect(res.monthlyEnergy.kwh).toBeCloseTo(
      res.monthlyEnergy.breakdown.lampuKwh + res.monthlyEnergy.breakdown.peralatanKwh, 1
    )
    expect(res.monthlyEnergy.costIDR).toBeGreaterThan(0)
  })

  it("watt override per fixture mengubah beban & harga unit", () => {
    const layout = makeLayout()
    const low = computeElectricalCosting(layout, interiorPlan(5), [])
    const high = computeElectricalCosting(layout, interiorPlan(25), [])
    expect(high.totalLampWatt).toBe(100) // 4 × 25 W
    expect(low.totalLampWatt).toBe(20)
    expect(high.costs.unitLampu).toBeGreaterThan(low.costs.unitLampu)
  })

  it("helper defaults: exteriorLampWatt per kind, harga unit berjenjang", () => {
    expect(exteriorLampWatt(lamp())).toBe(7)
    expect(exteriorLampWatt(lamp({ kind: "bollard" }))).toBe(5)
    expect(exteriorLampWatt(lamp({ watt: 20 }))).toBe(20)
    expect(lampUnitPriceIDR(5)).toBeLessThan(lampUnitPriceIDR(20))
  })

  it("deriveApplianceLoads: AC mengikuti jumlah kamar, pompa dari titik air", () => {
    const layout = makeLayout()
    layout.rooms.push(
      { id: "k1", floorId: "floor-1", name: "Kamar 1", type: "kamar_tidur", x: 0, y: 4, width: 3, depth: 3, areaM2: 9 },
      { id: "k2", floorId: "floor-1", name: "Kamar 2", type: "kamar_tidur", x: 4, y: 4, width: 3, depth: 3, areaM2: 9 },
    )
    layout.water = [{ id: "w1", roomId: "r2", type: "sink_dapur", x: 4.2, y: 1 }]
    const loads = deriveApplianceLoads(layout)
    expect(loads.find((a) => a.id === "ac")?.qty).toBe(2)
    expect(loads.some((a) => a.id === "pompa-air")).toBe(true)
  })
})

describe("deriveApplianceLoads — opsi spa (KL-7)", () => {
  it("spa dengan jet/heater/chlorinator → tiga beban tambahan", () => {
    const base = makeLayout()
    const layout = {
      ...base,
      rooms: [
        ...base.rooms,
        { ...base.rooms[0], id: "room-spa", name: "Spa", type: "kolam" as const,
          x: 1, y: 1, width: 2, depth: 2, areaM2: 4, poolKind: "spa" as const,
          poolHasJets: true, poolHeater: true, poolSaltChlorinator: true },
      ],
    }
    const loads = deriveApplianceLoads(layout)
    expect(loads.some((l) => l.id === "jet-spa")).toBe(true)
    expect(loads.some((l) => l.id === "heater-kolam")).toBe(true)
    expect(loads.some((l) => l.id === "chlorinator-kolam")).toBe(true)
  })
})
