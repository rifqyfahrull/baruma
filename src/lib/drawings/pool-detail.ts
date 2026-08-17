/**
 * DETAIL KOLAM — potongan konstruksi per kolam: dinding & lantai beton 20 cm,
 * lantai kerja 5 cm, muka air −8 cm dari bibir, coping, level ±0.00/−kedalaman,
 * catatan spesifikasi. Elevasi memakai konvensi drawing: y ke ATAS, tanah = 0,
 * dasar kolam = −kedalaman.
 */
import type { DesignLayout, Room } from "@/types"
import { round2 } from "@/lib/geometry"
import { POOL_FINISHES, effectivePoolDepthRange, effectivePoolFinish } from "@/lib/three/pool"
import type { Drawing, DrawLabel, DrawLine, DimChain, LevelMark } from "./types"

const WALL_T = 0.2
const FLOOR_T = 0.2
const LEAN_T = 0.05          // lantai kerja
const WATER_DROP = 0.08
const COPING_H = 0.12
const COPING_W = 0.18
const POOL_GAP_M = 3

const FINISH_LABEL: Record<string, string> = {
  keramik_biru: "Keramik biru",
  mozaik_hijau: "Mozaik hijau",
  pebble_gelap: "Pebble gelap",
  batu_alam: "Batu alam",
}

export function buildPoolDetail(layout: DesignLayout): Drawing {
  const pools = layout.rooms.filter((r) => r.type === "kolam")
  const lines: DrawLine[] = []
  const labels: DrawLabel[] = []
  const dims: DimChain[] = []
  const levels: LevelMark[] = []
  let x0 = 0
  let maxDepth = 0

  for (const pool of pools) {
    drawOne(pool, x0, lines, labels, dims, levels)
    maxDepth = Math.max(maxDepth, effectivePoolDepthRange(pool).deepM)
    const lenAlong =
      pool.poolEntrySide === "n" || pool.poolEntrySide === "s" ? pool.depth : pool.width
    x0 += lenAlong + 2 * (WALL_T + COPING_W) + POOL_GAP_M
  }

  return {
    widthM: round2(Math.max(1, x0 - POOL_GAP_M) + 2),
    heightM: round2(maxDepth + FLOOR_T + LEAN_T + COPING_H + 2.5),
    lines,
    labels,
    dims,
    levels,
    title: "Detail Kolam",
  }
}

function drawOne(
  pool: Room,
  x0: number,
  lines: DrawLine[],
  labels: DrawLabel[],
  dims: DimChain[],
  levels: LevelMark[],
): void {
  const refId = pool.id
  const range = effectivePoolDepthRange(pool)
  // Potongan digambar searah sumbu sisi masuk: ujung DANGKAL di kiri (sisi
  // masuk), DALAM di kanan. Uniform → garis datar (identik perilaku lama).
  const innerW =
    pool.poolEntrySide === "n" || pool.poolEntrySide === "s" ? pool.depth : pool.width
  const dL = range.shallowM
  const dR = range.deepM
  const inL = x0 + WALL_T          // muka dalam dinding kiri
  const inR = inL + innerW
  const outL = x0
  const outR = inR + WALL_T

  // garis tanah kiri-kanan
  lines.push({ x1: outL - 1, y1: 0, x2: outR + 1, y2: 0, kind: "ground", refId })

  // dinding kiri (dangkal) & kanan (dalam) — rect cut: dari 0 turun ke dasar
  lines.push(
    { x1: outL, y1: 0, x2: outL, y2: round2(-dL - FLOOR_T), kind: "cut", refId },
    { x1: inL, y1: 0, x2: inL, y2: round2(-dL), kind: "cut", refId },
    { x1: inR, y1: 0, x2: inR, y2: round2(-dR), kind: "cut", refId },
    { x1: outR, y1: 0, x2: outR, y2: round2(-dR - FLOOR_T), kind: "cut", refId },
  )
  // lantai kolam (miring bila dangkal≠dalam) + slab bawah + lantai kerja
  lines.push(
    { x1: inL, y1: round2(-dL), x2: inR, y2: round2(-dR), kind: "cut", refId },
    { x1: outL, y1: round2(-dL - FLOOR_T), x2: outR, y2: round2(-dR - FLOOR_T), kind: "cut", refId },
    { x1: outL, y1: round2(-dL - FLOOR_T - LEAN_T), x2: outR, y2: round2(-dR - FLOOR_T - LEAN_T), kind: "slab", refId },
  )
  // muka air
  lines.push({ x1: inL, y1: -WATER_DROP, x2: inR, y2: -WATER_DROP, kind: "opening", refId })
  // coping dua sisi (rect kecil di atas dinding)
  for (const cx of [outL - COPING_W + WALL_T, inR] as const) {
    lines.push(
      { x1: cx, y1: 0, x2: cx + WALL_T + COPING_W, y2: 0, kind: "outline", refId },
      { x1: cx, y1: COPING_H, x2: cx + WALL_T + COPING_W, y2: COPING_H, kind: "outline", refId },
    )
  }

  levels.push({ y: 0, label: "±0.00" })
  levels.push({ y: round2(-dL), label: `-${dL.toFixed(2)}` })
  if (dR !== dL) levels.push({ y: round2(-dR), label: `-${dR.toFixed(2)}` })
  dims.push({
    axis: "y",
    at: round2(outR + 0.6),
    points: dR !== dL ? [0, round2(-dL), round2(-dR)] : [0, round2(-dR)],
  })
  dims.push({ axis: "x", at: round2(-dR - FLOOR_T - 0.6), points: [round2(inL), round2(inR)] })

  const finish = effectivePoolFinish(pool)
  const depthText = dR !== dL ? `${dL.toFixed(2)}–${dR.toFixed(2)}` : dR.toFixed(2)
  const notes = [
    `${pool.name} — ${innerW.toFixed(1)} m × kedalaman ${depthText} m`,
    `Beton bertulang K-300, dinding & lantai t=${Math.round(WALL_T * 100)} cm`,
    "Waterproofing integral + coating semen 2 lapis",
    `Lantai kerja t=${Math.round(LEAN_T * 100)} cm`,
    `Finishing: ${FINISH_LABEL[finish] ?? finish} (${POOL_FINISHES[finish].water})`,
    `Coping batu ${Math.round(COPING_W * 100)} cm, muka air -${Math.round(WATER_DROP * 100)} cm`,
  ]
  notes.forEach((text, i) => {
    labels.push({
      x: round2(outL), y: round2(0.6 + (notes.length - i) * 0.45),
      text, kind: "room", refId, anchor: "start",
    })
  })
}
