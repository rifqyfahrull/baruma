/**
 * Pure projection of a `DesignLayout` into the structural calculation sheet
 * ("Perhitungan Struktur"). The `Drawing` contract has NO table primitive, so —
 * exactly like the SP5 sanitation calc sheets — the table is built as a stack
 * of `kind:"room"` label rows inside a framing rectangle (SP6 Global
 * Constraint: "label bertumpuk untuk tabel").
 *
 * Every number comes from the SP6 structural modules (this file never
 * re-derives a formula): `deriveColumnGrid` (spans), `columnLoad` (Pu/Ps),
 * `sizeColumn`/`sizeBeam` (member dims), `sizeFooting` (footing side) and the
 * `loads.ts` constants/combos (`floorWu`, `roofWu`, …). The sheet shows the
 * governing (heaviest) bottom column so the calc ties bit-for-bit to the plan
 * sheets and the RAB.
 *
 * σ is read DEFENSIVELY (`layout.structural?.soilBearingKPa ?? SOIL_DEFAULT_KPA`)
 * — the layout PUT has no zod. The sheet carries the MANDATORY structural
 * disclaimer VERBATIM as the last `room` label. `normalize()` (shared with
 * sanitation-detail.ts) shifts every coordinate into a positive box so nothing
 * is clipped from the origin (SP5 clip fix).
 */
import type { DesignLayout } from "@/types"
import { round2 } from "@/lib/geometry"
import { deriveColumnGrid } from "@/lib/structural/grid"
import { columnLoad } from "@/lib/structural/takedown"
import { sizeColumn, sizeBeam, SLOOF } from "@/lib/structural/sizing"
import { sizeFooting } from "@/lib/structural/foundation"
import {
  DL_FLOOR, DL_ROOF, LL_FLOOR, LL_ROOF, FC_MPA, FY_MPA, SOIL_DEFAULT_KPA,
  floorWu, roofWu, floorWs, roofWs,
} from "@/lib/structural/loads"
import { normalize } from "./sanitation-detail"
import type { Drawing, DrawLine, DrawLabel } from "./types"

/**
 * Mandatory structural disclaimer (verbatim — SP6 Global Constraints). Shared
 * with the plan sheets (structural-plan.ts imports it) so the wording never
 * drifts.
 */
export const STRUCT_DISCLAIMER =
  "Perhitungan pendekatan — wajib diverifikasi insinyur struktur berlisensi sebelum konstruksi (persyaratan PBG)."

/** Defensive σ read — un-validated PUT may omit `structural`. */
function soilBearing(layout: DesignLayout): number {
  const s = layout.structural?.soilBearingKPa
  return Number.isFinite(s) && (s as number) > 0 ? (s as number) : SOIL_DEFAULT_KPA
}

const ROW_H = 0.5 // metres per stacked table row
const TABLE_W = 14 // frame width (m) — long Bahasa rows; scaling handles overflow
const PAD = 0.25 // left cell padding (m)

type Row = { text: string; section?: boolean }

/**
 * Structural calc sheet for the governing bottom column of the derived grid.
 * `floors` is the storey count the column stacks under (Project.floors).
 */
export function buildStructuralCalc(layout: DesignLayout, floors: number): Drawing {
  const grid = deriveColumnGrid(layout)
  const sigma = soilBearing(layout)
  const n = Math.max(1, Math.floor(Number.isFinite(floors) ? floors : 1))

  const { Atrib, Pu, Ps } = columnLoad(grid.spanX, grid.spanY, floors)
  const col = sizeColumn(Pu)
  const beamX = sizeBeam(grid.spanX)
  const beamY = sizeBeam(grid.spanY)
  const footing = sizeFooting(Ps, sigma)
  // Ag_req comes straight from sizeColumn (single source of truth) — never
  // re-derive the 0.33·f'c formula here, or this row could silently diverge
  // from the column side shown one line below.
  const AgReq = col.agReq

  const rows: Row[] = [
    { text: "ASUMSI", section: true },
    { text: `DL lantai ${DL_FLOOR} kPa · DL atap ${DL_ROOF} kPa`, },
    { text: `LL lantai ${LL_FLOOR} kPa · LL atap ${LL_ROOF} kPa`, },
    { text: `f'c = ${FC_MPA} MPa · fy = ${FY_MPA} MPa`, },
    { text: `Daya dukung tanah σ = ${sigma} kPa`, },
    { text: `Jumlah lantai = ${n} · Bentang bay ${grid.spanX} × ${grid.spanY} m`, },
    { text: "LANGKAH PERHITUNGAN (kolom terberat)", section: true },
    { text: `Atribusi A = ${grid.spanX} × ${grid.spanY} = ${Atrib} m²`, },
    { text: `wu = 1.2·DL + 1.6·LL → lantai ${floorWu()} kPa · atap ${roofWu()} kPa`, },
    { text: `ws = DL + LL → lantai ${floorWs()} kPa · atap ${roofWs()} kPa`, },
    { text: `Pu = A × (${n}×${floorWu()} + ${roofWu()}) = ${Pu} kN`, },
    { text: `Ps = A × (${n}×${floorWs()} + ${roofWs()}) = ${Ps} kN`, },
    { text: `Ag perlu = Pu·1000/(0.33·f'c) ≈ ${AgReq} mm² → sisi kolom ${col.side} mm`, },
    { text: `A telapak = Ps/σ = ${footing.area} m² → sisi ${footing.side} m`, },
    { text: "HASIL", section: true },
    { text: `Kolom ${col.side}×${col.side} mm`, },
    { text: `Balok arah-X ${beamX.b}×${beamX.h} mm · arah-Y ${beamY.b}×${beamY.h} mm`, },
    { text: `Sloof ${SLOOF.b}×${SLOOF.h} mm`, },
    { text: `Telapak ${footing.side}×${footing.side} m (tebal ${footing.thickness} m)`, },
  ]
  if (footing.deepNote) rows.push({ text: `Catatan pondasi: ${footing.deepNote}` })
  rows.push({ text: STRUCT_DISCLAIMER })

  const nRows = rows.length
  const topY = round2(nRows * ROW_H)

  const lines: DrawLine[] = []
  const labels: DrawLabel[] = []

  // Outer frame.
  lines.push({ x1: 0, y1: 0, x2: TABLE_W, y2: 0, kind: "outline" })
  lines.push({ x1: TABLE_W, y1: 0, x2: TABLE_W, y2: topY, kind: "outline" })
  lines.push({ x1: TABLE_W, y1: topY, x2: 0, y2: topY, kind: "outline" })
  lines.push({ x1: 0, y1: topY, x2: 0, y2: 0, kind: "outline" })

  rows.forEach((row, i) => {
    const rowTop = round2(topY - i * ROW_H)
    // Separator rule above each section header (and below the title band).
    if (row.section && i > 0) {
      lines.push({ x1: 0, y1: rowTop, x2: TABLE_W, y2: rowTop, kind: "outline" })
    }
    labels.push({
      x: PAD,
      y: round2(rowTop - ROW_H / 2),
      text: row.text,
      kind: "room",
      // x is the LEFT edge of the row text (PAD from the frame) — without an
      // explicit "start" the renderer would centre the text on x=PAD and half
      // of every row would stick out LEFT of the table frame.
      anchor: "start",
    })
  })

  return normalize({
    widthM: TABLE_W,
    heightM: topY,
    lines,
    labels,
    dims: [],
    levels: [],
    title: "Perhitungan Struktur",
  })
}
