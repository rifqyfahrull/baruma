/**
 * Builds the "Gambar Kerja" (drawings pack) PDF: 4 elevations (tampak
 * utara/selatan/timur/barat) + 2 mid-building section cuts (potongan A-A /
 * B-B), then the kusen deliverables (Rencana Kusen per regular floor,
 * Daftar Kusen, Detail Kusen panels), then Pola Lantai + Rencana Plafon per
 * regular floor and the Detail Atap sheet — one A3 landscape page per sheet.
 *
 * Renders the same renderer-agnostic `Drawing` primitives that `SheetSvg`
 * draws to SVG, but straight onto jsPDF (`doc.line/rect/text`) using the
 * exact same `sheetPlacement` transform — so the PDF output is geometrically
 * identical to the on-screen `/drawings` page. Sheet enumeration comes from
 * the SHARED `buildSheetList` module (the same one the page's tabs consume),
 * so page ↔ PDF can never drift. No DOM involved.
 */
import { jsPDF } from "jspdf"

import type { DesignLayout, Project, RoomInteriorPlan } from "@/types"
import type { Drawing, DrawLine, DimChain } from "@/lib/drawings/types"
import { buildSheetList } from "@/lib/drawings/sheet-list"
import {
  sheetPlacement,
  SHEET_W_MM,
  SHEET_H_MM,
  CONTENT_LEFT_MM,
  CONTENT_TOP_MM,
  CONTENT_RIGHT_MM,
  CONTENT_BOTTOM_MM,
} from "@/lib/drawings/layout-sheet"
import { formatLength } from "@/lib/format"
import { round2 } from "@/lib/geometry"

const ROOFTOP_FLOOR_ID = "floor-rooftop"

export type SheetEntry = { title: string; sheetNo: string; drawing: Drawing }

/** Bounding footprint (meters) of the building's non-rooftop rooms — same
 *  definition the `/drawings` page uses for its cut-slider bounds. */
function buildingBounds(layout: DesignLayout): { width: number; depth: number } {
  const rooms = layout.rooms.filter((r) => r.floorId !== ROOFTOP_FLOOR_ID)
  const width = rooms.reduce((m, r) => Math.max(m, r.x + r.width), 0)
  const depth = rooms.reduce((m, r) => Math.max(m, r.y + r.depth), 0)
  return { width: round2(width), depth: round2(depth) }
}

/**
 * The default sheets, one per `buildSheetList` entry (the SAME shared
 * enumeration the `/drawings` page renders as tabs): 4 tampak + potongan
 * tengah on both axes (A-01…A-06), the kusen deliverables (K-01…), Pola
 * Lantai (L-01…) + Rencana Plafon (C-01…) per regular floor, and Detail
 * Atap (R-01). Sections are cut at the building's mid-width/mid-depth;
 * `interiors` (resolved saved-or-generated room plans) feed the pola
 * lantai / plafon builders and may be empty (pure fallbacks apply).
 */
export function defaultSheets(layout: DesignLayout, interiors: RoomInteriorPlan[]): SheetEntry[] {
  const bounds = buildingBounds(layout)
  const cuts = { cutX: round2(bounds.width / 2), cutY: round2(bounds.depth / 2) }

  return buildSheetList(layout).map((entry) => {
    const drawing = entry.build(layout, interiors, cuts)
    return { title: drawing.title, sheetNo: entry.sheetNo, drawing }
  })
}

/* ------------------------------------------------------------------ */
/* PDF rendering — mirrors SheetSvg's layout/line-weights exactly.    */
/* ------------------------------------------------------------------ */

/** jsPDF `setFontSize`/`text` sizes are always in points regardless of the
 *  document's unit ("mm" here) — convert the SheetSvg mm font sizes. */
const MM_TO_PT = 72 / 25.4

const STROKE_WIDTH_MM: Record<DrawLine["kind"], number> = {
  outline: 0.5,
  slab: 0.35,
  opening: 0.35,
  ground: 0.7,
  cut: 1.0,
}

const TICK_MM = 1.5
const DIM_FONT_MM = 2.6
const LABEL_FONT_MM = 3
const LEVEL_MARK_LEN_M = 0.3

type ToMm = (x: number, y: number) => { x: number; y: number }

function drawDimChain(doc: jsPDF, dim: DimChain, toMm: ToMm) {
  if (dim.points.length < 2) return

  const isX = dim.axis === "x"
  const pts = dim.points.map((p) => (isX ? toMm(p, dim.at) : toMm(dim.at, p)))
  const first = pts[0]
  const last = pts[pts.length - 1]

  doc.setLineWidth(0.25)
  doc.setLineDashPattern([], 0)
  doc.line(first.x, first.y, last.x, last.y)
  for (const p of pts) {
    if (isX) doc.line(p.x, p.y - TICK_MM, p.x, p.y + TICK_MM)
    else doc.line(p.x - TICK_MM, p.y, p.x + TICK_MM, p.y)
  }

  doc.setFont("helvetica", "normal")
  doc.setFontSize(DIM_FONT_MM * MM_TO_PT)
  dim.points.slice(1).forEach((p, i) => {
    const from = dim.points[i]
    const delta = Math.abs(p - from)
    const mid = isX ? toMm((from + p) / 2, dim.at) : toMm(dim.at, (from + p) / 2)
    const label = formatLength(delta, "mm")
    if (isX) {
      doc.text(label, mid.x, mid.y - 1.4, { align: "center", baseline: "alphabetic" })
    } else {
      doc.text(label, mid.x - 1.4, mid.y, { align: "center", baseline: "alphabetic", angle: 90 })
    }
  })
}

/** Draws one `SheetEntry` (border, margin frame, drawing primitives, dims,
 *  level marks, labels, title block) onto the current jsPDF page. */
function drawSheet(doc: jsPDF, entry: SheetEntry, projectName: string, dateStr: string) {
  const { drawing, sheetNo } = entry
  const { scaleN, toMm } = sheetPlacement(drawing)

  doc.setTextColor(0, 0, 0)
  doc.setDrawColor(0, 0, 0)

  const contentW = CONTENT_RIGHT_MM - CONTENT_LEFT_MM
  const contentH = CONTENT_BOTTOM_MM - CONTENT_TOP_MM
  const titleBlockDivider1 = CONTENT_LEFT_MM + contentW * 0.64
  const titleBlockDivider2 = CONTENT_LEFT_MM + contentW * 0.87

  // Outer border
  doc.setLineWidth(0.5)
  doc.rect(0.25, 0.25, SHEET_W_MM - 0.5, SHEET_H_MM - 0.5)

  // Margin frame
  doc.setLineWidth(0.3)
  doc.rect(CONTENT_LEFT_MM, CONTENT_TOP_MM, contentW, contentH)

  // Drawing primitives
  for (const ln of drawing.lines) {
    const p1 = toMm(ln.x1, ln.y1)
    const p2 = toMm(ln.x2, ln.y2)
    doc.setLineWidth(STROKE_WIDTH_MM[ln.kind])
    if (ln.kind === "slab") {
      doc.setLineDashPattern([2, 1.2], 0)
      doc.line(p1.x, p1.y, p2.x, p2.y)
      doc.setLineDashPattern([], 0)
    } else {
      doc.line(p1.x, p1.y, p2.x, p2.y)
    }
  }

  for (const dim of drawing.dims) drawDimChain(doc, dim, toMm)

  doc.setFont("helvetica", "normal")
  for (const lvl of drawing.levels) {
    const p0 = toMm(-LEVEL_MARK_LEN_M, lvl.y)
    const p1 = toMm(0, lvl.y)
    doc.setLineWidth(0.35)
    doc.line(p0.x, p0.y, p1.x, p1.y)
    doc.setFontSize(DIM_FONT_MM * MM_TO_PT)
    doc.text(lvl.label, p0.x - 1, p0.y, { align: "right", baseline: "middle" })
  }

  // jsPDF align per DrawLabel anchor (start/middle/end ↔ left/center/right);
  // absent anchor keeps the legacy per-kind default — parity with SheetSvg.
  const ALIGN_BY_ANCHOR = { start: "left", middle: "center", end: "right" } as const
  for (const lb of drawing.labels) {
    const p = toMm(lb.x, lb.y)
    const align = lb.anchor
      ? ALIGN_BY_ANCHOR[lb.anchor]
      : lb.kind === "level"
        ? "left"
        : "center"
    doc.setFont("helvetica", lb.kind === "title" ? "bold" : "normal")
    doc.setFontSize((lb.kind === "title" ? LABEL_FONT_MM * 1.3 : LABEL_FONT_MM) * MM_TO_PT)
    doc.text(lb.text, p.x, p.y, { align, baseline: "middle" })
  }

  // Title block (bottom strip)
  doc.setLineWidth(0.35)
  doc.rect(
    CONTENT_LEFT_MM,
    CONTENT_BOTTOM_MM,
    contentW,
    SHEET_H_MM - CONTENT_TOP_MM - CONTENT_BOTTOM_MM
  )
  doc.setLineWidth(0.3)
  doc.line(titleBlockDivider1, CONTENT_BOTTOM_MM, titleBlockDivider1, SHEET_H_MM - CONTENT_TOP_MM)
  doc.line(titleBlockDivider2, CONTENT_BOTTOM_MM, titleBlockDivider2, SHEET_H_MM - CONTENT_TOP_MM)

  doc.setFont("helvetica", "bold")
  doc.setFontSize(3.6 * MM_TO_PT)
  doc.text(projectName, CONTENT_LEFT_MM + 3, CONTENT_BOTTOM_MM + 8)

  doc.setFont("helvetica", "normal")
  doc.setFontSize(3 * MM_TO_PT)
  doc.text(drawing.title, CONTENT_LEFT_MM + 3, CONTENT_BOTTOM_MM + 16)

  doc.setFontSize(2.8 * MM_TO_PT)
  doc.text(`Skala 1:${scaleN}`, titleBlockDivider1 + 3, CONTENT_BOTTOM_MM + 9)
  doc.text(dateStr, titleBlockDivider1 + 3, CONTENT_BOTTOM_MM + 17)

  doc.setFont("helvetica", "bold")
  doc.setFontSize(5.5 * MM_TO_PT)
  doc.text(sheetNo, (titleBlockDivider2 + CONTENT_RIGHT_MM) / 2, CONTENT_BOTTOM_MM + 13, {
    align: "center",
    baseline: "middle",
  })
}

/**
 * Builds the drawings-pack PDF: one A3 landscape page per default sheet (4
 * tampak + 2 potongan tengah + kusen sheets + pola lantai / plafon / detail
 * atap), dimensioned and monochrome for print. `interiors` are the resolved
 * room interior plans (saved overlay if any, generated otherwise) — resolve
 * them with the same pure logic the `/drawings` page uses.
 */
export async function buildDrawingsPdf(
  project: Project,
  layout: DesignLayout,
  interiors: RoomInteriorPlan[]
): Promise<Blob> {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a3" })
  const sheets = defaultSheets(layout, interiors)
  const dateStr = new Date().toLocaleDateString("id-ID")

  sheets.forEach((entry, i) => {
    if (i > 0) doc.addPage("a3", "landscape")
    drawSheet(doc, entry, project.name, dateStr)
  })

  return doc.output("blob")
}
