import type { MaterialAssignment, RoofMaterial } from "@/types"
import type { MaterialVisualOverride } from "@/lib/three/surface"

const INTERIOR_MATERIAL_VISUALS: Record<string, MaterialVisualOverride> = {
  "floor-vinyl-oak": { color: "#b88755", texture: "wood", roughness: 0.46 },
  "floor-cream-tile": { color: "#d8cfbd", texture: "floor", roughness: 0.38 },
  "floor-porcelain-matte": { color: "#cfcac1", texture: "floor", roughness: 0.42 },
  "floor-terrazzo": { color: "#d6d0c5", texture: "concrete", roughness: 0.35 },
  "floor-polished-concrete": { color: "#77716a", texture: "concrete", roughness: 0.32 },
  "wall-warm-white": { color: "#f4efe6", texture: "wall", roughness: 0.86 },
  "wall-limewash": { color: "#d8cfbf", texture: "concrete", roughness: 0.9 },
  "panel-wood": { color: "#a16b3f", texture: "wood", roughness: 0.55 },
  "wall-exposed-brick": { color: "#9b5139", texture: "brick", roughness: 0.82 },
  "wall-stone-cladding": { color: "#8f8779", texture: "concrete", roughness: 0.88 },
  "wall-wallpaper-stripes": { color: "#e2d9c8", texture: "stripes", roughness: 0.8 },
  "wall-wainscot-panel": { color: "#e6dfd2", texture: "wainscot", roughness: 0.72 },
  "wall-geometric-motif": { color: "#d9cfc0", texture: "diamond", roughness: 0.75 },
  // Motif tekstur asli (bank asset) — color near-white agar foto tidak ter-tint.
  "wall-bata-metro-putih": { color: "#ffffff", mapUrl: "/textures/tex-bata-metro-putih.jpg", roughness: 0.8 },
  "wall-bata-putih": { color: "#ffffff", mapUrl: "/textures/tex-bata-putih.jpg", roughness: 0.85 },
  "wall-bata-warna": { color: "#ffffff", mapUrl: "/textures/tex-bata-warna.jpg", roughness: 0.82 },
  "wall-bata-merah": { color: "#ffffff", mapUrl: "/textures/tex-bata-merah.jpg", roughness: 0.85 },
  "wall-bata-tua": { color: "#ffffff", mapUrl: "/textures/tex-bata-tua.jpg", roughness: 0.88 },
  "panel-kayu-hetre": { color: "#ffffff", mapUrl: "/textures/tex-kayu-hetre.jpg", roughness: 0.6 },
  "panel-kayu-rosewood": { color: "#ffffff", mapUrl: "/textures/tex-kayu-rosewood.jpg", roughness: 0.55 },
  "floor-parket-maple": { color: "#ffffff", mapUrl: "/textures/tex-parket-maple.jpg", mapRepeat: 3, roughness: 0.5 },
  "floor-parket-cherry": { color: "#ffffff", mapUrl: "/textures/tex-parket-cherry.jpg", mapRepeat: 3, roughness: 0.5 },
  "floor-parket-oak": { color: "#ffffff", mapUrl: "/textures/tex-parket-oak.jpg", mapRepeat: 3, roughness: 0.52 },
  "floor-karpet-loop": { color: "#ffffff", mapUrl: "/textures/tex-karpet-loop.jpg", mapRepeat: 4, roughness: 0.95 },
  "floor-karpet-gelap": { color: "#ffffff", mapUrl: "/textures/tex-karpet-loop-gelap.jpg", mapRepeat: 4, roughness: 0.95 },
  "floor-karpet-stripes": { color: "#ffffff", mapUrl: "/textures/tex-karpet-stripes.jpg", mapRepeat: 4, roughness: 0.92 },
  // Wave 2 bank asset (2026-07-11): marmer, HPL, parket, kayu.
  "floor-marmer-carrara": { color: "#ffffff", mapUrl: "/textures/tex-marmer-carrara.jpg", mapRepeat: 2, roughness: 0.22, metalness: 0.05 },
  "floor-marmer-travertine": { color: "#ffffff", mapUrl: "/textures/tex-marmer-travertine.jpg", mapRepeat: 2, roughness: 0.3 },
  "floor-parket-natural": { color: "#ffffff", mapUrl: "/textures/tex-parket-natural.jpg", mapRepeat: 3, roughness: 0.52 },
  "floor-parket-gelap": { color: "#ffffff", mapUrl: "/textures/tex-parket-gelap.jpg", mapRepeat: 3, roughness: 0.5 },
  "wall-marmer-emperador": { color: "#ffffff", mapUrl: "/textures/tex-marmer-emperador.jpg", mapRepeat: 2, roughness: 0.25, metalness: 0.05 },
  "panel-hpl-winter-maple": { color: "#ffffff", mapUrl: "/textures/tex-hpl-winter-maple.jpg", mapRepeat: 2, roughness: 0.55 },
  "panel-hpl-dark-moka": { color: "#ffffff", mapUrl: "/textures/tex-hpl-dark-moka.jpg", mapRepeat: 2, roughness: 0.55 },
  "panel-hpl-auburn-oak": { color: "#ffffff", mapUrl: "/textures/tex-hpl-auburn-oak.jpg", mapRepeat: 2, roughness: 0.55 },
  "panel-kayu-alder": { color: "#ffffff", mapUrl: "/textures/tex-kayu-alder.jpg", mapRepeat: 2, roughness: 0.6 },
  "panel-kayu-beech": { color: "#ffffff", mapUrl: "/textures/tex-kayu-beech.jpg", mapRepeat: 2, roughness: 0.6 },
  "backsplash-subway-tile": { color: "#e8e4db", texture: "floor", roughness: 0.36 },
  "bathroom-tile": { color: "#b8c5c6", texture: "floor", roughness: 0.34 },
  "outdoor-deck": { color: "#8a6a4b", texture: "wood", roughness: 0.62 },
  "ceiling-gypsum": { color: "#f7f4ed", texture: "wall", roughness: 0.9 },
  "ceiling-shadowline": { color: "#efe9df", texture: "wall", roughness: 0.88 },
  "ceiling-expose-industrial": { color: "#7a7873", texture: "concrete", roughness: 0.78 },
}

const ROOF_MATERIAL_VISUALS: Record<RoofMaterial, MaterialVisualOverride> = {
  // Foto genteng asli dari bank asset; color near-white = tanpa tint.
  genteng_beton: { color: "#f2f2f2", mapUrl: "/textures/tex-atap-genteng.jpg", mapRepeat: 4, roughness: 0.78 },
  genteng_keramik: { color: "#ffffff", mapUrl: "/textures/tex-atap-kolonial.jpg", mapRepeat: 4, roughness: 0.58 },
  metal: { color: "#e8ecee", mapUrl: "/textures/tex-atap-metal.jpg", mapRepeat: 4, roughness: 0.4, metalness: 0.3 },
  aspal: { color: "#3c3a38", texture: "concrete", roughness: 0.86 },
}

export function materialVisualForAssignment(
  assignment: MaterialAssignment | undefined
): MaterialVisualOverride | undefined {
  if (!assignment) return undefined
  return INTERIOR_MATERIAL_VISUALS[assignment.materialId]
}

export function materialVisualForRoof(
  material: RoofMaterial | undefined
): MaterialVisualOverride | undefined {
  if (!material) return undefined
  return ROOF_MATERIAL_VISUALS[material]
}
