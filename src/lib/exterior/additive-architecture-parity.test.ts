import { describe, expect, it } from "vitest"

import { buildElevation } from "@/lib/drawings/elevation"
import { buildLayoutSheet } from "@/lib/drawings/layout-sheet"
import { generateRAB } from "@/lib/mock/rab"
import { buildPreviewSceneStats } from "@/lib/three/scene-stats"
import { sampleBrief } from "@/test-utils/fixtures"
import { certificationScene } from "./certification-scenes"
import { exteriorElementQuantities } from "./quantities"

function lineRefs(lines: Array<{ refId?: string }>): Set<string> {
  return new Set(lines.map((line) => line.refId).filter(Boolean) as string[])
}

describe("additive architecture parity — Scene A", () => {
  const scene = certificationScene("scene-a-modern-concrete")
  const additive = scene.layout.exteriorElements?.filter((element) =>
    element.kind === "portal_frame" ||
    element.kind === "canopy" ||
    element.kind === "facade_panel" ||
    element.kind === "planter"
  ) ?? []

  it("keeps Scene A additive architecture complete as native semantic elements", () => {
    expect(additive.filter((element) => element.kind === "facade_panel")).toHaveLength(5)
    expect(additive.some((element) => element.kind === "portal_frame")).toBe(true)
    expect(additive.some((element) => element.kind === "canopy")).toBe(true)
    expect(additive.some((element) => element.kind === "planter")).toBe(true)
    expect(additive.every((element) => element.floorId === "floor-1")).toBe(true)
  })

  it("renders additive elements into 3D scene stats without breaking performance budget", () => {
    const stats = buildPreviewSceneStats(scene.layout, scene.site, scene.project, {
      showRoof: true,
      showFurniture: false,
      realistic: true,
    })

    expect(stats.ok).toBe(true)
    expect(stats.byKind.exterior).toBeGreaterThanOrEqual(additive.length)
    expect(stats.semanticObjects).toBeGreaterThan(additive.length)
  })

  it("projects additive elements into plan and front elevation with stable refs", () => {
    const plan = buildLayoutSheet(scene.layout, "floor-1")
    const elevation = buildElevation(scene.layout, "s")
    const planRefs = lineRefs(plan.lines)
    const elevationRefs = lineRefs(elevation.lines)

    for (const element of additive) {
      expect(planRefs.has(element.id), `${element.id} missing from plan`).toBe(true)
      expect(elevationRefs.has(element.id), `${element.id} missing from south elevation`).toBe(true)
    }
  })

  it("feeds additive native quantities into RAB with sourceElementIds", () => {
    const rab = generateRAB(scene.project, sampleBrief, scene.layout)
    const rabSourceIds = new Set(
      rab.items.flatMap((item) => item.sourceElementIds ?? [])
    )

    for (const element of additive) {
      const quantities = exteriorElementQuantities(element)
      expect(quantities.every((quantity) => quantity.included)).toBe(true)
      expect(rabSourceIds.has(element.id), `${element.id} missing from RAB`).toBe(true)
    }
  })
})
