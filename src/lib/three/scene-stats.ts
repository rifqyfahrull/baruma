import type { DesignLayout, Project } from "@/types"
import { buildModel, type Model, type Prim, type PrimKind } from "@/lib/three/build-model"
import { surfaceForKind } from "@/lib/three/surface"

export type SceneStatsBudgetKey = "drawCalls" | "trianglesDesktop" | "trianglesMobile"

export type SceneStatsBudgetStatus = {
  key: SceneStatsBudgetKey
  value: number
  limit: number
  ok: boolean
}

export type SceneStats = {
  semanticObjects: number
  prims: number
  meshes: number
  instances: number
  drawCalls: number
  triangles: number
  textureCount: number
  textureMemoryBytes: number
  byKind: Record<PrimKind, number>
  budgets: Record<SceneStatsBudgetKey, SceneStatsBudgetStatus>
  ok: boolean
}

export const SCENE_STATS_BUDGETS: Record<SceneStatsBudgetKey, number> = {
  drawCalls: 300,
  trianglesDesktop: 1_500_000,
  trianglesMobile: 400_000,
}

const PROCEDURAL_TEXTURE_BYTES = 256 * 256 * 4

function emptyKindCounts(): Record<PrimKind, number> {
  return {
    slab: 0,
    tile: 0,
    garden: 0,
    pool: 0,
    wall: 0,
    riser: 0,
    door: 0,
    window: 0,
    furniture: 0,
    roof: 0,
    roof_gable: 0,
    roof_hip: 0,
    roof_skillion: 0,
    roof_glass: 0,
    wall_gable: 0,
    fascia: 0,
    rail: 0,
    rail_glass: 0,
    louver: 0,
    stair: 0,
    exterior: 0,
  }
}

export function estimatePrimTriangles(prim: Pick<Prim, "kind" | "surfacePoints">): number {
  if (prim.surfacePoints?.length) return Math.max(0, prim.surfacePoints.length - 2)
  switch (prim.kind) {
    case "roof_gable":
    case "roof_hip":
    case "roof_skillion":
      return 8
    case "wall_gable":
      return 16
    default:
      return 12
  }
}

export function countSemanticObjects(layout: DesignLayout): number {
  // Tangga/kolam nyata = Room type:"tangga"/"kolam" → sudah terhitung di
  // layout.rooms.length. Array layout.stairs/pools dorman (selalu []) tidak
  // dihitung lagi (TG-6/KL-8).
  return (
    layout.rooms.length +
    layout.openings.length +
    (layout.facadeElements?.length ?? 0) +
    (layout.exteriorElements?.length ?? 0) +
    (layout.roofZones?.length ?? (layout.roof ? 1 : 0)) +
    (layout.exteriorLamps?.length ?? 0)
  )
}

export function summarizeModelStats(
  model: Model,
  layout: DesignLayout,
  opts: { realistic?: boolean } = {}
): SceneStats {
  const byKind = emptyKindCounts()
  const textureKinds = new Set<string>()
  let triangles = 0

  for (const prim of model.prims) {
    byKind[prim.kind] += 1
    triangles += estimatePrimTriangles(prim)
    const surface = surfaceForKind(prim.kind)
    if (opts.realistic && surface) textureKinds.add(surface)
  }

  const meshes = model.prims.length
  const drawCalls = meshes
  const textureCount = textureKinds.size
  const budgets = {
    drawCalls: budgetStatus("drawCalls", drawCalls),
    trianglesDesktop: budgetStatus("trianglesDesktop", triangles),
    trianglesMobile: budgetStatus("trianglesMobile", triangles),
  }

  return {
    semanticObjects: countSemanticObjects(layout),
    prims: model.prims.length,
    meshes,
    instances: 0,
    drawCalls,
    triangles,
    textureCount,
    textureMemoryBytes: textureCount * PROCEDURAL_TEXTURE_BYTES,
    byKind,
    budgets,
    ok: Object.values(budgets).every((budget) => budget.ok),
  }
}

function budgetStatus(key: SceneStatsBudgetKey, value: number): SceneStatsBudgetStatus {
  const limit = SCENE_STATS_BUDGETS[key]
  return { key, value, limit, ok: value <= limit }
}

export function buildPreviewSceneStats(
  layout: DesignLayout,
  site: { widthM: number; depthM: number },
  project: Project,
  opts: { exploded?: boolean; showRoof?: boolean; showFurniture?: boolean; realistic?: boolean } = {}
): SceneStats {
  const model = buildModel(layout, site, project, {
    exploded: opts.exploded ?? false,
    showRoof: opts.showRoof ?? true,
    showFurniture: opts.showFurniture ?? false,
  })
  return summarizeModelStats(model, layout, { realistic: opts.realistic ?? true })
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${Math.round(kb)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}
