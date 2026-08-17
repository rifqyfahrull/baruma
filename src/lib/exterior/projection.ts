import type { ExteriorElement } from "@/types"
import type { DrawLabel, DrawLine } from "@/lib/drawings/types"
import {
  exteriorElementBoundingBox,
  orientedRectCorners,
  round2,
} from "@/lib/exterior/geometry"

export type ExteriorPlanProjection = {
  lines: DrawLine[]
  labels: DrawLabel[]
  maxX: number
  maxY: number
}

function outline(points: Array<{ x: number; y: number }>, refId: string): DrawLine[] {
  return points.map((point, index) => {
    const next = points[(index + 1) % points.length]
    return {
      x1: round2(point.x),
      y1: round2(point.y),
      x2: round2(next.x),
      y2: round2(next.y),
      kind: "outline" as const,
      refId,
    }
  })
}

function planPoints(element: ExteriorElement): Array<{ x: number; y: number }> {
  if ("start" in element) return [element.start, element.end]
  if ("points" in element) return element.points
  const bbox = exteriorElementBoundingBox(element)
  if ("x" in element && "y" in element && "widthM" in element) {
    const depthM = "depthM" in element
      ? (element.depthM ?? 0.3)
      : "lengthM" in element
        ? element.lengthM
        : bbox.maxY - bbox.minY
    return orientedRectCorners({
      x: element.x,
      y: element.y,
      widthM: element.widthM,
      depthM,
      rotationDeg: "rotationDeg" in element ? (element.rotationDeg ?? 0) : 0,
    })
  }
  return [
    { x: bbox.minX, y: bbox.minY },
    { x: bbox.maxX, y: bbox.minY },
    { x: bbox.maxX, y: bbox.maxY },
    { x: bbox.minX, y: bbox.maxY },
  ]
}

export function projectExteriorPlan(
  elements: readonly ExteriorElement[],
  floorId: string,
): ExteriorPlanProjection {
  const lines: DrawLine[] = []
  const labels: DrawLabel[] = []
  let maxX = 0
  let maxY = 0

  for (const element of elements) {
    if (element.hidden || (element.floorId && element.floorId !== floorId)) continue
    const points = planPoints(element)
    if (points.length < 2) continue
    if ("start" in element) {
      lines.push({
        x1: round2(element.start.x),
        y1: round2(element.start.y),
        x2: round2(element.end.x),
        y2: round2(element.end.y),
        kind: "outline",
        refId: element.id,
      })
    } else {
      lines.push(...outline(points, element.id))
    }
    const bbox = exteriorElementBoundingBox(element)
    maxX = Math.max(maxX, bbox.maxX)
    maxY = Math.max(maxY, bbox.maxY)
    labels.push({
      x: round2((bbox.minX + bbox.maxX) / 2),
      y: round2((bbox.minY + bbox.maxY) / 2),
      text: element.label ?? element.kind.replaceAll("_", " ").toUpperCase(),
      kind: "room",
      refId: element.id,
    })
  }
  return { lines, labels, maxX, maxY }
}

export type ElevationSide = "n" | "s" | "e" | "w"

function heightOf(element: ExteriorElement): number {
  if ("heightM" in element) return element.heightM
  if (element.kind === "exterior_stair") return element.riseM
  return element.thicknessM ?? 0.05
}

function baseElevation(
  element: ExteriorElement,
  floorBaseY: ReadonlyMap<string, number>,
): number {
  const floor = element.floorId ? (floorBaseY.get(element.floorId) ?? 0) : 0
  return floor + ("zM" in element ? (element.zM ?? 0) : 0)
}

function projectH(side: ElevationSide, x: number, y: number, totalW: number, totalD: number): number {
  if (side === "s") return x
  if (side === "n") return totalW - x
  if (side === "w") return y
  return totalD - y
}

export function projectExteriorElevation(
  elements: readonly ExteriorElement[],
  options: {
    side: ElevationSide
    totalW: number
    totalD: number
    floorBaseY: ReadonlyMap<string, number>
  },
): { lines: DrawLine[]; topY: number; dimPoints: number[] } {
  const lines: DrawLine[] = []
  const dimPoints: number[] = []
  let topY = 0

  for (const element of elements) {
    if (element.hidden || (element.floorId && !options.floorBaseY.has(element.floorId))) continue
    const bbox = exteriorElementBoundingBox(element)
    const projected = [
      projectH(options.side, bbox.minX, bbox.minY, options.totalW, options.totalD),
      projectH(options.side, bbox.maxX, bbox.maxY, options.totalW, options.totalD),
    ]
    let h0 = round2(Math.min(...projected))
    let h1 = round2(Math.max(...projected))
    if (h1 - h0 < 0.02) {
      const center = (h0 + h1) / 2
      h0 = round2(center - 0.025)
      h1 = round2(center + 0.025)
    }
    const y0 = round2(baseElevation(element, options.floorBaseY))
    const y1 = round2(y0 + Math.max(0.02, heightOf(element)))
    const refId = element.id
    lines.push(
      { x1: h0, y1: y0, x2: h1, y2: y0, kind: "outline", refId },
      { x1: h0, y1: y1, x2: h1, y2: y1, kind: "outline", refId },
      { x1: h0, y1: y0, x2: h0, y2: y1, kind: "outline", refId },
      { x1: h1, y1: y0, x2: h1, y2: y1, kind: "outline", refId },
    )
    if (element.kind === "portal_frame") {
      const innerH0 = round2(h0 + element.memberSizeM)
      const innerH1 = round2(h1 - element.memberSizeM)
      const innerY = round2(y1 - element.memberSizeM)
      if (innerH1 > innerH0 && innerY > y0) {
        lines.push(
          { x1: innerH0, y1: y0, x2: innerH0, y2: innerY, kind: "opening", refId },
          { x1: innerH1, y1: y0, x2: innerH1, y2: innerY, kind: "opening", refId },
          { x1: innerH0, y1: innerY, x2: innerH1, y2: innerY, kind: "opening", refId },
        )
      }
    }
    dimPoints.push(h0, h1)
    topY = Math.max(topY, y1)
  }
  return { lines, topY, dimPoints }
}
