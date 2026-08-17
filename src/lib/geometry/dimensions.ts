/**
 * Auto-derive an architectural dimension grid from free-form rooms.
 *
 * The 2D editor has no fixed structural grid, so we synthesise one: collect
 * every room edge (+ the site boundary), cluster near-equal positions into axis
 * lines, label them (A,B,C… across X; 1,2,3… down Y), and measure the gap
 * between consecutive axes. Pure functions → unit-testable, no rendering here.
 */
import type { Room } from "@/types"
import { round2 } from "./index"

export type Axis = { m: number; label: string }
export type DimensionSegment = { from: number; to: number; m: number }

export type Dimensions = {
  xAxes: Axis[]
  yAxes: Axis[]
  xSegments: DimensionSegment[]
  ySegments: DimensionSegment[]
  overallX: number
  overallY: number
}

/** Cluster near-equal positions (within `tol` metres) into sorted unique
 *  positions, each the mean of its cluster. */
export function clusterEdges(values: number[], tol = 0.1): number[] {
  if (values.length === 0) return []
  const sorted = [...values].sort((a, b) => a - b)
  const clusters: number[][] = [[sorted[0]]]
  for (let i = 1; i < sorted.length; i++) {
    const v = sorted[i]
    const cur = clusters[clusters.length - 1]
    if (v - cur[cur.length - 1] <= tol) cur.push(v)
    else clusters.push([v])
  }
  return clusters.map((c) => round2(c.reduce((s, x) => s + x, 0) / c.length))
}

/** Spreadsheet-style column label: 0→A, 25→Z, 26→AA. */
function colLabel(i: number): string {
  let n = i
  let s = ""
  do {
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return s
}

function segmentsOf(pos: number[]): DimensionSegment[] {
  const segs: DimensionSegment[] = []
  for (let i = 0; i < pos.length - 1; i++) {
    segs.push({ from: pos[i], to: pos[i + 1], m: round2(pos[i + 1] - pos[i]) })
  }
  return segs
}

export function deriveDimensions(
  rooms: Room[],
  site: { widthM: number; depthM: number },
  tol = 0.1
): Dimensions {
  const xs: number[] = [0, site.widthM]
  const ys: number[] = [0, site.depthM]
  for (const r of rooms) {
    xs.push(r.x, r.x + r.width)
    ys.push(r.y, r.y + r.depth)
  }
  const xPos = clusterEdges(xs, tol)
  const yPos = clusterEdges(ys, tol)

  return {
    xAxes: xPos.map((m, i) => ({ m, label: colLabel(i) })),
    yAxes: yPos.map((m, i) => ({ m, label: String(i + 1) })),
    xSegments: segmentsOf(xPos),
    ySegments: segmentsOf(yPos),
    overallX: round2((xPos.at(-1) ?? 0) - (xPos[0] ?? 0)),
    overallY: round2((yPos.at(-1) ?? 0) - (yPos[0] ?? 0)),
  }
}
