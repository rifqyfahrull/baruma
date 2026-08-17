import { describe, it, expect } from "vitest"

import type { DesignLayout, Room, WaterPoint } from "@/types"
import { autoGenerateWater } from "./plan"

/** Hand-built fixture (editor-store.test.ts style): 1 floor with a
 *  kamar_mandi + dapur + kamar_tidur (dry) + void. WATER_DEFAULTS pinned by
 *  the SP5 plan:
 *  kamar_mandi → [kloset, wastafel, shower, floor_drain] (4)
 *  dapur       → [sink_dapur, floor_drain] (2)
 *  kamar_tidur → [] (0, dry room)
 *  void        → skipped (0)
 *  → total 6. */
const baseLayout = (): DesignLayout => ({
  id: "l", projectId: "p", versionId: "v",
  floors: [{ id: "f1", level: 1, name: "Lantai 1", heightM: 3 }],
  rooms: [
    { id: "r-km", floorId: "f1", name: "Kamar Mandi", type: "kamar_mandi", x: 0, y: 0, width: 3, depth: 3, areaM2: 9 },
    { id: "r-dp", floorId: "f1", name: "Dapur", type: "dapur", x: 3, y: 0, width: 3, depth: 3, areaM2: 9 },
    { id: "r-kt", floorId: "f1", name: "Kamar Tidur", type: "kamar_tidur", x: 6, y: 0, width: 3, depth: 3, areaM2: 9 },
    { id: "r-vd", floorId: "f1", name: "Void", type: "void", x: 0, y: 3, width: 2, depth: 2, areaM2: 4 },
  ],
  walls: [], openings: [], stairs: [], pools: [],
  validation: { passed: true, issues: [] },
})

const twoFloorLayout = (): DesignLayout => {
  const l = baseLayout()
  l.floors.push({ id: "f2", level: 2, name: "Lantai 2", heightM: 3 })
  l.rooms.push({
    id: "r-km2", floorId: "f2", name: "Kamar Mandi 2", type: "kamar_mandi",
    x: 0, y: 0, width: 3, depth: 3, areaM2: 9,
  })
  return l
}

const typesIn = (pts: WaterPoint[], roomId: string) =>
  pts.filter((p) => p?.roomId === roomId).map((p) => p.type)

describe("autoGenerateWater", () => {
  it("kamar_mandi gets its 4 default fixtures in order", () => {
    const pts = autoGenerateWater(baseLayout())
    expect(typesIn(pts, "r-km")).toEqual(["kloset", "wastafel", "shower", "floor_drain"])
  })

  it("dapur gets its 2 default fixtures", () => {
    const pts = autoGenerateWater(baseLayout())
    expect(typesIn(pts, "r-dp")).toEqual(["sink_dapur", "floor_drain"])
  })

  it("a dry room (kamar_tidur) gets 0 fixtures", () => {
    const pts = autoGenerateWater(baseLayout())
    expect(typesIn(pts, "r-kt")).toHaveLength(0)
  })

  it("void gets 0 fixtures and the exact total is 6", () => {
    const pts = autoGenerateWater(baseLayout())
    expect(typesIn(pts, "r-vd")).toHaveLength(0)
    expect(pts).toHaveLength(6) // 4 (kamar_mandi) + 2 (dapur)
  })

  it("every point lies strictly inside its room's bbox and ids start with water-", () => {
    const layout = baseLayout()
    const pts = autoGenerateWater(layout)
    const roomById = new Map<string, Room>(layout.rooms.map((r) => [r.id, r]))
    for (const p of pts) {
      const room = roomById.get(p.roomId)!
      expect(p.id).toMatch(/^water-/)
      expect(p.x).toBeGreaterThan(room.x)
      expect(p.x).toBeLessThan(room.x + room.width)
      expect(p.y).toBeGreaterThan(room.y)
      expect(p.y).toBeLessThan(room.y + room.depth)
    }
  })

  it("is idempotent: running twice adds nothing and keeps existing points", () => {
    const layout = baseLayout()
    const once = autoGenerateWater(layout)
    const twice = autoGenerateWater({ ...layout, water: once })
    expect(twice).toEqual(once)
  })

  it("returns a NEW array and does not mutate layout.water", () => {
    const layout = baseLayout()
    layout.water = []
    const pts = autoGenerateWater(layout)
    expect(pts).not.toBe(layout.water)
    expect(layout.water).toHaveLength(0)
    expect(pts.length).toBeGreaterThan(0)
  })

  it("skips a room that already has ANY existing water point", () => {
    const layout = baseLayout()
    const existing: WaterPoint = { id: "water-x1", roomId: "r-km", type: "kloset", x: 1, y: 1 }
    layout.water = [existing]
    const pts = autoGenerateWater(layout)
    // r-km keeps only its existing point; dapur still generates its 2.
    expect(pts.filter((p) => p.roomId === "r-km")).toEqual([existing])
    expect(typesIn(pts, "r-dp")).toEqual(["sink_dapur", "floor_drain"])
    expect(pts).toHaveLength(1 + 2)
  })

  it("floorId filter generates only that floor's rooms", () => {
    const pts = autoGenerateWater(twoFloorLayout(), "f2")
    expect(pts.every((p) => p.roomId === "r-km2")).toBe(true)
    expect(typesIn(pts, "r-km2")).toEqual(["kloset", "wastafel", "shower", "floor_drain"])
    expect(pts).toHaveLength(4)
  })

  it("floorId = ground floor generates only f1 rooms", () => {
    const pts = autoGenerateWater(twoFloorLayout(), "f1")
    expect(pts.every((p) => p.roomId !== "r-km2")).toBe(true)
    expect(pts).toHaveLength(6)
  })

  it("tolerates malformed existing points without crashing (PUT has no zod)", () => {
    const layout = baseLayout()
    layout.water = [
      { id: "water-bad1", roomId: "r-km", type: "alien" as WaterPoint["type"], x: Number.NaN, y: 999 },
      { id: "water-bad2", roomId: undefined as unknown as string, type: "kloset", x: 1, y: 1 },
      null as unknown as WaterPoint,
    ]
    const pts = autoGenerateWater(layout)
    // Existing entries are preserved as-is; r-km is skipped (it "has" a point),
    // dapur is still generated.
    expect(pts.slice(0, 3)).toEqual(layout.water)
    expect(typesIn(pts, "r-dp")).toEqual(["sink_dapur", "floor_drain"])
  })
})
