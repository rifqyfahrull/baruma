/**
 * Kolam renang — spesifikasi tipe & finish, dipakai bersama oleh build-model
 * (geometri air + coping + waterline), editor 3D (PoolQuickEditor), dan (fase
 * MEP berikutnya) preset pipa/pompa/lampu. Modul murni: hanya konstanta +
 * arithmetic, tanpa react/three, agar mudah ditest.
 */
import { clamp, round2 } from "@/lib/geometry"
import { rooftopStrips } from "@/lib/geometry/rooftop"
import type { BuildingFootprint } from "@/lib/structural/grid"
import type { PoolFinish, PoolKind, Room } from "@/types"

export type PoolKindSpec = {
  label: string
  /** Kedalaman air bawaan (m) bila room.poolDepthM kosong. */
  defaultDepthM: number
  minDepthM: number
  maxDepthM: number
}

/** Tipe kolam → kedalaman & batas wajar (kasus lapangan Indonesia). */
export const POOL_KINDS: Record<PoolKind, PoolKindSpec> = {
  renang: { label: "Kolam renang", defaultDepthM: 1.5, minDepthM: 1.0, maxDepthM: 2.5 },
  plunge: { label: "Plunge pool", defaultDepthM: 1.2, minDepthM: 0.9, maxDepthM: 1.6 },
  anak: { label: "Kolam anak", defaultDepthM: 0.4, minDepthM: 0.2, maxDepthM: 0.6 },
  spa: { label: "Spa / jacuzzi", defaultDepthM: 0.9, minDepthM: 0.6, maxDepthM: 1.2 },
}

export type PoolFinishSpec = {
  label: string
  /** Warna air (permukaan translucent). */
  water: string
  /** Warna garis waterline (band tipis di permukaan air). */
  waterline: string
  /** Warna coping / bibir kolam (rim batu keliling). */
  coping: string
}

/** Finish kolam → palet warna air/waterline/coping. */
export const POOL_FINISHES: Record<PoolFinish, PoolFinishSpec> = {
  keramik_biru: { label: "Keramik biru", water: "#2f8fd0", waterline: "#bfe3f5", coping: "#d8d2c5" },
  mozaik_hijau: { label: "Mozaik hijau", water: "#1f9e8e", waterline: "#bff0e6", coping: "#d8d2c5" },
  pebble_gelap: { label: "Pebble gelap", water: "#155e63", waterline: "#7fb7bd", coping: "#c9c3b6" },
  batu_alam: { label: "Batu alam", water: "#2b7a78", waterline: "#a9d6d2", coping: "#b9b2a3" },
}

/** Kedalaman air efektif (m): room.poolDepthM di-clamp ke rentang tipe, else default tipe. */
export function effectivePoolDepth(room: Pick<Room, "poolKind" | "poolDepthM">): number {
  const spec = POOL_KINDS[room.poolKind ?? "renang"]
  return clamp(room.poolDepthM ?? spec.defaultDepthM, spec.minDepthM, spec.maxDepthM)
}

export type PoolDepthRange = { shallowM: number; deepM: number; avgM: number }

/**
 * Rentang kedalaman efektif: dangkal→dalam bila KEDUA field diisi (dasar
 * miring; masing-masing di-clamp ke rentang tipe lalu diurutkan), selain itu
 * uniform dari effectivePoolDepth. Sirkulasi/RAB memakai avgM.
 */
export function effectivePoolDepthRange(
  room: Pick<Room, "poolKind" | "poolDepthM" | "poolShallowM" | "poolDeepM">,
): PoolDepthRange {
  const spec = POOL_KINDS[room.poolKind ?? "renang"]
  if (typeof room.poolShallowM === "number" && typeof room.poolDeepM === "number") {
    const a = clamp(room.poolShallowM, spec.minDepthM, spec.maxDepthM)
    const b = clamp(room.poolDeepM, spec.minDepthM, spec.maxDepthM)
    const shallowM = Math.min(a, b)
    const deepM = Math.max(a, b)
    return { shallowM, deepM, avgM: round2((shallowM + deepM) / 2) }
  }
  const d = effectivePoolDepth(room)
  return { shallowM: d, deepM: d, avgM: d }
}

/** Finish efektif (default keramik biru). */
export function effectivePoolFinish(room: Pick<Room, "poolFinish">): PoolFinish {
  return room.poolFinish ?? "keramik_biru"
}

export type PoolRect = { x: number; y: number; width: number; depth: number }

/**
 * Default kolam di HALAMAN: strip yard terbesar (site − footprint), reuse
 * dekomposisi rooftopStrips. Kolam mengisi strip minus margin 0,6 m, dibatasi
 * 8 m/sisi. Null bila tak ada halaman usable (bangunan memenuhi lahan — mis.
 * Rumah Qyfa 8×8; pemanggil lalu jatuh ke dak rooftop / lantai terpilih).
 */
export function defaultPoolRect(
  site: { widthM: number; depthM: number },
  fp: BuildingFootprint
): PoolRect | null {
  if (fp.widthM <= 0 || fp.depthM <= 0) return null
  const siteFp: BuildingFootprint = { x0: 0, y0: 0, widthM: site.widthM, depthM: site.depthM }
  const yard: PoolRect = { x: fp.x0, y: fp.y0, width: fp.widthM, depth: fp.depthM }
  const strips = rooftopStrips(siteFp, yard)
  if (!strips.length) return null
  const best = strips.reduce((a, b) => (a.width * a.depth >= b.width * b.depth ? a : b))
  const margin = 0.6
  const width = round2(Math.min(best.width - 2 * margin, 8))
  const depth = round2(Math.min(best.depth - 2 * margin, 8))
  if (width < 1.2 || depth < 1.2) return null
  return {
    x: round2(best.x + (best.width - width) / 2),
    y: round2(best.y + (best.depth - depth) / 2),
    width,
    depth,
  }
}

/** Sub-rect kolam plunge pada dak (rect deck): center, ~40% lebar × 55% dalam,
 *  dibatasi 3×4 m — untuk kolam di rooftop saat halaman penuh. Null bila terlalu kecil. */
export function plungeRectInDeck(deck: PoolRect): PoolRect | null {
  const width = round2(Math.min(deck.width - 1.0, 3))
  const depth = round2(Math.min(deck.depth - 1.0, 4))
  if (width < 1.2 || depth < 1.2) return null
  return {
    x: round2(deck.x + (deck.width - width) / 2),
    y: round2(deck.y + (deck.depth - depth) / 2),
    width,
    depth,
  }
}
