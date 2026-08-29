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
import type { FacadeSideId, SceneFacts } from "./analyze"

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

// ---------------------------------------------------------------------------
// Prompt v2 (Fase A Task 3 — docs/superpowers/plans/
// 2026-08-23-ai-render-scene-intelligence-fase-a.md). Dibangun dari
// `SceneFacts` (Task 2, ./analyze.ts) — fakta terukur dari pose kamera +
// layout DB, bukan metadata scene yang dipilih user (`RenderSceneMeta`
// lama). Sama-sama deterministik & murni: input sama → output byte-identik.
// `compilePrompt`/`describeScene` di atas TIDAK diubah (jalur legacy tetap
// aktif sampai caller dipindah ke v2).
// ---------------------------------------------------------------------------

/** Label sisi fasad untuk kalimat Inggris — s/n mengikuti orientasi rumah
 *  Indonesia (depan menghadap jalan = selatan pada konvensi compass.ts). */
const SIDE_LABELS: Record<FacadeSideId, string> = {
  s: "front (south)",
  n: "rear (north)",
  e: "east side",
  w: "west side",
}

/** `garden_bed` → `garden bed` — kind di ExteriorElement pakai snake_case,
 *  klausa "visible site elements" perlu kalimat Inggris biasa. */
function snakeToSpaces(kind: string): string {
  return kind.replace(/_/g, " ")
}

/**
 * Klausa fasad per sisi terlihat: `"{label}: {claddings} cladding, {n}
 * window(s), ..."`. Setiap sub-bagian (cladding/window/door/garasi/elemen
 * fasad/balkon) di-skip bila kosong; sisi yang sama sekali tak punya fakta
 * (semua sub-bagian kosong) dilewati seluruhnya — tidak menghasilkan
 * `"label: "` tanpa isi.
 */
function describeSide(side: SceneFacts["sides"][number]): string | null {
  const bits: string[] = []
  if (side.claddings.length > 0) bits.push(`${side.claddings.join(", ")} cladding`)
  if (side.windowCount > 0) bits.push(`${side.windowCount} window(s)`)
  if (side.doorCount > 0) bits.push(`${side.doorCount} door(s)`)
  if (side.garageDoorCount > 0) bits.push(`${side.garageDoorCount} garage door(s)`)
  if (side.facadeElements.length > 0)
    bits.push(side.facadeElements.map(snakeToSpaces).join(", "))
  if (side.balconyCount > 0) bits.push(`${side.balconyCount} balcony(ies)`)
  if (bits.length === 0) return null
  return `${SIDE_LABELS[side.side]}: ${bits.join(", ")}`
}

/**
 * Klausa lampu malam (#6 di brief) — HANYA muncul untuk preset "malam" DAN
 * ada lampu eksterior. Diekstrak jadi helper terpisah (bukan inline di
 * `describeSceneFacts`) supaya `compilePromptV2` bisa menambahkannya
 * kembali SETELAH `polishedDescription` (LLM, Task 4) menggantikan
 * deskripsi deterministik — fakta jumlah lampu tidak boleh hilang hanya
 * karena jalur polish dipakai. `null` (bukan string kosong) dipakai sebagai
 * penanda "tidak ada klausa" supaya pemanggil bisa cek falsy tanpa ambigu
 * dengan string kosong.
 */
function nightLampClause(facts: SceneFacts, presetId?: string): string | null {
  if (presetId === "malam" && facts.lighting.exteriorLampCount > 0) {
    return `${facts.lighting.exteriorLampCount} warm exterior lamps glowing`
  }
  return null
}

/**
 * Rangkai `SceneFacts` jadi klausa deterministik (urutan tetap, join `"; "`),
 * analog `describeScene` legacy tapi sumbernya fakta terukur dari analyzer
 * (Task 2), bukan metadata pilihan user. `presetId` opsional HANYA
 * dikonsumsi untuk klausa lampu malam (#6) — dipanggil oleh `compilePromptV2`
 * dengan preset yang sudah di-resolve (termasuk fallback preset tak
 * dikenal); dipanggil tanpa argumen kedua di test/di jalur lain berarti
 * "tidak ada preset" → klausa lampu malam otomatis absen.
 */
export function describeSceneFacts(facts: SceneFacts, presetId?: string): string {
  const parts: string[] = []

  // 1. Sudut pandang kamera.
  const sideLabels = facts.camera.visibleSides.map((s) => SIDE_LABELS[s])
  parts.push(
    `${facts.camera.heightClass} camera view of the ${sideLabels.join(" and ")} facade, ` +
      `${facts.camera.distanceClass} distance, ${facts.camera.lensMm}mm architectural lens`
  )

  // 2. Massing bangunan.
  const m = facts.massing
  let massingClause =
    `${m.floors}-storey house, footprint ${m.footprintWidthM} x ${m.footprintDepthM} meters ` +
    `on a ${m.siteWidthM} x ${m.siteDepthM} meter lot, approximate height ${m.approxHeightM} meters`
  if (m.hasRooftopDeck) {
    massingClause += `, rooftop deck with ${m.rooftopRailing} railing`
  }
  parts.push(massingClause)

  // 3. Fasad per sisi terlihat (urutan = visibleSides / facts.sides).
  for (const side of facts.sides) {
    const clause = describeSide(side)
    if (clause) parts.push(clause)
  }

  // 4. Elemen tapak yang masuk frame.
  if (facts.exteriorInFrame.length > 0) {
    parts.push(`visible site elements: ${facts.exteriorInFrame.map(snakeToSpaces).join(", ")}`)
  }

  // 5. Atap.
  const roofBase =
    facts.roof.zoneTypes.length > 0 ? facts.roof.zoneTypes.join(", ") : facts.roof.globalType
  let roofClause = `roof: ${roofBase}`
  if (facts.roof.skylightCount > 0) {
    roofClause += ` with ${facts.roof.skylightCount} skylight(s)`
  }
  parts.push(roofClause)

  // 6. Lampu malam — HANYA preset "malam" & ada lampu.
  const lampClause = nightLampClause(facts, presetId)
  if (lampClause) parts.push(lampClause)

  return parts.join("; ")
}

/**
 * Compile prompt v2 dari `SceneFacts` + id preset. Merangkai persis pola
 * `compilePrompt` legacy (base foto tetap → deskripsi → fragmen preset →
 * geometry guard tetap), tapi deskripsi berasal dari fakta terukur analyzer
 * (Task 2) — atau dari `polishedDescription` (LLM opsional, Task 4) bila
 * tersedia & tidak kosong setelah trim. Preset id tak dikenal → fallback ke
 * preset pertama (sama seperti legacy) daripada throw di jalur kritis.
 *
 * Klausa lampu malam (#6) HARUS bertahan meski `polishedDescription`
 * dipakai — LLM polish tidak tahu fakta jumlah lampu, jadi ditambahkan
 * kembali secara eksplisit setelah teks polished (bukan diserahkan ke LLM
 * untuk "mengarang" jumlahnya).
 */
export function compilePromptV2(
  facts: SceneFacts,
  presetId: string,
  polishedDescription?: string | null
): string {
  const preset = RENDER_PRESET_MAP.get(presetId) ?? RENDER_PRESETS[0]
  const trimmedPolished = polishedDescription?.trim()
  const lampClause = nightLampClause(facts, preset.id)
  const description = trimmedPolished
    ? trimmedPolished + (lampClause ? `; ${lampClause}` : "")
    : describeSceneFacts(facts, preset.id)

  return [
    `${PROMPT_BASE}.`,
    `${description}.`,
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
