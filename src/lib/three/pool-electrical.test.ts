import { describe, it, expect } from "vitest"

import { poolElectrical } from "@/lib/three/pool-electrical"
import type { Room } from "@/types"

const pool = (over: Partial<Room> = {}): Room => ({
  id: "p", floorId: "floor-1", name: "Kolam", type: "kolam",
  x: 0, y: 0, width: 4, depth: 8, areaM2: 32, poolKind: "renang", poolDepthM: 1.5,
  ...over,
})

describe("poolElectrical", () => {
  it("derives pump kW, a standard MCB, lights, transformer & bonding", () => {
    const e = poolElectrical(pool())
    expect(e.pumpKw).toBeCloseTo(0.75, 2) // 1.0 HP × 0.746
    expect([6, 10, 16, 20, 25, 32, 40, 50, 63]).toContain(e.pumpBreakerA)
    expect(e.lights).toBeGreaterThanOrEqual(1)
    expect([100, 300, 600, 1000]).toContain(e.transformerVa)
    expect(e.totalLoadW).toBeGreaterThan(e.lightsTotalW)
    expect(e.bondingM).toBeGreaterThan(0)
  })

  it("bigger pool → more lights and an equal-or-bigger transformer", () => {
    const small = poolElectrical(pool({ areaM2: 18, width: 3, depth: 6 }))
    const big = poolElectrical(pool({ areaM2: 72, width: 6, depth: 12 }))
    expect(big.lights).toBeGreaterThan(small.lights)
    expect(big.transformerVa).toBeGreaterThanOrEqual(small.transformerVa)
  })
})
