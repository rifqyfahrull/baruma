import { describe, expect, it } from "vitest"

import { reflowFixes, reconcileOverlappingRooms } from "./reflow"
import { collectSafeFixes, simulateFixesOnScene } from "./fix-all"
import { rectsOverlap } from "@/lib/geometry"
import { ROOM_STANDARDS } from "./standards"
import type { FloorplanScene } from "@/lib/assistant/actions"

function scene(rooms: FloorplanScene["rooms"], extra: Partial<FloorplanScene> = {}): FloorplanScene {
  return {
    site: { widthM: 8, depthM: 8 },
    floors: [{ id: "f1", name: "L1", level: 1 }],
    selectedFloorId: "f1",
    selectedRoomId: null,
    rooms,
    openings: [],
    ...extra,
  }
}

function r(id: string, type: string, x: number, y: number, w: number, d: number, locked = false): FloorplanScene["rooms"][number] {
  return { id, name: id, type, floorId: "f1", x, y, width: w, depth: d, areaM2: w * d, locked }
}

describe("reflowFixes — menata ulang denah dengan menggeser tetangga", () => {
  it("shrinks a roomy neighbour so a landlocked undersized room reaches its SNI minimum", () => {
    // kt (kamar_tidur 2×3=6 m² < 9 m²) terkurung: tamu besar di timur (6×8),
    // dinding site di barat/utara, dapur di selatan. Satu-satunya jalan: tamu
    // menyempit (tetap >= standarnya) dan kt melebar ke timur.
    const s = scene([
      r("kt", "kamar_tidur", 0, 0, 2, 3),
      r("tamu", "ruang_tamu", 2, 0, 6, 8),
      r("dapur2", "dapur", 0, 3, 2, 5),
    ])
    const out = reflowFixes(s)

    const ktFix = out.fixes.find((f) => f.roomId === "kt")
    expect(ktFix).toBeTruthy()
    expect(ktFix!.movedNeighbors).toContain("tamu")

    // Hasil simulasi: kt >= 9 m², tamu masih >= standarnya, tanpa overlap.
    const sim = simulateFixesOnScene(s, out.actions)
    const kt = sim.rooms.find((x) => x.id === "kt")!
    const tamu = sim.rooms.find((x) => x.id === "tamu")!
    expect(kt.width * kt.depth + 0.05).toBeGreaterThanOrEqual(ROOM_STANDARDS.kamar_tidur!.minAreaM2)
    expect(tamu.width * tamu.depth + 0.05).toBeGreaterThanOrEqual(ROOM_STANDARDS.ruang_tamu!.minAreaM2)
    for (let i = 0; i < sim.rooms.length; i++)
      for (let j = i + 1; j < sim.rooms.length; j++)
        expect(rectsOverlap(
          { x: sim.rooms[i].x, y: sim.rooms[i].y, width: sim.rooms[i].width, depth: sim.rooms[i].depth },
          { x: sim.rooms[j].x, y: sim.rooms[j].y, width: sim.rooms[j].width, depth: sim.rooms[j].depth },
        )).toBe(false)
  })

  it("refuses to shrink a neighbour that would fall below ITS OWN standard", () => {
    // Semua tetangga sudah pas di minimum → reflow harus jujur menyerah.
    const tight = scene([
      r("kt", "kamar_tidur", 0, 0, 2, 3),          // 6 m² < 9 m²
      r("kt2", "kamar_tidur", 2, 0, 3, 3),          // 9 m² — pas minimum
      r("km", "kamar_mandi", 0, 3, 2, 1.5),         // 3 m² — pas minimum
    ], { site: { widthM: 5, depthM: 4.5 } })
    const out = reflowFixes(tight)
    expect(out.fixes.find((f) => f.roomId === "kt")).toBeFalsy()
    expect(out.stillBlocked.map((x) => x.id)).toContain("kt")
  })

  it("widens a too-narrow room (sisi terpendek) via the same mechanism", () => {
    // dapur 1.2×4: area 4.8 >= 4 tapi sisi terpendek 1.2 < 1.5 (standar dapur).
    const s = scene([
      r("dpr", "dapur", 0, 0, 1.2, 4),
      r("tamu", "ruang_tamu", 1.2, 0, 6.8, 8),
    ])
    const out = reflowFixes(s)
    const sim = simulateFixesOnScene(s, out.actions)
    const dpr = sim.rooms.find((x) => x.id === "dpr")!
    expect(Math.min(dpr.width, dpr.depth) + 0.02).toBeGreaterThanOrEqual(ROOM_STANDARDS.dapur!.minWidthM)
  })

  it("never touches locked neighbours", () => {
    const s = scene([
      r("kt", "kamar_tidur", 0, 0, 2, 3),
      r("tamu", "ruang_tamu", 2, 0, 6, 8, true), // locked
    ])
    const out = reflowFixes(s)
    expect(out.actions.every((a) => a.type !== "updateRoom" || a.roomId !== "tamu")).toBe(true)
  })
})

describe("collectSafeFixes + reflow integration", () => {
  it("reports reflowed rooms and clears them from blocked", () => {
    const s = scene([
      r("kt", "kamar_tidur", 0, 0, 2, 3),
      r("tamu", "ruang_tamu", 2, 0, 6, 8),
      r("dapur2", "dapur", 0, 3, 2, 5),
    ])
    const result = collectSafeFixes(s)
    expect(result.reflowed.some((f) => f.roomId === "kt")).toBe(true)
    expect(result.blocked.rooms).not.toContain("kt")
  })
})

describe("reconcileOverlappingRooms — memisahkan ruang yang saling bertabrakan", () => {
  it("shrinks the room with more slack above its own standard, leaving the tighter room untouched", () => {
    // void1 (no SNI standard) overlaps kt (kamar_tidur, 16 m² — far above the
    // 9 m² minimum) by 1 m on the x axis. void1 has "infinite" slack (no
    // standard at all) so it yields; kt stays exactly where it was.
    const s = scene([
      r("void1", "void", 0, 0, 4, 4),
      r("kt", "kamar_tidur", 3, 0, 4, 4),
    ])
    const out = reconcileOverlappingRooms(s, s.rooms)

    expect(out.resolvedPairs).toEqual([["void1", "kt"]])
    expect(out.stillBlocked).toEqual([])
    const ktPatch = out.actions.find((a) => a.type === "updateRoom" && a.roomId === "kt")
    expect(ktPatch).toBeUndefined() // kt untouched
    const voidPatch = out.actions.find((a) => a.type === "updateRoom" && a.roomId === "void1")
    expect(voidPatch).toBeDefined()
    if (voidPatch?.type === "updateRoom") {
      expect(voidPatch.patch).toEqual({ x: 0, y: 0, width: 3, depth: 4 })
    }
  })

  it("leaves a pair unresolved when required displacement exceeds 30% of the moved room's short side", () => {
    // Two 3x3 kamar_tidur (exactly at their 9 m² minimum, zero slack each)
    // overlap by 2 m on the x axis — 2/3 = 66% of the short side, way over
    // the 30% cap on BOTH sides. Neither can safely absorb the fix.
    const s = scene([
      r("kt1", "kamar_tidur", 0, 0, 3, 3),
      r("kt2", "kamar_tidur", 1, 0, 3, 3),
    ])
    const out = reconcileOverlappingRooms(s, s.rooms)

    expect(out.stillBlocked).toEqual([["kt1", "kt2"]])
    expect(out.actions).toEqual([])
  })

  it("never moves a locked room, even when it has more slack", () => {
    // locked1 (locked, would otherwise be preferred — same slack as kt2) is
    // skipped; kt2 absorbs the 0.8 m x-axis overlap instead (20% of its 4 m
    // short side — within the 30% cap).
    const s = scene([
      r("locked1", "kamar_tidur", 0, 0, 4, 4, true),
      r("kt2", "kamar_tidur", 3.2, 0, 4, 4),
    ])
    const out = reconcileOverlappingRooms(s, s.rooms)

    expect(out.resolvedPairs).toEqual([["locked1", "kt2"]])
    const lockedPatch = out.actions.find((a) => a.type === "updateRoom" && a.roomId === "locked1")
    expect(lockedPatch).toBeUndefined()
    const kt2Patch = out.actions.find((a) => a.type === "updateRoom" && a.roomId === "kt2")
    expect(kt2Patch).toBeDefined()
    if (kt2Patch?.type === "updateRoom") {
      expect(kt2Patch.patch).toEqual({ x: 4, y: 0, width: 3.2, depth: 4 })
    }
  })
})
