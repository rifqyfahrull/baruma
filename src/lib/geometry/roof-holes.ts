/**
 * Mesin lubang bidang atap DATAR — satu sumber kebenaran untuk SKYLIGHT
 * (Fase B) dan COURTYARD/openToSky (Fase C, plan ARSITEKTUR_MODERN).
 * Modul murni (tanpa react/zustand/three), pola rooftop.ts/slab.ts.
 *
 * Presedensi bidang host MENIRU persis presedensi emisi atap build-model
 * (ketiganya saling eksklusif):
 *   1. roofZones eksplisit  → hanya zona `datar` yang jadi host;
 *   2. dak rooftop          → rect deck (parsial) / footprint (penuh);
 *   3. atap datar legacy    → footprint bangunan (hanya bila roof.type datar).
 * Atap miring/pelana/limasan TIDAK punya host datar → resolveFlatHost null
 * (skylight tervalidasi sebagai warning, datanya dipertahankan).
 */

import type { DesignLayout, RoofZone } from "@/types"
import { round2 } from "@/lib/geometry"
import type { SlabRect } from "@/lib/geometry/slab"
import { buildingFootprint } from "@/lib/structural/grid"
import { clampRooftopArea, hasRooftopFloor } from "@/lib/geometry/rooftop"
import { hasExplicitRoofZones } from "@/lib/exterior/roof-zones"
import { topRegularFloorId } from "@/lib/editor/floors"

export type RoofHostKind = "legacy-flat" | "deck" | "zone-datar"
export type RoofHost = { kind: RoofHostKind; rect: SlabRect; zoneId?: string }

/** Rect core zona (koordinat zona = CENTER; konversi ke pojok di sini). */
function zoneCoreRect(zone: RoofZone): SlabRect {
  return {
    x: zone.x - zone.widthM / 2,
    y: zone.y - zone.depthM / 2,
    width: zone.widthM,
    depth: zone.depthM,
  }
}

function rectsOverlap(a: SlabRect, b: SlabRect): boolean {
  return (
    Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 1e-6 &&
    Math.min(a.y + a.depth, b.y + b.depth) - Math.max(a.y, b.y) > 1e-6
  )
}

/** Daftar semua bidang atap DATAR yang tersedia pada layout ini. */
export function flatRoofHosts(layout: DesignLayout): RoofHost[] {
  if (hasExplicitRoofZones(layout)) {
    return (layout.roofZones ?? [])
      .filter((z) => z.type === "datar" && !z.hidden)
      .map((z) => ({ kind: "zone-datar" as const, rect: zoneCoreRect(z), zoneId: z.id }))
  }
  const fp = buildingFootprint(layout)
  if (!(fp.widthM > 0 && fp.depthM > 0)) return []
  const fpRect: SlabRect = { x: fp.x0, y: fp.y0, width: fp.widthM, depth: fp.depthM }
  if (hasRooftopFloor(layout)) {
    const rect = layout.rooftopArea ? clampRooftopArea(layout.rooftopArea, fp) : fpRect
    return [
      {
        kind: "deck" as const,
        rect: { x: rect.x, y: rect.y, width: rect.width, depth: rect.depth },
      },
    ]
  }
  const roofType = layout.roof?.type ?? "datar"
  if (roofType !== "datar") return []
  return [{ kind: "legacy-flat" as const, rect: fpRect }]
}

/** Host datar yang menaungi `rect` (overlap terbesar); null = tak ada. */
export function resolveFlatHost(layout: DesignLayout, rect: SlabRect): RoofHost | null {
  let best: RoofHost | null = null
  let bestArea = 0
  for (const host of flatRoofHosts(layout)) {
    if (!rectsOverlap(rect, host.rect)) continue
    const w =
      Math.min(rect.x + rect.width, host.rect.x + host.rect.width) -
      Math.max(rect.x, host.rect.x)
    const d =
      Math.min(rect.y + rect.depth, host.rect.y + host.rect.depth) -
      Math.max(rect.y, host.rect.y)
    const area = w * d
    if (area > bestArea) {
      bestArea = area
      best = host
    }
  }
  return best
}

const MIN_HOLE_M = 0.4

/** Clamp rect ⊆ host (ukuran min 0.4 m, round2) — pola clampRooftopArea. */
export function clampToHost(rect: SlabRect, host: RoofHost): SlabRect {
  const width = round2(Math.min(Math.max(rect.width, MIN_HOLE_M), host.rect.width))
  const depth = round2(Math.min(Math.max(rect.depth, MIN_HOLE_M), host.rect.depth))
  const x = round2(
    Math.min(Math.max(rect.x, host.rect.x), host.rect.x + host.rect.width - width),
  )
  const y = round2(
    Math.min(Math.max(rect.y, host.rect.y), host.rect.y + host.rect.depth - depth),
  )
  return { x, y, width, depth }
}

/** Rect sebuah skylight. */
export function skylightRect(sk: {
  x: number
  y: number
  widthM: number
  depthM: number
}): SlabRect {
  return { x: sk.x, y: sk.y, width: sk.widthM, depth: sk.depthM }
}

/** Skylight (dgn id) yang ter-resolve ke SATU host, rect ter-clamp ⊆ host. */
export function skylightsOnHost(
  layout: DesignLayout,
  host: RoofHost,
): Array<{ id: string; kind: "fixed" | "operable"; rect: SlabRect }> {
  const out: Array<{ id: string; kind: "fixed" | "operable"; rect: SlabRect }> = []
  for (const sk of layout.skylights ?? []) {
    const rect = skylightRect(sk)
    const resolved = resolveFlatHost(layout, rect)
    if (!resolved) continue
    if (resolved.kind !== host.kind) continue
    if (resolved.kind === "zone-datar" && resolved.zoneId !== host.zoneId) continue
    out.push({ id: sk.id, kind: sk.kind, rect: clampToHost(rect, host) })
  }
  return out
}

/**
 * Lubang untuk SATU host: skylight yang ter-resolve ke host itu, ter-clamp.
 * (Fase C menambahkan rect room openToSky di fungsi ini juga.)
 */
export function roofHoleRectsFor(layout: DesignLayout, host: RoofHost): SlabRect[] {
  const out = skylightsOnHost(layout, host).map((s) => s.rect)
  // Courtyard (openToSky): lubang ruang terbuka yang mencapai bidang atap —
  // di-clip ke rect host (beda dgn skylight yang di-clamp utuh: lubang
  // courtyard boleh terpotong tepi atap).
  for (const c of courtyardRoofRooms(layout)) {
    const x0 = Math.max(c.rect.x, host.rect.x)
    const y0 = Math.max(c.rect.y, host.rect.y)
    const x1 = Math.min(c.rect.x + c.rect.width, host.rect.x + host.rect.width)
    const y1 = Math.min(c.rect.y + c.rect.depth, host.rect.y + host.rect.depth)
    if (x1 - x0 > 0.05 && y1 - y0 > 0.05) {
      out.push({ x: round2(x0), y: round2(y0), width: round2(x1 - x0), depth: round2(y1 - y0) })
    }
  }
  return out
}

/** Skylight yang TIDAK punya bidang datar (utk validasi warning). */
export function unresolvedSkylights(layout: DesignLayout): string[] {
  return (layout.skylights ?? [])
    .filter((sk) => !resolveFlatHost(layout, skylightRect(sk)))
    .map((sk) => sk.id)
}

/**
 * Luas skylight (m², ter-clamp) yang MENAUNGI sebuah ruang — kredit cahaya
 * zenithal utk audit pencahayaan. Hanya ruang di lantai teratas reguler
 * (bidang atap tepat di atasnya) yang menerima cahaya skylight.
 */
export function skylightAreaServingRoom(
  layout: DesignLayout,
  room: { floorId: string; x: number; y: number; width: number; depth: number },
): number {
  const topRegularId = topRegularFloorId(layout.floors)
  if (!topRegularId || room.floorId !== topRegularId) return 0
  let area = 0
  for (const host of flatRoofHosts(layout)) {
    for (const sk of skylightsOnHost(layout, host)) {
      const w =
        Math.min(room.x + room.width, sk.rect.x + sk.rect.width) -
        Math.max(room.x, sk.rect.x)
      const d =
        Math.min(room.y + room.depth, sk.rect.y + sk.rect.depth) -
        Math.max(room.y, sk.rect.y)
      if (w > 0 && d > 0) area += w * d
    }
  }
  return round2(area)
}

/** Ada bidang datar tepat di atas ruang ini (kandidat lokasi skylight)? */
export function roomUnderFlatRoof(
  layout: DesignLayout,
  room: { floorId: string; x: number; y: number; width: number; depth: number },
): boolean {
  const topRegularId = topRegularFloorId(layout.floors)
  if (!topRegularId || room.floorId !== topRegularId) return false
  return (
    resolveFlatHost(layout, {
      x: room.x,
      y: room.y,
      width: room.width,
      depth: room.depth,
    }) !== null
  )
}

/* ───────────────────────── Courtyard (openToSky) ────────────────────────── */

const OPEN_SKY_TYPES = new Set(["taman", "kolam", "void"])
const MIN_COURTYARD_M = 0.6
/** Lubang boleh digeser maksimal sejauh ini keluar rect ruangnya. */
const COURTYARD_MARGIN_M = 0.5

/** Rect lubang efektif sebuah ruang openToSky (user-editable; absen = rect ruang). */
export function courtyardRect(room: {
  x: number
  y: number
  width: number
  depth: number
  openToSkyRect?: { x: number; y: number; width: number; depth: number }
}): SlabRect {
  const r = room.openToSkyRect
  return r
    ? { x: r.x, y: r.y, width: r.width, depth: r.depth }
    : { x: room.x, y: room.y, width: room.width, depth: room.depth }
}

/** Clamp rect lubang courtyard: ⊆ rect ruang + margin 0.5 m, ukuran min 0.6. */
export function clampCourtyardRect(
  room: { x: number; y: number; width: number; depth: number },
  rect: SlabRect,
): SlabRect {
  const bx0 = room.x - COURTYARD_MARGIN_M
  const by0 = room.y - COURTYARD_MARGIN_M
  const bw = room.width + 2 * COURTYARD_MARGIN_M
  const bd = room.depth + 2 * COURTYARD_MARGIN_M
  const width = round2(Math.min(Math.max(rect.width, MIN_COURTYARD_M), bw))
  const depth = round2(Math.min(Math.max(rect.depth, MIN_COURTYARD_M), bd))
  const x = round2(Math.min(Math.max(rect.x, bx0), bx0 + bw - width))
  const y = round2(Math.min(Math.max(rect.y, by0), by0 + bd - depth))
  return { x, y, width, depth }
}

/**
 * Ruang courtyard yang lubangnya MENEMBUS BIDANG ATAP: ruang openToSky
 * (taman/kolam/void) di lantai teratas reguler, atau di floor-rooftop
 * (lubang di dak). Ruang openToSky lantai bawah hanya melubangi slab di
 * atasnya (build-model) — sampai rantainya (via void openToSky) mencapai atap.
 */
export function courtyardRoofRooms(
  layout: DesignLayout,
): Array<{ roomId: string; rect: SlabRect }> {
  const topRegularId = topRegularFloorId(layout.floors)
  return layout.rooms
    .filter(
      (r) =>
        r.openToSky === true &&
        OPEN_SKY_TYPES.has(r.type) &&
        (r.floorId === topRegularId || r.floorId === "floor-rooftop"),
    )
    .map((r) => ({ roomId: r.id, rect: clampCourtyardRect(r, courtyardRect(r)) }))
}

/**
 * Luas total (m²) lubang courtyard yang menembus bidang atap — dipakai RAB
 * (material atap & catchment resapan) dan lembar detail agar tak menagih/
 * menampung area yang terbuka ke langit. Di-clip ke footprint bangunan.
 */
export function openToSkyRoofHoleAreaM2(layout: DesignLayout): number {
  const fp = buildingFootprint(layout)
  if (!(fp.widthM > 0 && fp.depthM > 0)) return 0
  let area = 0
  for (const c of courtyardRoofRooms(layout)) {
    const x0 = Math.max(c.rect.x, fp.x0)
    const y0 = Math.max(c.rect.y, fp.y0)
    const x1 = Math.min(c.rect.x + c.rect.width, fp.x0 + fp.widthM)
    const y1 = Math.min(c.rect.y + c.rect.depth, fp.y0 + fp.depthM)
    if (x1 - x0 > 0 && y1 - y0 > 0) area += (x1 - x0) * (y1 - y0)
  }
  return round2(area)
}
