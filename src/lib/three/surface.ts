/**
 * Pure prim → material resolver for the exterior 3D meshes (SP6 T11).
 *
 * Bridges the box `PrimKind`s emitted by build-model.ts to the web-PBR surfaces
 * (materials.ts `SURFACE_PBR`) + their procedural maps (textures.ts). Kept free of
 * React/three-render code so the realistic-vs-flat gating is unit-testable — the
 * r3f scene itself never mounts in vitest.
 *
 * The `realistic=false` (or flat-only kind) path returns NO map and the exact
 * pre-T11 flat roughness/metalness so the weak-GPU escape hatch renders identically
 * to before this task.
 */
import type { CanvasTexture, Texture } from "three"

import type { PrimKind } from "@/lib/three/build-model"
import type { TextureKind } from "@/lib/three/textures"
import {
  SHARED_COLORS,
  type MaterialPreset,
  type PbrSurface,
} from "@/lib/three/materials"
import { textureFor } from "@/lib/three/textures"
import { imageTextureFor } from "@/lib/three/image-textures"

/**
 * Maps a box `PrimKind` to the web-PBR surface whose texture + roughness/metalness
 * it adopts when realistic, or `null` for kinds that always stay flat-colored
 * (garden/pool/door/furniture/rail).
 */
export function surfaceForKind(kind: PrimKind): PbrSurface | null {
  switch (kind) {
    case "wall":
    case "riser":
    case "wall_gable":
      return "wall"
    case "slab":
    case "tile":
      return "floor"
    case "roof":
    case "roof_gable":
    case "roof_hip":
    case "roof_skillion":
      return "roof"
    case "window":
      return "glass"
    default:
      return null
  }
}

/** Flat base color for a prim — the map (when realistic) modulates this hue. */
export function baseColor(kind: PrimKind, preset: MaterialPreset): string {
  switch (kind) {
    case "slab":
    case "tile":
      return preset.floor
    case "garden":
      return SHARED_COLORS.garden
    case "pool":
      return SHARED_COLORS.pool
    case "wall":
    case "riser":
    case "wall_gable":
      return preset.wall
    case "door":
      return SHARED_COLORS.door
    case "window":
      return SHARED_COLORS.window
    case "furniture":
      return SHARED_COLORS.furniture
    case "roof":
    case "roof_gable":
    case "roof_hip":
    case "roof_skillion":
      return preset.roof
    case "fascia":
      return "#3c4245"
    case "rail":
      return SHARED_COLORS.rail
    case "rail_glass":
      return "#cfe4ee"
    case "roof_glass":
      return "#bfe0f2"
    case "louver":
      return "#8a6242"
    case "stair":
      return "#b6b0a4"
    case "exterior":
      return "#a8a29e"
  }
}

/** Resolved meshStandardMaterial props for one prim. */
export type PrimMaterial = {
  /** Base tint. Selected/hover states override this in the component. */
  color: string
  /** Procedural or image map when realistic + a mapped surface + canvas available; else null. */
  map: CanvasTexture | Texture | null
  roughness: number
  metalness: number
}

export type MaterialVisualOverride = {
  color?: string
  texture?: TextureKind | null
  /** Image texture (real motif from the asset bank, /textures/<id>.jpg). Wins over `texture`. */
  mapUrl?: string
  /** Tiling repeat for `mapUrl` (default 2). */
  mapRepeat?: number
  roughness?: number
  metalness?: number
}

/**
 * Resolves the `meshStandardMaterial` props for one box prim.
 *
 * - `realistic` + a mapped surface → the surface's procedural map plus the preset's
 *   PBR roughness/metalness (map may be `null` under SSR / no canvas — no crash).
 * - `!realistic`, or a flat-only kind → NO map and the exact pre-T11 flat
 *   roughness/metalness (window 0.1 / others 0.85; rail metalness 0.6), so the
 *   fallback renders byte-for-byte as before T11.
 */
/**
 * Repeat tekstur proporsional dimensi bidang: `mapRepeat` katalog = jumlah
 * tile pada dimensi REFERENSI 3 m (≈ tinggi dinding), jadi ukuran tile
 * konsisten antar dinding 8 m dan 1,5 m. Quantize 0.25 membatasi jumlah
 * varian texture di cache.
 */
export function proportionalRepeat(
  mapRepeat: number,
  widthM: number,
  heightM: number,
): [number, number] {
  const tileM = 3 / Math.max(0.25, mapRepeat)
  const q = (v: number) => Math.max(0.25, Math.round((v / tileM) * 4) / 4)
  return [q(widthM), q(heightM)]
}

export function primMaterial(
  kind: PrimKind,
  preset: MaterialPreset,
  realistic: boolean,
  override?: MaterialVisualOverride,
  /** Dimensi bidang (m) utk repeat proporsional; absen = perilaku lama (uniform). */
  faceDims?: { widthM: number; heightM: number },
): PrimMaterial {
  const color = override?.color ?? baseColor(kind, preset)
  const surface = surfaceForKind(kind)

  if (realistic && surface) {
    const pbr = preset.pbr[surface]
    const texture = override?.texture === undefined ? pbr.texture : override.texture
    const map = override?.mapUrl
      ? faceDims
        ? imageTextureFor(
            override.mapUrl,
            ...proportionalRepeat(override.mapRepeat ?? 2, faceDims.widthM, faceDims.heightM),
          )
        : imageTextureFor(override.mapUrl, override.mapRepeat ?? 2)
      : texture
        ? textureFor(texture)
        : null
    return {
      color,
      map,
      roughness: override?.roughness ?? pbr.roughness,
      metalness: override?.metalness ?? pbr.metalness,
    }
  }

  return {
    color,
    map: null,
    roughness: override?.roughness ?? (kind === "window" ? 0.1 : 0.85),
    metalness: override?.metalness ?? (kind === "rail" ? 0.6 : 0),
  }
}
