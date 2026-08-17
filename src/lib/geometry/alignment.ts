import type { Rect } from "./index"

export type SnapKind = "edge" | "center" | "site" | "equal"
export type SnapCandidate = { value: number; kind: SnapKind }
export type SnapResult = { value: number; guide: SnapCandidate | null }

type Site = { widthM: number; depthM: number }

/** Nearest candidate within tol wins; else value unchanged. */
export function snapAxis(value: number, candidates: SnapCandidate[], tol: number): SnapResult {
  let best: SnapCandidate | null = null
  let bestD = tol
  for (const c of candidates) {
    const d = Math.abs(c.value - value)
    if (d <= bestD) {
      bestD = d
      best = c
    }
  }
  return best ? { value: best.value, guide: best } : { value, guide: null }
}

function edgesX(others: Rect[]): SnapCandidate[] {
  return others.flatMap((o) => [
    { value: o.x, kind: "edge" as const },
    { value: o.x + o.width, kind: "edge" as const },
    { value: o.x + o.width / 2, kind: "center" as const },
  ])
}
function edgesY(others: Rect[]): SnapCandidate[] {
  return others.flatMap((o) => [
    { value: o.y, kind: "edge" as const },
    { value: o.y + o.depth, kind: "edge" as const },
    { value: o.y + o.depth / 2, kind: "center" as const },
  ])
}
function siteX(site: Site): SnapCandidate[] {
  return [
    { value: 0, kind: "site" },
    { value: site.widthM, kind: "site" },
    { value: site.widthM / 2, kind: "site" },
  ]
}
function siteY(site: Site): SnapCandidate[] {
  return [
    { value: 0, kind: "site" },
    { value: site.depthM, kind: "site" },
    { value: site.depthM / 2, kind: "site" },
  ]
}

export function resizeCandidatesX(room: Rect, others: Rect[], site: Site, edge: "left" | "right"): SnapCandidate[] {
  const out = [...edgesX(others), ...siteX(site)]
  for (const o of others) {
    out.push({ value: edge === "right" ? room.x + o.width : room.x + room.width - o.width, kind: "equal" })
  }
  return out
}
export function resizeCandidatesY(room: Rect, others: Rect[], site: Site, edge: "top" | "bottom"): SnapCandidate[] {
  const out = [...edgesY(others), ...siteY(site)]
  for (const o of others) {
    out.push({ value: edge === "bottom" ? room.y + o.depth : room.y + room.depth - o.depth, kind: "equal" })
  }
  return out
}
export function moveCandidatesX(others: Rect[], site: Site): SnapCandidate[] {
  return [...edgesX(others), ...siteX(site)]
}
export function moveCandidatesY(others: Rect[], site: Site): SnapCandidate[] {
  return [...edgesY(others), ...siteY(site)]
}

/** Move a rect on one axis: match its left(pos)/right(pos+size)/center against candidates,
 *  snap to the nearest in-tol one, and return the adjusted position + the matched guide. */
export function snapMove(pos: number, size: number, candidates: SnapCandidate[], tol: number): SnapResult {
  const refs = [pos, pos + size, pos + size / 2]
  let best: SnapCandidate | null = null
  let bestPos = pos
  let bestD = tol
  for (const ref of refs) {
    for (const c of candidates) {
      const d = Math.abs(c.value - ref)
      if (d <= bestD) {
        bestD = d
        best = c
        bestPos = pos + (c.value - ref)
      }
    }
  }
  return best ? { value: bestPos, guide: best } : { value: pos, guide: null }
}
