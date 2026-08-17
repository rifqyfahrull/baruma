/**
 * Sistem sirkulasi/perairan kolam renang (Fase 2) — turunan teknik dari ukuran
 * & tipe kolam sesuai praktik lapangan Indonesia: volume → turnover → debit →
 * pompa → filter → jumlah skimmer/inlet/main-drain → diameter & panjang pipa.
 * Plus tata-letak fitting (poolFittings) untuk denah pipa. Modul murni (hanya
 * arithmetic), mudah ditest; dipakai PoolQuickEditor (spec + denah) & RAB.
 *
 * Referensi praktik: turnover residensial 4–6 jam; skimmer ~1 per 25 m²
 * permukaan; inlet ~1 per 15 m²; main drain 1 (2 bila luas >40 m², anti-
 * entrapment); pompa ± 15 m³/jam per HP; filter pasir dipilih dari debit.
 */
import { round2 } from "@/lib/geometry"
import { effectivePoolDepthRange } from "@/lib/three/pool"
import type { PoolKind, Room } from "@/types"

/** Round to 1 decimal (debit/panjang — cukup untuk spesifikasi lapangan). */
function round1(n: number): number {
  return Math.round(n * 10) / 10
}

export type PoolFilterKind = "pasir" | "cartridge"

export type PoolCirculationType = "skimmer" | "overflow"

export type PoolCirculation = {
  areaM2: number
  avgDepthM: number
  volumeM3: number
  /** Target waktu sirkulasi seluruh volume (jam). */
  turnoverHours: number
  /** Debit sirkulasi wajib (m³/jam) = volume / turnover. */
  flowM3h: number
  /** Daya pompa (HP), kelipatan 0,5. */
  pumpHp: number
  filterKind: PoolFilterKind
  /** Diameter tabung filter pasir (inci). */
  filterDiaInch: number
  skimmers: number
  returns: number
  mainDrains: number
  /** Diameter pipa hisap / balik (mm). */
  suctionPipeMm: number
  returnPipeMm: number
  /** Estimasi total panjang pipa (m). */
  estPipeM: number
  circulationType: PoolCirculationType
  /** Panjang gutter keliling (m) — overflow saja, else 0. */
  gutterM: number
  /** Volume balancing tank (m³) ≈ 7% volume kolam — overflow saja, else 0. */
  balancingTankM3: number
}

/** Target turnover (jam) per tipe kolam — spa jauh lebih cepat, anak menengah. */
const TURNOVER_H: Record<PoolKind, number> = { renang: 6, plunge: 5, anak: 4, spa: 1 }

function ceilHalf(n: number): number {
  return Math.max(0.5, Math.ceil(n * 2) / 2)
}

export function poolCirculation(
  room: Pick<Room, "width" | "depth" | "areaM2" | "poolKind" | "poolDepthM" | "poolShallowM" | "poolDeepM" | "poolCirculationType">
): PoolCirculation {
  const kind: PoolKind = room.poolKind ?? "renang"
  const areaM2 = room.areaM2 > 0 ? room.areaM2 : Math.max(0, room.width * room.depth)
  const avgDepthM = effectivePoolDepthRange(room).avgM
  const volumeM3 = round2(areaM2 * avgDepthM)
  const turnoverHours = TURNOVER_H[kind]
  const flowM3h = round1(volumeM3 / turnoverHours)

  const pumpHp = ceilHalf(flowM3h / 15)

  // Filter pasir: diameter tabung dari debit (kapasitas ~ luas media).
  const filterDiaInch = flowM3h <= 10 ? 18 : flowM3h <= 18 ? 24 : flowM3h <= 30 ? 30 : 36
  // Spa (dan plunge kecil) memakai filter cartridge; selain itu pasir.
  const filterKind: PoolFilterKind =
    kind === "spa" || (kind === "plunge" && volumeM3 < 15) ? "cartridge" : "pasir"

  const skimmers = Math.max(1, Math.round(areaM2 / 25))
  const returns = Math.max(2, Math.round(areaM2 / 15))
  const mainDrains = areaM2 > 40 ? 2 : 1

  const suctionPipeMm = flowM3h <= 20 ? 50 : 63
  const returnPipeMm = flowM3h <= 20 ? 40 : 50

  // Overflow: skimmer digantikan gutter keliling + balancing tank (±7% volume).
  const circulationType: PoolCirculationType = room.poolCirculationType ?? "skimmer"
  const overflow = circulationType === "overflow"
  const skimmersEff = overflow ? 0 : skimmers
  const gutterM = overflow ? round1(2 * (room.width + room.depth)) : 0
  const balancingTankM3 = overflow ? round2(volumeM3 * 0.07) : 0

  // Estimasi pipa: keliling kolam + lari ke ruang pompa per titik hisap/balik.
  const fittings = skimmersEff + returns + mainDrains
  const estPipeM = round1(2 * (room.width + room.depth) + fittings * 4)

  return {
    areaM2: round1(areaM2),
    avgDepthM,
    volumeM3,
    turnoverHours,
    flowM3h,
    pumpHp,
    filterKind,
    filterDiaInch,
    skimmers: skimmersEff,
    returns,
    mainDrains,
    suctionPipeMm,
    returnPipeMm,
    estPipeM,
    circulationType,
    gutterM,
    balancingTankM3,
  }
}

/** Jenis fitting untuk denah pipa. */
export type PoolFittingKind = "skimmer" | "return" | "drain" | "equipment"

/** Titik fitting pada denah — u,v fraksi [0,1] di dalam rect kolam
 *  (u sepanjang lebar, v sepanjang dalam). `equipment` diletakkan di LUAR
 *  kolam (u>1) mewakili ruang pompa/filter. */
export type PoolFitting = { kind: PoolFittingKind; u: number; v: number; label: string }

/**
 * Tata-letak fitting untuk denah pipa: skimmer di tepi atas, inlet/return di
 * tepi bawah, main drain di dasar tengah, ruang pompa di luar sisi kanan.
 */
export function poolFittings(
  room: Pick<Room, "width" | "depth" | "areaM2" | "poolKind" | "poolDepthM" | "poolShallowM" | "poolDeepM" | "poolCirculationType">
): PoolFitting[] {
  const c = poolCirculation(room)
  const out: PoolFitting[] = []
  // Skimmer hanya untuk sistem skimmer; overflow memakai gutter keliling
  // (digambar sebagai emphasis outline di denah, bukan titik fitting).
  for (let i = 0; i < c.skimmers; i++) {
    out.push({ kind: "skimmer", u: (i + 1) / (c.skimmers + 1), v: 0, label: "Skimmer" })
  }
  for (let i = 0; i < c.returns; i++) {
    out.push({ kind: "return", u: (i + 1) / (c.returns + 1), v: 1, label: "Inlet" })
  }
  for (let i = 0; i < c.mainDrains; i++) {
    out.push({ kind: "drain", u: (i + 1) / (c.mainDrains + 1), v: 0.5, label: "Main drain" })
  }
  out.push({ kind: "equipment", u: 1.18, v: 0.5, label: "Pompa & filter" })
  if (c.circulationType === "overflow") {
    out.push({ kind: "equipment", u: 1.18, v: 0.15, label: "Balancing tank" })
  }
  return out
}
