import { describe, it, expect } from "vitest"

import type { DesignLayout, ElectricalPoint, Room } from "@/types"
import { autoGenerateElectrical } from "./plan"

/** Hand-built fixture (editor-store.test.ts style): 1 floor with
 *  kamar_tidur + dapur + void. Defaults pinned by the SP4 plan:
 *  kamar_tidur → 2 stopkontak + 1 saklar_tunggal (3)
 *  dapur       → 3 stopkontak + 1 stopkontak_daya + 1 saklar_tunggal (5)
 *  void        → skipped (0)
 *  + exactly 1 panel per house → total 9. */
const baseLayout = (): DesignLayout => ({
  id: "l", projectId: "p", versionId: "v",
  floors: [{ id: "f1", level: 1, name: "Lantai 1", heightM: 3 }],
  rooms: [
    { id: "r-kt", floorId: "f1", name: "Kamar Tidur", type: "kamar_tidur", x: 0, y: 0, width: 3, depth: 3, areaM2: 9 },
    { id: "r-dp", floorId: "f1", name: "Dapur", type: "dapur", x: 3, y: 0, width: 3, depth: 3, areaM2: 9 },
    { id: "r-vd", floorId: "f1", name: "Void", type: "void", x: 0, y: 3, width: 2, depth: 2, areaM2: 4 },
  ],
  walls: [], openings: [], stairs: [], pools: [],
  validation: { passed: true, issues: [] },
})

const twoFloorLayout = (): DesignLayout => {
  const l = baseLayout()
  l.floors.push({ id: "f2", level: 2, name: "Lantai 2", heightM: 3 })
  l.rooms.push({
    id: "r-kt2", floorId: "f2", name: "Kamar Tidur 2", type: "kamar_tidur",
    x: 0, y: 0, width: 3, depth: 3, areaM2: 9,
  })
  return l
}

const ofType = (pts: ElectricalPoint[], roomId: string, type: ElectricalPoint["type"]) =>
  pts.filter((p) => p.roomId === roomId && p.type === type)

describe("autoGenerateElectrical", () => {
  it("kamar_tidur gets 2 stopkontak + 1 saklar_tunggal", () => {
    const pts = autoGenerateElectrical(baseLayout())
    expect(ofType(pts, "r-kt", "stopkontak")).toHaveLength(2)
    expect(ofType(pts, "r-kt", "saklar_tunggal")).toHaveLength(1)
  })

  it("dapur gets 3 stopkontak + 1 stopkontak_daya + 1 saklar_tunggal", () => {
    const pts = autoGenerateElectrical(baseLayout())
    expect(ofType(pts, "r-dp", "stopkontak")).toHaveLength(3)
    expect(ofType(pts, "r-dp", "stopkontak_daya")).toHaveLength(1)
    expect(ofType(pts, "r-dp", "saklar_tunggal")).toHaveLength(1)
  })

  it("void gets 0 points and the exact total is 9", () => {
    const pts = autoGenerateElectrical(baseLayout())
    expect(pts.filter((p) => p.roomId === "r-vd")).toHaveLength(0)
    expect(pts).toHaveLength(9) // 3 (kamar_tidur) + 5 (dapur) + 1 panel
  })

  it("adds exactly 1 panel, in the first non-void ground-floor room", () => {
    const pts = autoGenerateElectrical(baseLayout())
    const panels = pts.filter((p) => p.type === "panel")
    expect(panels).toHaveLength(1)
    expect(panels[0].roomId).toBe("r-kt")
  })

  it("every point lies inside its room's bbox and ids start with elec-", () => {
    const layout = baseLayout()
    const pts = autoGenerateElectrical(layout)
    const roomById = new Map<string, Room>(layout.rooms.map((r) => [r.id, r]))
    for (const p of pts) {
      const room = roomById.get(p.roomId)!
      expect(p.id).toMatch(/^elec-/)
      expect(p.x).toBeGreaterThanOrEqual(room.x)
      expect(p.x).toBeLessThanOrEqual(room.x + room.width)
      expect(p.y).toBeGreaterThanOrEqual(room.y)
      expect(p.y).toBeLessThanOrEqual(room.y + room.depth)
    }
  })

  it("is idempotent: running twice adds nothing and keeps existing points", () => {
    const layout = baseLayout()
    const once = autoGenerateElectrical(layout)
    const twice = autoGenerateElectrical({ ...layout, electrical: once })
    expect(twice).toEqual(once)
  })

  it("returns a NEW array and does not mutate layout.electrical", () => {
    const layout = baseLayout()
    layout.electrical = []
    const pts = autoGenerateElectrical(layout)
    expect(pts).not.toBe(layout.electrical)
    expect(layout.electrical).toHaveLength(0)
    expect(pts.length).toBeGreaterThan(0)
  })

  it("skips a room that already has ANY existing point", () => {
    const layout = baseLayout()
    const existing: ElectricalPoint = { id: "elec-x1", roomId: "r-kt", type: "data", x: 1, y: 1 }
    layout.electrical = [existing]
    const pts = autoGenerateElectrical(layout)
    // r-kt gets NO default points (it already has one) — the house panel is a
    // house-level point and still lands in the first non-void ground-floor
    // room, which happens to be r-kt.
    expect(pts.filter((p) => p.roomId === "r-kt" && p.type !== "panel")).toEqual([existing])
    expect(pts.filter((p) => p.type === "panel")).toHaveLength(1)
    expect(pts).toHaveLength(1 + 5 + 1)
  })

  it("does not add a second panel when one already exists anywhere", () => {
    const layout = baseLayout()
    layout.electrical = [{ id: "elec-p1", roomId: "r-dp", type: "panel", x: 3.5, y: 0.5 }]
    const pts = autoGenerateElectrical(layout)
    expect(pts.filter((p) => p.type === "panel")).toHaveLength(1)
  })

  it("floorId filter generates only that floor's rooms (no panel on upper floor)", () => {
    const pts = autoGenerateElectrical(twoFloorLayout(), "f2")
    expect(pts.every((p) => p.roomId === "r-kt2")).toBe(true)
    expect(pts).toHaveLength(3) // 2 stopkontak + 1 saklar_tunggal; no panel
    expect(pts.filter((p) => p.type === "panel")).toHaveLength(0)
  })

  it("floorId = ground floor still adds the panel", () => {
    const pts = autoGenerateElectrical(twoFloorLayout(), "f1")
    expect(pts.filter((p) => p.type === "panel")).toHaveLength(1)
    expect(pts.every((p) => p.roomId !== "r-kt2")).toBe(true)
  })

  it("places the switch at the corner nearest the room's first door", () => {
    const layout = baseLayout()
    // Door on the EAST edge of r-kt, near the far (high-y) end → nearest
    // inset corner is (2.7, 2.7).
    layout.openings = [
      { id: "o1", floorId: "f1", wallId: "r-kt:e", type: "door", positionM: 2.5, widthM: 0.9, heightM: 2.1 },
    ]
    const pts = autoGenerateElectrical(layout)
    const sw = ofType(pts, "r-kt", "saklar_tunggal")[0]
    expect(sw.x).toBe(2.7)
    expect(sw.y).toBe(2.7)
  })

  it("places the switch at the bottom-left corner + offset when the room has no door", () => {
    const pts = autoGenerateElectrical(baseLayout())
    const sw = ofType(pts, "r-dp", "saklar_tunggal")[0]
    expect(sw.x).toBe(3.3) // room.x (3) + WALL_OFFSET_M
    expect(sw.y).toBe(0.3) // room.y (0) + WALL_OFFSET_M
  })

  it("tolerates malformed existing points without crashing (carry-forward: PUT has no zod)", () => {
    const layout = baseLayout()
    layout.electrical = [
      { id: "elec-bad1", roomId: "r-kt", type: "alien" as ElectricalPoint["type"], x: Number.NaN, y: 999 },
      { id: "elec-bad2", roomId: undefined as unknown as string, type: "stopkontak", x: 1, y: 1 },
      null as unknown as ElectricalPoint,
    ]
    const pts = autoGenerateElectrical(layout)
    // Existing entries are preserved as-is; r-kt is skipped (it "has" a point),
    // dapur + panel are still generated.
    expect(pts.slice(0, 3)).toEqual(layout.electrical)
    expect(pts.filter((p) => p?.roomId === "r-dp")).toHaveLength(5)
    expect(pts.filter((p) => p?.type === "panel")).toHaveLength(1)
  })
})
