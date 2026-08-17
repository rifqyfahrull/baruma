import { describe, expect, it } from "vitest"
import type { FloorplanScene } from "./actions"
import { proposeOpenPlanConnection, proposeSmallRoomRepair, proposeSoakwellRelocation } from "./design-strategies"

describe("design strategies", () => {
  it("compacts a service room that blocks an open-plan kitchen-family connection", () => {
    const scene: FloorplanScene = {
      site: { widthM: 8, depthM: 8 },
      floors: [{ id: "f1", name: "Lantai 1", level: 1 }],
      selectedFloorId: "f1",
      selectedRoomId: "keluarga",
      rooms: [
        { id: "carport", name: "Carport", type: "carport", floorId: "f1", x: 0.28, y: 0.28, width: 2.88, depth: 3.82, areaM2: 11, locked: false },
        { id: "dapur", name: "Dapur", type: "dapur", floorId: "f1", x: 3.22, y: 0.28, width: 4.5, depth: 1.72, areaM2: 7.74, locked: false },
        { id: "km1", name: "Kamar mandi 1", type: "kamar_mandi", floorId: "f1", x: 4.57, y: 2, width: 3.15, depth: 1.32, areaM2: 4.16, locked: false },
        { id: "keluarga", name: "Ruang keluarga", type: "ruang_keluarga", floorId: "f1", x: 3.22, y: 3.32, width: 4.5, depth: 4.38, areaM2: 19.71, locked: false },
        { id: "tamu", name: "Ruang tamu", type: "ruang_tamu", floorId: "f1", x: 0.28, y: 4.14, width: 2.88, depth: 3.56, areaM2: 10.25, locked: false },
      ],
      openings: [],
    }

    const proposal = proposeOpenPlanConnection(scene, {
      mainRoomTypes: ["dapur", "ruang_keluarga"],
      blockerType: "kamar_mandi",
      floorId: "f1",
    })

    expect(proposal?.strategyId).toBe("open-plan-repack-service-blocker")
    expect(proposal?.rationale.toLowerCase()).toContain("sumbu")
    expect(proposal?.actions).toEqual([
      { type: "updateRoom", roomId: "km1", patch: { x: 5.92, width: 1.8, depth: 2.22 } },
      { type: "updateRoom", roomId: "keluarga", patch: { width: 2.7 } },
      { type: "updateRoom", roomId: "dapur", patch: { zoneId: "zone-open-dapur-keluarga" } },
      { type: "updateRoom", roomId: "keluarga", patch: { zoneId: "zone-open-dapur-keluarga" } },
    ])
  })

  it("repairs a too-small bathroom by expanding it and trimming the adjacent room safely", () => {
    const scene: FloorplanScene = {
      site: { widthM: 8, depthM: 8 },
      floors: [{ id: "f1", name: "Lantai 1", level: 1 }],
      selectedFloorId: "f1",
      selectedRoomId: "km1",
      rooms: [
        { id: "carport", name: "Carport", type: "carport", floorId: "f1", x: 0.28, y: 0.28, width: 2.88, depth: 3.82, areaM2: 11, locked: false },
        { id: "dapur", name: "Dapur", type: "dapur", floorId: "f1", x: 3.22, y: 0.28, width: 4.5, depth: 1.72, areaM2: 7.74, locked: false },
        { id: "km1", name: "Kamar mandi 1", type: "kamar_mandi", floorId: "f1", x: 5.92, y: 1.92, width: 1.8, depth: 1.4, areaM2: 2.52, locked: false },
        { id: "keluarga", name: "Ruang keluarga", type: "ruang_keluarga", floorId: "f1", x: 3.22, y: 3.32, width: 4.5, depth: 4.38, areaM2: 19.71, locked: false },
        { id: "tamu", name: "Ruang tamu", type: "ruang_tamu", floorId: "f1", x: 0.28, y: 4.14, width: 2.88, depth: 3.56, areaM2: 10.25, locked: false },
      ],
      openings: [],
    }

    const proposal = proposeSmallRoomRepair(scene, { roomId: "km1", floorId: "f1" })

    expect(proposal?.strategyId).toBe("repair-small-room")
    expect(proposal?.actions).toEqual([
      { type: "updateRoom", roomId: "km1", patch: { x: 5.14, width: 2.86 } },
      { type: "updateRoom", roomId: "dapur", patch: { depth: 1.64 } },
    ])
  })

  it("uses the explicitly sacrificed neighbor when repairing a too-small room", () => {
    const scene: FloorplanScene = {
      site: { widthM: 8, depthM: 8 },
      floors: [{ id: "f1", name: "Lantai 1", level: 1 }],
      selectedFloorId: "f1",
      selectedRoomId: "km1",
      rooms: [
        { id: "carport", name: "Carport", type: "carport", floorId: "f1", x: 0.28, y: 0.28, width: 2.88, depth: 3.82, areaM2: 11, locked: false },
        { id: "dapur", name: "Dapur", type: "dapur", floorId: "f1", x: 3.22, y: 0.28, width: 4.5, depth: 1.72, areaM2: 7.74, locked: false },
        { id: "km1", name: "Kamar mandi 1", type: "kamar_mandi", floorId: "f1", x: 5.92, y: 1.92, width: 1.8, depth: 1.4, areaM2: 2.52, locked: false },
        { id: "keluarga", name: "Ruang keluarga", type: "ruang_keluarga", floorId: "f1", x: 3.22, y: 3.32, width: 4.5, depth: 4.38, areaM2: 19.71, locked: false },
        { id: "tamu", name: "Ruang tamu", type: "ruang_tamu", floorId: "f1", x: 0.28, y: 4.14, width: 2.88, depth: 3.56, areaM2: 10.25, locked: false },
      ],
      openings: [],
    }

    const proposal = proposeSmallRoomRepair(scene, {
      roomId: "km1",
      floorId: "f1",
      sacrificeRoomTypes: ["ruang_keluarga"],
    })

    expect(proposal?.actions).toEqual([
      { type: "updateRoom", roomId: "km1", patch: { x: 5.14, y: 2, width: 2.86 } },
      { type: "updateRoom", roomId: "keluarga", patch: { y: 3.4, depth: 4.3 } },
    ])
  })

  it("treats a near-fit unlabeled void as a service court opportunity", () => {
    const scene: FloorplanScene = {
      site: { widthM: 8, depthM: 8 },
      floors: [{ id: "f1", name: "Lantai 1", level: 1 }],
      selectedFloorId: "f1",
      selectedRoomId: null,
      rooms: [
        { id: "carport", name: "Carport", type: "carport", floorId: "f1", x: 0.28, y: 0.28, width: 2.88, depth: 3.82, areaM2: 11, locked: false },
        { id: "dapur", name: "Dapur", type: "dapur", floorId: "f1", x: 3.22, y: 0.28, width: 4.5, depth: 1.72, areaM2: 7.74, locked: false },
        { id: "km1", name: "Kamar mandi 1", type: "kamar_mandi", floorId: "f1", x: 4.57, y: 2, width: 3.15, depth: 1.32, areaM2: 4.16, locked: false },
        { id: "keluarga", name: "Ruang keluarga", type: "ruang_keluarga", floorId: "f1", x: 3.22, y: 3.32, width: 4.5, depth: 4.38, areaM2: 19.71, locked: false },
        { id: "tamu", name: "Ruang tamu", type: "ruang_tamu", floorId: "f1", x: 0.28, y: 4.14, width: 2.88, depth: 3.56, areaM2: 10.25, locked: false },
      ],
      openings: [],
      sanitation: {
        septicTank: { id: "st", x: 0.79, y: 3.18, widthM: 0.85, lengthM: 1.7, depthM: 1.8 },
        soakwell: { id: "sw1", x: 6, y: 6.8, widthM: 1.4, lengthM: 1.4, depthM: 2 },
        controlBoxes: [
          { id: "bk1", x: 0.56, y: 2.09, widthM: 0.4, lengthM: 0.4, depthM: 0.5 },
          { id: "bk2", x: 1.47, y: 3.84, widthM: 0.4, lengthM: 0.4, depthM: 0.5 },
          { id: "bk3", x: 4, y: 7.4, widthM: 0.4, lengthM: 0.4, depthM: 0.5 },
          { id: "bk4", x: 5.33, y: 7.4, widthM: 0.4, lengthM: 0.4, depthM: 0.5 },
          { id: "bk5", x: 6.67, y: 7.4, widthM: 0.4, lengthM: 0.4, depthM: 0.5 },
        ],
      },
    }

    const proposal = proposeSoakwellRelocation(scene)

    expect(proposal?.strategyId).toBe("service-court-for-soakwell")
    expect(proposal?.rationale.toLowerCase()).toContain("taman servis")
    expect(proposal?.actions).toEqual([
      { type: "updateRoom", roomId: "dapur", patch: { y: 0.2 } },
      { type: "updateRoom", roomId: "km1", patch: { x: 4.62 } },
      { type: "moveSanitationObject", kind: "soakwell", x: 3.92, y: 2.62 },
    ])
  })
})
