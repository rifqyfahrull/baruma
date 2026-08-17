import { describe, it, expect } from "vitest"

import { buildBriefFields } from "./build-brief"
import type { CreateProjectInput } from "@/lib/schemas/project"

const baseInput = (over: Partial<CreateProjectInput> = {}): CreateProjectInput => ({
  name: "Rumah A",
  city: "Bandung",
  projectType: "new",
  style: "modern_tropis",
  widthM: 8,
  depthM: 15,
  frontOrientation: "east",
  sidesAttached: 1,
  frontRoadWidthM: 6,
  carport: true,
  siteNotes: "hook lot",
  floors: 2,
  rooftop: false,
  budgetMinIDR: 500_000_000,
  budgetMaxIDR: 900_000_000,
  finishingLevel: "menengah",
  priorities: ["terasa_lega"],
  rooms: [
    { roomType: "kamar_tidur", name: "Kamar", required: true, quantity: 3, sizePreference: "standard" },
  ],
  ...over,
})

describe("buildBriefFields", () => {
  it("computes site area (w×d) and maps building budget", () => {
    const b = buildBriefFields(baseInput())
    expect(b.site.areaM2).toBe(120)
    expect(b.site.widthM).toBe(8)
    expect(b.building.budget).toEqual({ minIDR: 500_000_000, maxIDR: 900_000_000 })
    expect(b.building.floors).toBe(2)
    expect(b.building.finishingLevel).toBe("menengah")
  })

  it("adds a carport item when carport=true, omits when false", () => {
    expect(buildBriefFields(baseInput({ carport: true })).spaceProgram.some((i) => i.roomType === "carport")).toBe(true)
    expect(buildBriefFields(baseInput({ carport: false })).spaceProgram.some((i) => i.roomType === "carport")).toBe(false)
  })

  it("keeps user rooms with quantity/name", () => {
    const sp = buildBriefFields(baseInput({ carport: false })).spaceProgram
    expect(sp).toHaveLength(1)
    expect(sp[0]).toMatchObject({ roomType: "kamar_tidur", quantity: 3, name: "Kamar" })
  })

  it("summary reflects floors, rooftop, dimensions, and style", () => {
    const b = buildBriefFields(baseInput({ floors: 3, rooftop: true }))
    expect(b.summary).toContain("3 lantai")
    expect(b.summary).toContain("+ rooftop")
    expect(b.summary).toContain("8×15")
    expect(b.summary).toContain("modern_tropis")
  })

  it("flags structural risk for 3 floors and for a pool", () => {
    const tall = buildBriefFields(baseInput({ floors: 3 }))
    expect(tall.risks.some((r) => r.category === "structural" && r.level === "warning")).toBe(true)
    const pool = buildBriefFields(
      baseInput({ floors: 1, sidesAttached: 0, rooms: [{ roomType: "kolam", name: "Kolam", required: false, quantity: 1 }] })
    )
    expect(pool.risks.some((r) => r.title === "Kolam")).toBe(true)
  })

  it("always returns the 4 standard assumptions", () => {
    expect(buildBriefFields(baseInput()).assumptions).toHaveLength(4)
  })

  it("notes a narrow lot in constraints when widthM < 7", () => {
    expect(buildBriefFields(baseInput({ widthM: 6 })).constraints.join(" ")).toContain("sempit")
  })
})
