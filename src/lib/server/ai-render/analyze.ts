/**
 * Analyzer deterministik scene AI Render (Fase A — docs/superpowers/plans/
 * 2026-08-23-ai-render-scene-intelligence-fase-a.md Task 2). PURE — tanpa
 * I/O, tanpa Math.random/Date.now, tanpa import three.js. Input sama →
 * output byte-identik: mengubah pose kamera + layout DB jadi `SceneFacts`
 * yang dikonsumsi prompt v2 (Task 3) & polish LLM opsional (Task 4).
 *
 * Konvensi dunia SAMA seperti lib/three/compass.ts & build-model.ts: utara =
 * −z, timur = +x; world x = site.x − site.widthM/2, world z = site.y −
 * site.depthM/2 (build-model.ts baris ~826-827: cx = site.widthM/2, cz =
 * site.depthM/2). Sisi "s" = depan bangunan (kamera preset "front" di +z).
 */
import type { DesignLayout, Room, Site } from "@/types"
import type { ExteriorElement } from "@/types/exterior"
import { facadeCladdingById } from "@/lib/three/facade-claddings"

/** Pose kamera three.js dikirim klien bersama capture (world coords). */
export type CameraPose = {
  /** World three.js: x timur, y atas, z selatan (utara = −z, compass.ts). */
  position: [number, number, number]
  target: [number, number, number]
  /** Derajat, vertikal (PerspectiveCamera.fov). */
  fov: number
}

export type FacadeSideId = "n" | "s" | "w" | "e"

export interface SideFacts {
  side: FacadeSideId
  claddings: string[] // label katalog, unik, urut abjad
  windowCount: number
  doorCount: number
  garageDoorCount: number
  facadeElements: string[] // kind unik, urut abjad
  balconyCount: number
}

export interface SceneFacts {
  camera: {
    heightClass: "eye-level" | "elevated" | "aerial"
    distanceClass: "close-up" | "medium" | "wide"
    lensMm: 24 | 35 | 50
    visibleSides: FacadeSideId[] // 1–2, primer dulu
  }
  massing: {
    siteWidthM: number
    siteDepthM: number
    footprintWidthM: number
    footprintDepthM: number
    floors: number
    approxHeightM: number
    hasRooftopDeck: boolean
    rooftopRailing?: string
  }
  sides: SideFacts[] // hanya sisi terlihat, urutan = visibleSides
  exteriorInFrame: string[] // kind unik urut abjad, hanya yang masuk frustum
  roof: { zoneTypes: string[]; globalType: string; skylightCount: number }
  lighting: { exteriorLampCount: number }
  vegetationPresent: boolean
}

const round1 = (v: number): number => Math.round(v * 10) / 10

const clamp = (v: number, min: number, max: number): number => {
  if (!Number.isFinite(v)) return min
  return Math.min(max, Math.max(min, v))
}

/** Ring azimuth sisi fasad — s=0°, e=90°, n=180°, w=270° (searah jarum jam
 *  dilihat dari atas, sama seperti cameraAzimuthDeg di compass.ts). */
const RING: Record<FacadeSideId, number> = { s: 0, e: 90, n: 180, w: 270 }
/** Urutan ring berdekatan (dipakai cari tetangga sisi primer). */
const RING_ORDER: FacadeSideId[] = ["s", "e", "n", "w"]

type Rect = { x: number; y: number; width: number; depth: number }

/** Konversi koordinat site (denah, y-down) → world xz (compass.ts). */
function siteToWorld(site: Site, sx: number, sy: number): [number, number] {
  return [sx - site.widthM / 2, sy - site.depthM / 2]
}

/** `${roomId}:${side}` → [roomId, side]. Toleran wallId tanpa ":" (roomId saja). */
function splitWallId(wallId: string): [string, string] {
  const idx = wallId.lastIndexOf(":")
  if (idx === -1) return [wallId, ""]
  return [wallId.slice(0, idx), wallId.slice(idx + 1)]
}

/** Bbox rooms lantai PERTAMA non-rooftop; fallback ke seluruh tapak bila
 *  lantai pertama tak punya ruang (footprint kosong — jalur never-throw). */
function computeFootprint(layout: DesignLayout, site: Site): Rect {
  const firstFloor = layout.floors.find((f) => f.id !== "floor-rooftop")
  const rooms = firstFloor ? layout.rooms.filter((r) => r.floorId === firstFloor.id) : []
  if (rooms.length === 0) {
    return { x: 0, y: 0, width: site.widthM, depth: site.depthM }
  }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const r of rooms) {
    minX = Math.min(minX, r.x)
    minY = Math.min(minY, r.y)
    maxX = Math.max(maxX, r.x + r.width)
    maxY = Math.max(maxY, r.y + r.depth)
  }
  return { x: minX, y: minY, width: maxX - minX, depth: maxY - minY }
}

/** Selisih sudut absolut terpendek antara dua derajat (0..180). */
function angularDiff(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360
  return diff > 180 ? 360 - diff : diff
}

function azimuthDeg(dx: number, dz: number): number {
  if (dx === 0 && dz === 0) return 0
  let deg = (Math.atan2(dx, dz) * 180) / Math.PI
  if (deg < 0) deg += 360
  return deg
}

/** Sisi primer = ring dgn selisih sudut minimum. Sekunder = tetangga ring
 *  terdekat bila selisih dari sumbu primer ada di [20°, 70°]. */
function resolveVisibleSides(azimuth: number): FacadeSideId[] {
  let primary: FacadeSideId = "s"
  let minDiff = Infinity
  for (const side of RING_ORDER) {
    const diff = angularDiff(azimuth, RING[side])
    if (diff < minDiff) {
      minDiff = diff
      primary = side
    }
  }
  const sides: FacadeSideId[] = [primary]
  if (minDiff >= 20 && minDiff <= 70) {
    const idx = RING_ORDER.indexOf(primary)
    const neighborA = RING_ORDER[(idx + 1) % 4]
    const neighborB = RING_ORDER[(idx + 3) % 4]
    const diffA = angularDiff(azimuth, RING[neighborA])
    const diffB = angularDiff(azimuth, RING[neighborB])
    sides.push(diffA <= diffB ? neighborA : neighborB)
  }
  return sides
}

function heightClassOf(y: number): "eye-level" | "elevated" | "aerial" {
  if (y < 2.5) return "eye-level"
  if (y < 9) return "elevated"
  return "aerial"
}

function distanceClassOf(ratio: number): "close-up" | "medium" | "wide" {
  if (ratio < 1.0) return "close-up"
  if (ratio < 2.2) return "medium"
  return "wide"
}

function lensMmOf(fov: number): 24 | 35 | 50 {
  if (fov >= 55) return 24
  if (fov >= 35) return 35
  return 50
}

/** Rooms SEMUA lantai yang tepinya menyentuh tepi bbox footprint pada sisi
 *  tertentu (toleransi 0.25 m). */
function edgeRooms(side: FacadeSideId, rooms: Room[], fp: Rect): Room[] {
  const TOL = 0.25
  return rooms.filter((r) => {
    switch (side) {
      case "s":
        return Math.abs(r.y + r.depth - (fp.y + fp.depth)) <= TOL
      case "n":
        return Math.abs(r.y - fp.y) <= TOL
      case "w":
        return Math.abs(r.x - fp.x) <= TOL
      case "e":
        return Math.abs(r.x + r.width - (fp.x + fp.width)) <= TOL
      default:
        return false
    }
  })
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b))
}

function buildSideFacts(side: FacadeSideId, layout: DesignLayout, fp: Rect): SideFacts {
  const rooms = edgeRooms(side, layout.rooms, fp)
  const roomIds = new Set(rooms.map((r) => r.id))

  const claddingLabels = new Set<string>()
  for (const [wallId, claddingId] of Object.entries(layout.facade ?? {})) {
    const [roomId, wallSide] = splitWallId(wallId)
    if (wallSide === side && roomIds.has(roomId)) {
      claddingLabels.add(facadeCladdingById(claddingId)?.label ?? claddingId)
    }
  }

  let windowCount = 0
  let doorCount = 0
  let garageDoorCount = 0
  for (const o of layout.openings) {
    const [roomId, wallSide] = splitWallId(o.wallId)
    if (wallSide !== side || !roomIds.has(roomId)) continue
    if (o.type === "window") windowCount++
    else if (o.type === "door") {
      if (o.kind === "garage_door") garageDoorCount++
      else doorCount++
    }
  }

  const facadeElementKinds = new Set<string>()
  for (const fe of layout.facadeElements ?? []) {
    const [roomId, wallSide] = splitWallId(fe.wallId)
    if (wallSide === side && roomIds.has(roomId)) facadeElementKinds.add(fe.kind)
  }

  const balconyCount = rooms.filter((r) => r.type === "balkon").length

  return {
    side,
    claddings: sortedUnique(claddingLabels),
    windowCount,
    doorCount,
    garageDoorCount,
    facadeElements: sortedUnique(facadeElementKinds),
    balconyCount,
  }
}

/** Titik wakil (koordinat site) sebuah elemen eksterior — dipakai cek
 *  keterlihatan (exteriorInFrame). null bila elemen tak punya geometri
 *  valid (mis. surface tanpa titik). */
function representativePoint(el: ExteriorElement): { x: number; y: number } | null {
  switch (el.kind) {
    case "boundary_wall":
    case "fence":
    case "sliding_gate":
    case "swing_gate":
    case "pedestrian_gate":
      return { x: (el.start.x + el.end.x) / 2, y: (el.start.y + el.end.y) / 2 }
    case "exterior_stair":
      return { x: el.x + el.widthM / 2, y: el.y + el.lengthM / 2 }
    case "driveway":
    case "walkway":
    case "terrace_surface":
    case "garden_bed": {
      if (el.points.length === 0) return null
      const sx = el.points.reduce((s, p) => s + p.x, 0) / el.points.length
      const sy = el.points.reduce((s, p) => s + p.y, 0) / el.points.length
      return { x: sx, y: sy }
    }
    case "solid_wall":
    case "facade_panel":
    case "column":
    case "chimney":
    case "beam":
    case "slab":
    case "canopy":
    case "overhang_slab":
    case "planter":
    case "pergola":
    case "asset":
    case "plant":
    case "tree":
    case "exterior_decor":
    case "vehicle":
      return { x: el.x + el.widthM / 2, y: el.y + el.depthM / 2 }
    case "portal_frame":
    case "gable_frame":
      return { x: el.x + el.widthM / 2, y: el.y + (el.depthM ?? 0) / 2 }
    default:
      return null
  }
}

/** Inset rect oklusi (m): footprint dikecilkan tiap sisi supaya elemen yang
 *  MENEMPEL fasad (kanopi, teras) tidak ikut dianggap tertutup bangunan. */
const OCCLUSION_INSET_M = 0.8

/**
 * True bila segmen 2D (a→b, koordinat site) menembus interior rect —
 * slab method baku: hitung rentang parameter t saat segmen berada di dalam
 * rentang x dan y rect; beririsan di 0<t<1 = segmen melewati rect SEBELUM
 * mencapai b. `a` (kamera) di dalam rect → false (fallback aman: kamera di
 * dalam footprint tidak meng-occlude apa pun — lihat analyzeScene).
 */
function segmentCrossesRect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  rect: { x0: number; y0: number; x1: number; y1: number }
): boolean {
  if (ax >= rect.x0 && ax <= rect.x1 && ay >= rect.y0 && ay <= rect.y1) return false
  const dx = bx - ax
  const dy = by - ay
  let tMin = 0
  let tMax = 1
  for (const [d, a, lo, hi] of [
    [dx, ax, rect.x0, rect.x1],
    [dy, ay, rect.y0, rect.y1],
  ] as const) {
    if (d === 0) {
      if (a < lo || a > hi) return false
    } else {
      let t0 = (lo - a) / d
      let t1 = (hi - a) / d
      if (t0 > t1) [t0, t1] = [t1, t0]
      tMin = Math.max(tMin, t0)
      tMax = Math.min(tMax, t1)
      if (tMin > tMax) return false
    }
  }
  // Irisan valid di dalam (0,1): segmen benar-benar melewati rect sebelum b.
  return tMax > 0 && tMin < 1 && tMin > 0
}

function computeExteriorInFrame(
  layout: DesignLayout,
  site: Site,
  pos: [number, number, number],
  target: [number, number, number],
  fov: number,
  diag: number,
  fp: { x: number; y: number; width: number; depth: number }
): string[] {
  const elements = layout.exteriorElements ?? []
  const viewDx = target[0] - pos[0]
  const viewDz = target[2] - pos[2]
  const viewMag = Math.hypot(viewDx, viewDz)
  const threshold = Math.min(100, fov * 1.35) / 2 + 12
  const maxDist = 3 * diag

  // Rect oklusi = footprint di-inset; inset dijepit supaya rect tetap valid
  // pada bangunan mungil (< 2×inset per sumbu → oklusi dimatikan saja).
  const inset = Math.min(OCCLUSION_INSET_M, fp.width / 4, fp.depth / 4)
  const occlusionRect =
    inset > 0
      ? {
          x0: fp.x + inset,
          y0: fp.y + inset,
          x1: fp.x + fp.width - inset,
          y1: fp.y + fp.depth - inset,
        }
      : null
  // Posisi kamera dalam koordinat site (inversi siteToWorld).
  const camSiteX = pos[0] + site.widthM / 2
  const camSiteY = pos[2] + site.depthM / 2

  const kinds = new Set<string>()
  for (const el of elements) {
    if (el.hidden) continue
    const rp = representativePoint(el)
    if (!rp) continue
    const [wx, wz] = siteToWorld(site, rp.x, rp.y)
    const dx = wx - pos[0]
    const dz = wz - pos[2]
    const dist = Math.hypot(dx, dz)
    if (dist > maxDist) continue
    if (viewMag === 0 || dist === 0) {
      kinds.add(el.kind)
      continue
    }
    const cos = (viewDx * dx + viewDz * dz) / (viewMag * dist)
    const angle = (Math.acos(clamp(cos, -1, 1)) * 180) / Math.PI
    if (angle > threshold) continue
    // Oklusi 2D: garis pandang kamera→elemen menembus massa bangunan →
    // elemen tertutup, jangan disebut "visible". Aproksimasi denah (tanpa
    // tinggi): elemen tinggi di belakang rumah rendah tetap tereksklusi —
    // keterbatasan v1 yang diterima (depth map tetap memandu provider).
    if (occlusionRect && segmentCrossesRect(camSiteX, camSiteY, rp.x, rp.y, occlusionRect)) {
      continue
    }
    kinds.add(el.kind)
  }
  return sortedUnique(kinds)
}

function computeRoof(layout: DesignLayout): SceneFacts["roof"] {
  const zoneTypes = sortedUnique(
    (layout.roofZones ?? []).filter((z) => !z.hidden).map((z) => z.type)
  )
  const globalType = layout.roof?.type ?? "datar"
  const skylightCount = layout.skylights?.length ?? 0
  return { zoneTypes, globalType, skylightCount }
}

/**
 * Analyzer deterministik: pose kamera + layout → SceneFacts. Pure, tak
 * pernah throw — footprint kosong jatuh ke seluruh tapak (computeFootprint),
 * fov aneh (0, negatif, NaN) di-clamp ke rentang PerspectiveCamera wajar
 * 10–120°.
 */
export function analyzeScene(layout: DesignLayout, site: Site, pose: CameraPose): SceneFacts {
  const fov = clamp(pose.fov, 10, 120)
  const pos = pose.position
  const target = pose.target

  const fp = computeFootprint(layout, site)
  const diag = Math.hypot(fp.width, fp.depth)

  const fpCenterSite = { x: fp.x + fp.width / 2, y: fp.y + fp.depth / 2 }
  const [centerWorldX, centerWorldZ] = siteToWorld(site, fpCenterSite.x, fpCenterSite.y)

  const azimuth = azimuthDeg(pos[0] - centerWorldX, pos[2] - centerWorldZ)
  const visibleSides = resolveVisibleSides(azimuth)

  const dist3D = Math.hypot(pos[0] - centerWorldX, pos[1] - 0, pos[2] - centerWorldZ)
  const ratio = diag === 0 ? 0 : dist3D / diag

  const roof = computeRoof(layout)
  const roofTypesUnion = new Set([...roof.zoneTypes, roof.globalType])
  const hasNonDatarRoof = [...roofTypesUnion].some((t) => t !== "datar")

  const floors = layout.floors.filter((f) => f.id !== "floor-rooftop").length || 1
  const approxHeightM = round1(floors * 3.2 + (hasNonDatarRoof ? 1.8 : 0.3))
  const hasRooftopDeck = layout.floors.some((f) => f.id === "floor-rooftop")

  const sides = visibleSides.map((side) => buildSideFacts(side, layout, fp))
  const exteriorInFrame = computeExteriorInFrame(layout, site, pos, target, fov, diag, fp)
  const vegetationPresent = (layout.exteriorElements ?? []).some(
    (el) => !el.hidden && (el.kind === "tree" || el.kind === "plant" || el.kind === "garden_bed")
  )

  return {
    camera: {
      heightClass: heightClassOf(pos[1]),
      distanceClass: distanceClassOf(ratio),
      lensMm: lensMmOf(fov),
      visibleSides,
    },
    massing: {
      siteWidthM: round1(site.widthM),
      siteDepthM: round1(site.depthM),
      footprintWidthM: round1(fp.width),
      footprintDepthM: round1(fp.depth),
      floors,
      approxHeightM,
      hasRooftopDeck,
      rooftopRailing: hasRooftopDeck ? (layout.rooftopRailingStyle ?? "kaca") : undefined,
    },
    sides,
    exteriorInFrame,
    roof,
    lighting: { exteriorLampCount: (layout.exteriorLamps ?? []).length },
    vegetationPresent,
  }
}
