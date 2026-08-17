import { describe, expect, it } from "vitest"

import { certificationScene, certificationScenes } from "./certification-scenes"
import { landscapeClearanceIssues, landscapePlacements } from "@/lib/three/landscape"
import { buildPreviewSceneStats } from "@/lib/three/scene-stats"
import { validateExteriorElement, validateRoofZones } from "./validation"

describe("certification exterior scenes", () => {
  it("keeps stable scene ids for regression fixtures", () => {
    const once = certificationScenes().map((scene) => ({
      id: scene.id,
      exteriorIds: scene.layout.exteriorElements?.map((element) => element.id),
      facadeElementIds: scene.layout.facadeElements?.map((element) => element.id),
      roofZoneIds: scene.layout.roofZones?.map((zone) => zone.id),
    }))
    const twice = certificationScenes().map((scene) => ({
      id: scene.id,
      exteriorIds: scene.layout.exteriorElements?.map((element) => element.id),
      facadeElementIds: scene.layout.facadeElements?.map((element) => element.id),
      roofZoneIds: scene.layout.roofZones?.map((zone) => zone.id),
    }))

    expect(twice).toEqual(once)
  })

  it("validates every shipped certification scene against exterior contracts and render budgets", () => {
    for (const scene of certificationScenes()) {
      const validFloorIds = new Set(scene.layout.floors.map((floor) => floor.id))
      const exteriorDangerIssues = (scene.layout.exteriorElements ?? [])
        .flatMap((element) => validateExteriorElement(element, { site: scene.site, validFloorIds }))
        .filter((issue) => issue.level === "danger")
      const roofDangerIssues = validateRoofZones(scene.layout.roofZones ?? [], scene.site)
        .filter((issue) => issue.level === "danger")
      const stats = buildPreviewSceneStats(scene.layout, scene.site, scene.project, {
        showRoof: true,
        showFurniture: false,
        realistic: true,
      })

      expect(exteriorDangerIssues).toEqual([])
      expect(roofDangerIssues).toEqual([])
      expect(landscapeClearanceIssues(scene.layout)).toEqual([])
      expect(stats.ok).toBe(true)
      expect(stats.drawCalls).toBeLessThanOrEqual(stats.budgets.drawCalls.limit)
      expect(stats.triangles).toBeLessThanOrEqual(stats.budgets.trianglesMobile.limit)
      expect(stats.byKind.exterior).toBeGreaterThan(8)
      expect(stats.textureMemoryBytes).toBeGreaterThan(0)
    }
  })

  it("locks Scene A as the modern concrete vertical facade reference", () => {
    const scene = certificationScene("scene-a-modern-concrete")
    const exterior = scene.layout.exteriorElements ?? []

    expect(exterior.filter((element) => element.kind === "facade_panel")).toHaveLength(5)
    expect(exterior.some((element) => element.kind === "portal_frame")).toBe(true)
    expect(exterior.some((element) => element.kind === "canopy")).toBe(true)
    expect(exterior.some((element) => element.kind === "sliding_gate")).toBe(true)
    expect(exterior.some((element) => element.kind === "driveway")).toBe(true)
    expect(exterior.some((element) => element.kind === "vehicle")).toBe(true)
  })

  it("locks Scene B as the brick gable roster and landscape reference", () => {
    const scene = certificationScene("scene-b-brick-gable")
    const exterior = scene.layout.exteriorElements ?? []
    const placements = landscapePlacements(scene.layout)

    expect(scene.layout.roofZones?.some((zone) => zone.type === "pelana")).toBe(true)
    expect(scene.layout.facadeElements?.some((element) => element.kind === "roster_screen")).toBe(true)
    expect(exterior.some((element) => element.kind === "garden_bed")).toBe(true)
    expect(exterior.some((element) => element.kind === "plant")).toBe(true)
    expect(placements.some((placement) => placement.sourceType === "garden_bed")).toBe(true)
  })
})
