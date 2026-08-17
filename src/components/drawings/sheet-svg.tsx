"use client"

import * as React from "react"

import type { Drawing, DrawLine, DimChain } from "@/lib/drawings/types"
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

/** One dimension chain: line + tick marks + segment lengths between points. */
function DimChainGroup({ dim, toMm }: { dim: DimChain; toMm: ToMm }) {
  if (dim.points.length < 2) return null

  const isX = dim.axis === "x"
  const pts = dim.points.map((p) => (isX ? toMm(p, dim.at) : toMm(dim.at, p)))
  const first = pts[0]
  const last = pts[pts.length - 1]

  return (
    <g className="stroke-foreground/70 fill-foreground">
      <line x1={first.x} y1={first.y} x2={last.x} y2={last.y} strokeWidth={0.25} />
      {pts.map((p, i) => (
        <line
          key={`tick-${i}`}
          x1={isX ? p.x : p.x - TICK_MM}
          y1={isX ? p.y - TICK_MM : p.y}
          x2={isX ? p.x : p.x + TICK_MM}
          y2={isX ? p.y + TICK_MM : p.y}
          strokeWidth={0.25}
        />
      ))}
      {dim.points.slice(1).map((p, i) => {
        const from = dim.points[i]
        const delta = Math.abs(p - from)
        const mid = isX ? toMm((from + p) / 2, dim.at) : toMm(dim.at, (from + p) / 2)
        const tx = isX ? mid.x : mid.x - 1.4
        const ty = isX ? mid.y - 1.4 : mid.y
        return (
          <text
            key={`seg-${i}`}
            x={tx}
            y={ty}
            textAnchor="middle"
            fontSize={DIM_FONT_MM}
            className="stroke-none"
            transform={isX ? undefined : `rotate(-90 ${tx} ${ty})`}
          >
            {formatLength(delta, "mm")}
          </text>
        )
      })}
    </g>
  )
}

/**
 * Renders any `Drawing` (tampak/potongan) onto a virtual A3 landscape sheet:
 * border + margin frame, a bottom title block, and the drawing's lines /
 * labels / dim chains / level markers scaled + centered via `sheetPlacement`.
 * Theme-aware (uses `stroke-foreground` / `fill-foreground` design tokens) so
 * it renders correctly in light and dark mode.
 */
export function SheetSvg({
  drawing,
  sheetNo,
  projectName,
}: {
  drawing: Drawing
  sheetNo: string
  projectName: string
}) {
  const clipId = React.useId()
  const { scaleN, toMm } = React.useMemo(() => sheetPlacement(drawing), [drawing])
  const dateStr = React.useMemo(() => new Date().toLocaleDateString("id-ID"), [])

  const contentW = CONTENT_RIGHT_MM - CONTENT_LEFT_MM
  const contentH = CONTENT_BOTTOM_MM - CONTENT_TOP_MM
  const titleBlockDivider1 = CONTENT_LEFT_MM + contentW * 0.64
  const titleBlockDivider2 = CONTENT_LEFT_MM + contentW * 0.87

  return (
    <svg
      data-testid="sheet-svg"
      viewBox={`0 0 ${SHEET_W_MM} ${SHEET_H_MM}`}
      className="h-auto w-full bg-background"
      role="img"
      aria-label={`${drawing.title} — skala 1:${scaleN}`}
    >
      <rect x={0} y={0} width={SHEET_W_MM} height={SHEET_H_MM} className="fill-background" />
      {/* Outer border */}
      <rect
        x={0.25}
        y={0.25}
        width={SHEET_W_MM - 0.5}
        height={SHEET_H_MM - 0.5}
        className="fill-none stroke-foreground"
        strokeWidth={0.5}
      />
      {/* Margin frame */}
      <rect
        x={CONTENT_LEFT_MM}
        y={CONTENT_TOP_MM}
        width={SHEET_W_MM - 2 * CONTENT_LEFT_MM}
        height={SHEET_H_MM - 2 * CONTENT_TOP_MM}
        className="fill-none stroke-foreground/60"
        strokeWidth={0.3}
      />

      <clipPath id={`sheet-clip-${clipId}`}>
        <rect x={CONTENT_LEFT_MM} y={CONTENT_TOP_MM} width={contentW} height={contentH} />
      </clipPath>

      <g clipPath={`url(#sheet-clip-${clipId})`}>
        {drawing.lines.map((ln, i) => {
          const p1 = toMm(ln.x1, ln.y1)
          const p2 = toMm(ln.x2, ln.y2)
          return (
            <line
              key={i}
              x1={p1.x}
              y1={p1.y}
              x2={p2.x}
              y2={p2.y}
              className="stroke-foreground"
              strokeWidth={STROKE_WIDTH_MM[ln.kind]}
              strokeDasharray={ln.kind === "slab" ? "2 1.2" : undefined}
              strokeLinecap="square"
            />
          )
        })}

        {drawing.dims.map((dim, i) => (
          <DimChainGroup key={i} dim={dim} toMm={toMm} />
        ))}

        {drawing.levels.map((lvl, i) => {
          const p0 = toMm(-LEVEL_MARK_LEN_M, lvl.y)
          const p1 = toMm(0, lvl.y)
          return (
            <g key={i}>
              <line
                x1={p0.x}
                y1={p0.y}
                x2={p1.x}
                y2={p1.y}
                className="stroke-foreground"
                strokeWidth={0.35}
              />
              <text
                x={p0.x - 1}
                y={p0.y}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize={DIM_FONT_MM}
                className="fill-foreground"
              >
                {lvl.label}
              </text>
            </g>
          )
        })}

        {drawing.labels.map((lb, i) => {
          const p = toMm(lb.x, lb.y)
          // Per-label anchor wins; fallback = legacy per-kind behaviour.
          const anchor = lb.anchor ?? (lb.kind === "level" ? "start" : "middle")
          return (
            <text
              key={i}
              x={p.x}
              y={p.y}
              textAnchor={anchor}
              dominantBaseline="middle"
              fontSize={lb.kind === "title" ? LABEL_FONT_MM * 1.3 : LABEL_FONT_MM}
              fontWeight={lb.kind === "title" ? 600 : 400}
              className="fill-foreground"
            >
              {lb.text}
            </text>
          )
        })}
      </g>

      {/* Title block (bottom-right strip) */}
      <g data-testid="sheet-title-block">
        <rect
          x={CONTENT_LEFT_MM}
          y={CONTENT_BOTTOM_MM}
          width={contentW}
          height={SHEET_H_MM - CONTENT_TOP_MM - CONTENT_BOTTOM_MM}
          className="fill-none stroke-foreground"
          strokeWidth={0.35}
        />
        <line
          x1={titleBlockDivider1}
          y1={CONTENT_BOTTOM_MM}
          x2={titleBlockDivider1}
          y2={SHEET_H_MM - CONTENT_TOP_MM}
          className="stroke-foreground"
          strokeWidth={0.3}
        />
        <line
          x1={titleBlockDivider2}
          y1={CONTENT_BOTTOM_MM}
          x2={titleBlockDivider2}
          y2={SHEET_H_MM - CONTENT_TOP_MM}
          className="stroke-foreground"
          strokeWidth={0.3}
        />
        <text x={CONTENT_LEFT_MM + 3} y={CONTENT_BOTTOM_MM + 8} fontSize={3.6} fontWeight={600} className="fill-foreground">
          {projectName}
        </text>
        <text x={CONTENT_LEFT_MM + 3} y={CONTENT_BOTTOM_MM + 16} fontSize={3} className="fill-foreground">
          {drawing.title}
        </text>
        <text x={titleBlockDivider1 + 3} y={CONTENT_BOTTOM_MM + 9} fontSize={2.8} className="fill-foreground">
          {`Skala 1:${scaleN}`}
        </text>
        <text x={titleBlockDivider1 + 3} y={CONTENT_BOTTOM_MM + 17} fontSize={2.8} className="fill-foreground">
          {dateStr}
        </text>
        <text
          x={(titleBlockDivider2 + (CONTENT_RIGHT_MM)) / 2}
          y={CONTENT_BOTTOM_MM + 13}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={5.5}
          fontWeight={700}
          className="fill-foreground"
        >
          {sheetNo}
        </text>
      </g>
    </svg>
  )
}
