/**
 * Pure projection of a `DesignLayout` into a `Drawing` (tampak / elevation).
 * No DOM, no three.js — safe to unit test and reuse from SVG/PDF renderers.
 *
 * Projection conventions (pinned — see docs/superpowers/plans/2026-07-03-sp1-tampak-potongan.md):
 *   h (horizontal axis of the drawing) per side: s → x · n → totalW−x (mirror)
 *   · w → y · e → totalD−y. `positionM` on an opening matches build-model.ts's
 *   `openingSegment` exactly (center of the opening along the wall, measured
 *   from room.x for n/s walls and room.y for w/e walls).
 */
import type { DesignLayout, RoofSpec, Room } from "@/types"
import {
  clamp,
  round2,
  openingSegment,
  parseOpeningWall,
  rectsOverlap,
  roomsAdjacentOnSide,
} from "@/lib/geometry"
import { floorElevations } from "@/lib/geometry/vertical"
import { effectiveRoof } from "@/lib/geometry/roof"
import { formatElevation } from "@/lib/format"
import { OPEN_TYPES, WALL_H } from "@/lib/three/build-model"
import { effectiveLamps } from "@/lib/three/lamps"
import { facadeCladdingById } from "@/lib/three/facade-claddings"
import { parseFacadeKey } from "@/lib/three/facade-bands"
import { buildingFootprint, type BuildingFootprint } from "@/lib/structural/grid"
import { floorOffset } from "@/lib/editor/floors"
import {
  effectiveRoofZones,
  hasExplicitRoofZones,
  type EffectiveRoofZone,
} from "@/lib/exterior/roof-zones"
import {
  clampRooftopArea,
  expandStripForOverhang,
  isPartialRooftop,
  rooftopStrips,
  type RooftopArea,
} from "@/lib/geometry/rooftop"
import type { Drawing, DrawLine, DrawLabel, LevelMark, DimChain } from "./types"
import { projectExteriorElevation } from "@/lib/exterior/projection"
import { exteriorElementBoundingBox } from "@/lib/exterior/geometry"

export type ElevationSide = "n" | "s" | "e" | "w"

export const WINDOW_SILL_M = 0.9
export const DRAW_SLAB_M = 0.15
/** Railing height (m) drawn on a rooftop deck's projected edge. Mirrors the
 *  3D `railH = 1.0` in build-model.ts so the sheets and the model agree. */
export const DRAW_RAIL_M = 1.0
/** Tinggi bidang bawah slab kanopi carport (m) — paritas `canopyH` build-model. */
export const DRAW_CANOPY_M = 2.5
/** Tebal slab kanopi carport (m) — paritas args kanopi 0.12 di build-model. */
const CANOPY_T_M = 0.12
/** Inset tiang kanopi dari sudut carport (m) — paritas build-model. */
const POST_INSET_M = 0.15
/** Lebar tiang kanopi (m) — tiang 10×10 di 3D. */
const POST_W_M = 0.1
/** Pitch sirip louver band (m) — paritas `PITCH` build-model. */
const LOUVER_PITCH_M = 0.25
/** Tebal garis handrail di atas kaca railing balkon (m) — paritas railh 3D. */
const HANDRAIL_T_M = 0.05
/** Simbol lampu dinding eksterior: persegi kecil lebar×tinggi (m). */
const LAMP_W_M = 0.09
const LAMP_H_M = 0.24

const TOL = 0.05
const ROOFTOP_FLOOR_ID = "floor-rooftop"

const TITLES: Record<ElevationSide, string> = {
  n: "Tampak Utara",
  s: "Tampak Selatan",
  e: "Tampak Timur",
  w: "Tampak Barat",
}

function isOpenRoom(room: Room): boolean {
  return OPEN_TYPES.includes(room.type)
}

// Pembaca clamped `layout.roof` kini modul murni bersama `@/lib/geometry/roof`
// (satu sumber kebenaran dengan build-model.ts). Re-export agar pemakai lama
// (rab.ts, section.ts, roof-detail.ts, sheet-list.ts, sanitation-place.ts)
// tetap mengimpor dari sini tanpa perubahan.
export { effectiveRoof }

/**
 * Orthographic silhouette of a sloped roof for one drawing (elevation view or
 * section cut), in the drawing's own h/y coordinates. Shared by elevation.ts
 * and section.ts so both use the exact same numbers.
 *
 * Ridge convention (Global Constraints): ridge runs along the LONGER footprint
 * dimension; `span` is the shorter one; `rise = (span/2 + ov) · tan(slopeDeg)`.
 * The eave sits at `topY` (the top of the building silhouette) and extends
 * ±ov beyond the walls; the apex/ridge sits at `topY + rise`.
 *
 * - Ridge parallel to the h axis (the long facade): pelana projects a
 *   full-width rectangle of height rise; limasan projects a trapezoid whose
 *   top edge is the ridge — per T4's HipPyramid the ridge is inset by half
 *   the padded short dimension at each end, so its endpoints land at
 *   `crossExtent/2` and `hExtent − crossExtent/2` (length = hExtent −
 *   crossExtent, the overhang cancels), degenerating to a point (pyramid)
 *   for a square footprint.
 * - Ridge perpendicular to the h axis (viewing along the ridge / cutting
 *   across it): BOTH pelana and limasan project the same triangle — the hip's
 *   end face rises at the same slope, so it lies inside the gable triangle.
 */
export function roofProfile(opts: {
  /** Clamped roof spec (pass through `effectiveRoof`). Must not be datar. */
  roof: RoofSpec
  /** Wall extent along the drawing's horizontal axis. */
  hExtent: number
  /** Footprint extent along the axis pointing away from the viewer. */
  crossExtent: number
  /** Is the roof ridge parallel to the drawing's horizontal axis? */
  ridgeParallelToH: boolean
  /** y of the top of the building silhouette (the eave line). */
  topY: number
  /**
   * HANYA type "miring" (skillion): posisi sisi RENDAH relatif view —
   * "facing" = kemiringan melintang view (siluet = persegi setinggi rise);
   * "h0"/"h1" = kemiringan sepanjang sumbu h, sisi rendah di ujung tsb
   * (siluet = segitiga siku dgn sisi tinggi di ujung berlawanan). Default "facing".
   */
  skillionLowAt?: "h0" | "h1" | "facing"
  /**
   * Gable ASIMETRIS (pelana, view gable-end): posisi h apex dalam frame
   * 0..hExtent (SUDAH ter-mirror oleh caller). Absen = hExtent/2 (simetris).
   * Dipakai hanya di cabang segitiga (!ridgeParallelToH).
   */
  apexH?: number
}): { lines: DrawLine[]; apexY: number } {
  const { roof, hExtent, crossExtent, ridgeParallelToH, topY } = opts
  const ov = roof.overhangM
  const h0 = round2(-ov)
  const h1 = round2(hExtent + ov)
  const y0 = round2(topY)

  if (roof.type === "miring") {
    // Skillion: rise dari bentang PENUH searah kemiringan (bukan setengah).
    const lowAt = opts.skillionLowAt ?? "facing"
    const runSpan = (lowAt === "facing" ? crossExtent : hExtent) + 2 * ov
    const sRise = round2(runSpan * Math.tan((roof.slopeDeg * Math.PI) / 180))
    const sApexY = round2(topY + sRise)
    const sLines: DrawLine[] = [{ x1: h0, y1: y0, x2: h1, y2: y0, kind: "outline" }] // eave
    if (lowAt === "facing") {
      // Muka rendah/tinggi menghadap viewer: persegi penuh setinggi rise.
      sLines.push({ x1: h0, y1: y0, x2: h0, y2: sApexY, kind: "outline" })
      sLines.push({ x1: h1, y1: y0, x2: h1, y2: sApexY, kind: "outline" })
      sLines.push({ x1: h0, y1: sApexY, x2: h1, y2: sApexY, kind: "outline" })
    } else {
      const lowH = lowAt === "h0" ? h0 : h1
      const highH = lowAt === "h0" ? h1 : h0
      sLines.push({ x1: highH, y1: y0, x2: highH, y2: sApexY, kind: "outline" }) // muka sisi tinggi
      sLines.push({ x1: lowH, y1: y0, x2: highH, y2: sApexY, kind: "outline" }) // bidang miring
    }
    return { lines: sLines, apexY: sApexY }
  }

  const span = ridgeParallelToH ? crossExtent : hExtent
  const rise = round2((span / 2 + ov) * Math.tan((roof.slopeDeg * Math.PI) / 180))
  const apexY = round2(topY + rise)

  const lines: DrawLine[] = [{ x1: h0, y1: y0, x2: h1, y2: y0, kind: "outline" }] // eave

  if (!ridgeParallelToH) {
    // Gable-end view / cut across the ridge: triangle (pelana AND limasan).
    // Gable asimetris: apex digeser via opts.apexH (di-clamp dalam bentang).
    const apexH = round2(
      Math.min(
        hExtent - 0.05,
        Math.max(0.05, opts.apexH ?? hExtent / 2),
      ),
    )
    lines.push({ x1: h0, y1: y0, x2: apexH, y2: apexY, kind: "outline" })
    lines.push({ x1: h1, y1: y0, x2: apexH, y2: apexY, kind: "outline" })
  } else if (roof.type === "pelana") {
    // Long facade: full-width rectangle — ridge runs the whole padded length.
    lines.push({ x1: h0, y1: y0, x2: h0, y2: apexY, kind: "outline" })
    lines.push({ x1: h1, y1: y0, x2: h1, y2: apexY, kind: "outline" })
    lines.push({ x1: h0, y1: apexY, x2: h1, y2: apexY, kind: "outline" })
  } else {
    // Long facade, limasan: trapezoid (hip slopes at both ends).
    const ridgeStart = round2(crossExtent / 2)
    const ridgeEnd = round2(hExtent - crossExtent / 2)
    lines.push({ x1: h0, y1: y0, x2: ridgeStart, y2: apexY, kind: "outline" })
    lines.push({ x1: h1, y1: y0, x2: ridgeEnd, y2: apexY, kind: "outline" })
    if (ridgeEnd - ridgeStart > 1e-9) {
      lines.push({ x1: ridgeStart, y1: apexY, x2: ridgeEnd, y2: apexY, kind: "outline" })
    }
  }

  return { lines, apexY }
}

export type RoofZoneProfileProjection = {
  h0: number
  h1: number
  crossExtent: number
  include?: boolean
  /** Gable asimetris: posisi h ABSOLUT garis bubungan (frame sama dgn h0/h1),
   *  sudah ter-mirror oleh proyeksi caller. Absen = simetris. */
  ridgeH?: number
}

export function buildRoofZoneProfiles(
  layout: DesignLayout,
  opts: {
    topYForZone: (zone: EffectiveRoofZone) => number
    projectZone: (zone: EffectiveRoofZone) => RoofZoneProfileProjection
    ridgeParallelToH: (zone: EffectiveRoofZone) => boolean
    skillionLowAt?: (zone: EffectiveRoofZone) => "h0" | "h1" | "facing"
  }
): { lines: DrawLine[]; apexY: number } {
  const lines: DrawLine[] = []
  let apexY = 0

  for (const zone of effectiveRoofZones(layout)) {
    const projected = opts.projectZone(zone)
    if (projected.include === false) continue
    const h0 = round2(Math.min(projected.h0, projected.h1))
    const h1 = round2(Math.max(projected.h0, projected.h1))
    const hExtent = round2(h1 - h0)
    if (hExtent <= 0 || projected.crossExtent <= 0) continue

    const topY = opts.topYForZone(zone)
    if (zone.type === "datar") {
      const ov = zone.overhangM
      const y0 = round2(topY)
      const y1 = round2(topY + DRAW_SLAB_M)
      const lo = round2(h0 - ov)
      const hi = round2(h1 + ov)
      lines.push({ x1: lo, y1: y0, x2: hi, y2: y0, kind: "slab", refId: zone.id })
      lines.push({ x1: lo, y1, x2: hi, y2: y1, kind: "slab", refId: zone.id })
      apexY = Math.max(apexY, y1)
      continue
    }

    const { lines: profile, apexY: profileApexY } = roofProfile({
      roof: zone.roof,
      hExtent,
      crossExtent: projected.crossExtent,
      ridgeParallelToH: opts.ridgeParallelToH(zone),
      topY,
      skillionLowAt: opts.skillionLowAt?.(zone),
      apexH: projected.ridgeH === undefined ? undefined : round2(projected.ridgeH - h0),
    })
    lines.push(
      ...profile.map((line) => ({
        ...line,
        x1: round2(line.x1 + h0),
        x2: round2(line.x2 + h0),
        refId: zone.id,
      }))
    )
    apexY = Math.max(apexY, profileApexY)
  }

  return { lines, apexY: round2(apexY) }
}

/** A footprint-space rectangle projected onto a drawing's h-axis. */
type ProjectedRect = { h0: number; h1: number; crossExtent: number }

/** A projected strip piece: its drawn h-interval, apex, and pre-shifted lines. */
type StripPiece = {
  /** Ascending projected h-interval actually drawn for this strip. */
  lo: number
  hi: number
  /** Top of this piece's silhouette (topY for a flat slab). */
  apexY: number
  /** Sloped (via roofProfile) vs a flat slab (datar / narrow). */
  sloped: boolean
  lines: DrawLine[]
}

/**
 * Shared partial-rooftop roof band for BOTH tampak (elevation) and potongan
 * (section). Given the footprint + clamped deck rect + roof spec and a
 * projection descriptor for the current view/cut, emits the roof pieces:
 *
 * - **Deck**: a flat "slab" line at `topY` over the deck's projected span, plus
 *   a `DRAW_RAIL_M`-tall railing (two verticals + a top rail, `outline`) so it
 *   reads as an open walk-on deck.
 * - **Strips** (`rooftopStrips(footprint, deck)`): each expanded by the roof
 *   overhang ONLY on its footprint-touching sides (`expandStripForOverhang`).
 *   A strip whose RAW shorter side `< 1 m`, or a `datar` roof → a flat slab line
 *   (same as the deck, no railing). Otherwise `roofProfile` draws the sloped
 *   silhouette and every line is shifted to the strip's h-position.
 *
 * OVERHANG DOUBLE-COUNT AVOIDANCE: the 3D (build-model.ts) rises each strip by
 * `round2((min(ex.width, ex.depth) / 2) · tan(slope))`, where `ex` is the
 * ALREADY-overhang-expanded rect — the overhang is baked into `ex`. `roofProfile`
 * would ADD `overhangM` a second time (its `span/2 + ov` and its `-ov / hExtent+ov`
 * eaves). So strips are projected from `ex` and `roofProfile` is called with
 * `overhangM: 0`; its `span/2` then equals `min(ex.width, ex.depth) / 2` exactly,
 * making the 2D apex identical to the 3D rise. Because every `roofProfile`
 * silhouette is symmetric about its centre, shifting by the projected min edge
 * `h0` is correct even for mirrored (n/e) views.
 *
 * `includeRect` (section only) filters pieces to those the cut plane crosses;
 * elevation passes everything (default `true`).
 *
 * `mode: "elevation"` additionally collapses the strips to the outer SILHOUETTE
 * envelope: several strips project to the same / nested horizontal ranges at
 * different heights, so drawing every one paints overlapping silhouettes. Only
 * the sloped strips forming the upper envelope are kept (a sloped strip hidden
 * inside a taller-or-equal, wider sloped strip's h-range is dropped), and the
 * deck flat+railing is drawn only over the deck's h-range NOT occluded by a kept
 * sloped strip tall enough to hide the railing (a fully-interior deck therefore
 * shows no railing — it is behind the surrounding roof). Flat (datar / narrow)
 * strips sit at the eave: they neither hide nor are hidden by a silhouette, so
 * they are always drawn. `mode: "section"` (default) keeps every crossed piece —
 * a cut is a true cross-section, not a silhouette.
 *
 * `suppressDeckSlab` (FIX 3, v1): when a SOLID room shares the rooftop floor
 * (`hasRooftopBlock`), that block already renders the rooftop mass at `topY`, so
 * the deck's flat slab line there would duplicate the block's slab. Suppress it
 * (railing + strips still drawn). NOTE: v1 simplification — solid rooftop rooms
 * sitting inside a partial deck are not fully composited with the deck/strips.
 */
export function buildPartialRoof(opts: {
  footprint: BuildingFootprint
  deck: RooftopArea
  roof: RoofSpec
  topY: number
  /** Project a footprint rect onto the drawing's h-axis (ascending). */
  projectRect: (rect: { x: number; y: number; width: number; depth: number }) => ProjectedRect
  /** Is the ridge (runs along the strip's longer side) parallel to the h-axis? */
  ridgeParallelToH: (exWidth: number, exDepth: number) => boolean
  /** Draw a piece only if the cut crosses its RAW footprint rect (section). */
  includeRect?: (rect: { x: number; y: number; width: number; depth: number }) => boolean
  /** "elevation" applies the silhouette-envelope dedup + deck occlusion. */
  mode?: "elevation" | "section"
  /** Suppress the deck flat slab (a solid rooftop block already draws it). */
  suppressDeckSlab?: boolean
}): { lines: DrawLine[]; apexY: number } {
  const { footprint, deck, roof, topY, projectRect, ridgeParallelToH, includeRect, mode, suppressDeckSlab } = opts
  const include = includeRect ?? (() => true)
  const isElevation = mode === "elevation"
  /** Containment / zero-width tolerance for the envelope + deck subtraction. */
  const TOL_ENV = 1e-6
  const lines: DrawLine[] = []
  const y0 = round2(topY)
  const railTop = round2(topY + DRAW_RAIL_M)
  let apexY = y0

  // Build every crossed strip as a StripPiece (projected interval + lines + apex).
  const pieces: StripPiece[] = []
  for (const strip of rooftopStrips(footprint, deck)) {
    if (!include(strip)) continue
    const ex = expandStripForOverhang(strip, roof.overhangM)
    const { h0, h1, crossExtent } = projectRect(ex)
    const sh0 = round2(h0)
    const hi = round2(h1)
    const hExtent = round2(h1 - h0)
    const narrow = Math.min(strip.width, strip.depth) < 1.0

    // Miring per-strip = slab datar (selaras 3D: build-model merender strip
    // miring sebagai slab karena arah air per strip ambigu).
    if (roof.type === "datar" || roof.type === "miring" || narrow) {
      pieces.push({
        lo: sh0,
        hi,
        apexY: y0,
        sloped: false,
        lines: [{ x1: sh0, y1: y0, x2: hi, y2: y0, kind: "slab" }],
      })
      continue
    }

    const prof = roofProfile({
      roof: { ...roof, overhangM: 0 },
      hExtent,
      crossExtent,
      ridgeParallelToH: ridgeParallelToH(ex.width, ex.depth),
      topY,
    })
    pieces.push({
      lo: sh0,
      hi,
      apexY: prof.apexY,
      sloped: true,
      lines: prof.lines.map((l) => ({ ...l, x1: round2(l.x1 + sh0), x2: round2(l.x2 + sh0) })),
    })
  }

  // Elevation: keep only the sloped strips forming the upper silhouette envelope.
  // Sort tallest-first (then widest-first) so an already-kept strip is always
  // taller-or-equal; drop a strip whose h-interval is contained in a kept one.
  const keptSloped: StripPiece[] = []
  let drawnStrips = pieces
  if (isElevation) {
    const flat = pieces.filter((p) => !p.sloped)
    const sloped = pieces
      .filter((p) => p.sloped)
      .sort((a, b) => b.apexY - a.apexY || b.hi - b.lo - (a.hi - a.lo))
    for (const p of sloped) {
      const hidden = keptSloped.some((k) => k.lo - TOL_ENV <= p.lo && p.hi <= k.hi + TOL_ENV)
      if (!hidden) keptSloped.push(p)
    }
    drawnStrips = [...flat, ...keptSloped]
  }

  // Deck: flat slab (unless suppressed) + railing. In elevation the deck is
  // drawn only over the h-range NOT occluded by a kept sloped strip that rises
  // to at least the railing top (subtract those intervals); in section it is
  // drawn over its whole crossed span.
  const drawDeckOver = (a: number, b: number) => {
    if (b - a <= TOL_ENV) return
    const dh0 = round2(a)
    const dh1 = round2(b)
    if (!suppressDeckSlab) lines.push({ x1: dh0, y1: y0, x2: dh1, y2: y0, kind: "slab" })
    lines.push({ x1: dh0, y1: y0, x2: dh0, y2: railTop, kind: "outline" })
    lines.push({ x1: dh1, y1: y0, x2: dh1, y2: railTop, kind: "outline" })
    lines.push({ x1: dh0, y1: railTop, x2: dh1, y2: railTop, kind: "outline" })
    apexY = Math.max(apexY, railTop)
  }

  if (include(deck)) {
    const { h0, h1 } = projectRect(deck)
    const dLo = round2(h0)
    const dHi = round2(h1)
    if (isElevation) {
      const occluders = keptSloped
        .filter((k) => k.apexY >= railTop - TOL_ENV)
        .map((k) => [k.lo, k.hi] as [number, number])
        .sort((a, b) => a[0] - b[0])
      let cursor = dLo
      for (const [lo, hi] of occluders) {
        if (hi <= cursor) continue
        if (lo > cursor) drawDeckOver(cursor, Math.min(lo, dHi))
        cursor = Math.max(cursor, hi)
        if (cursor >= dHi) break
      }
      if (cursor < dHi) drawDeckOver(cursor, dHi)
    } else {
      drawDeckOver(dLo, dHi)
    }
  }

  // Strip pieces (kept envelope for elevation, every crossed piece for section).
  for (const p of drawnStrips) {
    lines.push(...p.lines)
    apexY = Math.max(apexY, p.apexY)
  }

  return { lines, apexY: round2(apexY) }
}

/** Project a single (x,y) point onto the drawing's horizontal axis. */
function toH(side: ElevationSide, x: number, y: number, totalW: number, totalD: number): number {
  switch (side) {
    case "s":
      return x
    case "n":
      return totalW - x
    case "w":
      return y
    case "e":
    default:
      return totalD - y
  }
}

/** Ascending [hStart, hEnd] for a room's footprint on the drawing's h-axis. */
function roomHRange(room: Room, side: ElevationSide, totalW: number, totalD: number): [number, number] {
  if (side === "s" || side === "n") {
    const a = toH(side, room.x, 0, totalW, totalD)
    const b = toH(side, room.x + room.width, 0, totalW, totalD)
    return a <= b ? [a, b] : [b, a]
  }
  const a = toH(side, 0, room.y, totalW, totalD)
  const b = toH(side, 0, room.y + room.depth, totalW, totalD)
  return a <= b ? [a, b] : [b, a]
}

/** Segmen tepi PENUH sebuah room pada sisi `side` (bentuk sama dgn openingSegment). */
function edgeSegment(room: Room, side: ElevationSide): { x1: number; y1: number; x2: number; y2: number } {
  switch (side) {
    case "n":
      return { x1: room.x, y1: room.y, x2: room.x + room.width, y2: room.y }
    case "s":
      return { x1: room.x, y1: room.y + room.depth, x2: room.x + room.width, y2: room.y + room.depth }
    case "w":
      return { x1: room.x, y1: room.y, x2: room.x, y2: room.y + room.depth }
    case "e":
    default:
      return { x1: room.x + room.width, y1: room.y, x2: room.x + room.width, y2: room.y + room.depth }
  }
}

/** Proyeksikan segmen dinding ke rentang-h MENAIK pada sheet (dibulatkan). */
function segHRange(
  side: ElevationSide,
  seg: { x1: number; y1: number; x2: number; y2: number },
  totalW: number,
  totalD: number
): [number, number] {
  const horizontal = side === "s" || side === "n"
  const a = horizontal ? toH(side, seg.x1, 0, totalW, totalD) : toH(side, 0, seg.y1, totalW, totalD)
  const b = horizontal ? toH(side, seg.x2, 0, totalW, totalD) : toH(side, 0, seg.y2, totalW, totalD)
  return [round2(Math.min(a, b)), round2(Math.max(a, b))]
}

/** Sort + merge overlapping/touching (within `tol`) intervals. */
function mergeIntervals(intervals: [number, number][], tol = TOL): [number, number][] {
  const sorted = intervals.slice().sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const [s, e] of sorted) {
    const last = merged[merged.length - 1]
    if (last && s <= last[1] + tol) {
      last[1] = Math.max(last[1], e)
    } else {
      merged.push([s, e])
    }
  }
  return merged
}

function overlap(a0: number, a1: number, b0: number, b1: number, tol = TOL): boolean {
  return a0 < b1 - tol && a1 > b0 + tol
}

/** Is an opening on room `room`'s wall (side === view) hidden behind a nearer solid room? */
function isOccluded(
  view: ElevationSide,
  room: Room,
  seg: { x1: number; y1: number; x2: number; y2: number },
  solids: Room[]
): boolean {
  for (const o of solids) {
    if (o.id === room.id) continue
    if (view === "s") {
      if (o.y >= room.y + room.depth - TOL && overlap(seg.x1, seg.x2, o.x, o.x + o.width)) return true
    } else if (view === "n") {
      if (o.y + o.depth <= room.y + TOL && overlap(seg.x1, seg.x2, o.x, o.x + o.width)) return true
    } else if (view === "w") {
      if (o.x + o.width <= room.x + TOL && overlap(seg.y1, seg.y2, o.y, o.y + o.depth)) return true
    } else {
      if (o.x >= room.x + room.width - TOL && overlap(seg.y1, seg.y2, o.y, o.y + o.depth)) return true
    }
  }
  return false
}

export function buildElevation(layout: DesignLayout, side: ElevationSide): Drawing {
  const roof = effectiveRoof(layout)
  const partial = isPartialRooftop(layout)
  const explicitRoofZones = hasExplicitRoofZones(layout)
  // Mezzanine bukan lantai penuh — dikeluarkan dari tumpukan tampak; tepi
  // platformnya digambar sebagai garis slab tersendiri (pass di akhir).
  const regularFloors = layout.floors
    .filter((f) => f.id !== ROOFTOP_FLOOR_ID && f.kind !== "mezzanine")
    .slice()
    .sort((a, b) => a.level - b.level)
  const rooftopFloor = layout.floors.find((f) => f.id === ROOFTOP_FLOOR_ID) ?? null

  const nonRooftopRooms = layout.rooms.filter((r) => r.floorId !== ROOFTOP_FLOOR_ID)
  const exteriorBounds = (layout.exteriorElements ?? [])
    .filter((element) => !element.hidden)
    .map(exteriorElementBoundingBox)
  const totalW = round2(Math.max(
    nonRooftopRooms.reduce((m, r) => Math.max(m, r.x + r.width), 0),
    ...exteriorBounds.map((bounds) => bounds.maxX),
  ))
  const totalD = round2(Math.max(
    nonRooftopRooms.reduce((m, r) => Math.max(m, r.y + r.depth), 0),
    ...exteriorBounds.map((bounds) => bounds.maxY),
  ))

  const lines: DrawLine[] = []
  const labels: DrawLabel[] = []
  const levels: LevelMark[] = []
  const dimPoints = new Set<number>()

  // Fase D: prefix-sum lokal diganti TABEL ELEVASI bersama (nilai identik —
  // keduanya membaca Floor.heightM) supaya 3D & gambar kerja satu sumber.
  const elevTable = floorElevations(layout.floors)
  const baseYByFloor = new Map<string, number>()
  let totalRegularHeight = 0
  for (const floor of regularFloors) {
    const e = elevTable.get(floor.id)
    baseYByFloor.set(floor.id, e?.baseY ?? totalRegularHeight)
    totalRegularHeight = (e?.baseY ?? totalRegularHeight) + (e?.floorToFloorM ?? floor.heightM)
  }

  const rooftopRooms = rooftopFloor ? layout.rooms.filter((r) => r.floorId === ROOFTOP_FLOOR_ID) : []
  const rooftopSolids = rooftopRooms.filter((r) => !isOpenRoom(r))
  const hasRooftopBlock = !!rooftopFloor && rooftopSolids.length > 0

  /** Draws one floor's silhouette/slab/opening geometry. Shared by regular floors + rooftop. */
  function drawFloor(floorId: string, baseY: number, heightM: number, isTopTransition: boolean, isTrueTop: boolean) {
    const top = baseY + heightM
    levels.push({ y: round2(baseY), label: formatElevation(round2(baseY), "m") })

    // Cantilever (CB4): geser massa lantai ber-offset pada koordinat site
    // sebelum diproyeksikan ke sumbu H. Tampak depan/belakang (s/n) → H=x →
    // pakai dx; tampak samping (w/e) → H=y → pakai dy — pemetaan diurus toH
    // dari koordinat ruang yang sudah digeser (mirror n/e ikut benar). Lantai
    // tanpa offset → objek ruang identik (output byte-identik pra-fitur).
    const thisFloor = layout.floors.find((f) => f.id === floorId)
    const o = floorOffset(thisFloor)
    const rawRooms = layout.rooms.filter((r) => r.floorId === floorId)
    const rooms =
      o.dx === 0 && o.dy === 0
        ? rawRooms
        : rawRooms.map((r) => ({ ...r, x: r.x + o.dx, y: r.y + o.dy }))
    const solids = rooms.filter((r) => !isOpenRoom(r))
    const merged = mergeIntervals(solids.map((r) => roomHRange(r, side, totalW, totalD)))

    for (const [h0, h1] of merged) {
      const rh0 = round2(h0)
      const rh1 = round2(h1)
      const rBase = round2(baseY)
      const rTop = round2(top)
      lines.push({ x1: rh0, y1: rBase, x2: rh0, y2: rTop, kind: "outline" })
      lines.push({ x1: rh1, y1: rBase, x2: rh1, y2: rTop, kind: "outline" })
      lines.push({ x1: rh0, y1: rBase, x2: rh1, y2: rBase, kind: "outline" })
      lines.push({ x1: rh0, y1: rTop, x2: rh1, y2: rTop, kind: "outline" })
      dimPoints.add(rh0)
      dimPoints.add(rh1)

      if (isTopTransition) {
        lines.push({ x1: rh0, y1: rBase, x2: rh1, y2: rBase, kind: "slab" })
      }
      // The flat roof-slab double line only exists for a datar roof; a sloped
      // roof replaces it with the profile drawn after the floors loop.
      if (isTrueTop && roof.type === "datar" && !explicitRoofZones) {
        lines.push({ x1: rh0, y1: rTop, x2: rh1, y2: rTop, kind: "slab" })
        lines.push({ x1: rh0, y1: round2(top + DRAW_SLAB_M), x2: rh1, y2: round2(top + DRAW_SLAB_M), kind: "slab" })
      }
    }

    // Split-level: a room's own floor offset draws an extra slab line.
    for (const r of solids) {
      const off = r.levelOffsetM ?? 0
      if (Math.abs(off) < 1e-9) continue
      const [h0, h1] = roomHRange(r, side, totalW, totalD)
      lines.push({ x1: round2(h0), y1: round2(baseY + off), x2: round2(h1), y2: round2(baseY + off), kind: "slab" })
    }

    // Openings hosted on this floor's rooms.
    for (const op of layout.openings.filter((o) => o.floorId === floorId)) {
      const parsed = parseOpeningWall(op.wallId)
      if (!parsed || parsed.side !== side) continue
      const room = rooms.find((r) => r.id === parsed.roomId)
      if (!room || isOpenRoom(room)) continue
      const seg = openingSegment(room, parsed.side, op.positionM, op.widthM)
      if (isOccluded(side, room, seg, solids)) continue

      const off = room.levelOffsetM ?? 0
      const sill = op.type === "door" ? 0 : WINDOW_SILL_M
      const yBottom = round2(baseY + off + sill)
      const yTop = round2(yBottom + op.heightM)

      const [h0, h1] = segHRange(side, seg, totalW, totalD)

      // TODO(bukaan-lengkung): op.archShape ("arch"/"capsule") masih digambar
      // sebagai rect persegi biasa di bawah — 2D belum menggambar siluet
      // lengkung (di luar scope commit ini, lihat pola poligon porthole di
      // bawah untuk pendekatan serupa bila digarap).
      // TODO(bukaan-trapesium): op.topSlopeM (tepi atas miring) juga masih
      // digambar rect persegi biasa di bawah — 2D belum mengikuti siluet
      // trapesium (di luar scope; 3D sudah, lihat topSlopeCornerFillPrims di
      // build-model.ts).
      //
      // Porthole (jendela bulat): gambar LINGKARAN, bukan rect, agar tampak
      // konsisten dengan 3D. Kontrak DrawLine tak punya primitive lingkaran/
      // arc, jadi diaproksimasi poligon tertutup 16 segmen — cukup halus pada
      // skala tampak 1:100. Diameter = min(widthM, heightM), berpusat di
      // tengah envelope bukaan (paritas visual 3D torus+disc).
      if (op.kind === "porthole") {
        const r = Math.min(op.widthM, op.heightM) / 2
        const hc = (h0 + h1) / 2
        const yc = (yBottom + yTop) / 2
        const SEGMENTS = 16
        for (let i = 0; i < SEGMENTS; i++) {
          const a0 = (i / SEGMENTS) * 2 * Math.PI
          const a1 = ((i + 1) / SEGMENTS) * 2 * Math.PI
          lines.push({
            x1: round2(hc + r * Math.cos(a0)),
            y1: round2(yc + r * Math.sin(a0)),
            x2: round2(hc + r * Math.cos(a1)),
            y2: round2(yc + r * Math.sin(a1)),
            kind: "opening",
          })
        }
        dimPoints.add(round2(hc - r))
        dimPoints.add(round2(hc + r))
        continue
      }

      lines.push({ x1: h0, y1: yBottom, x2: h1, y2: yBottom, kind: "opening" })
      lines.push({ x1: h0, y1: yTop, x2: h1, y2: yTop, kind: "opening" })
      lines.push({ x1: h0, y1: yBottom, x2: h0, y2: yTop, kind: "opening" })
      lines.push({ x1: h1, y1: yBottom, x2: h1, y2: yTop, kind: "opening" })
      dimPoints.add(h0)
      dimPoints.add(h1)
    }

    // ── Fitur fasad 3D pada tampak (paritas build-model.ts) ─────────────────
    // Hanya elemen yang MENGHADAP orientasi sheet ini yang digambar; occlusion
    // memakai aturan yang sama dengan openings (isOccluded vs solids sefloor).

    // 1. Louver band (facadeElements): persegi band + sirip vertikal pitch
    //    ~0,25 m pada sillHeightM..sillHeightM+heightM relatif lantai host.
    for (const fe of (layout.facadeElements ?? []).filter((f) => f.floorId === floorId)) {
      const parsed = parseOpeningWall(fe.wallId)
      if (!parsed || parsed.side !== side) continue
      const host = rooms.find((r) => r.id === parsed.roomId)
      if (!host || isOpenRoom(host)) continue
      const seg = openingSegment(host, parsed.side, fe.positionM, fe.widthM)
      if (isOccluded(side, host, seg, solids)) continue

      // Clamp band persis build-model: tinggi [0.3, wallH], sill
      // [0, wallH − tinggi] — wallH kini PER LANTAI host (tabel elevasi).
      const off = host.levelOffsetM ?? 0
      const hostWallH = elevTable.get(host.floorId)?.wallHM ?? WALL_H
      const bandH = clamp(fe.heightM, 0.3, hostWallH)
      const sillFe = clamp(fe.sillHeightM, 0, hostWallH - bandH)
      const yBottom = round2(baseY + off + sillFe)
      const yTop = round2(baseY + off + sillFe + bandH)
      const [h0, h1] = segHRange(side, seg, totalW, totalD)
      lines.push({ x1: h0, y1: yBottom, x2: h1, y2: yBottom, kind: "opening" })
      lines.push({ x1: h0, y1: yTop, x2: h1, y2: yTop, kind: "opening" })
      lines.push({ x1: h0, y1: yBottom, x2: h0, y2: yTop, kind: "opening" })
      lines.push({ x1: h1, y1: yBottom, x2: h1, y2: yTop, kind: "opening" })
      // Sirip: rumus count sama dengan build-model (min 2). Himpunan posisi
      // simetris terhadap tengah band, jadi aman untuk view cermin (n/e).
      const span = h1 - h0
      const count = Math.max(2, Math.floor(span / LOUVER_PITCH_M))
      for (let i = 0; i < count; i++) {
        const h = round2(h0 + ((i + 0.5) * span) / count)
        lines.push({ x1: h, y1: yBottom, x2: h, y2: yTop, kind: "opening" })
      }
    }

    // 2. Railing kaca balkon: sisi TERBUKA (aturan railg- build-model: tetangga
    //    balkon lain / ruang berdinding → tanpa railing) yang menghadap view
    //    ini — panel kaca 1,0 m di atas lantai balkon + garis handrail atas.
    for (const room of rooms) {
      if (room.type !== "balkon") continue
      const others = rooms.filter((r) => r.id !== room.id)
      const nb = roomsAdjacentOnSide(room, side, others)
      if (nb && (nb.type === "balkon" || !isOpenRoom(nb))) continue
      if (isOccluded(side, room, edgeSegment(room, side), solids)) continue
      const y0 = round2(baseY + (room.levelOffsetM ?? 0))
      const y1 = round2(y0 + DRAW_RAIL_M)
      const [h0, h1] = segHRange(side, edgeSegment(room, side), totalW, totalD)
      lines.push({ x1: h0, y1: y0, x2: h1, y2: y0, kind: "opening" })
      lines.push({ x1: h0, y1: y1, x2: h1, y2: y1, kind: "opening" })
      lines.push({ x1: h0, y1: y0, x2: h0, y2: y1, kind: "opening" })
      lines.push({ x1: h1, y1: y0, x2: h1, y2: y1, kind: "opening" })
      const railTop = round2(y1 + HANDRAIL_T_M)
      lines.push({ x1: h0, y1: railTop, x2: h1, y2: railTop, kind: "outline" })
    }

    // 3. Kanopi carport: slab tipis (tebal 0,12) di 2,5 m, menjorok 0,15 per
    //    sisi (args w+0.3 di 3D) + tiang 10×10 di sudut terbuka — skip bila
    //    tertutup ruang lantai atas (aturan cpr-/cpp- build-model).
    const fIdx = regularFloors.findIndex((f) => f.id === floorId)
    const floorAbove = fIdx >= 0 ? regularFloors[fIdx + 1] : undefined
    for (const room of rooms) {
      if (room.type !== "carport") continue
      const coveredAbove =
        !!floorAbove && layout.rooms.some((r) => r.floorId === floorAbove.id && rectsOverlap(r, room))
      if (coveredAbove) continue
      if (isOccluded(side, room, edgeSegment(room, side), solids)) continue
      const yBase = round2(baseY + (room.levelOffsetM ?? 0))
      const canopyY = round2(yBase + DRAW_CANOPY_M)
      const canopyTop = round2(canopyY + CANOPY_T_M)
      const [rh0, rh1] = segHRange(side, edgeSegment(room, side), totalW, totalD)
      lines.push({ x1: round2(rh0 - 0.15), y1: canopyY, x2: round2(rh1 + 0.15), y2: canopyY, kind: "slab" })
      lines.push({ x1: round2(rh0 - 0.15), y1: canopyTop, x2: round2(rh1 + 0.15), y2: canopyTop, kind: "slab" })

      const others = rooms.filter((r) => r.id !== room.id)
      const walled = (s: ElevationSide) => {
        const adj = roomsAdjacentOnSide(room, s, others)
        return !!adj && !isOpenRoom(adj)
      }
      const sideWalled = { n: walled("n"), s: walled("s"), w: walled("w"), e: walled("e") }
      const corners = [
        { x: room.x + POST_INSET_M, y: room.y + POST_INSET_M, skip: sideWalled.n || sideWalled.w },
        { x: room.x + room.width - POST_INSET_M, y: room.y + POST_INSET_M, skip: sideWalled.n || sideWalled.e },
        { x: room.x + POST_INSET_M, y: room.y + room.depth - POST_INSET_M, skip: sideWalled.s || sideWalled.w },
        { x: room.x + room.width - POST_INSET_M, y: room.y + room.depth - POST_INSET_M, skip: sideWalled.s || sideWalled.e },
      ]
      // Sudut depan & belakang jatuh pada h yang sama dalam proyeksi → dedup.
      const postHs = new Set<number>()
      for (const c of corners) {
        if (!c.skip) postHs.add(round2(toH(side, c.x, c.y, totalW, totalD)))
      }
      for (const h of postHs) {
        const p0 = round2(h - POST_W_M / 2)
        const p1 = round2(h + POST_W_M / 2)
        lines.push({ x1: p0, y1: yBase, x2: p0, y2: canopyY, kind: "outline" })
        lines.push({ x1: p1, y1: yBase, x2: p1, y2: canopyY, kind: "outline" })
      }
    }

    // 5. Keterangan cladding (layout.facade): label material di tengah bidang
    //    dinding TERLUAR (tak terhalang ruang lain) yang menghadap view ini.
    for (const [wallId, cladId] of Object.entries(layout.facade ?? {})) {
      // parseFacadeKey (bukan parseOpeningWall): key band `roomId:side@s-h`
      // ikut ter-parse — label band tidak drop diam-diam (split-facade F1).
      const parsed = parseFacadeKey(wallId)
      if (!parsed || parsed.side !== side) continue
      const room = rooms.find((r) => r.id === parsed.roomId)
      if (!room || isOpenRoom(room)) continue
      const clad = facadeCladdingById(cladId)
      if (!clad) continue
      if (isOccluded(side, room, edgeSegment(room, side), solids)) continue
      const [h0, h1] = segHRange(side, edgeSegment(room, side), totalW, totalD)
      const bandMidY = parsed.band
        ? (parsed.band.sillM + parsed.band.headM) / 2
        : heightM / 2
      labels.push({
        x: round2((h0 + h1) / 2),
        y: round2(baseY + (room.levelOffsetM ?? 0) + bandMidY),
        text: clad.label,
        kind: "room",
      })
    }
  }

  regularFloors.forEach((floor, idx) => {
    const baseY = baseYByFloor.get(floor.id)!
    const isTopRegular = idx === regularFloors.length - 1
    // A partial rooftop replaces the top floor's flat roof-slab with the deck +
    // strip pieces drawn below, so suppress the datar slab here when partial.
    drawFloor(floor.id, baseY, floor.heightM, idx > 0, isTopRegular && !hasRooftopBlock && !partial && !explicitRoofZones)
  })

  let peakY = totalRegularHeight
  if (rooftopFloor && hasRooftopBlock) {
    peakY = totalRegularHeight + rooftopFloor.heightM
    drawFloor(rooftopFloor.id, totalRegularHeight, rooftopFloor.heightM, true, true)
  }
  levels.push({ y: round2(peakY), label: formatElevation(round2(peakY), "m") })

  // 4. Lampu dinding eksterior (effectiveLamps — paritas lamps.ts) yang
  //    menghadap orientasi ini: simbol persegi kecil 0,09×0,24 m berpusat
  //    vertikal di mountH relatif lantai host lampu.
  for (const lamp of effectiveLamps(layout)) {
    if (lamp.kind !== "wall" || lamp.side !== side) continue
    const lampBase = baseYByFloor.get(lamp.floorId)
    if (lampBase === undefined) continue
    const h = toH(side, lamp.x, lamp.y, totalW, totalD)
    // Tepi kanan dijangkarkan ke tepi kiri yang sudah dibulatkan supaya lebar
    // simbol selalu tepat 0,09 (round2 dua sisi bisa menghasilkan 0,08/0,10).
    const h0 = round2(h - LAMP_W_M / 2)
    const h1 = round2(h0 + LAMP_W_M)
    const y0 = round2(lampBase + lamp.mountH - LAMP_H_M / 2)
    const y1 = round2(lampBase + lamp.mountH + LAMP_H_M / 2)
    lines.push({ x1: h0, y1: y0, x2: h1, y2: y0, kind: "outline" })
    lines.push({ x1: h0, y1: y1, x2: h1, y2: y1, kind: "outline" })
    lines.push({ x1: h0, y1: y0, x2: h0, y2: y1, kind: "outline" })
    lines.push({ x1: h1, y1: y0, x2: h1, y2: y1, kind: "outline" })
  }

  const exterior = projectExteriorElevation(layout.exteriorElements ?? [], {
    side,
    totalW,
    totalD,
    floorBaseY: baseYByFloor,
  })
  lines.push(...exterior.lines)
  exterior.dimPoints.forEach((point) => dimPoints.add(point))

  const drawingWidth = side === "s" || side === "n" ? totalW : totalD

  // Sloped roof: draw the profile on top of the silhouette. The h axis maps
  // to x for s/n views and to y for w/e views; the ridge runs along the
  // longer footprint dimension (x when totalW >= totalD, matching T4).
  let sheetTopY = round2(Math.max(peakY, exterior.topY))
  if (explicitRoofZones) {
    const hIsX = side === "s" || side === "n"
    const skillionLowAt = (zone: EffectiveRoofZone): "h0" | "h1" | "facing" => {
      const low = zone.lowSide ?? "s"
      return hIsX === (low === "n" || low === "s")
        ? "facing"
        : side === "s" ? (low === "w" ? "h0" : "h1")
        : side === "n" ? (low === "w" ? "h1" : "h0")
        : side === "w" ? (low === "n" ? "h0" : "h1")
        : low === "n" ? "h1" : "h0"
    }
    const { lines: roofLines, apexY } = buildRoofZoneProfiles(layout, {
      topYForZone: (zone) => {
        if (zone.floorId) {
          const baseY = baseYByFloor.get(zone.floorId)
          const floor = regularFloors.find((f) => f.id === zone.floorId)
          if (baseY !== undefined && floor) return round2(baseY + floor.heightM)
          if (zone.floorId === ROOFTOP_FLOOR_ID && rooftopFloor && hasRooftopBlock) {
            return round2(totalRegularHeight + rooftopFloor.heightM)
          }
        }
        return round2(peakY)
      },
      projectZone: (zone) => {
        const minX = zone.x - zone.widthM / 2
        const maxX = zone.x + zone.widthM / 2
        const minY = zone.y - zone.depthM / 2
        const maxY = zone.y + zone.depthM / 2
        // Gable asimetris: garis bubungan (tegak lurus ridge) diproyeksikan
        // ke h dgn mirror toH yang sama — dipakai hanya di view gable-end.
        const ro = zone.type === "pelana" ? (zone.ridgeOffsetM ?? 0) : 0
        if (hIsX) {
          const a = toH(side, minX, 0, totalW, totalD)
          const b = toH(side, maxX, 0, totalW, totalD)
          return {
            h0: Math.min(a, b),
            h1: Math.max(a, b),
            crossExtent: zone.depthM,
            ...(ro ? { ridgeH: toH(side, zone.x + ro, 0, totalW, totalD) } : {}),
          }
        }
        const a = toH(side, 0, minY, totalW, totalD)
        const b = toH(side, 0, maxY, totalW, totalD)
        return {
          h0: Math.min(a, b),
          h1: Math.max(a, b),
          crossExtent: zone.widthM,
          ...(ro ? { ridgeH: toH(side, 0, zone.y + ro, totalW, totalD) } : {}),
        }
      },
      ridgeParallelToH: (zone) => (hIsX ? zone.widthM >= zone.depthM : zone.depthM > zone.widthM),
      skillionLowAt,
    })
    lines.push(...roofLines)
    if (apexY > sheetTopY) {
      levels.push({ y: apexY, label: formatElevation(apexY, "m") })
      sheetTopY = apexY
    }
  } else if (partial) {
    // Partial rooftop: flat deck (+ railing) over the deck rect, roof strips
    // over the surrounding ring — same decomposition + rise math as the 3D.
    const footprint = buildingFootprint(layout)
    const deck = clampRooftopArea(layout.rooftopArea!, footprint)
    const { lines: roofLines, apexY } = buildPartialRoof({
      footprint,
      deck,
      roof,
      topY: totalRegularHeight,
      projectRect: (rect) => {
        if (side === "s" || side === "n") {
          const a = toH(side, rect.x, 0, totalW, totalD)
          const b = toH(side, rect.x + rect.width, 0, totalW, totalD)
          return { h0: Math.min(a, b), h1: Math.max(a, b), crossExtent: rect.depth }
        }
        const a = toH(side, 0, rect.y, totalW, totalD)
        const b = toH(side, 0, rect.y + rect.depth, totalW, totalD)
        return { h0: Math.min(a, b), h1: Math.max(a, b), crossExtent: rect.width }
      },
      ridgeParallelToH: (exW, exD) => (side === "s" || side === "n" ? exW >= exD : exD > exW),
      // Elevation draws the outer silhouette envelope (dedup hidden strips +
      // occlude the interior deck); a solid rooftop block already slabs topY.
      mode: "elevation",
      suppressDeckSlab: hasRooftopBlock,
    })
    lines.push(...roofLines)
    if (apexY > sheetTopY) {
      levels.push({ y: apexY, label: formatElevation(apexY, "m") })
      sheetTopY = apexY
    }
  } else if (roof.type !== "datar") {
    const hIsX = side === "s" || side === "n"
    // Skillion: posisi sisi RENDAH pada sumbu h drawing, mengikuti pemetaan
    // toH per view (s: h=x; n: h=totalW−x; w: h=y; e: h=totalD−y).
    const low = roof.lowSide ?? "s"
    const skillionLowAt: "h0" | "h1" | "facing" =
      hIsX === (low === "n" || low === "s")
        ? "facing"
        : side === "s" ? (low === "w" ? "h0" : "h1")
        : side === "n" ? (low === "w" ? "h1" : "h0")
        : side === "w" ? (low === "n" ? "h0" : "h1")
        : low === "n" ? "h1" : "h0"
    const wholeHExtent = hIsX ? totalW : totalD
    // Gable asimetris whole-building: mirror view n/e membalik arah h.
    const roSign = side === "s" || side === "w" ? 1 : -1
    const wholeRo = roof.type === "pelana" ? (roof.ridgeOffsetM ?? 0) : 0
    const { lines: roofLines, apexY } = roofProfile({
      roof,
      hExtent: wholeHExtent,
      crossExtent: hIsX ? totalD : totalW,
      ridgeParallelToH: hIsX ? totalW >= totalD : totalD > totalW,
      topY: peakY,
      skillionLowAt,
      ...(wholeRo ? { apexH: wholeHExtent / 2 + roSign * wholeRo } : {}),
    })
    lines.push(...roofLines)
    levels.push({ y: apexY, label: formatElevation(apexY, "m") })
    sheetTopY = apexY
  }

  lines.push({ x1: round2(-0.5), y1: 0, x2: round2(drawingWidth + 0.5), y2: 0, kind: "ground" })

  const dims: DimChain[] = [
    { axis: "x", at: -0.8, points: Array.from(dimPoints).sort((a, b) => a - b) },
  ]

  return {
    widthM: drawingWidth,
    heightM: sheetTopY,
    lines,
    labels,
    dims,
    levels,
    title: TITLES[side],
  }
}
