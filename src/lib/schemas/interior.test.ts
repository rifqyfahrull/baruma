import { describe, expect, it } from "vitest"

import { savedInteriorSchema, type SavedInterior } from "./interior"

const valid: SavedInterior = {
  schemaVersion: 1,
  versionId: "ver-1",
  style: "modern_tropical",
  rooms: [
    {
      roomId: "room-1",
      materials: [
        {
          id: "mat-room-1-floor",
          roomId: "room-1",
          surface: "floor",
          materialId: "floor-cream-tile",
          name: "Homogeneous Tile Cream",
          areaM2: 12,
          priceRange: { low: 180_000, mid: 280_000, high: 650_000 },
        },
      ],
      furniture: [
        {
          id: "placed-room-1-sofa-3-seat-0",
          furnitureId: "sofa-3-seat",
          roomId: "room-1",
          name: "Sofa 3 Dudukan",
          category: "seating",
          x: 0.35,
          y: 0.45,
          rotationDeg: 0,
          widthM: 2.1,
          depthM: 0.9,
          heightM: 0.85,
          locked: false,
          priceRange: { low: 4_500_000, mid: 7_000_000, high: 12_000_000 },
        },
      ],
    },
  ],
}

describe("savedInteriorSchema", () => {
  it("parses a valid payload (round-trip)", () => {
    const parsed = savedInteriorSchema.parse(valid)
    expect(parsed).toEqual(valid)
  })

  it("rejects an unknown style", () => {
    const bad = { ...valid, style: "not_a_style" }
    expect(savedInteriorSchema.safeParse(bad).success).toBe(false)
  })

  it("rejects a furniture item with a missing field", () => {
    const bad = structuredClone(valid)
    // @ts-expect-error intentionally drop a required field
    delete bad.rooms[0].furniture[0].widthM
    expect(savedInteriorSchema.safeParse(bad).success).toBe(false)
  })

  it("accepts any numeric rotationDeg (free-angle rotation model)", () => {
    const free = structuredClone(valid)
    free.rooms[0].furniture[0].rotationDeg = 45
    expect(savedInteriorSchema.safeParse(free).success).toBe(true)
  })

  it("rejects a non-numeric rotationDeg", () => {
    const bad = structuredClone(valid)
    // @ts-expect-error invalid rotation type
    bad.rooms[0].furniture[0].rotationDeg = "45"
    expect(savedInteriorSchema.safeParse(bad).success).toBe(false)
  })

  it("accepts schemaVersion 2 (current) payloads", () => {
    const v2 = { ...structuredClone(valid), schemaVersion: 2 as const }
    expect(savedInteriorSchema.safeParse(v2).success).toBe(true)
  })
})
