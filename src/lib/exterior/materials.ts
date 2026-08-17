import type { ExteriorMaterialSlot, MaterialRef } from "@/types"
import { facadeCladdingById } from "@/lib/three/facade-claddings"
import type { MaterialVisualOverride } from "@/lib/three/surface"

export type ExteriorMaterialSurfaceKind =
  | "wall"
  | "floor"
  | "roof"
  | "metal"
  | "wood"
  | "concrete"
  | "glass"
  | "generic"

export type ResolvedExteriorMaterial = {
  id: string
  label: string
  source: "catalog" | "custom" | "fallback"
  visual: MaterialVisualOverride
}

export type ExteriorMaterialResolveOptions = {
  slot?: ExteriorMaterialSlot
}

const FALLBACKS: Record<ExteriorMaterialSurfaceKind, ResolvedExteriorMaterial> = {
  wall: {
    id: "fallback-wall",
    label: "Material dinding default",
    source: "fallback",
    visual: { color: "#d8d4cc", texture: "wall", roughness: 0.85 },
  },
  floor: {
    id: "fallback-floor",
    label: "Material lantai default",
    source: "fallback",
    visual: { color: "#c8c1b6", texture: "floor", roughness: 0.62 },
  },
  roof: {
    id: "fallback-roof",
    label: "Material atap default",
    source: "fallback",
    visual: { color: "#c6c0b8", texture: "roof", roughness: 0.8 },
  },
  metal: {
    id: "fallback-metal",
    label: "Material metal default",
    source: "fallback",
    visual: { color: "#3c4245", texture: null, roughness: 0.42, metalness: 0.35 },
  },
  wood: {
    id: "fallback-wood",
    label: "Material kayu default",
    source: "fallback",
    visual: { color: "#8a6242", texture: "wood", roughness: 0.62 },
  },
  concrete: {
    id: "fallback-concrete",
    label: "Material beton default",
    source: "fallback",
    visual: { color: "#aaa59c", texture: "concrete", roughness: 0.9 },
  },
  glass: {
    id: "fallback-glass",
    label: "Material kaca default",
    source: "fallback",
    visual: { color: "#cfe4ee", texture: "glass", roughness: 0.08, metalness: 0 },
  },
  generic: {
    id: "fallback-generic",
    label: "Material eksterior default",
    source: "fallback",
    visual: { color: "#a8a29e", texture: null, roughness: 0.75 },
  },
}

function normalizeHexColor(value: string | undefined): string | null {
  if (!value) return null
  const raw = value.trim()
  const short = /^#([0-9a-f]{3})$/i.exec(raw)
  if (short) {
    const [r, g, b] = short[1].split("")
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
  }
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw.toLowerCase()
  return null
}

function customLabel(ref: MaterialRef): string {
  return ref.finish?.trim() || "Warna custom"
}

/**
 * Single resolver for semantic exterior materials.
 *
 * Catalog ids remain backward-compatible with facade cladding ids. Custom
 * colors are allowed only when valid hex; unknown ids / invalid colors fall
 * back to a deterministic surface-kind default so 3D/drawings/RAB labels never
 * have to guess independently.
 */
export function resolveExteriorMaterial(
  ref: MaterialRef | undefined,
  surfaceKind: ExteriorMaterialSurfaceKind = "generic",
  options: ExteriorMaterialResolveOptions = {},
): ResolvedExteriorMaterial {
  const fallback = FALLBACKS[surfaceKind] ?? FALLBACKS.generic
  const slotRef = options.slot ? ref?.surfaces?.[options.slot] : undefined
  const effectiveRef =
    slotRef && Object.keys(slotRef).length
      ? {
          materialId: slotRef.materialId,
          color: slotRef.color ?? ref?.color,
          finish: slotRef.finish ?? ref?.finish,
        }
      : ref
  const catalog = facadeCladdingById(effectiveRef?.materialId)
  if (catalog) {
    return {
      id: catalog.id,
      label: catalog.label,
      source: "catalog",
      visual: catalog.visual,
    }
  }

  const customColor = normalizeHexColor(effectiveRef?.color)
  if (customColor) {
    return {
      id: effectiveRef?.materialId ?? `custom-${customColor.slice(1)}`,
      label: customLabel(effectiveRef ?? {}),
      source: "custom",
      visual: { ...fallback.visual, color: customColor },
    }
  }

  return fallback
}

export function exteriorSurfaceKindForMaterial(elementKind: string): ExteriorMaterialSurfaceKind {
  switch (elementKind) {
    case "boundary_wall":
    case "solid_wall":
    case "facade_panel":
    case "portal_frame":
      return "wall"
    case "driveway":
    case "walkway":
    case "terrace_surface":
    case "exterior_stair":
    case "slab":
      return "floor"
    case "fence":
    case "sliding_gate":
    case "swing_gate":
    case "pedestrian_gate":
      return "metal"
    case "canopy":
      return "roof"
    // Pergola: rangka kisi kayu/besi menonjol — fallback "wood" (mayoritas
    // proyek pakai kayu; UI/agent bisa override via material.color/finish).
    case "pergola":
      return "wood"
    case "planter":
    case "garden_bed":
    // Pelat menjorok (overhang) = pelat beton ekspos, fallback beton.
    case "overhang_slab":
      return "concrete"
    case "plant":
    case "tree":
      return "wood"
    case "vehicle":
      return "metal"
    default:
      return "generic"
  }
}
