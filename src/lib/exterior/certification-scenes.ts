import type { DesignLayout, ExteriorElement, Project, Site } from "@/types"
import { buildFacadeComposerTemplate } from "@/lib/exterior/facade-templates"
import {
  defaultModelRef,
  makeAssetElement,
  makeRoofZone,
  makeSurfaceElement,
} from "@/lib/exterior/factories"

export type CertificationSceneId =
  | "scene-a-modern-concrete"
  | "scene-b-brick-gable"

export type CertificationScene = {
  id: CertificationSceneId
  label: string
  description: string
  project: Project
  site: Site
  layout: DesignLayout
}

const ISO = "2026-07-15T00:00:00.000Z"

function project(id: CertificationSceneId, name: string, site: Site): Project {
  return {
    id,
    name,
    status: "editing",
    readiness: "concept_ready",
    projectType: "new",
    thumbnail: "vertical",
    style: "modern_tropis",
    site,
    floors: 2,
    rooftop: false,
    createdAt: ISO,
    updatedAt: ISO,
  }
}

function normalizeTemplateIds(sceneId: CertificationSceneId, elements: ExteriorElement[]): ExteriorElement[] {
  return elements.map((element, index) => ({
    ...element,
    id: `${sceneId}-${element.kind}-${index + 1}`,
  }))
}

function applyFacadeTemplate(
  layout: DesignLayout,
  site: Site,
  sceneId: CertificationSceneId,
  templateId: Parameters<typeof buildFacadeComposerTemplate>[2],
): DesignLayout {
  const template = buildFacadeComposerTemplate(layout, site, templateId)
  return {
    ...layout,
    facade: template.facade,
    facadeElements: template.facadeElements,
    exteriorElements: normalizeTemplateIds(sceneId, template.exteriorElements),
  }
}

function sceneAModernConcrete(): CertificationScene {
  const id = "scene-a-modern-concrete"
  const site: Site = {
    widthM: 14,
    depthM: 18,
    areaM2: 252,
    city: "Jakarta",
    province: "DKI Jakarta",
    frontOrientation: "south",
    frontRoadWidthM: 6,
  }
  const base: DesignLayout = {
    id: `${id}-layout`,
    projectId: id,
    versionId: `${id}-v1`,
    floors: [
      { id: "floor-1", level: 0, name: "Lantai 1", heightM: 3.1 },
      { id: "floor-2", level: 1, name: "Lantai 2", heightM: 3.1 },
    ],
    rooms: [
      { id: "a-carport", floorId: "floor-1", name: "Carport", type: "carport", x: 0.6, y: 11.2, width: 5.2, depth: 5.2, areaM2: 27.04 },
      { id: "a-living", floorId: "floor-1", name: "Ruang Tamu", type: "ruang_tamu", x: 5.8, y: 10.8, width: 3.6, depth: 5.6, areaM2: 20.16 },
      { id: "a-kitchen", floorId: "floor-1", name: "Dapur", type: "dapur", x: 9.4, y: 10.8, width: 3.6, depth: 5.6, areaM2: 20.16 },
      { id: "a-bedroom", floorId: "floor-2", name: "Kamar Depan", type: "kamar_tidur", x: 1.2, y: 9.8, width: 5.2, depth: 5.4, areaM2: 28.08 },
      { id: "a-family", floorId: "floor-2", name: "Ruang Keluarga", type: "ruang_keluarga", x: 6.4, y: 9.8, width: 6.2, depth: 5.4, areaM2: 33.48 },
    ],
    walls: [],
    openings: [
      { id: "a-w-living", floorId: "floor-1", wallId: "a-living:s", type: "window", kind: "curtain_wall", positionM: 1.8, widthM: 2.8, heightM: 2.2, sillHeightM: 0.35 },
      { id: "a-d-living", floorId: "floor-1", wallId: "a-living:s", type: "door", kind: "sliding_glass_door", positionM: 1, widthM: 1.4, heightM: 2.3 },
      { id: "a-w-bedroom", floorId: "floor-2", wallId: "a-bedroom:s", type: "window", kind: "curtain_wall", positionM: 2.6, widthM: 4.4, heightM: 2.1, sillHeightM: 0.45 },
      { id: "a-w-family", floorId: "floor-2", wallId: "a-family:s", type: "window", kind: "fixed_window", positionM: 3.1, widthM: 2.8, heightM: 1.8, sillHeightM: 0.7 },
    ],
    stairs: [],
    pools: [],
    roofZones: [
      makeRoofZone("datar", 3.7, 12.8, { id: "a-roof-left-flat", floorId: "floor-2", widthM: 6.2, depthM: 5.8, slopeDeg: 0, overhangM: 0.45, materialId: "metal" }),
      makeRoofZone("datar", 9.5, 12.8, { id: "a-roof-right-flat", floorId: "floor-2", widthM: 5.4, depthM: 5.8, slopeDeg: 0, overhangM: 0.45, materialId: "metal" }),
    ],
    validation: { passed: true, issues: [] },
  }
  const layout = applyFacadeTemplate(base, site, id, "modern_concrete_vertical")
  layout.exteriorElements = [
    ...(layout.exteriorElements ?? []),
    makeSurfaceElement("garden_bed", [
      { x: 10.4, y: 5.8 },
      { x: 13.2, y: 5.8 },
      { x: 13.2, y: 9.2 },
      { x: 10.4, y: 9.2 },
    ], {
      id: "a-garden-bed-side",
      floorId: "floor-1",
      label: "Certification: taman samping",
      material: { materialId: "tanah_taman" },
      scatterSeed: 101,
    }),
    makeAssetElement("tree", 12.4, 7.3, defaultModelRef({ modelAssetId: "global-tree-cert", fitMode: "fit_envelope" }), {
      id: "a-tree-side",
      floorId: "floor-1",
      label: "Certification: pohon samping",
      widthM: 1.6,
      depthM: 1.6,
      heightM: 3.4,
      material: { materialId: "kayu_alder" },
    }),
    makeAssetElement("vehicle", 2.8, 14.2, defaultModelRef({ modelAssetId: "global-car-cert", fitMode: "fit_envelope" }), {
      id: "a-car-carport",
      floorId: "floor-1",
      label: "Certification: mobil carport",
      widthM: 2,
      depthM: 4.2,
      heightM: 1.45,
      material: { materialId: "metal_gelap" },
    }),
  ]

  return {
    id,
    label: "Scene A — Modern Concrete Vertical",
    description: "Rumah dua lantai dengan portal, canopy, lima panel beton vertikal, pagar/gate, carport, dan taman samping.",
    project: project(id, "Certification Scene A", site),
    site,
    layout,
  }
}

function sceneBBrickGable(): CertificationScene {
  const id = "scene-b-brick-gable"
  const site: Site = {
    widthM: 10,
    depthM: 16,
    areaM2: 160,
    city: "Bandung",
    province: "Jawa Barat",
    frontOrientation: "south",
    frontRoadWidthM: 5,
  }
  const base: DesignLayout = {
    id: `${id}-layout`,
    projectId: id,
    versionId: `${id}-v1`,
    floors: [
      { id: "floor-1", level: 0, name: "Lantai 1", heightM: 3 },
      { id: "floor-2", level: 1, name: "Lantai 2", heightM: 3 },
    ],
    rooms: [
      { id: "b-carport", floorId: "floor-1", name: "Carport", type: "carport", x: 0.5, y: 10.8, width: 3.4, depth: 4.6, areaM2: 15.64 },
      { id: "b-living", floorId: "floor-1", name: "Ruang Tamu", type: "ruang_tamu", x: 3.9, y: 10.8, width: 3.2, depth: 4.6, areaM2: 14.72 },
      { id: "b-service", floorId: "floor-1", name: "Service", type: "dapur", x: 7.1, y: 10.8, width: 2.2, depth: 4.6, areaM2: 10.12 },
      { id: "b-bedroom", floorId: "floor-2", name: "Kamar Atas", type: "kamar_tidur", x: 0.8, y: 8.6, width: 4.2, depth: 5.4, areaM2: 22.68 },
      { id: "b-family", floorId: "floor-2", name: "Ruang Atas", type: "ruang_keluarga", x: 5, y: 8.6, width: 4.2, depth: 5.4, areaM2: 22.68 },
    ],
    walls: [],
    openings: [
      { id: "b-roster-main", floorId: "floor-1", wallId: "b-living:s", type: "window", kind: "roster", positionM: 1.6, widthM: 2.2, heightM: 2.4, sillHeightM: 0.35 },
      { id: "b-d-main", floorId: "floor-1", wallId: "b-service:s", type: "door", kind: "pivot_door", positionM: 1.1, widthM: 1.1, heightM: 2.4 },
      { id: "b-w-bedroom", floorId: "floor-2", wallId: "b-bedroom:s", type: "window", kind: "jalousie_window", positionM: 2.1, widthM: 2.8, heightM: 1.6, sillHeightM: 0.8 },
      { id: "b-w-family", floorId: "floor-2", wallId: "b-family:s", type: "window", kind: "fixed_window", positionM: 2.1, widthM: 2.4, heightM: 1.7, sillHeightM: 0.75 },
    ],
    stairs: [],
    pools: [],
    roofZones: [
      makeRoofZone("pelana", 3, 11.3, { id: "b-roof-gable-brick", floorId: "floor-2", widthM: 5, depthM: 5.8, slopeDeg: 35, overhangM: 0.5, materialId: "genteng_keramik" }),
      makeRoofZone("datar", 7.5, 11.3, { id: "b-roof-flat-carport", floorId: "floor-2", widthM: 4, depthM: 5.8, slopeDeg: 0, overhangM: 0.35, materialId: "metal" }),
    ],
    validation: { passed: true, issues: [] },
  }
  const layout = applyFacadeTemplate(base, site, id, "brick_gable_roster")
  layout.exteriorElements = [
    ...(layout.exteriorElements ?? []),
    makeSurfaceElement("garden_bed", [
      { x: 6.9, y: 5.5 },
      { x: 9.2, y: 5.5 },
      { x: 9.2, y: 8.8 },
      { x: 6.9, y: 8.8 },
    ], {
      id: "b-garden-bed-front",
      floorId: "floor-1",
      label: "Certification: taman depan roster",
      material: { materialId: "tanah_taman" },
      scatterSeed: 202,
    }),
    makeAssetElement("plant", 8.1, 7.1, defaultModelRef({ modelAssetId: "global-plant-cert", fitMode: "fit_envelope" }), {
      id: "b-plant-front",
      floorId: "floor-1",
      label: "Certification: tanaman depan",
      widthM: 0.9,
      depthM: 0.9,
      heightM: 1.2,
      material: { materialId: "kayu_alder" },
    }),
  ]

  return {
    id,
    label: "Scene B — Brick Gable Roster",
    description: "Rumah kompak dua lantai dengan gable bata, roster/krawangan, carport, walkway, gate, dan planting bed.",
    project: project(id, "Certification Scene B", site),
    site,
    layout,
  }
}

export function certificationScenes(): CertificationScene[] {
  return [sceneAModernConcrete(), sceneBBrickGable()]
}

export function certificationScene(id: CertificationSceneId): CertificationScene {
  return certificationScenes().find((scene) => scene.id === id) ?? sceneAModernConcrete()
}
