import { describe, it, expect } from "vitest"

import { createProjectSchema } from "@/lib/schemas/project"

const valid = {
  name: "Rumah Contoh",
  city: "Surabaya",
  projectType: "new",
  style: "modern_tropis",
  widthM: 8,
  depthM: 12,
  frontOrientation: "east",
  sidesAttached: 2,
  frontRoadWidthM: 5,
  carport: true,
  siteNotes: "",
  floors: 2,
  rooftop: false,
  budgetMinIDR: 500_000_000,
  budgetMaxIDR: 900_000_000,
  finishingLevel: "menengah",
  priorities: ["terasa_lega"],
  rooms: [
    { roomType: "ruang_tamu", name: "Ruang tamu", required: true, quantity: 1, sizePreference: "standard" },
  ],
}

describe("createProjectSchema", () => {
  it("accepts valid input", () => {
    expect(createProjectSchema.safeParse(valid).success).toBe(true)
  })

  it("rejects a too-short name", () => {
    expect(createProjectSchema.safeParse({ ...valid, name: "R" }).success).toBe(false)
  })

  it("rejects land width below 3 m", () => {
    expect(createProjectSchema.safeParse({ ...valid, widthM: 2 }).success).toBe(false)
  })

  it("requires at least one priority", () => {
    expect(createProjectSchema.safeParse({ ...valid, priorities: [] }).success).toBe(false)
  })

  it("requires at least one room", () => {
    expect(createProjectSchema.safeParse({ ...valid, rooms: [] }).success).toBe(false)
  })
})
