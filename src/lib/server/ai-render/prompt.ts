/**
 * Prompt compiler AI Render (Fase 3 — docs/plan-integrasi-ai-renderer-2026-08.md
 * §Fase 3). User TIDAK PERNAH menulis prompt bebas — hanya memilih preset
 * suasana dari daftar tetap. Ini menghindari abuse prompt-injection ke
 * provider eksternal sekaligus menjaga konsistensi visual antar-render.
 *
 * `compilePrompt` murni & deterministik: input sama → string byte-identik.
 * Fragmen preset HANYA mengarahkan gaya (cahaya, mood, lensa) — TIDAK PERNAH
 * menyebut geometri, supaya provider tidak "mengarang ulang" bentuk bangunan
 * yang sudah dikunci oleh capture beauty/depth pass.
 */

/** Metadata scene serializable — dikirim dari klien, bukan objek three.js. */
export interface RenderSceneMeta {
  facadeMaterials: string[]
  roofType: string
  floors: number
  landscape?: string
}

export interface RenderPreset {
  id: string
  /** Label Indonesia yang tampil di UI pemilihan preset. */
  label: string
  /** Fragmen prompt Inggris — provider gambar (Gemini/FLUX) paling akurat
   *  dengan instruksi Inggris; hasil (gambar) tidak berbahasa jadi ini aman. */
  promptFragment: string
}

/**
 * 4 preset v1. Fragmen dikurasi manual — HANYA pencahayaan/mood/lensa,
 * tidak pernah mengubah jumlah lantai/material/atap (itu datang dari
 * sceneMeta & referensi gambar beauty/depth pass).
 */
export const RENDER_PRESETS: RenderPreset[] = [
  {
    id: "tropis-siang",
    label: "Tropis — Siang",
    promptFragment:
      "bright tropical midday sunlight, clear blue sky with soft white clouds, " +
      "strong natural daylight with crisp shadows, lush green tropical vegetation, " +
      "shot on a 24mm architectural lens, natural saturated colors",
  },
  {
    id: "tropis-senja",
    label: "Tropis — Senja",
    promptFragment:
      "warm golden hour tropical dusk, low sun casting long soft shadows, " +
      "orange and amber sky gradient near the horizon, warm ambient light on facade, " +
      "shot on a 35mm architectural lens, cinematic warm color grading",
  },
  {
    id: "skandinavia-siang",
    label: "Skandinavia — Siang",
    promptFragment:
      "soft overcast Scandinavian daylight, diffused even lighting with minimal shadows, " +
      "muted cool grey-blue sky, crisp clean air, understated natural color palette, " +
      "shot on a 24mm architectural lens, neutral realistic color grading",
  },
  {
    id: "malam",
    label: "Malam",
    promptFragment:
      "blue hour night photography, deep blue-violet twilight sky, " +
      "warm glowing interior lights visible through windows, exterior accent lighting, " +
      "shot on a 24mm architectural lens with a tripod, long exposure night look",
  },
]

const RENDER_PRESET_MAP = new Map(RENDER_PRESETS.map((p) => [p.id, p]))

export type RenderPresetId = (typeof RENDER_PRESETS)[number]["id"]

/** Basis fotografi tetap — sama untuk semua render, menjaga gaya konsisten. */
const PROMPT_BASE =
  "photorealistic architectural photography of a residential house, " +
  "professional real-estate exterior photography, sharp focus, high dynamic range"

/**
 * Instruksi geometri tetap di akhir prompt — memaksa provider mempertahankan
 * bentuk/proporsi/sudut kamera persis dari gambar referensi (beauty+depth
 * pass), bukan mengarang ulang. Ini bukan negative prompt provider-spesifik
 * (Gemini/FLUX tidak selalu punya field negative_prompt terpisah), jadi
 * dituliskan sebagai instruksi eksplisit dalam prompt teks.
 */
const PROMPT_GEOMETRY_GUARD =
  "preserve the exact geometry, camera angle and building proportions from the reference image; " +
  "do not add, remove, or resize any structural elements"

/** Rangkai fakta scene jadi klausa deterministik (urutan tetap, tanpa acak). */
function describeScene(sceneMeta: RenderSceneMeta): string {
  const parts: string[] = []

  if (sceneMeta.facadeMaterials.length > 0) {
    parts.push(`facade materials: ${sceneMeta.facadeMaterials.join(", ")}`)
  }
  parts.push(`roof type: ${sceneMeta.roofType}`)
  parts.push(`${sceneMeta.floors} floor${sceneMeta.floors === 1 ? "" : "s"}`)
  if (sceneMeta.landscape) {
    parts.push(`landscape: ${sceneMeta.landscape}`)
  }

  return parts.join("; ")
}

/**
 * Compile prompt deterministik dari metadata scene + id preset. Input sama →
 * output byte-identik (dites via snapshot). Preset id tak dikenal → fallback
 * ke preset pertama (tropis-siang) daripada melempar error di jalur kritis.
 */
export function compilePrompt(
  sceneMeta: RenderSceneMeta,
  presetId: string
): string {
  const preset = RENDER_PRESET_MAP.get(presetId) ?? RENDER_PRESETS[0]
  const sceneDescription = describeScene(sceneMeta)

  return [
    `${PROMPT_BASE}.`,
    `${sceneDescription}.`,
    `${preset.promptFragment}.`,
    `${PROMPT_GEOMETRY_GUARD}.`,
  ].join(" ")
}

/**
 * Derivasi seed 32-bit stabil dari projectId (FNV-1a — pola sama dengan
 * `stableRolloutBucket` di src/lib/features.ts). Seed dikunci per proyek
 * supaya render berturut-turut pada proyek yang sama tetap konsisten
 * (bukan acak tiap request), tanpa perlu menyimpan seed terpisah di DB.
 */
export function projectSeed(projectId: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < projectId.length; i++) {
    hash ^= projectId.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0) % 2147483647
}
