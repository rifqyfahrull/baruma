import { describe, expect, it } from "vitest"

import { buildElevation } from "@/lib/drawings/elevation"
import { buildRoofDetail } from "@/lib/drawings/roof-detail"
import { buildSection } from "@/lib/drawings/section"
import { generateRAB } from "@/lib/mock/rab"
import { buildModel } from "@/lib/three/build-model"
import { floorplanSceneFromLayout } from "@/lib/assistant/scene"
import { sampleBrief, sampleProject } from "@/test-utils/fixtures"
import type { DesignLayout, Project, Room, RoofZone } from "@/types"

const floorId = "f1"
const sceneBRoofZones: RoofZone[] = [
  {
    id: "scene-b-gable",
    floorId,
    type: "pelana",
    x: 2,
    y: 1.5,
    widthM: 4,
    depthM: 3,
    slopeDeg: 35,
    overhangM: 0.3,
    materialId: "genteng_keramik",
  },
  {
    id: "scene-b-flat",
    floorId,
    type: "datar",
    x: 6,
    y: 1.5,
    widthM: 4,
    depthM: 3,
    slopeDeg: 0,
    overhangM: 0.2,
    materialId: "metal",
  },
]

function room(over: Partial<Room>): Room {
  return {
    id: "room",
    floorId,
    name: "Ruang",
    type: "ruang_tamu",
    x: 0,
    y: 0,
    width: 4,
    depth: 3,
    areaM2: 12,
    ...over,
  }
}

function sceneBLayout(): DesignLayout {
  return {
    id: "scene-b-roof-parity",
    projectId: "project-scene-b",
    versionId: "version-scene-b",
    floors: [{ id: floorId, level: 0, name: "Lantai 1", heightM: 3 }],
    rooms: [
      room({ id: "gable-mass", name: "Massa pelana", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 }),
      room({ id: "flat-mass", name: "Massa datar", x: 4, y: 0, width: 4, depth: 3, areaM2: 12 }),
    ],
    walls: [],
    openings: [],
    stairs: [],
    pools: [],
    roof: { type: "datar", slopeDeg: 0, overhangM: 0.2, material: "metal" },
    roofZones: sceneBRoofZones,
    validation: { passed: true, issues: [] },
  }
}

describe("Scene B roof-zone parity", () => {
  it("keeps the local gable roof local across 3D, drawings, AI scene, and RAB quantities", () => {
    const layout = sceneBLayout()

    const prims = buildModel(
      layout,
      { widthM: 8, depthM: 16 },
      { ...sampleProject, rooftop: false } as Project,
      { exploded: false, showRoof: true, showFurniture: false }
    ).prims
    const roofs = prims.filter((prim) => prim.id.startsWith("roof"))
    expect(roofs.map((prim) => prim.id).sort()).toEqual(["roof-zone-scene-b-flat", "roof-zone-scene-b-gable"])
    expect(roofs.some((prim) => prim.id === "roof")).toBe(false)
    expect(roofs.find((prim) => prim.id === "roof-zone-scene-b-gable")).toMatchObject({
      kind: "roof_gable",
      roofMaterial: "genteng_keramik",
      args: [4.3, 1.26, 3.6],
    })
    expect(roofs.find((prim) => prim.id === "roof-zone-scene-b-flat")).toMatchObject({
      kind: "roof",
      roofMaterial: "metal",
      args: [4.2, 0.15, 3.4],
    })

    const elevation = buildElevation(layout, "s")
    expect(elevation.lines.some((line) => line.refId === "scene-b-gable" && line.kind === "outline")).toBe(true)
    expect(elevation.lines).toContainEqual({
      x1: 3.8,
      y1: 3,
      x2: 8.2,
      y2: 3,
      kind: "slab",
      refId: "scene-b-flat",
    })
    expect(elevation.lines.some((line) => line.kind === "slab" && line.y1 === 3.15 && line.refId === undefined)).toBe(false)

    const section = buildSection(layout, { axis: "y", positionM: 1.5 })
    expect(section.lines.some((line) => line.refId === "scene-b-gable" && line.kind === "outline")).toBe(true)
    expect(section.lines.some((line) => line.refId === "scene-b-flat" && line.kind === "slab")).toBe(true)
    expect(section.lines.some((line) => line.kind === "slab" && line.y1 === 3.15 && line.refId === undefined)).toBe(false)

    const roofDetail = buildRoofDetail(layout)
    expect(roofDetail.labels).toContainEqual(
      expect.objectContaining({ refId: "scene-b-gable", text: "Atap Pelana — Genteng Keramik · 16.85 m²" })
    )
    expect(roofDetail.labels).toContainEqual(
      expect.objectContaining({ refId: "scene-b-flat", text: "Atap Datar — Metal · 13.2 m²" })
    )
    expect(roofDetail.labels.some((label) => label.text === "Material 30.05 m² · Tangkapan 24 m²")).toBe(true)

    const rab = generateRAB(sampleProject, sampleBrief, layout)
    const roofItems = rab.items.filter((item) => item.item.startsWith("Atap zona "))
    expect(roofItems.map((item) => item.sourceElementIds?.[0]).sort()).toEqual(["scene-b-flat", "scene-b-gable"])
    expect(roofItems.map((item) => item.volume).sort((a, b) => a - b)).toEqual([13.2, 16.9])

    const aiScene = floorplanSceneFromLayout(layout, { widthM: 8, depthM: 16, areaM2: 128 })
    expect(aiScene.roofZones.map((zone) => zone.id).sort()).toEqual(["scene-b-flat", "scene-b-gable"])
  })
})
