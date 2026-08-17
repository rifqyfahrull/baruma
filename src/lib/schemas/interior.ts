import { z } from "zod"

/**
 * Persisted interior "intent" (PRD interior persistence spec, 2026-06-26).
 * Stored as jsonb in project_interiors. Derived data (budget/warnings) is NOT
 * persisted — it is recomputed on load. `versionId` ties validity to the layout.
 */

export const interiorStyleEnum = z.enum([
  "modern_tropical",
  "warm_minimalist",
  "japandi",
  "scandinavian",
  "industrial",
  "luxury_compact",
  "family_cozy",
])

export const furnitureCategoryEnum = z.enum([
  "seating",
  "table",
  "bed",
  "wardrobe",
  "cabinet",
  "kitchen",
  "appliance",
  "lighting",
  "decor",
  "bathroom_fixture",
  "outdoor",
  "storage",
  "workspace",
  "prayer",
])

const priceRangeSchema = z.object({
  low: z.number(),
  mid: z.number(),
  high: z.number(),
})

const placedFurnitureSchema = z.object({
  id: z.string(),
  furnitureId: z.string(),
  roomId: z.string(),
  name: z.string(),
  category: furnitureCategoryEnum,
  x: z.number(),
  y: z.number(),
  rotationDeg: z.number(),
  widthM: z.number(),
  depthM: z.number(),
  heightM: z.number(),
  locked: z.boolean(),
  priceRange: priceRangeSchema,
  priceOverrideIDR: z.number().nullable().optional(),
  // semantic slot fields (furnimesh model ingestion)
  slotType: z.enum(["tv", "sofa", "coffee_table", "generic"]).nullable().optional(),
  modelAssetId: z.string().nullable().optional(),
  modelUrl: z.string().nullable().optional(),
  fitMode: z.enum(["fit_to_slot_width", "fit_to_slot_depth", "fit_to_slot_height", "use_real_size"]).nullable().optional(),
  materialMode: z.enum(["keep_original", "match_project_style", "customize"]).nullable().optional(),
  scaleFactor: z.object({ x: z.number(), y: z.number(), z: z.number() }).nullable().optional(),
})

const materialAssignmentSchema = z.object({
  id: z.string(),
  roomId: z.string(),
  surface: z.enum(["floor", "wall", "ceiling", "accent"]),
  materialId: z.string(),
  name: z.string(),
  areaM2: z.number(),
  priceRange: priceRangeSchema,
})

const lightingFixtureSchema = z.object({
  id: z.string(),
  roomId: z.string(),
  type: z.enum(["downlight", "pendant", "wall_lamp", "indirect", "task", "outdoor"]),
  x: z.number(),
  y: z.number(),
  heightM: z.number(),
  colorTemperature: z.enum(["warm", "neutral", "cool"]),
  qty: z.number(),
  priceRange: priceRangeSchema,
  watt: z.number().optional(),
})

const savedRoomSchema = z.object({
  roomId: z.string(),
  furniture: z.array(placedFurnitureSchema),
  materials: z.array(materialAssignmentSchema).optional(),
  lighting: z.array(lightingFixtureSchema).optional(),
})

export const savedInteriorSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  versionId: z.string(),
  style: interiorStyleEnum,
  rooms: z.array(savedRoomSchema),
})

export type SavedInterior = z.infer<typeof savedInteriorSchema>
