import { describe, it, expect } from "vitest"

import { poolCirculation, poolFittings } from "@/lib/three/pool-circulation"
import type { Room } from "@/types"

const pool = (over: Partial<Room> = {}): Room => ({
  id: "p", floorId: "floor-1", name: "Kolam", type: "kolam",
  x: 0, y: 0, width: 4, depth: 8, areaM2: 32, poolKind: "renang", poolDepthM: 1.5,
  ...over,
})

describe("poolCirculation", () => {
  it("derives volume/turnover/flow/pump for a 32 m² × 1.5 m renang pool", () => {
    const c = poolCirculation(pool())
    expect(c.volumeM3).toBeCloseTo(48, 5) // 32 × 1.5
    expect(c.turnoverHours).toBe(6)
    expect(c.flowM3h).toBeCloseTo(8, 1) // 48 / 6
    expect(c.pumpHp).toBeGreaterThanOrEqual(0.5)
    expect(c.filterKind).toBe("pasir")
    expect(c.skimmers).toBeGreaterThanOrEqual(1)
    expect(c.returns).toBeGreaterThanOrEqual(2)
    expect(c.mainDrains).toBe(1)
    expect(c.estPipeM).toBeGreaterThan(0)
  })

  it("clamps depth to the kind range (anak shallow) when computing volume", () => {
    const c = poolCirculation(pool({ poolKind: "anak", poolDepthM: 3, areaM2: 10, width: 2, depth: 5 }))
    expect(c.volumeM3).toBeCloseTo(6, 5) // 10 × clamp(3→0.6)
    expect(c.turnoverHours).toBe(4)
  })

  it("adds a second main drain for pools over 40 m² (anti-entrapment)", () => {
    const c = poolCirculation(pool({ areaM2: 50, width: 5, depth: 10 }))
    expect(c.mainDrains).toBe(2)
  })
})

describe("poolFittings", () => {
  it("places skimmers on the top edge, inlets on the bottom, drain mid, equipment outside", () => {
    const c = poolCirculation(pool())
    const f = poolFittings(pool())
    expect(f.filter((x) => x.kind === "skimmer").length).toBe(c.skimmers)
    expect(f.filter((x) => x.kind === "return").length).toBe(c.returns)
    expect(f.filter((x) => x.kind === "drain").length).toBe(c.mainDrains)
    expect(f.filter((x) => x.kind === "equipment").length).toBe(1)
    expect(f.filter((x) => x.kind === "skimmer").every((x) => x.v === 0)).toBe(true)
    expect(f.filter((x) => x.kind === "return").every((x) => x.v === 1)).toBe(true)
    expect(f.find((x) => x.kind === "equipment")!.u).toBeGreaterThan(1)
  })
})
