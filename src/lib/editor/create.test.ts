import { describe, it, expect } from "vitest"
import { makeRoom, makeFloor, defaultRoomSize } from "./create"

const site = { widthM: 10, depthM: 12 }

describe("defaultRoomSize", () => {
  it("matches makeRoom's own sizing (single source of truth for both)", () => {
    const size = defaultRoomSize("kamar_tidur")
    expect(size.width).toBeCloseTo(3.5, 5)
    expect(size.depth).toBeCloseTo(3.5, 5)

    const r = makeRoom("kamar_tidur", 0, 0, "f1", site)
    expect(r.width).toBeCloseTo(size.width, 5)
    expect(r.depth).toBeCloseTo(size.depth, 5)
  })

  it("floors at MIN_ROOM for very small catalog areas", () => {
    // kamar_mandi defaultAreaM2 = 4 -> sqrt=2 -> already >= MIN_ROOM (1.2)
    const size = defaultRoomSize("kamar_mandi")
    expect(size.width).toBeGreaterThanOrEqual(1.2)
    expect(size.depth).toBeGreaterThanOrEqual(1.2)
  })
})

describe("makeRoom", () => {
  it("derives a square-ish default size from the type and clamps into the lot", () => {
    const r = makeRoom("kamar_tidur", 2, 2, "f1", site) // defaultAreaM2 = 12
    expect(r.floorId).toBe("f1")
    expect(r.type).toBe("kamar_tidur")
    expect(r.name).toBe("Kamar tidur")
    expect(r.width).toBeCloseTo(3.5, 5) // round(sqrt(12)*2)/2
    expect(r.depth).toBeCloseTo(3.5, 5)
    expect(r.areaM2).toBeCloseTo(12.25, 5)
    expect(r.id).toMatch(/^room-/)
  })
  it("clamps position so the room stays inside the lot", () => {
    const r = makeRoom("ruang_tamu", 100, 100, "f1", site)
    expect(r.x + r.width).toBeLessThanOrEqual(site.widthM + 1e-6)
    expect(r.y + r.depth).toBeLessThanOrEqual(site.depthM + 1e-6)
  })
  it("applies the snap fn to position", () => {
    const r = makeRoom("dapur", 1.2, 1.2, "f1", site, (v) => Math.round(v))
    expect(r.x).toBe(1)
    expect(r.y).toBe(1)
  })
})

describe("makeFloor", () => {
  it("assigns the next level and a derived name", () => {
    const f = makeFloor([
      { id: "a", level: 1, name: "Lantai 1", heightM: 3 },
      { id: "b", level: 2, name: "Lantai 2", heightM: 3.2 },
    ])
    expect(f.level).toBe(3)
    expect(f.name).toBe("Lantai 3")
    expect(f.heightM).toBe(3.2) // copied from the highest-level regular floor
    expect(f.id).toMatch(/^floor-/)
  })

  it("uses the regular floor's heightM, not the rooftop's", () => {
    const f = makeFloor([
      { id: "f1", level: 1, name: "Lantai 1", heightM: 3 },
      { id: "floor-rooftop", level: 2, name: "Atap", heightM: 5 },
    ])
    expect(f.heightM).toBe(3)
  })
})
