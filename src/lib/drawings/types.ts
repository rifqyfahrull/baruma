/**
 * Renderer-agnostic drawing contract for the "Gambar Kerja" module (tampak +
 * potongan). Pure data — coordinates are in meters, y points UP. A renderer
 * (SVG/PDF) is responsible for flipping y and scaling to a physical sheet.
 */

export type DrawLine = {
  x1: number
  y1: number
  x2: number
  y2: number
  kind: "outline" | "slab" | "opening" | "ground" | "cut"
  /** Stable semantic owner for selection/debug/export traceability. */
  refId?: string
}

export type DrawLabel = {
  x: number
  y: number
  text: string
  kind: "room" | "level" | "title"
  /** Stable semantic owner for selection/debug/export traceability. */
  refId?: string
  /**
   * Horizontal text anchor for renderers (SVG `text-anchor` / PDF `align`).
   * When ABSENT, renderers keep the legacy per-kind default: "middle" for
   * kind "room"/"title" (point-centred labels — room names, sheet titles)
   * and "start" for kind "level". Builders that lay text out from its LEFT
   * edge (table cells, legend entries, calc rows, stacked notes) MUST set
   * "start" explicitly, or the text will be centred on the cell edge and
   * bleed across borders.
   */
  anchor?: "start" | "middle" | "end"
}

export type DimChain = {
  axis: "x" | "y"
  at: number
  points: number[]
}

export type LevelMark = {
  y: number
  label: string
}

export type Drawing = {
  widthM: number
  heightM: number
  lines: DrawLine[]
  labels: DrawLabel[]
  dims: DimChain[]
  levels: LevelMark[]
  title: string
}
