/**
 * TABEL ELEVASI TUNGGAL (Fase D plan ARSITEKTUR_MODERN) — satu sumber
 * kebenaran vertikal untuk 3D (build-model, house-model, camera-rig,
 * house-scene, exterior-primitives), gambar kerja (section, elevation,
 * ceiling-plan), dan RAB. Menggantikan rumus `index × (WALL_H + SLAB_T)`
 * yang membuat `Floor.heightM` jadi data mati di 3D (HC-1/HC-2 audit) dan
 * membiarkan 3D (2.95 m) divergen diam-diam dari gambar kerja (3.0/3.2 m).
 *
 * Konvensi: `Floor.heightM` = FLOOR-TO-FLOOR (lantai-ke-lantai, termasuk
 * slab). Tinggi dinding lantai itu = heightM − SLAB_T. Lantai rooftop
 * (`floor-rooftop`) spesial: heightM-nya (0.3) adalah TEBAL DAK, bukan
 * floor-to-floor — dak duduk di puncak tumpukan lantai reguler, wallHM 0.
 *
 * Modul murni (tanpa react/zustand/three); konstanta global tinggal
 * fallback & default.
 */

import type { Floor } from "@/types"
import {
  isMezzanineFloor,
  isRooftopFloor,
} from "@/lib/editor/floors"

/** Tinggi dinding default (m) — nilai historis 3D. */
export const WALL_H = 2.8
/** Tebal slab lantai (m). */
export const SLAB_T = 0.15
/** Floor-to-floor default = WALL_H + SLAB_T (= 2.95, memakai FLOAT historis
 *  hasil penjumlahan — bukan literal 2.95) — dipakai normalisasi data legacy
 *  (migrasi D2) & default lantai baru agar geometri 3D lama BIT-IDENTIK. */
export const DEFAULT_FLOOR_TO_FLOOR_M = WALL_H + SLAB_T

const ROOFTOP_ID = "floor-rooftop"

export type FloorElevation = {
  /** Index STACKING (untuk gap exploded-view): lantai reguler berurutan;
   *  rooftop = jumlah lantai reguler (duduk di puncak). BUKAN index array. */
  index: number
  /** Elevasi dasar lantai (prefix-sum floor-to-floor lantai di bawahnya). */
  baseY: number
  /** Lantai-ke-lantai lantai ini (rooftop: tebal dak). */
  floorToFloorM: number
  /** Tinggi dinding lantai ini = floorToFloorM − SLAB_T (rooftop: 0). */
  wallHM: number
  /** Rise tangga dari lantai ini ke LANTAI BERIKUTNYA DI ARRAY (konvensi
   *  target tangga): regular→regular/rooftop = floorToFloorM (perilaku
   *  lama); regular→mezzanine = baseOffsetM mezzanine (tangga mendarat di
   *  tepi platform — tidak melubangi lantai reguler di atasnya). */
  stairRiseToNextM?: number
}

function floorToFloorOf(floor: Floor): number {
  const h = floor.heightM
  if (!Number.isFinite(h) || h <= 0) return DEFAULT_FLOOR_TO_FLOOR_M
  // Snap nilai ternormalisasi 2.95 ke float historis WALL_H+SLAB_T supaya
  // tumpukan mereproduksi rumus lama `index × floorStep` bit-identik.
  return Math.abs(h - DEFAULT_FLOOR_TO_FLOOR_M) < 1e-9 ? DEFAULT_FLOOR_TO_FLOOR_M : h
}

const round2v = (v: number) => Math.round(v * 100) / 100

/**
 * Tabel elevasi per lantai. Lantai reguler ditumpuk berurutan sesuai urutan
 * array (konvensi layout); rooftop selalu di puncak tumpukan reguler,
 * terlepas posisinya di array.
 */
export function floorElevations(floors: readonly Floor[]): Map<string, FloorElevation> {
  const out = new Map<string, FloorElevation>()
  let cursor = 0
  let regularIndex = 0
  // Selama semua lantai di bawah masih default, baseY dihitung PERKALIAN
  // (index × floorStep) persis rumus lama — penjumlahan berulang float bisa
  // menyimpang 1 ulp dan memecah golden test bit-identik.
  let allDefault = true
  let lastRegular: { baseY: number; f2f: number; index: number } | null = null
  for (const floor of floors) {
    if (isRooftopFloor(floor)) continue
    if (isMezzanineFloor(floor)) {
      // MEZZANINE: lantai antara PARSIAL — TIDAK menambah tumpukan (atap &
      // lantai berikutnya tidak naik). baseY = induk + baseOffsetM (default
      // ½ f2f induk); index = index induk (gap explode menempel induknya).
      const parent = lastRegular
      const parentBase = parent?.baseY ?? 0
      const parentF2f = parent?.f2f ?? DEFAULT_FLOOR_TO_FLOOR_M
      const off =
        Number.isFinite(floor.baseOffsetM) && (floor.baseOffsetM ?? 0) > 0
          ? (floor.baseOffsetM as number)
          : round2v(parentF2f / 2)
      const f2f = floorToFloorOf(floor)
      out.set(floor.id, {
        index: parent?.index ?? 0,
        baseY: parentBase + off,
        floorToFloorM: f2f,
        wallHM: Math.max(0, round2v(f2f - SLAB_T)),
      })
      continue
    }
    const f2f = floorToFloorOf(floor)
    const baseY = allDefault ? regularIndex * DEFAULT_FLOOR_TO_FLOOR_M : cursor
    out.set(floor.id, {
      index: regularIndex,
      baseY,
      floorToFloorM: f2f,
      wallHM:
        f2f === DEFAULT_FLOOR_TO_FLOOR_M ? WALL_H : Math.max(0, round2v(f2f - SLAB_T)),
    })
    lastRegular = { baseY, f2f, index: regularIndex }
    cursor = baseY + f2f
    if (f2f !== DEFAULT_FLOOR_TO_FLOOR_M) allDefault = false
    regularIndex += 1
  }
  const rooftop = floors.find((f) => isRooftopFloor(f))
  if (rooftop) {
    out.set(rooftop.id, {
      index: regularIndex,
      baseY: allDefault ? regularIndex * DEFAULT_FLOOR_TO_FLOOR_M : cursor,
      floorToFloorM: floorToFloorOf(rooftop),
      wallHM: 0,
    })
  }
  // Post-pass: rise tangga per lantai = selisih baseY ke lantai berikutnya
  // di ARRAY (mezzanine yang tepat di atas induknya menjadi target tangga
  // lantai itu). Tanpa lantai berikutnya → floorToFloorM (fallback lama).
  for (let i = 0; i < floors.length; i++) {
    const cur = out.get(floors[i].id)
    if (!cur) continue
    const next = i + 1 < floors.length ? out.get(floors[i + 1].id) : undefined
    if (next && next.baseY > cur.baseY + 1e-6) {
      cur.stairRiseToNextM = next.baseY - cur.baseY
    }
  }
  return out
}

/** Tinggi total tumpukan (puncak dinding/lantai teratas) — utk kamera/scene. */
export function totalStackHeightM(floors: readonly Floor[]): number {
  const elev = floorElevations(floors)
  let top = 0
  for (const e of elev.values()) {
    top = Math.max(top, e.baseY + (e.wallHM > 0 ? e.floorToFloorM : SLAB_T + e.floorToFloorM))
  }
  return top
}

/**
 * Rise tangga dari lantai `floorId` ke lantai tepat di atasnya =
 * floor-to-floor lantai itu (anak teratas rata dgn slab atas). Fallback
 * DEFAULT_FLOOR_TO_FLOOR_M utk id tak dikenal (defensif).
 */
export function stairRiseM(
  elev: ReadonlyMap<string, FloorElevation>,
  floorId: string,
): number {
  const e = elev.get(floorId)
  return e?.stairRiseToNextM ?? e?.floorToFloorM ?? DEFAULT_FLOOR_TO_FLOOR_M
}

/**
 * Apakah tangga di lantai `stairFloorId` MENEMBUS slab lantai di atasnya
 * (lubang slab + potongan dinding/railing exit). Fase D: rise selalu =
 * floor-to-floor → selalu true. Fase E (mezzanine/split-level): tangga
 * ber-rise parsial mengembalikan false — konsumen tak perlu berubah lagi.
 */
export function stairPenetratesSlabAbove(
  elev: ReadonlyMap<string, FloorElevation>,
  stairFloorId: string,
): boolean {
  const e = elev.get(stairFloorId)
  if (!e) return true
  return stairRiseM(elev, stairFloorId) >= e.floorToFloorM - 1e-6
}
