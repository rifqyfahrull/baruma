/**
 * Pure projection of a `DesignLayout`'s kusen schedule into two kinds of
 * `Drawing` sheets: the "Daftar Kusen" table and the parametric "Detail
 * Kusen" panels (one per `KusenType`). No DOM, no three.js — safe to unit
 * test and reuse from SVG/PDF renderers. Mirrors kusen-plan.ts/elevation.ts's
 * module style.
 *
 * Conventions (pinned — see
 * docs/superpowers/plans/2026-07-03-sp2-rencana-kusen.md Task 3):
 *
 * `buildKusenScheduleDrawing` draws a 6-column table (Kode/Jenis/Lebar/
 * Tinggi/Jumlah/Per Lantai), one header row (`kind:"title"` labels) plus one
 * row per `KusenType` (`kind:"room"` labels). The grid is a flat list of
 * `outline` lines: (rows+2) horizontal + 7 vertical (6 columns). Column
 * widths and row height are fixed drawing-space constants (total width 10 m,
 * row height 0.6 m) — the sheet is a data table, not a floor plan, so these
 * are just legible proportions, not physical dimensions.
 *
 * `buildKusenDetails` lays out one panel per `KusenType` on a 3×2 grid, ≤6
 * panels per sheet (paginating into "Detail Kusen (i/n)" sheets when there
 * are more than 6 types). Every sheet shares the same panel cell size,
 * derived once from the *global* max width/height across the whole
 * schedule plus a margin — so panels are consistently sized across sheets.
 * Each panel:
 *   - a double rect frame (outer w×h, inner inset `FRAME_INSET_M`) as
 *     `outline` lines;
 *   - door: a diagonal "leaf" line from the hinge (inner bottom-left
 *     corner) at 45°, plus an 8-segment polyline approximating the
 *     quarter-circle swing arc (radius = min(w,h)) — both `kind:"opening"`;
 *   - window: an X (two diagonals, `kind:"opening"`) plus a sill line at the
 *     panel's base (`kind:"slab"`) labeled `"sill 900"` (`WINDOW_SILL_M`
 *     in mm);
 *   - a width DimChain below the panel and a height DimChain beside it
 *     (to the right);
 *   - a code+size label (`"P1 — 0,9 × 2,1 m"`, via `formatDimensions`)
 *     above the panel.
 */
import type { DesignLayout } from "@/types"
import { round2 } from "@/lib/geometry"
import { formatLength, formatDimensions } from "@/lib/format"
import { WINDOW_SILL_M } from "./elevation"
import { kusenSchedule, type KusenType } from "./kusen"
import type { Drawing, DrawLine, DrawLabel, DimChain } from "./types"

/* ---------- Daftar Kusen (table) ---------- */

const SCHEDULE_COLUMNS = ["Kode", "Jenis", "Lebar", "Tinggi", "Jumlah", "Per Lantai"]
const SCHEDULE_COL_WIDTHS_M = [1.0, 1.6, 1.6, 1.6, 1.0, 3.2] // sums to 10 m
const SCHEDULE_ROW_HEIGHT_M = 0.6

function perFloorText(layout: DesignLayout, t: KusenType): string {
  return layout.floors
    .filter((f) => (t.perFloor[f.id] ?? 0) > 0)
    .map((f) => `${f.name}: ${t.perFloor[f.id]}`)
    .join(", ")
}

export function buildKusenScheduleDrawing(layout: DesignLayout): Drawing {
  const schedule = kusenSchedule(layout)
  const rows = schedule.length

  const colX: number[] = [0]
  for (const w of SCHEDULE_COL_WIDTHS_M) colX.push(round2(colX[colX.length - 1] + w))
  const totalWidth = colX[colX.length - 1]
  const totalHeight = round2((rows + 1) * SCHEDULE_ROW_HEIGHT_M)

  const lines: DrawLine[] = []
  const labels: DrawLabel[] = []

  // Horizontal grid lines: header top + one per row bottom edge = rows+2.
  for (let k = 0; k <= rows + 1; k++) {
    const y = round2(totalHeight - k * SCHEDULE_ROW_HEIGHT_M)
    lines.push({ x1: 0, y1: y, x2: totalWidth, y2: y, kind: "outline" })
  }
  // Vertical grid lines: 6 columns -> 7 boundaries.
  for (const x of colX) {
    lines.push({ x1: x, y1: 0, x2: x, y2: totalHeight, kind: "outline" })
  }

  SCHEDULE_COLUMNS.forEach((text, c) => {
    labels.push({
      x: round2((colX[c] + colX[c + 1]) / 2),
      y: round2(totalHeight - SCHEDULE_ROW_HEIGHT_M / 2),
      text,
      kind: "title",
    })
  })

  schedule.forEach((t, i) => {
    const rowTop = round2(totalHeight - (i + 1) * SCHEDULE_ROW_HEIGHT_M)
    const rowCenterY = round2(rowTop - SCHEDULE_ROW_HEIGHT_M / 2)
    const cells = [
      t.code,
      t.openingType === "door" ? "Pintu" : "Jendela",
      formatLength(t.widthM, "mm"),
      formatLength(t.heightM, "mm"),
      String(t.count),
      perFloorText(layout, t),
    ]
    cells.forEach((text, c) => {
      labels.push({
        x: round2((colX[c] + colX[c + 1]) / 2),
        y: rowCenterY,
        text,
        kind: "room",
      })
    })
  })

  return {
    widthM: totalWidth,
    heightM: totalHeight,
    lines,
    labels,
    dims: [],
    levels: [],
    title: "Daftar Kusen",
  }
}

/* ---------- Detail Kusen (parametric panels) ---------- */

const PANELS_PER_ROW = 3
const ROWS_PER_SHEET = 2
const PANELS_PER_SHEET = PANELS_PER_ROW * ROWS_PER_SHEET // 6
const CELL_MARGIN_M = 0.6
const FRAME_INSET_M = 0.05
const DIM_OFFSET_M = 0.35
const LABEL_ABOVE_OFFSET_M = 0.2
const SILL_LABEL_OFFSET_M = 0.15
const SWING_ARC_SEGMENTS = 8

/** Draws one panel's frame/opening-symbol/dims/label at (x0,y0)=bottom-left. */
function drawPanel(
  t: KusenType,
  x0: number,
  y0: number,
  lines: DrawLine[],
  labels: DrawLabel[],
  dims: DimChain[]
): void {
  const w = t.widthM
  const h = t.heightM
  const x1 = round2(x0 + w)
  const y1 = round2(y0 + h)

  // Outer frame.
  lines.push({ x1: x0, y1: y0, x2: x1, y2: y0, kind: "outline" })
  lines.push({ x1: x1, y1: y0, x2: x1, y2: y1, kind: "outline" })
  lines.push({ x1: x1, y1: y1, x2: x0, y2: y1, kind: "outline" })
  lines.push({ x1: x0, y1: y1, x2: x0, y2: y0, kind: "outline" })

  // Inner frame (inset).
  const ix0 = round2(x0 + FRAME_INSET_M)
  const iy0 = round2(y0 + FRAME_INSET_M)
  const ix1 = round2(x1 - FRAME_INSET_M)
  const iy1 = round2(y1 - FRAME_INSET_M)
  lines.push({ x1: ix0, y1: iy0, x2: ix1, y2: iy0, kind: "outline" })
  lines.push({ x1: ix1, y1: iy0, x2: ix1, y2: iy1, kind: "outline" })
  lines.push({ x1: ix1, y1: iy1, x2: ix0, y2: iy1, kind: "outline" })
  lines.push({ x1: ix0, y1: iy1, x2: ix0, y2: iy0, kind: "outline" })

  if (t.openingType === "door") {
    // Hinge at the inner rect's bottom-left corner; swing radius capped to
    // the smaller panel dimension so the arc never overshoots the frame.
    const hx = ix0
    const hy = iy0
    const radius = Math.min(w, h)

    const leafAngle = Math.PI / 4
    lines.push({
      x1: hx,
      y1: hy,
      x2: round2(hx + radius * Math.cos(leafAngle)),
      y2: round2(hy + radius * Math.sin(leafAngle)),
      kind: "opening",
    })

    for (let s = 0; s < SWING_ARC_SEGMENTS; s++) {
      const a0 = (s / SWING_ARC_SEGMENTS) * (Math.PI / 2)
      const a1 = ((s + 1) / SWING_ARC_SEGMENTS) * (Math.PI / 2)
      lines.push({
        x1: round2(hx + radius * Math.cos(a0)),
        y1: round2(hy + radius * Math.sin(a0)),
        x2: round2(hx + radius * Math.cos(a1)),
        y2: round2(hy + radius * Math.sin(a1)),
        kind: "opening",
      })
    }
  } else {
    lines.push({ x1: x0, y1: y0, x2: x1, y2: y1, kind: "opening" })
    lines.push({ x1: x1, y1: y0, x2: x0, y2: y1, kind: "opening" })
    lines.push({ x1: x0, y1: y0, x2: x1, y2: y0, kind: "slab" })
    labels.push({
      x: round2((x0 + x1) / 2),
      y: round2(y0 - SILL_LABEL_OFFSET_M),
      text: `sill ${Math.round(WINDOW_SILL_M * 1000)}`,
      kind: "room",
    })
  }

  labels.push({
    x: round2((x0 + x1) / 2),
    y: round2(y1 + LABEL_ABOVE_OFFSET_M),
    text: `${t.code} — ${formatDimensions(w, h)}`,
    kind: "room",
  })

  dims.push({ axis: "x", at: round2(y0 - DIM_OFFSET_M), points: [x0, x1] })
  dims.push({ axis: "y", at: round2(x1 + DIM_OFFSET_M), points: [y0, y1] })
}

export function buildKusenDetails(layout: DesignLayout): Drawing[] {
  const schedule = kusenSchedule(layout)
  if (schedule.length === 0) return []

  const maxW = schedule.reduce((m, t) => Math.max(m, t.widthM), 0)
  const maxH = schedule.reduce((m, t) => Math.max(m, t.heightM), 0)
  const cellW = round2(maxW + CELL_MARGIN_M)
  const cellH = round2(maxH + CELL_MARGIN_M)

  const sheetCount = Math.ceil(schedule.length / PANELS_PER_SHEET)
  const sheets: Drawing[] = []

  for (let s = 0; s < sheetCount; s++) {
    const types = schedule.slice(s * PANELS_PER_SHEET, (s + 1) * PANELS_PER_SHEET)
    const lines: DrawLine[] = []
    const labels: DrawLabel[] = []
    const dims: DimChain[] = []

    const rowsUsed = Math.ceil(types.length / PANELS_PER_ROW)
    const colsUsed = Math.min(PANELS_PER_ROW, types.length)

    types.forEach((t, i) => {
      const col = i % PANELS_PER_ROW
      const row = Math.floor(i / PANELS_PER_ROW)
      const originX = round2(col * cellW)
      const originY = round2((rowsUsed - 1 - row) * cellH)
      drawPanel(t, originX, originY, lines, labels, dims)
    })

    sheets.push({
      widthM: round2(colsUsed * cellW),
      heightM: round2(rowsUsed * cellH),
      lines,
      labels,
      dims,
      levels: [],
      title: sheetCount === 1 ? "Detail Kusen" : `Detail Kusen (${s + 1}/${sheetCount})`,
    })
  }

  return sheets
}
