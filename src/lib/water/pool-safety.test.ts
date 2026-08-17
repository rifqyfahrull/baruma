import { describe, expect, it } from "vitest"

import { poolSafetyIssues } from "./pool-safety"
import type { Brief, DesignLayout } from "@/types"

const floors = [
  { id: "floor-1", level: 1, name: "Lantai 1", heightM: 3 },
  { id: "floor-rooftop", level: 3, name: "Rooftop", heightM: 3 },
]
const poolAt = (floorId: string) => ({
  id: "room-pool", floorId, name: "Kolam", type: "kolam" as const,
  x: 1, y: 1, width: 4, depth: 8, areaM2: 32, poolKind: "renang" as const,
})
const briefNoKids = { spaceProgram: [] } as unknown as Brief
const briefKids = {
  spaceProgram: [{ roomType: "kamar_anak", name: "Kamar Anak", required: true, quantity: 1 }],
} as unknown as Brief

describe("poolSafetyIssues", () => {
  it("kolam di dak → danger beban ton (air ~1 t/m³)", () => {
    const issues = poolSafetyIssues(
      { rooms: [poolAt("floor-rooftop")], floors } as DesignLayout, briefNoKids)
    const load = issues.find((i) => i.level === "danger")
    expect(load).toBeDefined()
    expect(load!.message).toContain("48 ton") // volume 32×1.5 = 48
  })

  it("kolam lantai dasar tanpa anak → tanpa issue", () => {
    const issues = poolSafetyIssues(
      { rooms: [poolAt("floor-1")], floors } as DesignLayout, briefNoKids)
    expect(issues).toHaveLength(0)
  })

  it("ada kamar anak → warning pagar pengaman", () => {
    const issues = poolSafetyIssues(
      { rooms: [poolAt("floor-1")], floors } as DesignLayout, briefKids)
    expect(issues.some((i) => i.level === "warning" && /pagar pengaman/i.test(i.message))).toBe(true)
  })
})
