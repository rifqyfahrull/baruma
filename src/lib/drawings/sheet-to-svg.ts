/**
 * Pure-string SVG renderer for a `Drawing` sheet — mirrors what `SheetSvg`
 * (`src/components/drawings/sheet-svg.tsx`) draws on screen, but emits a
 * self-contained SVG markup string with EXPLICIT colors instead of Tailwind
 * design-token classes (`stroke-foreground` etc. only resolve inside the
 * app's CSS context, not when rasterized standalone onto a `<canvas>`).
 *
 * Used by the Contractor Pack PDF (`contractor-pack.ts`) to turn each
 * floor's denah into a raster image via `<img src="data:image/svg+xml...">`
 * → canvas → `doc.addImage`, reusing the exact same `sheetPlacement`
 * geometry (and line-weight/label rules) the on-screen SVG and drawings-pack
 * PDF already share — so the denah page in the Contractor Pack always
 * matches the `/drawings` page.
 */
import type { DimChain, DrawLine, Drawing } from "./types"
import {
  sheetPlacement,
  SHEET_W_MM,
  SHEET_H_MM,
  CONTENT_LEFT_MM,
  CONTENT_TOP_MM,
  CONTENT_RIGHT_MM,
  CONTENT_BOTTOM_MM,
} from "./layout-sheet"
import { formatLength } from "@/lib/format"

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
const INK = "#18181b"

type ToMm = (x: number, y: number) => { x: number; y: number }

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function dimChainSvg(dim: DimChain, toMm: ToMm): string {
  if (dim.points.length < 2) return ""
  const isX = dim.axis === "x"
  const pts = dim.points.map((p) => (isX ? toMm(p, dim.at) : toMm(dim.at, p)))
  const first = pts[0]
  const last = pts[pts.length - 1]

  const parts: string[] = [
    `<line x1="${first.x}" y1="${first.y}" x2="${last.x}" y2="${last.y}" stroke="${INK}" stroke-width="0.25" opacity="0.7"/>`,
  ]
  for (const p of pts) {
    if (isX) {
      parts.push(
        `<line x1="${p.x}" y1="${p.y - TICK_MM}" x2="${p.x}" y2="${p.y + TICK_MM}" stroke="${INK}" stroke-width="0.25" opacity="0.7"/>`
      )
    } else {
      parts.push(
        `<line x1="${p.x - TICK_MM}" y1="${p.y}" x2="${p.x + TICK_MM}" y2="${p.y}" stroke="${INK}" stroke-width="0.25" opacity="0.7"/>`
      )
    }
  }
  dim.points.slice(1).forEach((p, i) => {
    const from = dim.points[i]
    const delta = Math.abs(p - from)
    const mid = isX ? toMm((from + p) / 2, dim.at) : toMm(dim.at, (from + p) / 2)
    const tx = isX ? mid.x : mid.x - 1.4
    const ty = isX ? mid.y - 1.4 : mid.y
    const rotate = isX ? "" : ` transform="rotate(-90 ${tx} ${ty})"`
    parts.push(
      `<text x="${tx}" y="${ty}" text-anchor="middle" font-size="${DIM_FONT_MM}" fill="${INK}"${rotate}>${esc(formatLength(delta, "mm"))}</text>`
    )
  })
  return parts.join("")
}

/**
 * Renders `drawing` onto a self-contained A3-viewBox SVG string (border,
 * margin frame, lines/labels/dims/level marks, and a bottom title block) —
 * everything `SheetSvg` renders, minus theme-awareness (fixed light colors,
 * since this is meant to be rasterized for print, not viewed live).
 */
export function buildSheetSvgString(drawing: Drawing, sheetNo: string, projectName: string): string {
  const { scaleN, toMm } = sheetPlacement(drawing)
  const dateStr = new Date().toLocaleDateString("id-ID")

  const contentW = CONTENT_RIGHT_MM - CONTENT_LEFT_MM
  const contentH = CONTENT_BOTTOM_MM - CONTENT_TOP_MM
  const titleBlockDivider1 = CONTENT_LEFT_MM + contentW * 0.64
  const titleBlockDivider2 = CONTENT_LEFT_MM + contentW * 0.87

  const parts: string[] = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SHEET_W_MM} ${SHEET_H_MM}" width="${SHEET_W_MM}mm" height="${SHEET_H_MM}mm">`
  )
  parts.push(`<rect x="0" y="0" width="${SHEET_W_MM}" height="${SHEET_H_MM}" fill="#ffffff"/>`)
  parts.push(
    `<rect x="0.25" y="0.25" width="${SHEET_W_MM - 0.5}" height="${SHEET_H_MM - 0.5}" fill="none" stroke="${INK}" stroke-width="0.5"/>`
  )
  parts.push(
    `<rect x="${CONTENT_LEFT_MM}" y="${CONTENT_TOP_MM}" width="${contentW}" height="${contentH}" fill="none" stroke="${INK}" stroke-width="0.3" opacity="0.6"/>`
  )

  for (const ln of drawing.lines) {
    const p1 = toMm(ln.x1, ln.y1)
    const p2 = toMm(ln.x2, ln.y2)
    const dash = ln.kind === "slab" ? ` stroke-dasharray="2 1.2"` : ""
    parts.push(
      `<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="${INK}" stroke-width="${STROKE_WIDTH_MM[ln.kind]}"${dash} stroke-linecap="square"/>`
    )
  }

  for (const dim of drawing.dims) parts.push(dimChainSvg(dim, toMm))

  for (const lvl of drawing.levels) {
    const p0 = toMm(-LEVEL_MARK_LEN_M, lvl.y)
    const p1 = toMm(0, lvl.y)
    parts.push(
      `<line x1="${p0.x}" y1="${p0.y}" x2="${p1.x}" y2="${p1.y}" stroke="${INK}" stroke-width="0.35"/>`
    )
    parts.push(
      `<text x="${p0.x - 1}" y="${p0.y}" text-anchor="end" dominant-baseline="middle" font-size="${DIM_FONT_MM}" fill="${INK}">${esc(lvl.label)}</text>`
    )
  }

  for (const lb of drawing.labels) {
    const p = toMm(lb.x, lb.y)
    const anchor = lb.anchor ?? (lb.kind === "level" ? "start" : "middle")
    const fs = lb.kind === "title" ? LABEL_FONT_MM * 1.3 : LABEL_FONT_MM
    const fw = lb.kind === "title" ? 600 : 400
    parts.push(
      `<text x="${p.x}" y="${p.y}" text-anchor="${anchor}" dominant-baseline="middle" font-size="${fs}" font-weight="${fw}" fill="${INK}">${esc(lb.text)}</text>`
    )
  }

  // Title block (bottom strip)
  parts.push(
    `<rect x="${CONTENT_LEFT_MM}" y="${CONTENT_BOTTOM_MM}" width="${contentW}" height="${SHEET_H_MM - CONTENT_TOP_MM - CONTENT_BOTTOM_MM}" fill="none" stroke="${INK}" stroke-width="0.35"/>`
  )
  parts.push(
    `<line x1="${titleBlockDivider1}" y1="${CONTENT_BOTTOM_MM}" x2="${titleBlockDivider1}" y2="${SHEET_H_MM - CONTENT_TOP_MM}" stroke="${INK}" stroke-width="0.3"/>`
  )
  parts.push(
    `<line x1="${titleBlockDivider2}" y1="${CONTENT_BOTTOM_MM}" x2="${titleBlockDivider2}" y2="${SHEET_H_MM - CONTENT_TOP_MM}" stroke="${INK}" stroke-width="0.3"/>`
  )
  parts.push(
    `<text x="${CONTENT_LEFT_MM + 3}" y="${CONTENT_BOTTOM_MM + 8}" font-size="3.6" font-weight="700" fill="${INK}">${esc(projectName)}</text>`
  )
  parts.push(
    `<text x="${CONTENT_LEFT_MM + 3}" y="${CONTENT_BOTTOM_MM + 16}" font-size="3" fill="${INK}">${esc(drawing.title)}</text>`
  )
  parts.push(
    `<text x="${titleBlockDivider1 + 3}" y="${CONTENT_BOTTOM_MM + 9}" font-size="2.8" fill="${INK}">Skala 1:${scaleN}</text>`
  )
  parts.push(
    `<text x="${titleBlockDivider1 + 3}" y="${CONTENT_BOTTOM_MM + 17}" font-size="2.8" fill="${INK}">${esc(dateStr)}</text>`
  )
  parts.push(
    `<text x="${(titleBlockDivider2 + CONTENT_RIGHT_MM) / 2}" y="${CONTENT_BOTTOM_MM + 13}" text-anchor="middle" dominant-baseline="middle" font-size="5.5" font-weight="700" fill="${INK}">${esc(sheetNo)}</text>`
  )

  parts.push("</svg>")
  return parts.join("")
}
