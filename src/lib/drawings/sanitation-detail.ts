/**
 * Pure projections of a `DesignLayout` (+ the SP3 roof-catchment area) into
 * parametric SECTION `Drawing`s for the three land-level sanitation detail
 * sheets — septic tank, soakwell (sumur resapan) and control box (bak kontrol).
 * No DOM, no three.js — safe to unit test and reuse from SVG/PDF renderers.
 * Coordinates are in metres with y UP (the `Drawing` contract); each section's
 * origin is the bottom-left of the object, y = 0 at the base.
 *
 * Every dimension comes from the SNI-approach sizing in `water/sanitation.ts`
 * (T3), so these sheets stay bit-for-bit consistent with the RAB and the
 * land-object markers. Each calc sheet carries the MANDATORY SNI disclaimer
 * (verbatim, `SNI_DISCLAIMER`) as a `kind: "room"` label — the calculations are
 * a simplified approximation and must be verified by a licensed professional.
 *
 * Defensive (T1 carry-forward): `layout.rooms` comes from an un-validated PUT
 * (no zod), so the occupant/wet-room derivations tolerate malformed shapes.
 */
import type { DesignLayout } from "@/types"
import { round2 } from "@/lib/geometry"
import { PIPE_DIAMETER } from "@/lib/water/water"
import {
  occupantsOf,
  sizeSepticTank,
  sizeSoakwell,
  sizeControlBoxes,
  wetRoomCountOf,
} from "@/lib/water/sanitation"
import type { Drawing, DrawLine, DrawLabel, DimChain } from "./types"

/** Mandatory SNI disclaimer on every calc sheet (verbatim — SP5 Global Constraints). */
export const SNI_DISCLAIMER =
  "Perhitungan pendekatan berbasis SNI disederhanakan — wajib diverifikasi ahli plumbing/sanitasi berlisensi sebelum konstruksi."

/**
 * Shift + resize a `Drawing` so ALL of its geometry lands inside
 * `[0, widthM] × [0, heightM]`. `sheetPlacement` scales content assuming it
 * lies in that box and `SheetSvg` clips to it, so any line/label/dim at a
 * NEGATIVE coordinate (inlet/outlet stubs, dim chains, disclaimer labels) or
 * beyond the declared box would be CROPPED. We compute the true bbox across
 * every line endpoint, label point and dim-chain coordinate (a DimChain on
 * `axis:"x"` occupies y=`at` and x∈`points`; on `axis:"y"` it occupies x=`at`
 * and y∈`points`), then translate everything by `(-minX + M, -minY + M)` with a
 * small margin `M` and set widthM/heightM to the true extent + 2·M. Only
 * positions move — label TEXT is never touched. Shared by all four builders
 * (also imported by riser-diagram.ts) so the normalization is DRY.
 */
export function normalize(drawing: Drawing, margin = 0.3): Drawing {
  const xs: number[] = []
  const ys: number[] = []
  for (const l of drawing.lines) {
    xs.push(l.x1, l.x2)
    ys.push(l.y1, l.y2)
  }
  for (const lb of drawing.labels) {
    xs.push(lb.x)
    ys.push(lb.y)
  }
  for (const dc of drawing.dims) {
    if (dc.axis === "x") {
      ys.push(dc.at)
      xs.push(...dc.points)
    } else {
      xs.push(dc.at)
      ys.push(...dc.points)
    }
  }
  for (const lv of drawing.levels) ys.push(lv.y)

  if (xs.length === 0 || ys.length === 0) return drawing

  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const maxX = Math.max(...xs)
  const maxY = Math.max(...ys)
  const dx = -minX + margin
  const dy = -minY + margin

  return {
    ...drawing,
    widthM: round2(maxX - minX + 2 * margin),
    heightM: round2(maxY - minY + 2 * margin),
    lines: drawing.lines.map((l) => ({
      ...l,
      x1: round2(l.x1 + dx),
      y1: round2(l.y1 + dy),
      x2: round2(l.x2 + dx),
      y2: round2(l.y2 + dy),
    })),
    labels: drawing.labels.map((lb) => ({ ...lb, x: round2(lb.x + dx), y: round2(lb.y + dy) })),
    dims: drawing.dims.map((dc) => ({
      ...dc,
      at: round2(dc.at + (dc.axis === "x" ? dy : dx)),
      points: dc.points.map((p) => round2(p + (dc.axis === "x" ? dx : dy))),
    })),
    levels: drawing.levels.map((lv) => ({ ...lv, y: round2(lv.y + dy) })),
  }
}

/**
 * Septic-tank section (SNI 2398:2017 approach). A `lengthM × depthM` tank with
 * a dividing wall (2 chambers), an inlet + outlet stub, a cover slab and the
 * water line (1.5 m water depth). `roofArea` is unused (kept for signature
 * parity with the soakwell builder + sheet-list call site).
 */
export function buildSepticDetail(layout: DesignLayout, _roofArea: number): Drawing {
  void _roofArea
  const occupants = occupantsOf(layout)
  const { widthM, lengthM, depthM, capacity } = sizeSepticTank(occupants)
  const L = round2(lengthM)
  const D = round2(depthM)
  const dividerX = round2(L * 0.6) // first chamber ~60% (settling)
  const waterY = round2(Math.min(1.5, D)) // 1.5 m water depth

  const lines: DrawLine[] = [
    // Tank walls (section).
    { x1: 0, y1: 0, x2: L, y2: 0, kind: "outline" },
    { x1: L, y1: 0, x2: L, y2: D, kind: "outline" },
    { x1: L, y1: D, x2: 0, y2: D, kind: "outline" },
    { x1: 0, y1: D, x2: 0, y2: 0, kind: "outline" },
    // Dividing wall (2 chambers).
    { x1: dividerX, y1: 0, x2: dividerX, y2: D, kind: "cut" },
    // Water line.
    { x1: 0, y1: waterY, x2: L, y2: waterY, kind: "opening" },
    // Inlet stub (left, high) + outlet stub (right, slightly lower for fall).
    { x1: -0.4, y1: round2(D - 0.2), x2: 0, y2: round2(D - 0.2), kind: "opening" },
    { x1: L, y1: round2(D - 0.4), x2: round2(L + 0.4), y2: round2(D - 0.4), kind: "opening" },
    // Cover slab (with overhang).
    { x1: -0.1, y1: D, x2: round2(L + 0.1), y2: D, kind: "slab" },
  ]

  const labels: DrawLabel[] = [
    { x: round2(L * 0.28), y: round2(D * 0.5), text: "Ruang 1", kind: "room" },
    { x: round2(L * 0.78), y: round2(D * 0.5), text: "Ruang 2", kind: "room" },
    { x: -0.4, y: round2(D + 0.05), text: `Inlet Ø ${PIPE_DIAMETER.limbah}`, kind: "room" },
    // Outlet text runs RIGHT of the tank; the note rows at x=0 stack their
    // text from the tank's left wall → anchor "start" (x = left text edge).
    { x: round2(L + 0.1), y: round2(D - 0.3), text: `Outlet Ø ${PIPE_DIAMETER.limbah}`, kind: "room", anchor: "start" },
    { x: 0, y: round2(D + 0.4), text: `${occupants} penghuni · Kapasitas ${capacity} m³`, kind: "room", anchor: "start" },
    { x: 0, y: round2(D + 0.8), text: `Dimensi ${lengthM} × ${widthM} × ${depthM} m`, kind: "room", anchor: "start" },
    { x: 0, y: round2(D + 1.3), text: SNI_DISCLAIMER, kind: "room", anchor: "start" },
  ]

  const dims: DimChain[] = [
    { axis: "x", at: -0.5, points: [0, L] }, // lengthM
    { axis: "y", at: -0.5, points: [0, D] }, // depthM
    { axis: "x", at: round2(D + 1.7), points: [0, round2(widthM)] }, // widthM (plan)
  ]

  return normalize({
    widthM: round2(L + 4),
    heightM: round2(D + 2.2),
    lines,
    labels,
    dims,
    levels: [],
    title: "Detail Septic Tank",
  })
}

/**
 * Soakwell section (SNI 8456 approach) from the roof-catchment area. A
 * `diameter × depth` cylindrical well shown as a rectangle section, with
 * schematic gravel/fibre fill bands, perforated-wall marks, an inlet stub and
 * a cover slab. `layout` is unused (kept for signature parity).
 */
export function buildSoakwellDetail(_layout: DesignLayout, roofArea: number): Drawing {
  const { widthM, depthM, capacity } = sizeSoakwell(roofArea)
  const Dia = round2(widthM) // diameter
  const H = round2(depthM) // depth

  const lines: DrawLine[] = [
    // Well walls (section).
    { x1: 0, y1: 0, x2: Dia, y2: 0, kind: "outline" },
    { x1: Dia, y1: 0, x2: Dia, y2: H, kind: "outline" },
    { x1: Dia, y1: H, x2: 0, y2: H, kind: "outline" },
    { x1: 0, y1: H, x2: 0, y2: 0, kind: "outline" },
    // Cover slab (with overhang).
    { x1: -0.1, y1: H, x2: round2(Dia + 0.1), y2: H, kind: "slab" },
    // Inlet stub (left, high).
    { x1: -0.4, y1: round2(H - 0.2), x2: 0, y2: round2(H - 0.2), kind: "opening" },
  ]

  // Schematic layered fill: gravel bands low, fibre (ijuk) band above.
  const bandFracs = [0.2, 0.32, 0.44]
  for (const f of bandFracs) {
    const y = round2(H * f)
    lines.push({ x1: 0, y1: y, x2: Dia, y2: y, kind: "opening" })
  }
  const ijukY = round2(H * 0.56)
  lines.push({ x1: 0, y1: ijukY, x2: Dia, y2: ijukY, kind: "opening" })

  // Perforated-wall marks: short outward ticks on both walls.
  for (const f of [0.3, 0.5, 0.7]) {
    const y = round2(H * f)
    lines.push({ x1: 0, y1: y, x2: -0.08, y2: y, kind: "opening" })
    lines.push({ x1: Dia, y1: y, x2: round2(Dia + 0.08), y2: y, kind: "opening" })
  }

  const labels: DrawLabel[] = [
    { x: round2(Dia * 0.5), y: round2(H * 0.32), text: "Kerikil", kind: "room" },
    { x: round2(Dia * 0.5), y: round2(H * 0.56 + 0.1), text: "Ijuk", kind: "room" },
    { x: -0.4, y: round2(H + 0.05), text: "Inlet", kind: "room" },
    // Note rows: x=0 is the LEFT text edge (well's left wall) → anchor "start".
    { x: 0, y: round2(H + 0.4), text: `Kapasitas ${capacity} m³`, kind: "room", anchor: "start" },
    { x: 0, y: round2(H + 0.8), text: `Ø ${widthM} m · dalam ${depthM} m`, kind: "room", anchor: "start" },
    { x: 0, y: round2(H + 1.2), text: `Luas atap ${round2(roofArea)} m²`, kind: "room", anchor: "start" },
    { x: 0, y: round2(H + 1.7), text: SNI_DISCLAIMER, kind: "room", anchor: "start" },
  ]

  const dims: DimChain[] = [
    { axis: "x", at: -0.5, points: [0, Dia] }, // diameter
    { axis: "y", at: -0.5, points: [0, H] }, // depth
  ]

  return normalize({
    widthM: round2(Dia + 4),
    heightM: round2(H + 2.4),
    lines,
    labels,
    dims,
    levels: [],
    title: "Detail Sumur Resapan",
  })
}

/**
 * Control-box (bak kontrol) section — a fixed 0.4 × 0.4 × 0.5 m inspection box
 * with a cover, an invert channel and inlet/outlet stubs. The `count` (one per
 * wet room + one at the septic, per T3) is called out on the sheet.
 */
export function buildControlBoxDetail(layout: DesignLayout): Drawing {
  const { count, dims: box } = sizeControlBoxes(wetRoomCountOf(layout))
  const W = round2(box.lengthM) // section width along x (0.4)
  const H = round2(box.depthM) // 0.5

  const lines: DrawLine[] = [
    // Box walls (section).
    { x1: 0, y1: 0, x2: W, y2: 0, kind: "outline" },
    { x1: W, y1: 0, x2: W, y2: H, kind: "outline" },
    { x1: W, y1: H, x2: 0, y2: H, kind: "outline" },
    { x1: 0, y1: H, x2: 0, y2: 0, kind: "outline" },
    // Removable cover (with overhang).
    { x1: -0.05, y1: H, x2: round2(W + 0.05), y2: H, kind: "slab" },
    // Invert channel at the base.
    { x1: round2(W * 0.15), y1: 0.06, x2: round2(W * 0.85), y2: 0.06, kind: "opening" },
    // Inlet stub (left, high) + outlet stub (right, lower for fall).
    { x1: -0.3, y1: round2(H - 0.15), x2: 0, y2: round2(H - 0.15), kind: "opening" },
    { x1: W, y1: round2(H - 0.22), x2: round2(W + 0.3), y2: round2(H - 0.22), kind: "opening" },
  ]

  const labels: DrawLabel[] = [
    { x: -0.3, y: round2(H + 0.05), text: "Inlet", kind: "room" },
    // Outlet text runs RIGHT of the box; note rows at x=0 → anchor "start".
    { x: round2(W + 0.05), y: round2(H - 0.12), text: "Outlet", kind: "room", anchor: "start" },
    { x: round2(W * 0.5), y: 0.12, text: "Saluran", kind: "room" },
    { x: 0, y: round2(H + 0.4), text: `Jumlah bak: ${count}`, kind: "room", anchor: "start" },
    { x: 0, y: round2(H + 0.7), text: `Dimensi ${box.widthM} × ${box.lengthM} × ${box.depthM} m`, kind: "room", anchor: "start" },
    { x: 0, y: round2(H + 1.1), text: SNI_DISCLAIMER, kind: "room", anchor: "start" },
  ]

  const dims: DimChain[] = [
    { axis: "x", at: -0.3, points: [0, W] }, // widthM
    { axis: "y", at: -0.3, points: [0, H] }, // depthM
  ]

  return normalize({
    widthM: round2(W + 3),
    heightM: round2(H + 1.8),
    lines,
    labels,
    dims,
    levels: [],
    title: "Detail Bak Kontrol",
  })
}
