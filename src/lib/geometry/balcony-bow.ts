/**
 * Balkon bertepi depan MELENGKUNG (bowed): aproksimasi busur murah — sagitta
 * parabola, bukan lingkaran sejati — cukup untuk siluet low-poly (grammar >
 * tekstur, target tablet; lihat filosofi produk). Modul pure (arithmetic
 * saja, tanpa Room/Prim): build-model.ts memetakan hasil (koordinat LOKAL
 * sepanjang tepi `u`, tonjolan keluar tepi `v`) ke posisi/rotasi world sesuai
 * sisi (n/s/w/e) yang dibusurkan.
 *
 *   v(u) = bowM · (1 − (2u/L)²),  u ∈ [−L/2, L/2]
 *
 * v(0) = bowM (tonjolan maksimum di tengah tepi), v(±L/2) = 0 (bertemu rapi
 * dengan sudut lurus di ujung tepi — sisi & belakang tak tersentuh).
 */

/** Jumlah strip pelat lantai — GANJIL supaya satu strip berpusat TEPAT di
 *  tengah tepi (tonjolannya persis `bowM`, bukan rata-rata dua strip
 *  tetangga). Dalam rentang low-poly yang disarankan (8–14). */
export const BOW_FLOOR_SEGMENTS = 9

/** Jumlah segmen railing (polyline) — GENAP supaya satu SIMPUL polyline
 *  jatuh tepat di tengah tepi (offsetnya persis `bowM`). Dalam rentang
 *  low-poly yang disarankan (8–14). */
export const BOW_RAIL_SEGMENTS = 10

/** Sagitta tak masuk akal kalau melebihi separuh panjang tepi (busur lebih
 *  dari setengah lingkaran) — clamp longgar di sini; UI/schema punya batas
 *  produk sendiri (0–1,5 m), ini cuma jaring pengaman geometri. */
function clampBow(bowM: number, lenM: number): number {
  if (!Number.isFinite(bowM) || bowM <= 0) return 0
  return Math.min(bowM, lenM / 2)
}

function sagAt(u: number, lenM: number, bowM: number): number {
  const t = (2 * u) / lenM
  return bowM * (1 - t * t)
}

export type BowFloorStrip = {
  /** Posisi tengah strip sepanjang tepi (u), meter, dari titik tengah tepi. */
  uMid: number
  /** Lebar strip sepanjang tepi (u), meter. */
  uLen: number
  /** Tonjolan strip keluar dari garis tepi lurus (v), meter (> 0). */
  vDepth: number
}

/**
 * Pelat lantai balkon di tepi bowed dipecah jadi `BOW_FLOOR_SEGMENTS` strip
 * selebar sama sepanjang tepi; tiap strip menonjol keluar sejauh `sagAt`
 * pada titik tengahnya — siluet kipas/strip mengaproksimasi busur.
 * `lenM<=0` atau `bowM<=0` → array kosong (caller pakai jalur lurus lama,
 * TANPA emisi tambahan apa pun — byte-identik).
 */
export function bowFloorStrips(lenM: number, bowM: number): BowFloorStrip[] {
  const bow = clampBow(bowM, lenM)
  if (lenM <= 0 || bow <= 0) return []
  const n = BOW_FLOOR_SEGMENTS
  const uLen = lenM / n
  const strips: BowFloorStrip[] = []
  for (let i = 0; i < n; i++) {
    const uMid = -lenM / 2 + (i + 0.5) * uLen
    strips.push({ uMid, uLen, vDepth: sagAt(uMid, lenM, bow) })
  }
  return strips
}

export type BowRailSegment = {
  /** Posisi tengah segmen sepanjang tepi (u), meter, dari titik tengah tepi. */
  uMid: number
  /** Offset tengah segmen keluar dari garis tepi lurus (v), meter. */
  vMid: number
  /** Panjang chord segmen (jarak antar simpul berturutan), meter. */
  length: number
  /** Komponen U dari vektor arah satuan (tangen chord) — untuk memposisikan
   *  elemen di dalam segmen (baluster/tiang) mengikuti kemiringan lokal. */
  dirU: number
  /** Komponen V dari vektor arah satuan (tangen chord). */
  dirV: number
}

/**
 * Railing balkon di tepi bowed dipecah jadi `BOW_RAIL_SEGMENTS` segmen
 * pendek berjajar mengikuti simpul-simpul parabola (polyline) — sudut tiap
 * segmen menyesuaikan kemiringan lokal kurva (lihat `dirU`/`dirV`).
 * `lenM<=0` atau `bowM<=0` → array kosong.
 */
export function bowRailSegments(lenM: number, bowM: number): BowRailSegment[] {
  const bow = clampBow(bowM, lenM)
  if (lenM <= 0 || bow <= 0) return []
  const n = BOW_RAIL_SEGMENTS
  const nodes: Array<{ u: number; v: number }> = []
  for (let k = 0; k <= n; k++) {
    const u = -lenM / 2 + k * (lenM / n)
    nodes.push({ u, v: sagAt(u, lenM, bow) })
  }
  const segs: BowRailSegment[] = []
  for (let k = 0; k < n; k++) {
    const a = nodes[k]
    const b = nodes[k + 1]
    const du = b.u - a.u
    const dv = b.v - a.v
    const length = Math.hypot(du, dv)
    segs.push({
      uMid: (a.u + b.u) / 2,
      vMid: (a.v + b.v) / 2,
      length,
      dirU: length > 0 ? du / length : 1,
      dirV: length > 0 ? dv / length : 0,
    })
  }
  return segs
}
