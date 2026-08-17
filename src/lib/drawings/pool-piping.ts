/**
 * DENAH PIPA KOLAM — menerbitkan perhitungan sirkulasi (pool-circulation.ts)
 * ke gambar kerja. Sebelumnya denah pipa hanya ada di panel editor 3D
 * (PoolQuickEditor) dan tidak pernah sampai ke kontraktor.
 *
 * Pemetaan kind (kontrak Drawing tidak menambah kind baru):
 *   "outline"  = outline kolam + glyph fitting
 *   "cut"      = pipa HISAP  (skimmer & main drain → pompa)
 *   "opening"  = pipa BALIK  (pompa → inlet/return)
 *   "slab"     = garis tabel skedul MEP
 * Semua elemen milik satu kolam ber-refId room.id.
 */
import type { DesignLayout, Room } from "@/types"
import { round2 } from "@/lib/geometry"
import { poolCirculation, poolFittings } from "@/lib/three/pool-circulation"
import { poolElectrical } from "@/lib/three/pool-electrical"
import type { Drawing, DrawLabel, DrawLine } from "./types"

const GLYPH_R = 0.18          // setengah sisi glyph fitting (m)
const POOL_GAP_M = 2.5        // jarak antar kolam bila lebih dari satu
const TABLE_ROW_M = 0.55      // tinggi baris skedul
const MARGIN_M = 1

function glyph(lines: DrawLine[], x: number, y: number, refId: string): void {
  // kotak kecil + silang — cukup khas tanpa butuh DrawSymbol
  lines.push(
    { x1: x - GLYPH_R, y1: y - GLYPH_R, x2: x + GLYPH_R, y2: y - GLYPH_R, kind: "outline", refId },
    { x1: x + GLYPH_R, y1: y - GLYPH_R, x2: x + GLYPH_R, y2: y + GLYPH_R, kind: "outline", refId },
    { x1: x + GLYPH_R, y1: y + GLYPH_R, x2: x - GLYPH_R, y2: y + GLYPH_R, kind: "outline", refId },
    { x1: x - GLYPH_R, y1: y + GLYPH_R, x2: x - GLYPH_R, y2: y - GLYPH_R, kind: "outline", refId },
    { x1: x - GLYPH_R, y1: y - GLYPH_R, x2: x + GLYPH_R, y2: y + GLYPH_R, kind: "outline", refId },
  )
}

export function buildPoolPiping(layout: DesignLayout): Drawing {
  const pools = layout.rooms.filter((r) => r.type === "kolam")
  const lines: DrawLine[] = []
  const labels: DrawLabel[] = []
  let cursorY = 0
  let maxX = 0

  for (const pool of pools) {
    const y0 = cursorY
    drawOnePool(pool, y0, lines, labels)
    const c = poolCirculation(pool)
    const rows = scheduleRows(pool, c)
    const tableY = y0 + pool.depth + 1
    drawSchedule(pool, rows, tableY, lines, labels)
    cursorY = tableY + rows.length * TABLE_ROW_M + POOL_GAP_M
    maxX = Math.max(maxX, pool.width + 4) // + ruang pompa & label kanan
  }

  return {
    widthM: round2(maxX + MARGIN_M * 2),
    heightM: round2(Math.max(1, cursorY - POOL_GAP_M) + MARGIN_M * 2),
    lines,
    labels,
    dims: [],
    levels: [],
    title: "Denah Pipa Kolam",
  }
}

function drawOnePool(
  pool: Room,
  y0: number,
  lines: DrawLine[],
  labels: DrawLabel[],
): void {
  const refId = pool.id
  const w = pool.width
  const d = pool.depth

  // outline kolam (digambar lokal dari (0,y0) — sheet ini skematik, bukan
  // posisi tapak; posisi tapak ada di denah arsitektur)
  lines.push(
    { x1: 0, y1: y0, x2: w, y2: y0, kind: "outline", refId },
    { x1: w, y1: y0, x2: w, y2: y0 + d, kind: "outline", refId },
    { x1: w, y1: y0 + d, x2: 0, y2: y0 + d, kind: "outline", refId },
    { x1: 0, y1: y0 + d, x2: 0, y2: y0, kind: "outline", refId },
  )
  labels.push({ x: round2(w / 2), y: round2(y0 + d / 2), text: pool.name, kind: "room", refId })

  const fittings = poolFittings(pool)
  const eq = fittings.find((f) => f.kind === "equipment")!
  const eqX = round2(eq.u * w)
  const eqY = round2(y0 + eq.v * d)
  for (const f of fittings) {
    const fx = round2(f.u * w)
    const fy = round2(y0 + f.v * d)
    glyph(lines, fx, fy, refId)
    labels.push({ x: round2(fx + GLYPH_R + 0.1), y: fy, text: f.label, kind: "room", refId, anchor: "start" })
    if (f.kind === "skimmer" || f.kind === "drain") {
      lines.push({ x1: fx, y1: fy, x2: eqX, y2: eqY, kind: "cut", refId })   // hisap
    } else if (f.kind === "return") {
      lines.push({ x1: eqX, y1: eqY, x2: fx, y2: fy, kind: "opening", refId }) // balik
    }
  }
}

function scheduleRows(pool: Room, c: ReturnType<typeof poolCirculation>): string[] {
  const e = poolElectrical(pool)
  const rows = [
    `Volume ${c.volumeM3} m³ · Turnover ${c.turnoverHours} jam · Debit ${c.flowM3h} m³/jam`,
    `Pompa ${c.pumpHp} HP (${e.pumpKw.toFixed(2)} kW) · MCB ${e.pumpBreakerA} A`,
    c.filterKind === "cartridge" ? `Filter cartridge` : `Filter pasir Ø${c.filterDiaInch}"`,
    c.circulationType === "overflow"
      ? `Gutter keliling ±${c.gutterM} m · Inlet ${c.returns} · Main drain ${c.mainDrains}`
      : `Skimmer ${c.skimmers} · Inlet ${c.returns} · Main drain ${c.mainDrains}`,
    `Hisap Ø${c.suctionPipeMm} / balik Ø${c.returnPipeMm} mm · Pipa ±${c.estPipeM} m`,
    `Lampu ${e.lights}×${25} W 12V · Trafo ${e.transformerVa} VA · Bonding ±${e.bondingM} m`,
  ]
  if (c.circulationType === "overflow") {
    rows.push(`Balancing tank ±${c.balancingTankM3} m³`)
  }
  return rows
}

function drawSchedule(
  pool: Room,
  rows: string[],
  tableY: number,
  lines: DrawLine[],
  labels: DrawLabel[],
): void {
  const refId = pool.id
  const tw = Math.max(pool.width, 6)
  for (let i = 0; i <= rows.length; i++) {
    const y = round2(tableY + i * TABLE_ROW_M)
    lines.push({ x1: 0, y1: y, x2: tw, y2: y, kind: "slab", refId })
  }
  lines.push({ x1: 0, y1: round2(tableY), x2: 0, y2: round2(tableY + rows.length * TABLE_ROW_M), kind: "slab", refId })
  lines.push({ x1: tw, y1: round2(tableY), x2: tw, y2: round2(tableY + rows.length * TABLE_ROW_M), kind: "slab", refId })
  rows.forEach((text, i) => {
    labels.push({
      x: 0.15,
      y: round2(tableY + (i + 0.5) * TABLE_ROW_M),
      text,
      kind: "room",
      refId,
      anchor: "start",
    })
  })
}
