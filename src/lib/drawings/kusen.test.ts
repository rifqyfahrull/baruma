import { describe, it, expect } from "vitest"
import { kusenSchedule, kusenCodeByOpeningId, kusenPrice } from "./kusen"
import type { DesignLayout, Floor, Opening } from "@/types"

const floor = (over: Partial<Floor>): Floor => ({
  id: "f1", level: 0, name: "Lantai 1", heightM: 3, ...over,
})
const opening = (over: Partial<Opening>): Opening => ({
  id: "o", floorId: "f1", wallId: "r:s", type: "window", positionM: 1, widthM: 1, heightM: 1, ...over,
})
const layout = (over: Partial<DesignLayout>): DesignLayout => ({
  id: "l", projectId: "p", versionId: "v",
  floors: [floor({})], rooms: [], walls: [], openings: [], stairs: [], pools: [],
  validation: { passed: true, issues: [] },
  ...over,
})

// Fixture: 2 floors.
// f1: 2x pintu 0.9x2.1, 1x pintu 0.8x2.1, 1x jendela 1.2x1.2
// f2: 1x pintu 0.9x2.1, 1x jendela 1.2x1.2, 1x jendela 0.6x0.6
const baseLayout = layout({
  floors: [
    floor({ id: "f1", level: 0, name: "Lantai 1", heightM: 3 }),
    floor({ id: "f2", level: 1, name: "Lantai 2", heightM: 3 }),
  ],
  openings: [
    opening({ id: "d1", floorId: "f1", wallId: "A:s", type: "door", widthM: 0.9, heightM: 2.1 }),
    opening({ id: "d2", floorId: "f1", wallId: "B:s", type: "door", widthM: 0.9, heightM: 2.1 }),
    opening({ id: "d3", floorId: "f1", wallId: "C:s", type: "door", widthM: 0.8, heightM: 2.1 }),
    opening({ id: "w1", floorId: "f1", wallId: "D:s", type: "window", widthM: 1.2, heightM: 1.2 }),
    opening({ id: "d4", floorId: "f2", wallId: "E:s", type: "door", widthM: 0.9, heightM: 2.1 }),
    opening({ id: "w2", floorId: "f2", wallId: "F:s", type: "window", widthM: 1.2, heightM: 1.2 }),
    opening({ id: "w3", floorId: "f2", wallId: "G:s", type: "window", widthM: 0.6, heightM: 0.6 }),
  ],
})

describe("kusenSchedule", () => {
  it("groups by (type, widthM, heightM), codes doors P1.. (width desc) then windows J1..", () => {
    const schedule = kusenSchedule(baseLayout)
    expect(schedule.map((t) => t.code)).toEqual(["P1", "P2", "J1", "J2"])
  })

  it("P1 = 0.9x2.1 door, count 3, perFloor {f1:2, f2:1}", () => {
    const p1 = kusenSchedule(baseLayout).find((t) => t.code === "P1")!
    expect(p1.openingType).toBe("door")
    expect(p1.widthM).toBe(0.9)
    expect(p1.heightM).toBe(2.1)
    expect(p1.count).toBe(3)
    expect(p1.perFloor).toEqual({ f1: 2, f2: 1 })
    expect(p1.openingIds.sort()).toEqual(["d1", "d2", "d4"])
  })

  it("P2 = 0.8x2.1 door, count 1, perFloor {f1:1}", () => {
    const p2 = kusenSchedule(baseLayout).find((t) => t.code === "P2")!
    expect(p2.openingType).toBe("door")
    expect(p2.widthM).toBe(0.8)
    expect(p2.heightM).toBe(2.1)
    expect(p2.count).toBe(1)
    expect(p2.perFloor).toEqual({ f1: 1 })
    expect(p2.openingIds).toEqual(["d3"])
  })

  it("J1 = 1.2x1.2 window, count 2, perFloor {f1:1, f2:1}", () => {
    const j1 = kusenSchedule(baseLayout).find((t) => t.code === "J1")!
    expect(j1.openingType).toBe("window")
    expect(j1.widthM).toBe(1.2)
    expect(j1.heightM).toBe(1.2)
    expect(j1.count).toBe(2)
    expect(j1.perFloor).toEqual({ f1: 1, f2: 1 })
    expect(j1.openingIds.sort()).toEqual(["w1", "w2"])
  })

  it("J2 = 0.6x0.6 window, count 1, perFloor {f2:1}", () => {
    const j2 = kusenSchedule(baseLayout).find((t) => t.code === "J2")!
    expect(j2.openingType).toBe("window")
    expect(j2.widthM).toBe(0.6)
    expect(j2.heightM).toBe(0.6)
    expect(j2.count).toBe(1)
    expect(j2.perFloor).toEqual({ f2: 1 })
    expect(j2.openingIds).toEqual(["w3"])
  })

  it("is deterministic across repeated calls (stable ordering)", () => {
    const a = kusenSchedule(baseLayout).map((t) => t.code)
    const b = kusenSchedule(baseLayout).map((t) => t.code)
    expect(a).toEqual(b)
  })
})

describe("kusenCodeByOpeningId", () => {
  it("maps every opening id to its schedule code", () => {
    const map = kusenCodeByOpeningId(baseLayout)
    expect(map.get("d1")).toBe("P1")
    expect(map.get("d2")).toBe("P1")
    expect(map.get("d4")).toBe("P1")
    expect(map.get("d3")).toBe("P2")
    expect(map.get("w1")).toBe("J1")
    expect(map.get("w2")).toBe("J1")
    expect(map.get("w3")).toBe("J2")
    expect(map.size).toBe(7)
  })
})

describe("kusenPrice", () => {
  it("door 0.9x2.1 menengah = round1k(1_400_000*(0.6+0.4*1.89)) = 1_898_000", () => {
    expect(kusenPrice("door", 0.9, 2.1, "menengah")).toBe(1_898_000)
  })

  it("window 1.2x1.2 standar = round1k(450_000*(0.6+0.4*1.44)) = 529_000", () => {
    expect(kusenPrice("window", 1.2, 1.2, "standar")).toBe(529_000)
  })

  it("is monotonic w.r.t. area for a fixed finishing level", () => {
    const small = kusenPrice("door", 0.7, 2.0, "standar")
    const large = kusenPrice("door", 1.2, 2.4, "standar")
    expect(large).toBeGreaterThan(small)
  })

  it("premium > menengah > standar for the same opening", () => {
    const standar = kusenPrice("window", 1.0, 1.0, "standar")
    const menengah = kusenPrice("window", 1.0, 1.0, "menengah")
    const premium = kusenPrice("window", 1.0, 1.0, "premium")
    expect(premium).toBeGreaterThan(menengah)
    expect(menengah).toBeGreaterThan(standar)
  })

  it("rounds to the nearest 1,000 IDR", () => {
    const price = kusenPrice("door", 0.85, 2.05, "premium")
    expect(price % 1000).toBe(0)
  })
})
