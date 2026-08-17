/** 3D material presets (PRD §10.7). Plain hex colors consumed by basic meshes. */

import type { TextureKind } from "./textures"

export type MaterialPresetId =
  | "modern_tropis"
  | "minimalis"
  | "industrial"
  | "japandi"
  | "warm_wood"

/** Surfaces that carry web-PBR params (roughness/metalness + optional map). */
export type PbrSurface = "wall" | "floor" | "roof" | "glass"

/** web-PBR params for one surface. `texture` names a procedural map (T10 `textures.ts`). */
export type SurfacePbr = {
  roughness: number
  metalness: number
  texture?: TextureKind
}

/**
 * Physical surface response, shared across the color presets (roughness/metalness
 * describe the material, not its hue). Consumed by the meshes in T11 alongside the
 * flat preset colors below, which stay the base `color` that the map modulates.
 */
export const SURFACE_PBR: Record<PbrSurface, SurfacePbr> = {
  wall: { roughness: 0.9, metalness: 0, texture: "wall" },
  floor: { roughness: 0.4, metalness: 0, texture: "floor" },
  roof: { roughness: 0.8, metalness: 0, texture: "roof" },
  glass: { roughness: 0.1, metalness: 0.2, texture: "glass" },
}

export type MaterialPreset = {
  label: string
  wall: string
  floor: string
  roof: string
  accent: string
  /** Per-surface web-PBR params (roughness/metalness + optional procedural map). */
  pbr: Record<PbrSurface, SurfacePbr>
}

export const MATERIAL_PRESETS: Record<MaterialPresetId, MaterialPreset> = {
  modern_tropis: {
    label: "Modern Tropis",
    wall: "#f4efe4",
    floor: "#d9cfbd",
    roof: "#46564d",
    accent: "#3a7d6e",
    pbr: SURFACE_PBR,
  },
  minimalis: {
    label: "Minimalis Putih",
    wall: "#fbfbfb",
    floor: "#e6e6e6",
    roof: "#cfd2d6",
    accent: "#8d9aa0",
    pbr: SURFACE_PBR,
  },
  industrial: {
    label: "Industrial",
    wall: "#928d86",
    floor: "#6f6b65",
    roof: "#3b3a38",
    accent: "#b0703a",
    pbr: SURFACE_PBR,
  },
  japandi: {
    label: "Japandi",
    wall: "#e8e1d4",
    floor: "#bb9d77",
    roof: "#6b5d4f",
    accent: "#7c8b7a",
    pbr: SURFACE_PBR,
  },
  warm_wood: {
    label: "Warm Wood",
    wall: "#cdab7e",
    floor: "#a87c4f",
    roof: "#5a4636",
    accent: "#d98e44",
    pbr: SURFACE_PBR,
  },
}

export const MATERIAL_PRESET_LIST = Object.entries(MATERIAL_PRESETS).map(
  ([id, p]) => ({ id: id as MaterialPresetId, label: p.label })
)

/** Colors shared across presets. */
export const SHARED_COLORS = {
  door: "#8a5a33",
  window: "#a9cfe3",
  pool: "#3f86c0",
  ground: "#ccd3cb",
  rail: "#5b5b5b",
  furniture: "#9b8e7d",
  garden: "#8fae7d",
  selected: "#2bb39a",
  hover: "#7fd0c2",
}

/** Extra `meshPhysicalMaterial` params for transmissive "Kaca realistis" glass. */
export type GlassPhysicalProps = {
  transmission: number
  ior: number
  thickness: number
  roughness: number
  clearcoat: number
  clearcoatRoughness: number
}

/**
 * Resolves the physical-glass params for one glass surface (window/curtain
 * wall/railing kaca), gated on the "Kaca realistis" quality toggle
 * (preview-store `glassRealistic`, default OFF).
 *
 * `realistic=false` → `null`: callers keep rendering the plain
 * `meshStandardMaterial` (SURFACE_PBR.glass roughness/metalness) exactly as
 * before this feature — byte-identical behavior, zero extra cost.
 *
 * `realistic=true` → params for `meshPhysicalMaterial` with `transmission`
 * (true see-through refraction) — three.js renders an extra offscreen pass
 * per frame for this, so it's opt-in only: tablets/weak GPUs should stay OFF.
 */
export function glassMaterialProps(realistic: boolean): GlassPhysicalProps | null {
  if (!realistic) return null
  return {
    transmission: 0.9,
    ior: 1.5,
    thickness: 0.4,
    roughness: 0.05,
    clearcoat: 0.6,
    clearcoatRoughness: 0.1,
  }
}
