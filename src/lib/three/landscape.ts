/**
 * Penempatan vegetasi taman untuk preview 3D — pohon & semak stylized yang
 * memberi konteks render (referensi visual arsitek selalu berlatar hijau).
 * Pure & DETERMINISTIK: posisi diturunkan dari hash id ruang (bukan
 * Math.random) sehingga stabil antar render/undo dan bisa ditest.
 * Ruang bertipe "taman" dan exterior `garden_bed`; kepadatan mengikuti luas.
 */
import type { DesignLayout, ExteriorSurfaceElement } from "@/types"
import { exteriorElementBoundingBox } from "@/lib/exterior/geometry"

export type PlantPlacement = {
  id: string
  kind: "tree" | "bush"
  /** Posisi ABSOLUT site (meter), konvensi sama dengan Room.x/y. */
  x: number
  y: number
  scale: number
  sourceId: string
  sourceType: "room" | "garden_bed"
  roomId?: string
  floorId: string
}

export type LandscapeClearanceIssue = {
  id: string
  elementId: string
  conflictElementId: string
  message: string
}

function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h) || 1
}

/** xorshift32 — cukup untuk sebaran visual; seeded → deterministik. */
function makeRng(seed: number): () => number {
  let s = seed
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    s |= 0
    return (Math.abs(s) % 10_000) / 10_000
  }
}

function polygonArea(points: Array<{ x: number; y: number }>): number {
  if (points.length < 3) return 0
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    sum += a.x * b.y - b.x * a.y
  }
  return Math.abs(sum) / 2
}

function pointInPolygon(point: { x: number; y: number }, polygon: Array<{ x: number; y: number }>): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]
    const b = polygon[j]
    const intersects =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y + Number.EPSILON) + a.x
    if (intersects) inside = !inside
  }
  return inside
}

function gardenBedPlacements(
  element: ExteriorSurfaceElement,
  fallbackFloorId: string,
): PlantPlacement[] {
  const area = polygonArea(element.points)
  if (area <= 0) return []

  const xs = element.points.map((p) => p.x)
  const ys = element.points.map((p) => p.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const rng = makeRng(element.scatterSeed ?? hashStr(element.id))
  const trees = Math.min(4, Math.max(area >= 4 ? 1 : 0, Math.floor(area / 10)))
  const bushes = Math.min(8, Math.max(2, Math.floor(area / 3)))
  const out: PlantPlacement[] = []

  const place = (kind: "tree" | "bush", index: number) => {
    for (let attempt = 0; attempt < 32; attempt++) {
      const p = {
        x: minX + rng() * Math.max(0.01, maxX - minX),
        y: minY + rng() * Math.max(0.01, maxY - minY),
      }
      if (!pointInPolygon(p, element.points)) continue
      out.push({
        id: `${kind}-${element.id}-${index}`,
        kind,
        x: p.x,
        y: p.y,
        scale: 0.75 + rng() * 0.55,
        sourceId: element.id,
        sourceType: "garden_bed",
        floorId: element.floorId ?? fallbackFloorId,
      })
      return
    }
  }

  for (let i = 0; i < trees; i++) place("tree", i)
  for (let i = 0; i < bushes; i++) place("bush", i)
  return out
}

function boxesOverlap(
  a: { minX: number; maxX: number; minY: number; maxY: number },
  b: { minX: number; maxX: number; minY: number; maxY: number },
): boolean {
  return Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX) > 0
    && Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY) > 0
}

export function landscapeClearanceIssues(layout: DesignLayout): LandscapeClearanceIssue[] {
  const hardscape = (layout.exteriorElements ?? []).filter(
    (element) =>
      !element.hidden &&
      (element.kind === "driveway" ||
        element.kind === "walkway" ||
        element.kind === "terrace_surface"),
  )
  const landscapeAssets = (layout.exteriorElements ?? []).filter(
    (element) =>
      !element.hidden &&
      (element.kind === "plant" ||
        element.kind === "tree" ||
        element.kind === "exterior_decor"),
  )

  const issues: LandscapeClearanceIssue[] = []
  for (const asset of landscapeAssets) {
    const assetBox = exteriorElementBoundingBox(asset)
    for (const access of hardscape) {
      if (!boxesOverlap(assetBox, exteriorElementBoundingBox(access))) continue
      issues.push({
        id: `landscape-clearance:${asset.id}:${access.id}`,
        elementId: asset.id,
        conflictElementId: access.id,
        message: `${asset.label ?? asset.kind} overlap jalur akses ${access.label ?? access.kind}.`,
      })
    }
  }
  return issues
}

export function landscapePlacements(layout: DesignLayout): PlantPlacement[] {
  const out: PlantPlacement[] = []
  const fallbackFloorId = layout.floors[0]?.id ?? "floor-1"
  for (const room of layout.rooms) {
    if (room.type !== "taman") continue
    const rng = makeRng(hashStr(room.id))
    const area = room.width * room.depth
    const trees = Math.min(3, Math.max(area >= 4 ? 1 : 0, Math.floor(area / 8)))
    const bushes = Math.min(6, Math.max(2, Math.floor(area / 3)))
    const place = (kind: "tree" | "bush", index: number, margin: number) => {
      // Margin menjaga tajuk tidak menembus dinding tetangga.
      const mx = Math.min(margin, room.width / 2 - 0.05)
      const my = Math.min(margin, room.depth / 2 - 0.05)
      out.push({
        id: `${kind}-${room.id}-${index}`,
        kind,
        x: room.x + mx + rng() * Math.max(0.01, room.width - 2 * mx),
        y: room.y + my + rng() * Math.max(0.01, room.depth - 2 * my),
        scale: 0.8 + rng() * 0.5,
        sourceId: room.id,
        sourceType: "room",
        roomId: room.id,
        floorId: room.floorId,
      })
    }
    for (let i = 0; i < trees; i++) place("tree", i, 0.8)
    for (let i = 0; i < bushes; i++) place("bush", i, 0.35)
  }
  for (const element of layout.exteriorElements ?? []) {
    if (element.hidden || element.kind !== "garden_bed") continue
    out.push(...gardenBedPlacements(element, fallbackFloorId))
  }
  return out
}
