import { describe, expect, it } from "vitest"

import { generateInteriorPlan } from "@/lib/interior/plan"
import { makeLayout, sampleSite } from "@/test-utils/fixtures"
import { floorplanSceneFromLayout, interiorSceneFromPlan } from "./scene"

describe("shared Agent scene builders", () => {
  it("serializes all floors/rooms and defensively drops malformed MEP payloads", () => {
    const layout = makeLayout()
    layout.electrical = [
      { id: "valid", roomId: "r1", type: "stopkontak", x: 1, y: 1 },
      { id: "bad", roomId: "r1", type: "stopkontak", x: Number.NaN, y: 1 },
    ] as typeof layout.electrical

    const scene = floorplanSceneFromLayout(layout, sampleSite, {
      selectedFloorId: "floor-1",
      selectedRoomId: "r1",
    })
    expect(scene.rooms).toHaveLength(layout.rooms.length)
    expect(scene.selectedRoomId).toBe("r1")
    expect(scene.electrical).toEqual([
      { id: "valid", roomId: "r1", type: "stopkontak", x: 1, y: 1 },
    ])
  })

  it("builds the same complete Interior scene shape on the server", () => {
    const layout = makeLayout()
    const plan = generateInteriorPlan(layout, { projectId: "p1", style: "japandi" })
    const scene = interiorSceneFromPlan(plan, layout, plan.rooms[0].roomId)
    expect(scene.style).toBe("japandi")
    expect(scene.selectedRoomId).toBe(plan.rooms[0].roomId)
    expect(scene.rooms[0].furniture).toHaveLength(plan.rooms[0].furniture.length)
    expect(scene.rooms[0].lighting).toHaveLength(plan.rooms[0].lighting.length)
  })
})
