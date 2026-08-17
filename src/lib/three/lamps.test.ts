import { describe, it, expect } from "vitest"
import { lampPlacements } from "./lamps"
import { makeLayout } from "@/test-utils/fixtures"
import type { Room } from "@/types"

describe("lampPlacements — lampu eksterior", () => {
  it("wall lamp beside an EXTERIOR ground-floor door only", () => {
    const layout = makeLayout()
    // pintu di dinding barat r1 (x=0.5 — bukan tepi footprint r1+r2? footprint x0=0.5)
    layout.openings = [
      { id: "op-out", type: "door", wallId: "r1:w", widthM: 0.9, heightM: 2.1, positionM: 1.0, floorId: "floor-1" },
      { id: "op-in", type: "door", wallId: "r1:e", widthM: 0.9, heightM: 2.1, positionM: 1.0, floorId: "floor-1" },
    ]
    const lamps = lampPlacements(layout)
    expect(lamps.some((l) => l.id === "lamp-door-op-out" && l.kind === "wall" && l.side === "w")).toBe(true)
    // r1:e = dinding interior (x=3.5, di dalam footprint 0.5..7) → tanpa lampu
    expect(lamps.some((l) => l.id === "lamp-door-op-in")).toBe(false)
  })

  it("carport gets a canopy downlight, taman gets two bollards", () => {
    const layout = makeLayout()
    const extra: Room[] = [
      { id: "cp", floorId: "floor-1", name: "Carport", type: "carport", x: 0.5, y: 4, width: 3, depth: 3, areaM2: 9 },
      { id: "tm", floorId: "floor-1", name: "Taman", type: "taman", x: 4, y: 4, width: 3, depth: 3, areaM2: 9 },
    ]
    layout.rooms.push(...extra)
    const lamps = lampPlacements(layout)
    const canopy = lamps.find((l) => l.id === "lamp-cp-cp")
    expect(canopy?.kind).toBe("canopy")
    expect(canopy?.mountH).toBeCloseTo(2.44, 2)
    expect(lamps.filter((l) => l.kind === "bollard" && l.id.startsWith("lamp-tm-tm"))).toHaveLength(2)
  })
})
