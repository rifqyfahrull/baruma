import type { FurnitureCategory } from "@/types"

export type Archetype =
  | "seating" | "bed" | "table" | "wardrobe" | "cabinet"
  | "appliance" | "kitchen" | "bathroom" | "decor_flat" | "generic"

export type FurnitureSource =
  | { kind: "glb"; url: string }
  | { kind: "procedural"; archetype: Archetype }
  | { kind: "box" }

/**
 * furnitureId → GLB served from `/models/<name>.glb`. Only items with a real,
 * furniture-scale model whose proportions suit the item's footprint. Items not
 * listed fall back to the procedural archetype for their category.
 *
 * STORAGE, NOT GIT: the GLB binaries are NOT committed (see .gitignore's
 * `public/models/*.glb`). They live in object storage under
 * `asset-library/catalog/furniture/<name>.glb` and are synced with
 * `scripts/sync-catalog-models.mjs` (`upload` from a dev machine, `download`
 * at deploy time — wired into the deploy workflow before `next build`). Adding
 * a model here means: drop the file in public/models locally, add the entry,
 * then `node scripts/sync-catalog-models.mjs upload`.
 *
 * The 2026-07 batch was curated from the local SketchUp asset bank
 * (Baruma-asset) via a Blender-headless SKP→GLB pipeline (Draco-compressed,
 * bbox-checked against the catalog dims, thumbnail-QA'd). Because
 * computeFitTransform uniform-scales WITHOUT rotating, each model was
 * pre-oriented width-along-X before export — re-conversions must preserve that.
 *
 * Items intentionally left procedural (no dimensionally-honest single-object
 * model in the bank — every candidate was a multi-object showroom scene, or
 * an open-shelf/vase whose proportions fight the catalog footprint):
 * wardrobe-2m, wardrobe-free, planter.
 */
export const FURNITURE_MODEL_REGISTRY: Record<string, string> = {
  "queen-bed": "/models/bed-queen-b19.glb",
  "single-bed": "/models/bed.glb",
  "sofa-3-seat": "/models/sofa-chesterfield.glb",
  "sofa-l": "/models/sofa-l-bend.glb",
  "coffee-table": "/models/coffee-table-wood.glb",
  "tv-cabinet": "/models/tv-cabinet-lazzoni.glb",
  "tv-55": "/models/tv-55.glb",
  "rug-large": "/models/rug-area.glb",
  "side-table": "/models/side-table-round.glb",
  "dining-table-4": "/models/dining-table-edo.glb",
  fridge: "/models/fridge.glb",
  "bathroom-shower": "/models/shower-cabin.glb",
  "bathroom-vanity": "/models/vanity-basin.glb",
  toilet: "/models/toilet-toto.glb",
  "prayer-rug-area": "/models/rug-prayer-area.glb",
  "laundry-machine": "/models/washer-lg.glb",
  "outdoor-sofa": "/models/outdoor-sofa.glb",
  "work-desk": "/models/work-desk.glb",
  "kitchen-linear": "/models/kitchen-linear.glb",
  "quran-shelf": "/models/quran-shelf.glb",
}

const CATEGORY_ARCHETYPE: Record<FurnitureCategory, Archetype> = {
  seating: "seating",
  table: "table",
  bed: "bed",
  wardrobe: "wardrobe",
  cabinet: "cabinet",
  kitchen: "kitchen",
  appliance: "appliance",
  lighting: "generic",
  decor: "decor_flat",
  bathroom_fixture: "bathroom",
  outdoor: "seating",
  storage: "cabinet",
  workspace: "table",
  prayer: "decor_flat",
}

export function archetypeForCategory(category: FurnitureCategory): Archetype | null {
  return CATEGORY_ARCHETYPE[category] ?? null
}

export function resolveFurnitureSource(item: {
  furnitureId: string
  category: FurnitureCategory
}): FurnitureSource {
  const url = FURNITURE_MODEL_REGISTRY[item.furnitureId]
  if (url) return { kind: "glb", url }
  const archetype = archetypeForCategory(item.category)
  if (archetype) return { kind: "procedural", archetype }
  return { kind: "box" }
}

export function registeredModelUrls(): string[] {
  return Array.from(new Set(Object.values(FURNITURE_MODEL_REGISTRY)))
}
