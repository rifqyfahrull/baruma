import { describe, it, expect } from "vitest"
import { makeLight, lightPriceFor, fixtureToLight, LIGHT_COLORS } from "./lighting"
import type { Room } from "@/types"

const room: Room = { id: "r1", floorId: "f1", name: "Kamar", type: "kamar_tidur", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 }

describe("lightPriceFor", () => {
  it("scales the per-unit price by qty", () => {
    const one = lightPriceFor("downlight", 1)
    const three = lightPriceFor("downlight", 3)
    expect(three.low).toBe(one.low * 3)
    expect(three.mid).toBe(one.mid * 3)
    expect(three.high).toBe(one.high * 3)
  })
})

describe("makeLight", () => {
  it("creates a centered fixture with type defaults and qty 1", () => {
    const l = makeLight("pendant", room)
    expect(l.id).toMatch(/^light-/)
    expect(l.roomId).toBe("r1")
    expect(l.type).toBe("pendant")
    expect(l.qty).toBe(1)
    expect(l.x).toBeCloseTo(2, 5)   // room.width/2
    expect(l.y).toBeCloseTo(1.5, 5) // room.depth/2
    expect(l.colorTemperature).toBe("warm")
    expect(l.priceRange).toEqual(lightPriceFor("pendant", 1))
    expect(l.heightM).toBeGreaterThan(0)
  })
  it("honors an explicit color temperature", () => {
    expect(makeLight("downlight", room, "cool").colorTemperature).toBe("cool")
  })
})

describe("fixtureToLight", () => {
  it("maps downlight to a downward spot, colored + intensity scaled by qty", () => {
    const f = makeLight("downlight", room, "warm")
    f.qty = 2
    const d = fixtureToLight(f, room)
    expect(d.kind).toBe("spot")
    expect(d.color).toBe(LIGHT_COLORS.warm)
    expect(d.position[0]).toBeCloseTo(2 - room.width / 2, 5)  // centered scene coords
    expect(d.position[2]).toBeCloseTo(1.5 - room.depth / 2, 5)
    expect(d.target?.[1]).toBe(0)
    const single = fixtureToLight({ ...f, qty: 1 }, room)
    expect(d.intensity).toBeGreaterThan(single.intensity)
  })
  it("maps pendant to a point light", () => {
    expect(fixtureToLight(makeLight("pendant", room), room).kind).toBe("point")
  })
})
