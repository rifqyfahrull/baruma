"use client"

import * as React from "react"

import type { Room } from "@/types"
import { deriveDimensions, type Dimensions } from "@/lib/geometry/dimensions"
import { formatLength, formatLengthPair, type LengthUnit } from "@/lib/format"

// Screen-space offsets (px) measured outward from a plan edge.
const CHAIN = 26 // segment dimension chain
const TOTAL = 50 // overall (total) chain
const BUBBLE = 74 // axis label bubbles
const TICK = 3
const BUBBLE_R = 9

/** Horizontal dimension band (X axes) along the top (dir=-1) or bottom (dir=+1). */
function HChain({
  dim, unit, toX, x0, xN, edgeY, dir,
}: {
  dim: Dimensions
  unit: LengthUnit
  toX: (m: number) => number
  x0: number
  xN: number
  edgeY: number
  dir: 1 | -1
}) {
  const chainY = edgeY + dir * CHAIN
  const totalY = edgeY + dir * TOTAL
  const bubbleY = edgeY + dir * BUBBLE
  const segTextY = chainY + (dir < 0 ? -4 : 11)
  const totalTextY = totalY + (dir < 0 ? -4 : 11)
  return (
    <g>
      {/* extension lines from the plan edge outward to the bubbles */}
      {dim.xAxes.map((a) => (
        <line key={`ext-${a.label}`} x1={toX(a.m)} y1={edgeY} x2={toX(a.m)} y2={bubbleY} className="stroke-foreground/20" strokeWidth={1} />
      ))}
      {/* segment chain + ticks + measurements */}
      <line x1={x0} y1={chainY} x2={xN} y2={chainY} className="stroke-foreground/70" strokeWidth={1} />
      {dim.xAxes.map((a) => (
        <line key={`tick-${a.label}`} x1={toX(a.m)} y1={chainY - TICK} x2={toX(a.m)} y2={chainY + TICK} className="stroke-foreground/70" strokeWidth={1} />
      ))}
      {dim.xSegments.map((s, i) => (
        <text key={i} x={(toX(s.from) + toX(s.to)) / 2} y={segTextY} textAnchor="middle" className="fill-foreground text-[9px]">
          {formatLength(s.m, unit)}
        </text>
      ))}
      {/* overall total */}
      <line x1={x0} y1={totalY} x2={xN} y2={totalY} className="stroke-foreground" strokeWidth={1.25} />
      <line x1={x0} y1={totalY - TICK} x2={x0} y2={totalY + TICK} className="stroke-foreground" strokeWidth={1.25} />
      <line x1={xN} y1={totalY - TICK} x2={xN} y2={totalY + TICK} className="stroke-foreground" strokeWidth={1.25} />
      <text x={(x0 + xN) / 2} y={totalTextY} textAnchor="middle" className="fill-foreground text-[10px] font-semibold">
        {formatLength(dim.overallX, unit)}
      </text>
      {/* bubbles */}
      {dim.xAxes.map((a) => (
        <g key={`bub-${a.label}`}>
          <circle cx={toX(a.m)} cy={bubbleY} r={BUBBLE_R} className="fill-background stroke-foreground/70" strokeWidth={1} />
          <text x={toX(a.m)} y={bubbleY} textAnchor="middle" dominantBaseline="central" className="fill-foreground text-[9px] font-semibold">
            {a.label}
          </text>
        </g>
      ))}
    </g>
  )
}

/** Vertical dimension band (Y axes) along the left (dir=-1) or right (dir=+1). */
function VChain({
  dim, unit, toY, y0, yN, edgeX, dir,
}: {
  dim: Dimensions
  unit: LengthUnit
  toY: (m: number) => number
  y0: number
  yN: number
  edgeX: number
  dir: 1 | -1
}) {
  const chainX = edgeX + dir * CHAIN
  const totalX = edgeX + dir * TOTAL
  const bubbleX = edgeX + dir * BUBBLE
  const segTextX = chainX + (dir < 0 ? -4 : 11)
  const totalTextX = totalX + (dir < 0 ? -4 : 11)
  return (
    <g>
      {dim.yAxes.map((a) => (
        <line key={`ext-${a.label}`} x1={edgeX} y1={toY(a.m)} x2={bubbleX} y2={toY(a.m)} className="stroke-foreground/20" strokeWidth={1} />
      ))}
      <line x1={chainX} y1={y0} x2={chainX} y2={yN} className="stroke-foreground/70" strokeWidth={1} />
      {dim.yAxes.map((a) => (
        <line key={`tick-${a.label}`} x1={chainX - TICK} y1={toY(a.m)} x2={chainX + TICK} y2={toY(a.m)} className="stroke-foreground/70" strokeWidth={1} />
      ))}
      {dim.ySegments.map((s, i) => {
        const cy = (toY(s.from) + toY(s.to)) / 2
        return (
          <text key={i} x={segTextX} y={cy} textAnchor="middle" transform={`rotate(-90 ${segTextX} ${cy})`} className="fill-foreground text-[9px]">
            {formatLength(s.m, unit)}
          </text>
        )
      })}
      <line x1={totalX} y1={y0} x2={totalX} y2={yN} className="stroke-foreground" strokeWidth={1.25} />
      <line x1={totalX - TICK} y1={y0} x2={totalX + TICK} y2={y0} className="stroke-foreground" strokeWidth={1.25} />
      <line x1={totalX - TICK} y1={yN} x2={totalX + TICK} y2={yN} className="stroke-foreground" strokeWidth={1.25} />
      <text x={totalTextX} y={(y0 + yN) / 2} textAnchor="middle" transform={`rotate(-90 ${totalTextX} ${(y0 + yN) / 2})`} className="fill-foreground text-[10px] font-semibold">
        {formatLength(dim.overallY, unit)}
      </text>
      {dim.yAxes.map((a) => (
        <g key={`bub-${a.label}`}>
          <circle cx={bubbleX} cy={toY(a.m)} r={BUBBLE_R} className="fill-background stroke-foreground/70" strokeWidth={1} />
          <text x={bubbleX} y={toY(a.m)} textAnchor="middle" dominantBaseline="central" className="fill-foreground text-[9px] font-semibold">
            {a.label}
          </text>
        </g>
      ))}
    </g>
  )
}

/**
 * Architectural dimension overlay for the 2D plan: an auto-derived axis grid
 * (A–H / 1–6 bubbles) with dimension chains + overall totals on ALL FOUR SIDES,
 * plus a per-room width×depth label. Read-only; recomputed from the current
 * rooms each render. Coordinates are screen px via toX/toY so text and offsets
 * stay constant regardless of zoom.
 */
export function DimensionLayer({
  rooms, site, toX, toY, pxPerMeter, unit,
}: {
  rooms: Room[]
  site: { widthM: number; depthM: number }
  toX: (m: number) => number
  toY: (m: number) => number
  pxPerMeter: number
  unit: LengthUnit
}) {
  const dim = React.useMemo(() => deriveDimensions(rooms, site), [rooms, site])
  if (dim.xAxes.length < 2 || dim.yAxes.length < 2) return null

  const x0 = toX(dim.xAxes[0].m)
  const xN = toX(dim.xAxes[dim.xAxes.length - 1].m)
  const y0 = toY(dim.yAxes[0].m)
  const yN = toY(dim.yAxes[dim.yAxes.length - 1].m)

  return (
    <g className="pointer-events-none" data-testid="dimension-layer">
      <HChain dim={dim} unit={unit} toX={toX} x0={x0} xN={xN} edgeY={y0} dir={-1} />
      <HChain dim={dim} unit={unit} toX={toX} x0={x0} xN={xN} edgeY={yN} dir={1} />
      <VChain dim={dim} unit={unit} toY={toY} y0={y0} yN={yN} edgeX={x0} dir={-1} />
      <VChain dim={dim} unit={unit} toY={toY} y0={y0} yN={yN} edgeX={xN} dir={1} />

      {/* Per-room width × depth */}
      {rooms.map((r) =>
        r.width * pxPerMeter > 56 && r.depth * pxPerMeter > 42 ? (
          <text
            key={`rdim-${r.id}`}
            x={toX(r.x + r.width / 2)} y={toY(r.y + r.depth) - 6}
            textAnchor="middle" className="fill-primary text-[9px] font-medium"
          >
            {formatLengthPair(r.width, r.depth, unit)}
          </text>
        ) : null
      )}
    </g>
  )
}
