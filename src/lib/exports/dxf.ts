/**
 * Real DXF export (ASCII R12 / AC1009 — plain text, universally readable by
 * AutoCAD/LibreCAD/BricsCAD/etc.) of the DENAH (floor plan): every regular
 * floor from `buildLayoutSheet` laid out side-by-side in ONE file, offset
 * along X so plans never overlap — this is what a drafter actually wants
 * (one file, every floor, ready to trace over), not one file per sheet.
 *
 * Coordinates are TRUE METERS in model space (not sheet millimeters) — the
 * `Drawing` primitives already use meters with y pointing UP, which is DXF's
 * native convention too, so no sheet-placement/y-flip transform is needed
 * here (unlike the PDF/SVG renderers, which project into a fixed A3 sheet).
 *
 * Entities: LINE for every `DrawLine` (layer per `kind`: OUTLINE/SLAB/
 * OPENING/CUT/GROUND), TEXT for every `DrawLabel` (height varies by kind),
 * and LINE+TEXT for each `DimChain` (a simple extension line + perpendicular
 * tick marks + a centered length label per segment — mirrors exactly what
 * `drawDimChain` in drawings-pack.ts draws, just in meters instead of sheet
 * mm). Full DIMENSION entities are overkill for a v1 hand-rolled writer.
 *
 * Only the DENAH (architectural floor plan per floor) is exported — tampak/
 * potongan/kusen/MEP sheets stay PDF-only for now; a drafter's first need is
 * the plan to trace walls/openings from, and one DXF containing every floor
 * side-by-side directly matches how a real drafter opens & works the file.
 */
import type { DesignLayout, Floor } from "@/types"
import type { DimChain, DrawLabel, DrawLine } from "@/lib/drawings/types"
import { buildLayoutSheet } from "@/lib/drawings/layout-sheet"

const ROOFTOP_FLOOR_ID = "floor-rooftop"

/** Gap (meters) inserted between each floor's plan along X. */
const FLOOR_GAP_M = 4

const LAYER_BY_LINE_KIND: Record<DrawLine["kind"], string> = {
  outline: "OUTLINE",
  slab: "SLAB",
  opening: "OPENING",
  cut: "CUT",
  ground: "GROUND",
}

const DIM_LAYER = "DIMENSIONS"
const LABEL_LAYER = "LABELS"

/** All layers created in the TABLES section, in a stable order. */
export const DXF_LAYERS = [
  "OUTLINE",
  "SLAB",
  "OPENING",
  "CUT",
  "GROUND",
  DIM_LAYER,
  LABEL_LAYER,
] as const

/** AutoCAD Color Index (ACI) per layer — kept monochrome-friendly (white/7
 *  is what most CAD viewers show as black-on-white / white-on-black). */
const ACI_BY_LAYER: Record<string, number> = {
  OUTLINE: 7,
  SLAB: 8,
  OPENING: 3,
  CUT: 1,
  GROUND: 9,
  [DIM_LAYER]: 5,
  [LABEL_LAYER]: 7,
}

/** Text height (meters) per DrawLabel kind — real-world scale, not sheet mm. */
const TEXT_HEIGHT_M: Record<DrawLabel["kind"], number> = {
  room: 0.22,
  level: 0.16,
  title: 0.35,
}

const DIM_TICK_M = 0.08
const DIM_TEXT_HEIGHT_M = 0.14
const FLOOR_TITLE_GAP_M = 1

function regularFloors(layout: DesignLayout): Floor[] {
  return layout.floors
    .filter((f) => f.id !== ROOFTOP_FLOOR_ID)
    .slice()
    .sort((a, b) => a.level - b.level)
}

function n(v: number): string {
  // DXF group-code numeric values as plain decimal text — 3 decimals is
  // plenty for millimeter-level precision in a meter coordinate system.
  return (Math.round(v * 1000) / 1000).toFixed(3)
}

function dxfLine(x1: number, y1: number, x2: number, y2: number, layer: string): string[] {
  return [
    "0", "LINE",
    "8", layer,
    "10", n(x1),
    "20", n(y1),
    "30", "0.0",
    "11", n(x2),
    "21", n(y2),
    "31", "0.0",
  ]
}

/** Simple left-justified TEXT entity (no group 72/73 justification pairs —
 *  keeps the writer minimal and avoids DXF's justification-order pitfalls;
 *  default insertion-point alignment is read correctly by every viewer). */
function dxfText(x: number, y: number, heightM: number, text: string, layer: string): string[] {
  const safe = text.replace(/[\r\n]+/g, " ").trim()
  return [
    "0", "TEXT",
    "8", layer,
    "10", n(x),
    "20", n(y),
    "30", "0.0",
    "40", n(heightM),
    "1", safe,
  ]
}

/** Extension line + tick marks + per-segment length labels (mm), meters. */
function dxfDimChain(dim: DimChain, offsetX: number): string[] {
  if (dim.points.length < 2) return []
  const isX = dim.axis === "x"
  const pt = (p: number): { x: number; y: number } =>
    isX ? { x: p + offsetX, y: dim.at } : { x: dim.at + offsetX, y: p }

  const lines: string[] = []
  const first = pt(dim.points[0])
  const last = pt(dim.points[dim.points.length - 1])
  lines.push(...dxfLine(first.x, first.y, last.x, last.y, DIM_LAYER))

  for (const p of dim.points) {
    const c = pt(p)
    if (isX) lines.push(...dxfLine(c.x, c.y - DIM_TICK_M, c.x, c.y + DIM_TICK_M, DIM_LAYER))
    else lines.push(...dxfLine(c.x - DIM_TICK_M, c.y, c.x + DIM_TICK_M, c.y, DIM_LAYER))
  }

  for (let i = 1; i < dim.points.length; i++) {
    const from = dim.points[i - 1]
    const to = dim.points[i]
    const deltaMm = Math.round(Math.abs(to - from) * 1000)
    const mid = pt((from + to) / 2)
    lines.push(...dxfText(mid.x, mid.y, DIM_TEXT_HEIGHT_M, `${deltaMm}`, DIM_LAYER))
  }

  return lines
}

/** Per-floor X offset (meters) each denah is placed at, keyed by floor id —
 *  exported mainly for tests to assert the side-by-side layout. */
export function floorDxfOffsets(layout: DesignLayout): Record<string, number> {
  const offsets: Record<string, number> = {}
  let offsetX = 0
  for (const floor of regularFloors(layout)) {
    offsets[floor.id] = offsetX
    const drawing = buildLayoutSheet(layout, floor.id)
    offsetX += drawing.widthM + FLOOR_GAP_M
  }
  return offsets
}

/** ENTITIES section body (group-code lines, no `SECTION`/`ENDSEC` wrapper). */
export function buildDxfEntities(layout: DesignLayout): string[] {
  const entities: string[] = []
  let offsetX = 0

  for (const floor of regularFloors(layout)) {
    const drawing = buildLayoutSheet(layout, floor.id)

    for (const ln of drawing.lines) {
      entities.push(
        ...dxfLine(ln.x1 + offsetX, ln.y1, ln.x2 + offsetX, ln.y2, LAYER_BY_LINE_KIND[ln.kind])
      )
    }
    for (const lb of drawing.labels) {
      entities.push(...dxfText(lb.x + offsetX, lb.y, TEXT_HEIGHT_M[lb.kind], lb.text, LABEL_LAYER))
    }
    for (const dim of drawing.dims) {
      entities.push(...dxfDimChain(dim, offsetX))
    }
    // Floor title above its plan — CAD viewers don't show sheet metadata,
    // so print it directly into model space.
    entities.push(
      ...dxfText(
        offsetX,
        drawing.heightM + FLOOR_TITLE_GAP_M,
        TEXT_HEIGHT_M.title,
        drawing.title,
        LABEL_LAYER
      )
    )

    offsetX += drawing.widthM + FLOOR_GAP_M
  }

  return entities
}

function layerTableEntries(): string[] {
  const lines: string[] = []
  for (const name of DXF_LAYERS) {
    lines.push(
      "0", "LAYER",
      "2", name,
      "70", "0",
      "62", String(ACI_BY_LAYER[name] ?? 7),
      "6", "CONTINUOUS"
    )
  }
  return lines
}

/**
 * Builds the full ASCII DXF (R12/AC1009) document as a string: HEADER
 * ($INSUNITS=6 → meters) + TABLES (one layer per line/dim/label group) +
 * ENTITIES (every floor's denah, side-by-side) + EOF.
 */
export function buildLayoutDxf(layout: DesignLayout): string {
  const parts: string[] = [
    "0", "SECTION",
    "2", "HEADER",
    "9", "$ACADVER",
    "1", "AC1009",
    "9", "$INSUNITS",
    "70", "6", // 6 = meters
    "0", "ENDSEC",

    "0", "SECTION",
    "2", "TABLES",
    "0", "TABLE",
    "2", "LAYER",
    "70", String(DXF_LAYERS.length),
    ...layerTableEntries(),
    "0", "ENDTAB",
    "0", "ENDSEC",

    "0", "SECTION",
    "2", "ENTITIES",
    ...buildDxfEntities(layout),
    "0", "ENDSEC",

    "0", "EOF",
  ]
  return parts.join("\n") + "\n"
}

/** Blob wrapper for `generateExport` — MIME left as the widely-used
 *  (unofficial but universal) `application/dxf`. */
export function buildDxfBlob(layout: DesignLayout): Blob {
  return new Blob([buildLayoutDxf(layout)], { type: "application/dxf" })
}
