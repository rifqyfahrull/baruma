/**
 * Pure projections of a `DesignLayout` into the three structural PLAN sheets
 * (denah struktur, top-view, y-UP) — foundation (Rencana Pondasi), columns
 * (Rencana Kolom) and beams (Rencana Balok). No DOM, no three.js — safe to unit
 * test and reuse from SVG/PDF renderers.
 *
 * The geometry comes straight from the SP6 structural modules — this file is a
 * PROJECTION layer only, it never re-derives a dimension:
 *  - `deriveColumnGrid(layout)` (grid.ts) → column positions + bay spans,
 *  - `columnLoad(spanX, spanY, floors)` (takedown.ts) → Pu / Ps for the bay,
 *  - `sizeColumn(Pu)` / `sizeBeam(span)` (sizing.ts) → member dims (mm),
 *  - `sizeFooting(Ps, σ)` (foundation.ts) → square footing side (m).
 * so the sheets stay bit-for-bit consistent with the RAB and the calc sheet.
 *
 * σ is read DEFENSIVELY (T1 carry-forward — `layout.structural` comes from an
 * un-validated PUT): `layout.structural?.soilBearingKPa ?? SOIL_DEFAULT_KPA`.
 *
 * Every builder ends with `normalize()` (shared with sanitation-detail.ts) so
 * ALL geometry lands inside a positive `[0,widthM]×[0,heightM]` box — the SP5
 * clip fix: `SheetSvg` clips from the origin, so grid axis lines / footing
 * squares / dim chains at negative coords would otherwise be cropped.
 */
import type { DesignLayout } from "@/types"
import { round2 } from "@/lib/geometry"
import { deriveColumnGrid } from "@/lib/structural/grid"
import { columnLoad } from "@/lib/structural/takedown"
import { sizeColumn, sizeBeam, SLOOF } from "@/lib/structural/sizing"
import { sizeFooting } from "@/lib/structural/foundation"
import { SOIL_DEFAULT_KPA } from "@/lib/structural/loads"
import { normalize } from "./sanitation-detail"
import { STRUCT_DISCLAIMER } from "./structural-calc"
import type { Drawing, DrawLine, DrawLabel, DimChain } from "./types"

/** Defensive σ read — un-validated PUT may omit `structural`. */
function soilBearing(layout: DesignLayout): number {
  const s = layout.structural?.soilBearingKPa
  return Number.isFinite(s) && (s as number) > 0 ? (s as number) : SOIL_DEFAULT_KPA
}

/** A-B-C… grid-line letters (x axis) and 1-2-3… numbers (y axis). */
const AXIS_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"

/** Grid axis lines extend this far (m) past the outermost columns. */
const AXIS_EXT_M = 0.6
/** Minimum clearance (m) between an info-block label and the nearest line. */
const LABEL_CLEAR_M = 0.25
/** Vertical pitch (m) between stacked info-block rows. */
const INFO_ROW_M = 0.5

/**
 * Info-block rows stacked ABOVE the plan (row 0 renders topmost, y-UP). The
 * LOWEST row is placed `LABEL_CLEAR_M` above the topmost line of the drawing
 * (grid axis extensions, footing pads, beams, …), so no label is ever struck
 * through by a grid line — the SP7 "Sloof 150×200 tercoret garis" fix. x = 0
 * is the LEFT text edge → anchor "start" (a centred label would stick out
 * left of the sheet frame).
 */
function infoLabels(lines: DrawLine[], rows: string[]): DrawLabel[] {
  const topLineY = lines.reduce((m, l) => Math.max(m, l.y1, l.y2), 0)
  const base = round2(topLineY + LABEL_CLEAR_M)
  return rows.map((text, i) => ({
    x: 0,
    y: round2(base + (rows.length - 1 - i) * INFO_ROW_M),
    text,
    kind: "room" as const,
    anchor: "start" as const,
  }))
}

/** Four `kind` lines forming a `side×side` square centred at `(cx, cy)`. */
function squareLines(cx: number, cy: number, side: number, kind: DrawLine["kind"]): DrawLine[] {
  const h = side / 2
  const x0 = round2(cx - h)
  const y0 = round2(cy - h)
  const x1 = round2(cx + h)
  const y1 = round2(cy + h)
  return [
    { x1: x0, y1: y0, x2: x1, y2: y0, kind },
    { x1: x1, y1: y0, x2: x1, y2: y1, kind },
    { x1: x1, y1: y1, x2: x0, y2: y1, kind },
    { x1: x0, y1: y1, x2: x0, y2: y0, kind },
  ]
}

/**
 * Grid axis lines (kind `opening`) spanning the footprint, one per grid line on
 * each axis, plus A/B/C + 1/2/3 axis bubbles as `room` labels. Extends a little
 * past the frame so the bubbles clear the columns/footings.
 */
function gridAxes(
  grid: ReturnType<typeof deriveColumnGrid>,
): { lines: DrawLine[]; labels: DrawLabel[] } {
  const lines: DrawLine[] = []
  const labels: DrawLabel[] = []
  if (grid.columns.length === 0) return { lines, labels }

  const xs = Array.from(new Set(grid.columns.map((c) => c.x))).sort((a, b) => a - b)
  const ys = Array.from(new Set(grid.columns.map((c) => c.y))).sort((a, b) => a - b)
  const y0 = ys[0]
  const y1 = ys[ys.length - 1]
  const x0 = xs[0]
  const x1 = xs[xs.length - 1]
  const ext = AXIS_EXT_M

  xs.forEach((x, i) => {
    lines.push({ x1: x, y1: round2(y0 - ext), x2: x, y2: round2(y1 + ext), kind: "opening" })
    labels.push({ x, y: round2(y0 - ext - 0.3), text: AXIS_LETTERS[i] ?? `X${i + 1}`, kind: "room" })
  })
  ys.forEach((y, i) => {
    lines.push({ x1: round2(x0 - ext), y1: y, x2: round2(x1 + ext), y2: y, kind: "opening" })
    labels.push({ x: round2(x0 - ext - 0.3), y, text: String(i + 1), kind: "room" })
  })
  return { lines, labels }
}

/**
 * Rencana Pondasi — one square spread footing per column, sized from the
 * service load `Ps` and the soil bearing σ. Footing squares use kind `slab`
 * (four lines each → footing count = `slab`-line count / 4); a small column
 * stub (`outline`) marks the pier; grid axes are `opening`. A dim chain on the
 * first footing calls out its real side; labels carry σ, the footing size, the
 * column count and (when the pad is impractical) the deep-foundation note.
 */
export function buildFoundationPlan(layout: DesignLayout, floors: number): Drawing {
  const grid = deriveColumnGrid(layout)
  const sigma = soilBearing(layout)
  const { Ps } = columnLoad(grid.spanX, grid.spanY, floors)
  const footing = sizeFooting(Ps, sigma)
  const s = footing.side

  const { lines: axisLines, labels: axisLabels } = gridAxes(grid)
  const lines: DrawLine[] = [...axisLines]
  for (const c of grid.columns) {
    lines.push(...squareLines(c.x, c.y, s, "slab")) // footing pad
    lines.push(...squareLines(c.x, c.y, 0.3, "outline")) // pier stub
  }

  const labels: DrawLabel[] = [...axisLabels]
  const dims: DimChain[] = []
  if (grid.columns.length > 0) {
    const c0 = grid.columns[0]
    // Dim the first footing's real side (position-independent under normalize).
    dims.push({ axis: "x", at: round2(c0.y - s / 2 - 0.4), points: [round2(c0.x - s / 2), round2(c0.x + s / 2)] })
  }

  // Info block stacked clear ABOVE the plan (never over a grid/footing line).
  const infoRows = [
    `Daya dukung tanah σ = ${sigma} kPa`,
    `Telapak ${s} × ${s} m (tebal ${footing.thickness} m)`,
    `Ps = ${Ps} kN/kolom · Jumlah kolom: ${grid.columns.length}`,
  ]
  if (footing.deepNote) infoRows.push(`Catatan: ${footing.deepNote}`)
  infoRows.push(STRUCT_DISCLAIMER)
  labels.push(...infoLabels(lines, infoRows))

  return normalize({ widthM: 0, heightM: 0, lines, labels, dims, levels: [], title: "Rencana Pondasi" })
}

/**
 * Rencana Kolom — one filled column square per grid intersection, sized from
 * the factored load `Pu`. Square uses kind `outline` (four lines each → column
 * count = `outline`-line count / 4) with a diagonal cross (kind `cut`) as the
 * solid/poché hatch. Labels carry the column dimension and the governing Pu.
 */
export function buildColumnPlan(layout: DesignLayout, floors: number, floorId: string): Drawing {
  const floor = layout.floors.find((f) => f.id === floorId)
  const grid = deriveColumnGrid(layout)
  const { Pu } = columnLoad(grid.spanX, grid.spanY, floors)
  const { side } = sizeColumn(Pu)
  const sideM = round2(side / 1000)

  const { lines: axisLines, labels: axisLabels } = gridAxes(grid)
  const lines: DrawLine[] = [...axisLines]
  for (const c of grid.columns) {
    lines.push(...squareLines(c.x, c.y, sideM, "outline"))
    // Diagonal cross = solid column (poché).
    const h = sideM / 2
    lines.push({ x1: round2(c.x - h), y1: round2(c.y - h), x2: round2(c.x + h), y2: round2(c.y + h), kind: "cut" })
    lines.push({ x1: round2(c.x - h), y1: round2(c.y + h), x2: round2(c.x + h), y2: round2(c.y - h), kind: "cut" })
  }

  const labels: DrawLabel[] = [...axisLabels]
  // Info block stacked clear ABOVE the plan (never over a grid line).
  labels.push(
    ...infoLabels(lines, [
      `Kolom ${side}×${side} mm (${grid.columns.length} titik)`,
      `Pu = ${Pu} kN (kolom terberat)`,
      STRUCT_DISCLAIMER,
    ]),
  )

  return normalize({
    widthM: 0, heightM: 0, lines, labels, dims: [], levels: [],
    title: `Rencana Kolom — ${floor ? floor.name : floorId}`,
  })
}

/**
 * Rencana Balok — beam centre-lines (kind `outline`) along the grid: one line
 * between every pair of horizontally-adjacent columns (arah-X) and every pair
 * of vertically-adjacent columns (arah-Y). Column nodes are marked with small
 * `cut` crosses. Labels carry the per-direction `b×h` from `sizeBeam(span)` and
 * the sloof section.
 */
export function buildBeamPlan(layout: DesignLayout, floors: number, floorId: string): Drawing {
  const floor = layout.floors.find((f) => f.id === floorId)
  const grid = deriveColumnGrid(layout)
  const beamX = sizeBeam(grid.spanX)
  const beamY = sizeBeam(grid.spanY)

  const { lines: axisLines, labels: axisLabels } = gridAxes(grid)
  const lines: DrawLine[] = [...axisLines]

  const xs = Array.from(new Set(grid.columns.map((c) => c.x))).sort((a, b) => a - b)
  const ys = Array.from(new Set(grid.columns.map((c) => c.y))).sort((a, b) => a - b)
  const has = new Set(grid.columns.map((c) => `${c.x}|${c.y}`))

  // arah-X beams (each row, between adjacent columns).
  for (const y of ys) {
    for (let i = 0; i + 1 < xs.length; i++) {
      if (has.has(`${xs[i]}|${y}`) && has.has(`${xs[i + 1]}|${y}`)) {
        lines.push({ x1: xs[i], y1: y, x2: xs[i + 1], y2: y, kind: "outline" })
      }
    }
  }
  // arah-Y beams (each column-line, between adjacent columns).
  for (const x of xs) {
    for (let i = 0; i + 1 < ys.length; i++) {
      if (has.has(`${x}|${ys[i]}`) && has.has(`${x}|${ys[i + 1]}`)) {
        lines.push({ x1: x, y1: ys[i], x2: x, y2: ys[i + 1], kind: "outline" })
      }
    }
  }
  // Column node crosses.
  for (const c of grid.columns) {
    lines.push({ x1: round2(c.x - 0.2), y1: c.y, x2: round2(c.x + 0.2), y2: c.y, kind: "cut" })
    lines.push({ x1: c.x, y1: round2(c.y - 0.2), x2: c.x, y2: round2(c.y + 0.2), kind: "cut" })
  }

  const labels: DrawLabel[] = [...axisLabels]
  // Balok/sloof callouts stacked clear ABOVE the beam grid — previously the
  // "Sloof" row landed EXACTLY on the topmost beam/axis line (y = depthM) and
  // was struck through; infoLabels keeps every row ≥ LABEL_CLEAR_M above the
  // topmost line.
  labels.push(
    ...infoLabels(lines, [
      `Balok arah-X ${beamX.b}×${beamX.h} mm (bentang ${grid.spanX} m)`,
      `Balok arah-Y ${beamY.b}×${beamY.h} mm (bentang ${grid.spanY} m)`,
      `Sloof ${SLOOF.b}×${SLOOF.h} mm`,
      STRUCT_DISCLAIMER,
    ]),
  )

  return normalize({
    widthM: 0, heightM: 0, lines, labels, dims: [], levels: [],
    title: `Rencana Balok — ${floor ? floor.name : floorId}`,
  })
}
