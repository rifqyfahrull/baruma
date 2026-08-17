/**
 * Resolusi & algoritma penempatan bilah untuk `ComponentPatternSpec` — pola
 * kisi/roster KUSTOM yang dipakai DUA pemanggil: elemen fasad
 * (louver_band/slat_horizontal/roster_screen di build-model.ts) dan pergola
 * eksterior (exterior-primitives.ts). Satu tempat supaya kedua jalur tak
 * pernah menyimpang rumus/clamp-nya.
 *
 * Tanpa `pattern` (absen), kedua pemanggil TETAP memakai jalur numerik lama
 * (konstanta hardcoded) — modul ini hanya aktif ketika `pattern` diberikan.
 */
import type { ComponentPatternSpec } from "@/types"
import { clamp } from "@/lib/geometry"

const PITCH_RANGE = [0.05, 1.5] as const
const BAR_WIDTH_RANGE = [0.02, 0.5] as const
// Batas bawah diturunkan dari 0.02 → 0.01 utk preset "Nat beton / reveal
// line" (garis nat tipis ~0.012 m). Sinkron dgn: zod actions.ts
// (componentPatternSchema.barDepthM), UI slider min (wall-inspector.tsx,
// component-studio.tsx, exterior-inspector.tsx "Tebal balok").
const BAR_DEPTH_RANGE = [0.01, 0.6] as const
const RHYTHM_MAX_LEN = 8
const RHYTHM_VALUE_RANGE = [1, 10] as const

/** Pitch efektif (m) — pattern.pitchM di-clamp, absen → fallback (konstanta lama). */
export function resolvePitchM(pattern: ComponentPatternSpec | undefined, fallback: number): number {
  return pattern?.pitchM != null ? clamp(pattern.pitchM, ...PITCH_RANGE) : fallback
}

/** Lebar penampang bilah (m, tegak lurus arah bentang) — clamp 0.02–0.5. */
export function resolveBarWidthM(pattern: ComponentPatternSpec | undefined, fallback: number): number {
  return pattern?.barWidthM != null ? clamp(pattern.barWidthM, ...BAR_WIDTH_RANGE) : fallback
}

/** Kedalaman/tebal bilah (m) — clamp 0.02–0.6. */
export function resolveBarDepthM(pattern: ComponentPatternSpec | undefined, fallback: number): number {
  return pattern?.barDepthM != null ? clamp(pattern.barDepthM, ...BAR_DEPTH_RANGE) : fallback
}

/** Orientasi efektif — absen di pattern → fallback bawaan pemanggil. */
export function resolveOrientation(
  pattern: ComponentPatternSpec | undefined,
  fallback: "v" | "h" | "grid" | "cross",
): "v" | "h" | "grid" | "cross" {
  return pattern?.orientation ?? fallback
}

/** Bingkai keliling diminta eksplisit (default false/absen). */
export function wantsFrame(pattern: ComponentPatternSpec | undefined): boolean {
  return pattern?.frame === true
}

/** Reveal line/nat beton (batang tenggelam) diminta eksplisit (default false/absen). */
export function wantsInset(pattern: ComponentPatternSpec | undefined): boolean {
  return pattern?.inset === true
}

function sanitizeRhythm(rhythm: number[] | undefined): number[] | undefined {
  if (!rhythm || rhythm.length === 0) return undefined
  const cleaned = rhythm
    .slice(0, RHYTHM_MAX_LEN)
    .map((n) => clamp(Math.round(n), ...RHYTHM_VALUE_RANGE))
  return cleaned.length ? cleaned : undefined
}

/**
 * Cycle boolean fill/gap dari `rhythm`, dibaca berpasangan
 * `[fill, gap, fill, gap, ...]`: rhythm=[3,1] → cycle 4 slot
 * `[true,true,true,false]` (3 bilah rapat lalu 1 SLOT PITCH kosong = gap
 * ekstra), berulang sepanjang bentang. Elemen ganjil di ujung (tanpa
 * pasangan gap) dianggap fill murni. Absen/kosong → `[true]` = bilah di
 * SETIAP slot (pola seragam, setara "tanpa rhythm").
 */
function rhythmCycle(rhythm: number[] | undefined): boolean[] {
  const r = sanitizeRhythm(rhythm)
  if (!r) return [true]
  const cycle: boolean[] = []
  for (let i = 0; i < r.length; i++) {
    const isFill = i % 2 === 0
    for (let k = 0; k < r[i]; k++) cycle.push(isFill)
  }
  return cycle.length ? cycle : [true]
}

/**
 * Posisi TENGAH bilah (offset dari tengah bentang `span`, meter) memakai
 * pitch TETAP `pitchM` (bukan pitch adaptif seperti jalur numerik lama yang
 * membagi span rata) + `rhythm` opsional. Grid dimulai dari
 * `-span/2 + pitchM/2`, melangkah `pitchM` per slot; slot "gap" (dari
 * rhythm) dilewati TANPA bilah — sehingga jarak sebelum bilah berikutnya
 * jadi kelipatan pitchM (gap ekstra). Deterministik untuk input yang sama.
 * `span`/`pitchM` tak positif → array kosong; bila hasilnya kosong (mis.
 * rhythm/pitch terlalu lebar utk span) fallback 1 bilah di tengah agar
 * elemen tak pernah hilang total.
 */
export function patternBarOffsets(span: number, pitchM: number, rhythm?: number[]): number[] {
  if (!(span > 0) || !(pitchM > 0)) return []
  const cycle = rhythmCycle(rhythm)
  const half = span / 2
  const offsets: number[] = []
  let pos = -half + pitchM / 2
  let i = 0
  const SAFETY_MAX = 2000
  while (pos <= half - pitchM / 2 + 1e-6 && i < SAFETY_MAX) {
    if (cycle[i % cycle.length]) offsets.push(pos)
    pos += pitchM
    i += 1
  }
  if (offsets.length === 0) offsets.push(0)
  return offsets
}
