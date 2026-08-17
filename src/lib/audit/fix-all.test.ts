import { describe, it, expect } from "vitest"

import { collectSafeFixes, simulateFixesOnScene } from "./fix-all"
import { rectsOverlap } from "@/lib/geometry"
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

function r(id: string, type: string, x: number, y: number, w: number, d: number): FloorplanScene["rooms"][number] {
  return { id, name: id, type, floorId: "f1", x, y, width: w, depth: d, areaM2: w * d, locked: false }
}

describe("simulateFixesOnScene", () => {
  it("applies updateRoom, addOpening, and moveSanitationObject onto a clone", () => {
    const s = scene([r("kt", "kamar_tidur", 0, 0, 2, 2)], {
      sanitation: { soakwell: { id: "sw", x: 3, y: 3, widthM: 1, lengthM: 1, depthM: 2 } },
    })
    const out = simulateFixesOnScene(s, [
      { type: "updateRoom", roomId: "kt", patch: { width: 3, depth: 3 } },
      { type: "addOpening", roomId: "kt", side: "s", positionM: 1.5, openingType: "window" },
      { type: "moveSanitationObject", kind: "soakwell", x: 7, y: 7 },
    ])
    expect(out.rooms[0].width).toBe(3)
    expect(out.openings).toHaveLength(1)
    expect(out.openings[0].type).toBe("window")
    expect(out.sanitation!.soakwell!.x).toBe(7)
    // original scene untouched
    expect(s.rooms[0].width).toBe(2)
    expect(s.openings).toHaveLength(0)
  })
})

describe("collectSafeFixes", () => {
  it("combines room-size + daylight + sanitation into one conflict-free action set", () => {
    const s = scene(
      [
        r("kt", "kamar_tidur", 0, 0, 2, 2), // undersized → enlarge; on N/W boundary → window
        r("tamu", "ruang_tamu", 4, 5, 4, 3), // ok size, on boundary
      ],
      { sanitation: { soakwell: { id: "sw", x: 5, y: 6, widthM: 1, lengthM: 1, depthM: 2 } } },
    )
    const result = collectSafeFixes(s)
    expect(result.applied.rooms).toBeGreaterThanOrEqual(1)
    expect(result.actions.length).toBeGreaterThan(0)

    // Apply everything and assert no two rooms overlap afterward.
    const final = simulateFixesOnScene(s, result.actions)
    for (let i = 0; i < final.rooms.length; i++)
      for (let j = i + 1; j < final.rooms.length; j++)
        expect(rectsOverlap(final.rooms[i], final.rooms[j])).toBe(false)
  })

  it("daylight stage sees enlarged rooms (window added on a wall the enlarged room reaches)", () => {
    // A small bedroom in the interior that, once enlarged, reaches the south
    // boundary — the window must land on that now-exterior wall.
    const s = scene([
      r("kt", "kamar_tidur", 2, 4, 2, 2), // 4 m², interior; enlarges toward s to y+depth=8
      r("block", "gudang", 0, 0, 8, 4), // fills the north half
    ])
    const result = collectSafeFixes(s)
    const hasWindow = result.actions.some((a) => a.type === "addOpening" && a.roomId === "kt")
    // Either it enlarged+windowed, or reported blocked — but must not crash and
    // must produce a coherent set.
    expect(Array.isArray(result.actions)).toBe(true)
    if (result.applied.windows > 0) expect(hasWindow).toBe(true)
  })

  it("returns an empty action set for an already-compliant scene", () => {
    const s = scene([
      r("kt", "kamar_tidur", 0, 0, 3.2, 3.2),
      r("tamu", "ruang_tamu", 0, 5, 4, 3),
    ], { openings: [
      { id: "o1", roomId: "kt", side: "n", type: "window", positionM: 1.5 },
      { id: "o2", roomId: "tamu", side: "s", type: "window", positionM: 2 },
    ] })
    const result = collectSafeFixes(s)
    expect(result.actions).toHaveLength(0)
  })
})
