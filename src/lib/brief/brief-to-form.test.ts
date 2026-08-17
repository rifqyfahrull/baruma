import { describe, it, expect } from "vitest"

import { buildBriefFields } from "./build-brief"
import { briefToFormValues } from "./brief-to-form"
import type { Brief, Project } from "@/types"
import type { CreateProjectInput } from "@/lib/schemas/project"

const input: CreateProjectInput = {
  name: "Rumah A",
  city: "Bandung",
  projectType: "new",
  style: "japandi",
  widthM: 9,
  depthM: 14,
  frontOrientation: "south",
  sidesAttached: 1,
  frontRoadWidthM: 5,
  carport: true,
  siteNotes: "hook lot",
  floors: 2,
  rooftop: true,
  budgetMinIDR: 600_000_000,
  budgetMaxIDR: 1_100_000_000,
  finishingLevel: "premium",
  priorities: ["terasa_lega", "banyak_cahaya"],
  rooms: [
    { roomType: "kamar_tidur", name: "Kamar", required: true, quantity: 3, sizePreference: "standard" },
    { roomType: "dapur", name: "Dapur", required: true, quantity: 1, sizePreference: "standard" },
  ],
}

const project = {
  name: "Rumah A",
  city: "Bandung",
  projectType: "new",
  style: "japandi",
} as Project

const briefFrom = (i: CreateProjectInput): Brief => ({ projectId: "p1", ...buildBriefFields(i) })

describe("briefToFormValues", () => {
  it("round-trips form input through a brief and back (key fields)", () => {
    const recovered = briefToFormValues(briefFrom(input), project)
    expect(recovered.widthM).toBe(input.widthM)
    expect(recovered.depthM).toBe(input.depthM)
    expect(recovered.floors).toBe(input.floors)
    expect(recovered.rooftop).toBe(input.rooftop)
    expect(recovered.budgetMinIDR).toBe(input.budgetMinIDR)
    expect(recovered.budgetMaxIDR).toBe(input.budgetMaxIDR)
    expect(recovered.finishingLevel).toBe(input.finishingLevel)
    expect(recovered.priorities).toEqual(input.priorities)
    expect(recovered.frontOrientation).toBe(input.frontOrientation)
  })

  it("derives carport=true from the carport item and excludes it from rooms", () => {
    const recovered = briefToFormValues(briefFrom(input), project)
    expect(recovered.carport).toBe(true)
    expect(recovered.rooms.some((r) => (r.roomType as string) === "carport")).toBe(false)
    expect(recovered.rooms.map((r) => r.roomType)).toEqual(["kamar_tidur", "dapur"])
  })

  it("derives carport=false when no carport item exists", () => {
    expect(briefToFormValues(briefFrom({ ...input, carport: false }), project).carport).toBe(false)
  })

  it("defaults style when the project has none", () => {
    const p2 = { ...project, style: undefined } as Project
    expect(briefToFormValues(briefFrom(input), p2).style).toBe("modern_tropis")
  })

  it("the recovered input rebuilds the same brief fields (stable round-trip)", () => {
    const recovered = briefToFormValues(briefFrom(input), project)
    const rebuilt = buildBriefFields(recovered)
    const original = buildBriefFields(input)
    expect(rebuilt.site).toEqual(original.site)
    expect(rebuilt.building).toEqual(original.building)
    expect(rebuilt.summary).toEqual(original.summary)
    expect(rebuilt.spaceProgram.map((r) => r.roomType)).toEqual(original.spaceProgram.map((r) => r.roomType))
  })
})
