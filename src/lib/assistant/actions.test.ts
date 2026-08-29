import { describe, expect, it } from "vitest"

import {
  describeAction,
  floorplanActionSchema,
  interiorActionSchema,
  type FloorplanScene,
  type InteriorScene,
} from "./actions"

const floorplanScene: FloorplanScene = {
  site: { widthM: 8, depthM: 12 },
  floors: [{ id: "floor-1", name: "Lantai 1", level: 1 }],
  rooms: [{
    id: "room-1", name: "Ruang Tamu", type: "ruang_tamu", floorId: "floor-1",
    x: 0, y: 0, width: 4, depth: 4, areaM2: 16,
  }],
  openings: [],
  facadeElements: [],
  exteriorElements: [],
  exteriorLamps: [],
  electrical: [],
  water: [],
}

const interiorScene: InteriorScene = {
  style: "japandi",
  rooms: [{
    roomId: "room-1", name: "Ruang Tamu", type: "ruang_tamu", widthM: 4, depthM: 4,
    furniture: [], lighting: [],
  }],
}

describe("aiRender action schema", () => {
  it("accepts a minimal valid action in BOTH unions (target only)", () => {
    const raw = { type: "aiRender", target: "exterior" }
    expect(floorplanActionSchema.safeParse(raw).success).toBe(true)
    expect(interiorActionSchema.safeParse(raw).success).toBe(true)
  })

  it("accepts the full field set (roomId, presetId, styleNotes) in both unions", () => {
    const raw = {
      type: "aiRender",
      target: "interior",
      roomId: "room-1",
      presetId: "golden-hour",
      styleNotes: "add a warm reading lamp on the side table",
    }
    expect(floorplanActionSchema.safeParse(raw)).toMatchObject({ success: true })
    expect(interiorActionSchema.safeParse(raw)).toMatchObject({ success: true })
  })

  it("rejects a target outside exterior/interior", () => {
    const raw = { type: "aiRender", target: "roofplan" }
    expect(floorplanActionSchema.safeParse(raw).success).toBe(false)
    expect(interiorActionSchema.safeParse(raw).success).toBe(false)
  })

  it("rejects styleNotes longer than 240 chars", () => {
    const raw = { type: "aiRender", target: "exterior", styleNotes: "x".repeat(241) }
    expect(floorplanActionSchema.safeParse(raw).success).toBe(false)
    expect(interiorActionSchema.safeParse(raw).success).toBe(false)
  })

  it("accepts styleNotes at exactly the 240-char boundary", () => {
    const raw = { type: "aiRender", target: "exterior", styleNotes: "x".repeat(240) }
    expect(floorplanActionSchema.safeParse(raw).success).toBe(true)
  })

  it("rejects a missing target", () => {
    const raw = { type: "aiRender" }
    expect(floorplanActionSchema.safeParse(raw).success).toBe(false)
  })
})

describe("describeAction (aiRender)", () => {
  it("describes an exterior render request without a room", () => {
    expect(describeAction({ type: "aiRender", target: "exterior" }, floorplanScene)).toBe(
      "Buka dialog Render AI (eksterior)"
    )
  })

  it("resolves the room name from a floorplan scene for an interior request", () => {
    expect(
      describeAction({ type: "aiRender", target: "interior", roomId: "room-1" }, floorplanScene)
    ).toBe("Buka dialog Render AI (interior — Ruang Tamu)")
  })

  it("resolves the room name from an interior scene for an interior request", () => {
    expect(
      describeAction({ type: "aiRender", target: "interior", roomId: "room-1" }, interiorScene)
    ).toBe("Buka dialog Render AI (interior — Ruang Tamu)")
  })

  it("falls back to the raw roomId when it isn't resolvable in the scene", () => {
    expect(
      describeAction({ type: "aiRender", target: "interior", roomId: "room-ghost" }, floorplanScene)
    ).toBe("Buka dialog Render AI (interior — room-ghost)")
  })

  it("omits the room clause entirely when no roomId is given", () => {
    expect(describeAction({ type: "aiRender", target: "interior" }, floorplanScene)).toBe(
      "Buka dialog Render AI (interior)"
    )
  })
})
