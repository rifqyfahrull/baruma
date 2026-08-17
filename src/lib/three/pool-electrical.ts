/**
 * Kelistrikan kolam renang (Fase 3) — turunan dari sirkulasi: daya & MCB pompa,
 * lampu bawah air (LED tegangan rendah + trafo), pembumian ekipotensial
 * (bonding, keselamatan). Feed ke beban PLN (deriveApplianceLoads) & RAB.
 * Praktik: pompa 1-fasa 220V pf 0,8 + margin 1,25 → MCB standar; lampu ~1 per
 * 18 m², 12V via trafo; bonding keliling kolam + lari ke MET.
 */
import { round2 } from "@/lib/geometry"
import { poolCirculation } from "@/lib/three/pool-circulation"
import type { Room } from "@/types"

/** Ukuran MCB 1-fasa standar (A). */
const MCB_SIZES = [6, 10, 16, 20, 25, 32, 40, 50, 63]
/** Ukuran trafo lampu kolam standar (VA). */
const TRAFO_SIZES = [100, 300, 600, 1000]

function roundUpTo(sizes: number[], v: number): number {
  return sizes.find((s) => s >= v) ?? sizes[sizes.length - 1]
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

export const POOL_LIGHT_WATT = 25
/** Beban opsi spa (W). */
export const POOL_JET_BLOWER_W = 1500
export const POOL_HEATER_W = 3000
export const POOL_CHLORINATOR_W = 150

export type PoolElectrical = {
  /** Daya pompa (kW). */
  pumpKw: number
  /** MCB dedikasi pompa (A) — 1-fasa 220V, pf 0,8, margin 1,25. */
  pumpBreakerA: number
  /** Jumlah lampu bawah air. */
  lights: number
  lightWattEach: number
  lightsTotalW: number
  /** Trafo lampu 12V (VA). */
  transformerVa: number
  /** Beban jet/blower spa (W) — 0 bila off. */
  jetBlowerW: number
  /** Beban pemanas kolam (W) — 0 bila off. */
  heaterW: number
  /** Beban salt chlorinator (W) — 0 bila off. */
  chlorinatorW: number
  /** Total beban kolam (W) = pompa + lampu + jet + heater + chlorinator. */
  totalLoadW: number
  /** Estimasi panjang penghantar pembumian/bonding (m). */
  bondingM: number
}

export function poolElectrical(
  room: Pick<
    Room,
    | "width" | "depth" | "areaM2" | "poolKind" | "poolDepthM"
    | "poolShallowM" | "poolDeepM" | "poolCirculationType"
    | "poolHasJets" | "poolHeater" | "poolSaltChlorinator"
  >
): PoolElectrical {
  const c = poolCirculation(room)
  const pumpKw = round2(c.pumpHp * 0.746)
  const pumpAmps = (pumpKw * 1000) / (220 * 0.8)
  const pumpBreakerA = roundUpTo(MCB_SIZES, pumpAmps * 1.25)

  const areaM2 = room.areaM2 > 0 ? room.areaM2 : Math.max(0, room.width * room.depth)
  const lights = Math.max(1, Math.round(areaM2 / 18))
  const lightsTotalW = lights * POOL_LIGHT_WATT
  const transformerVa = roundUpTo(TRAFO_SIZES, lightsTotalW * 1.25)

  const jetBlowerW = room.poolHasJets ? POOL_JET_BLOWER_W : 0
  const heaterW = room.poolHeater ? POOL_HEATER_W : 0
  const chlorinatorW = room.poolSaltChlorinator ? POOL_CHLORINATOR_W : 0

  const totalLoadW = Math.round(
    pumpKw * 1000 + lightsTotalW + jetBlowerW + heaterW + chlorinatorW
  )
  const bondingM = round1(2 * (room.width + room.depth) + 8)

  return {
    pumpKw,
    pumpBreakerA,
    lights,
    lightWattEach: POOL_LIGHT_WATT,
    lightsTotalW,
    transformerVa,
    jetBlowerW,
    heaterW,
    chlorinatorW,
    totalLoadW,
    bondingM,
  }
}
