/**
 * Validation profiles for semantic furniture slots (furnimesh model ingestion).
 * Each profile defines the expected dimensions, placement, and material tokens
 * for a specific slot type. Used to validate uploaded GLB models.
 */
import type { SlotType, ValidationProfile } from "@/types"

export const VALIDATION_PROFILES: Record<SlotType, ValidationProfile> = {
  tv: {
    category: "tv",
    placement: ["wall_mounted", "cabinet_mounted"],
    recommended: {
      widthM: [0.7, 2.5],
      depthM: [0.02, 0.25],
      heightM: [0.35, 1.5],
      widthToDepthMin: 6,
      widthToHeight: [1.1, 3.2],
    },
    materialTokens: {
      screen: ["screen.black_glass"],
      frame: ["metal.matte_black", "metal.dark_gray"],
      stand: ["metal.matte_black", "wood.primary"],
    },
  },

  sofa: {
    category: "sofa",
    placement: ["floor"],
    recommended: {
      widthM: [1.2, 4.0],
      depthM: [0.6, 1.5],
      heightM: [0.6, 1.3],
    },
    materialTokens: {
      fabric: ["fabric.primary", "fabric.secondary"],
      legs: ["wood.primary", "metal.accent"],
    },
  },

  coffee_table: {
    category: "coffee_table",
    placement: ["floor"],
    recommended: {
      widthM: [0.4, 1.8],
      depthM: [0.3, 1.2],
      heightM: [0.25, 0.65],
    },
    materialTokens: {
      top: ["wood.primary", "stone.cream", "glass.clear"],
      legs: ["wood.primary", "metal.accent"],
    },
  },

  // Catch-all: any furniture without a curated profile accepts a custom GLB
  // with permissive bounds (covers wardrobes, beds, tables, appliances, decor…).
  generic: {
    category: "generic",
    placement: ["floor", "wall_mounted", "cabinet_mounted"],
    recommended: {
      widthM: [0.1, 6],
      depthM: [0.05, 6],
      heightM: [0.05, 4],
    },
    materialTokens: {},
  },
}

/**
 * Map furniture IDs from the library to CURATED slot types (strict validation
 * profiles). Anything not listed falls back to the permissive "generic" slot —
 * every interior furniture item accepts a custom GLB.
 */
export const FURNITURE_SLOT_MAP: Record<string, SlotType> = {
  "tv-55": "tv",
  "tv-cabinet": "tv",
  "sofa-3-seat": "sofa",
  "sofa-l": "sofa",
  "coffee-table": "coffee_table",
}

/**
 * Get the slot type for a furniture item. Never null: uncurated items get "generic".
 */
export function slotTypeForFurniture(furnitureId: string): SlotType {
  return FURNITURE_SLOT_MAP[furnitureId] ?? "generic"
}

/**
 * Get the validation profile for a slot type.
 */
export function profileForSlot(slotType: SlotType): ValidationProfile {
  return VALIDATION_PROFILES[slotType]
}

/**
 * Slot-specific requirements text for the upload dialog.
 */
export function slotRequirementsText(slotType: SlotType): {
  label: string
  format: string
  expectedSize: string
  tips: string[]
} {
  const profile = VALIDATION_PROFILES[slotType]
  const { widthM, depthM, heightM } = profile.recommended

  const configs: Record<SlotType, ReturnType<typeof slotRequirementsText>> = {
    tv: {
      label: "TV / Display",
      format: "GLB",
      expectedSize: `${widthM[0]}–${widthM[1]}m × ${depthM[0]}–${depthM[1]}m × ${heightM[0]}–${heightM[1]}m`,
      tips: [
        "Model harus flat (tipis), seperti layar TV",
        "Rasio lebar/tinggi seperti layar (1.1–3.2)",
        "Bisa wall-mounted atau cabinet-mounted",
        "File size maksimal 100MB, rekomendasi <10MB",
      ],
    },
    sofa: {
      label: "Sofa / Tempat Duduk",
      format: "GLB",
      expectedSize: `${widthM[0]}–${widthM[1]}m × ${depthM[0]}–${depthM[1]}m × ${heightM[0]}–${heightM[1]}m`,
      tips: [
        "Model harus diletakkan di lantai",
        "Dimensi sesuai ukuran sofa (tidak terlalu tipis)",
        "File size maksimal 100MB, rekomendasi <10MB",
      ],
    },
    coffee_table: {
      label: "Meja Kopi",
      format: "GLB",
      expectedSize: `${widthM[0]}–${widthM[1]}m × ${depthM[0]}–${depthM[1]}m × ${heightM[0]}–${heightM[1]}m`,
      tips: [
        "Tinggi meja rendah (25–65cm)",
        "Model harus diletakkan di lantai",
        "File size maksimal 100MB, rekomendasi <10MB",
      ],
    },
    generic: {
      label: "Furnitur Custom",
      format: "GLB",
      expectedSize: "Bebas — model di-fit ke ukuran slot furnitur",
      tips: [
        "Ukuran sebenarnya model dipas otomatis ke dimensi furnitur",
        "Gunakan satuan meter di file GLB agar skala akurat",
        "File size maksimal 100MB, rekomendasi <10MB",
      ],
    },
  }

  return configs[slotType]
}

/**
 * Design DNA material tokens per category.
 * Used for material consistency checks against project style.
 */
export const MATERIAL_TOKENS = {
  "fabric.primary": { label: "Fabric Utama", hex: "#D4C5B9" },
  "fabric.secondary": { label: "Fabric Sekunder", hex: "#B8A898" },
  "wood.primary": { label: "Kayu Utama", hex: "#8B6914" },
  "wall.base": { label: "Dinding Dasar", hex: "#F5F0EB" },
  "accent.primary": { label: "Aksen Utama", hex: "#2D5A27" },
  "metal.accent": { label: "Metal Aksen", hex: "#4A4A4A" },
  "metal.matte_black": { label: "Metal Matte Black", hex: "#1A1A1A" },
  "metal.dark_gray": { label: "Metal Dark Gray", hex: "#3A3A3A" },
  "screen.black_glass": { label: "Screen Black Glass", hex: "#0A0A0A" },
  "stone.cream": { label: "Batu Cream", hex: "#E8DCC8" },
  "glass.clear": { label: "Kaca Bening", hex: "#D4E8F0" },
  "floor.primary": { label: "Lantai Utama", hex: "#C4A882" },
} as const

export type MaterialTokenId = keyof typeof MATERIAL_TOKENS

// ── Material consistency scoring (deterministic) ──

/** Keyword mappings: GLB material name substrings → Design DNA token IDs. */
const MATERIAL_KEYWORD_MAP: Record<string, MaterialTokenId[]> = {
  wood: ["wood.primary"],
  kayu: ["wood.primary"],
  fabric: ["fabric.primary", "fabric.secondary"],
  kain: ["fabric.primary", "fabric.secondary"],
  leather: ["fabric.primary"],
  kulit: ["fabric.primary"],
  metal: ["metal.accent", "metal.matte_black", "metal.dark_gray"],
  logam: ["metal.accent"],
  black: ["metal.matte_black", "screen.black_glass"],
  hitam: ["metal.matte_black", "screen.black_glass"],
  screen: ["screen.black_glass"],
  layar: ["screen.black_glass"],
  glass: ["glass.clear"],
  kaca: ["glass.clear"],
  stone: ["stone.cream"],
  batu: ["stone.cream"],
  marble: ["stone.cream"],
  marmer: ["stone.cream"],
  gold: ["metal.accent"],
  emas: ["metal.accent"],
  silver: ["metal.accent"],
  perak: ["metal.accent"],
  chrome: ["metal.accent"],
  plastic: [],
  plastik: [],
  paint: ["wall.base"],
  cat: ["wall.base"],
  ceramic: ["stone.cream"],
  keramik: ["stone.cream"],
  concrete: ["stone.cream"],
  beton: ["stone.cream"],
  floor: ["floor.primary"],
  lantai: ["floor.primary"],
}

/**
 * Score how well detected material names match the expected tokens for a slot.
 * Returns 0–100. Deterministic — no LLM needed.
 */
export function scoreMaterialConsistency(
  detectedMaterialNames: string[],
  slotType: SlotType
): {
  score: number
  matchedTokens: string[]
  unmatchedMaterials: string[]
  recommendations: string[]
} {
  const profile = VALIDATION_PROFILES[slotType]
  // Flatten all expected tokens for this slot
  const expectedTokens = new Set(
    Object.values(profile.materialTokens).flat()
  )

  const matchedTokens: string[] = []
  const unmatchedMaterials: string[] = []
  const recommendations: string[] = []

  for (const matName of detectedMaterialNames) {
    const lower = matName.toLowerCase()
    let found = false
    for (const [keyword, tokens] of Object.entries(MATERIAL_KEYWORD_MAP)) {
      if (lower.includes(keyword)) {
        for (const token of tokens) {
          if (expectedTokens.has(token)) {
            matchedTokens.push(token)
            found = true
          }
        }
      }
    }
    if (!found) {
      unmatchedMaterials.push(matName)
      // Suggest replacement tokens
      const allExpected = Array.from(expectedTokens)
      if (allExpected.length > 0) {
        recommendations.push(
          `${matName} → pertimbangkan ${allExpected.slice(0, 2).join(" atau ")}`
        )
      }
    }
  }

  const uniqueMatched = new Set(matchedTokens)
  const totalExpected = expectedTokens.size
  const matchRatio = totalExpected > 0
    ? uniqueMatched.size / Math.min(totalExpected, detectedMaterialNames.length || 1)
    : 0.5

  // Base score from token matching (70%) + material count penalty (30%)
  const matchScore = Math.round(matchRatio * 70)
  const countPenalty = detectedMaterialNames.length > 10
    ? 0
    : detectedMaterialNames.length === 0
      ? 0
      : Math.min(30, detectedMaterialNames.length * 3)
  const score = Math.min(100, matchScore + countPenalty)

  return {
    score,
    matchedTokens: Array.from(uniqueMatched),
    unmatchedMaterials,
    recommendations: recommendations.slice(0, 3),
  }
}

/**
 * Full consistency score for an attached asset (0–100).
 * Components: category match (25) + size/scale (20) + color/material (35) + performance (20).
 */
export function computeConsistencyScore(opts: {
  categoryConfidence: number  // 0–100 from validateBboxForSlot
  materialScore: number       // 0–100 from scoreMaterialConsistency
  fileSizeMb: number
  mobileRisk: "low" | "medium" | "high"
}): { score: number; level: "excellent" | "good" | "needs_adjustment" | "poor" } {
  const categoryScore = Math.round(opts.categoryConfidence * 0.25)
  const materialScore = Math.round(opts.materialScore * 0.35)
  const perfScore = opts.mobileRisk === "low" ? 20 : opts.mobileRisk === "medium" ? 12 : 5
  const sizeScore = opts.fileSizeMb <= 10 ? 20 : opts.fileSizeMb <= 15 ? 14 : 8
  const total = categoryScore + materialScore + perfScore + sizeScore

  let level: "excellent" | "good" | "needs_adjustment" | "poor"
  if (total >= 90) level = "excellent"
  else if (total >= 75) level = "good"
  else if (total >= 50) level = "needs_adjustment"
  else level = "poor"

  return { score: total, level }
}
