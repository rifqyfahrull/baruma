import { describe, it, expect } from "vitest"

import { bestExteriorWindow, daylightFixes, enlargeRoomToTarget, needsDaylight, roomSizeFixes } from "./auto-fix"
import { rectsOverlap } from "@/lib/geometry"
import type { FloorplanScene } from "@/lib/assistant/actions"

function scene(rooms: FloorplanScene["rooms"], openings: FloorplanScene["openings"] = []): FloorplanScene {
  return {
    site: { widthM: 8, depthM: 10 },
    floors: [{ id: "f1", name: "Lantai 1", level: 1 }],
    selectedFloorId: "f1",
    selectedRoomId: null,
    rooms,
    openings,
  }
}

function room(partial: Partial<FloorplanScene["rooms"][number]> & { id: string; type: string; x: number; y: number; width: number; depth: number }): FloorplanScene["rooms"][number] {
  return { name: partial.id, floorId: "f1", areaM2: partial.width * partial.depth, ...partial } as FloorplanScene["rooms"][number]
}

describe("needsDaylight", () => {
  it("is true for habitable types, false for wet/service types", () => {
    expect(needsDaylight(room({ id: "a", type: "kamar_tidur", x: 0, y: 0, width: 3, depth: 3 }))).toBe(true)
    expect(needsDaylight(room({ id: "b", type: "kamar_mandi", x: 0, y: 0, width: 2, depth: 2 }))).toBe(false)
    expect(needsDaylight(room({ id: "c", type: "gudang", x: 0, y: 0, width: 2, depth: 2 }))).toBe(false)
  })

  it("honors an explicit requiresNaturalLight=false opt-out", () => {
    expect(needsDaylight(room({ id: "a", type: "kamar_tidur", x: 0, y: 0, width: 3, depth: 3, requiresNaturalLight: false }))).toBe(false)
  })
})

describe("bestExteriorWindow", () => {
  const site = { widthM: 8, depthM: 10 }
  it("prefers the south wall, positioned along width", () => {
    const r = { x: 2, y: 7, width: 3, depth: 3 } // y+depth = 10 = depthM → south
    expect(bestExteriorWindow(r, site)).toEqual({ side: "s", positionM: 1.5 })
  })
  it("uses an east/west wall (position along depth) when not on N/S", () => {
    const r = { x: 5, y: 3, width: 3, depth: 4 } // x+width = 8 = widthM → east
    expect(bestExteriorWindow(r, site)).toEqual({ side: "e", positionM: 2 })
  })
  it("returns null for a landlocked room (no exterior wall)", () => {
    const r = { x: 2, y: 2, width: 3, depth: 3 }
    expect(bestExteriorWindow(r, site)).toBeNull()
  })
})

describe("daylightFixes", () => {
  it("produces one addOpening window per windowless habitable room with an exterior wall", () => {
    const s = scene([
      room({ id: "kt", name: "Kamar", type: "kamar_tidur", x: 0, y: 0, width: 3, depth: 3 }), // north wall
      room({ id: "km", name: "Mandi", type: "kamar_mandi", x: 3, y: 0, width: 2, depth: 2 }), // not habitable → skip
      room({ id: "tamu", name: "Tamu", type: "ruang_tamu", x: 0, y: 7, width: 4, depth: 3 }), // south wall
    ])
    const { fixes, landlocked } = daylightFixes(s)
    expect(fixes.map((f) => f.roomId).sort()).toEqual(["kt", "tamu"])
    expect(fixes.every((f) => f.action.type === "addOpening" && f.action.openingType === "window")).toBe(true)
    expect(landlocked).toHaveLength(0)
  })

  it("skips rooms that already have a window", () => {
    const s = scene(
      [room({ id: "kt", name: "Kamar", type: "kamar_tidur", x: 0, y: 0, width: 3, depth: 3 })],
      [{ id: "op1", roomId: "kt", side: "n", type: "window", positionM: 1.5 }],
    )
    expect(daylightFixes(s).fixes).toHaveLength(0)
  })

  it("reports a landlocked habitable room instead of fixing it", () => {
    const s = scene([room({ id: "kt", name: "Kamar", type: "kamar_tidur", x: 2, y: 2, width: 3, depth: 3 })])
    const { fixes, landlocked } = daylightFixes(s)
    expect(fixes).toHaveLength(0)
    expect(landlocked.map((r) => r.id)).toEqual(["kt"])
  })
})

describe("enlargeRoomToTarget", () => {
  const site = { widthM: 8, depthM: 8 }
  it("grows an undersized room into adjacent free space to hit the target area", () => {
    const room = { x: 0, y: 0, width: 2, depth: 2 } // 4 m²
    const out = enlargeRoomToTarget(room, 9, [], site)
    expect(out).not.toBeNull()
    expect(out!.width * out!.depth).toBeGreaterThanOrEqual(9 - 0.05)
    expect(out!.x).toBeGreaterThanOrEqual(0)
    expect(out!.y).toBeGreaterThanOrEqual(0)
    expect(out!.x + out!.width).toBeLessThanOrEqual(site.widthM + 0.05)
  })

  it("never overlaps a blocking neighbour", () => {
    const room = { x: 0, y: 0, width: 2, depth: 2 }
    const neighbour = { x: 3, y: 0, width: 5, depth: 8 } // blocks east past x=3
    const out = enlargeRoomToTarget(room, 9, [neighbour], site)
    if (out) expect(rectsOverlap(out, neighbour)).toBe(false)
  })

  it("returns null when the room is boxed in and cannot reach the target", () => {
    const room = { x: 3, y: 3, width: 1.5, depth: 1.5 } // 2.25 m²
    const box = [
      { x: 0, y: 3, width: 3, depth: 1.5 }, // west
      { x: 4.5, y: 3, width: 3.5, depth: 1.5 }, // east
      { x: 3, y: 0, width: 1.5, depth: 3 }, // north
      { x: 3, y: 4.5, width: 1.5, depth: 3.5 }, // south
    ]
    expect(enlargeRoomToTarget(room, 9, box, site)).toBeNull()
  })
})

describe("roomSizeFixes", () => {
  function scene2(rooms: FloorplanScene["rooms"]): FloorplanScene {
    return { site: { widthM: 8, depthM: 8 }, floors: [{ id: "f1", name: "L1", level: 1 }], selectedFloorId: "f1", selectedRoomId: null, rooms, openings: [] }
  }
  function r(id: string, type: string, x: number, y: number, w: number, d: number): FloorplanScene["rooms"][number] {
    return { id, name: id, type, floorId: "f1", x, y, width: w, depth: d, areaM2: w * d, locked: false }
  }

  it("enlarges an undersized bedroom to its SNI minimum and leaves compliant rooms alone", () => {
    const s = scene2([
      r("kt", "kamar_tidur", 0, 0, 2, 2), // 4 m² < 9 → fix
      r("tamu", "ruang_tamu", 0, 5, 4, 3), // 12 m² ok
    ])
    const { fixes } = roomSizeFixes(s)
    expect(fixes.map((f) => f.roomId)).toEqual(["kt"])
    expect(fixes[0].toAreaM2).toBeGreaterThanOrEqual(9 - 0.05)
    expect(fixes[0].action.type).toBe("updateRoom")
  })

  it("produces non-overlapping enlargements for two undersized rooms sharing a floor", () => {
    const s = scene2([
      r("kt1", "kamar_tidur", 0, 0, 2, 2),
      r("kt2", "kamar_tidur", 0, 5, 2, 2),
    ])
    const { fixes } = roomSizeFixes(s)
    // Apply the fixes and check no two final rects overlap.
    const finals = s.rooms.map((room) => {
      const fix = fixes.find((f) => f.roomId === room.id)
      const p = fix?.action.patch
      return { x: p?.x ?? room.x, y: p?.y ?? room.y, width: p?.width ?? room.width, depth: p?.depth ?? room.depth }
    })
    for (let i = 0; i < finals.length; i++)
      for (let j = i + 1; j < finals.length; j++)
        expect(rectsOverlap(finals[i], finals[j])).toBe(false)
  })
})
