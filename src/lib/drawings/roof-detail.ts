/**
 * Pure projection of a `DesignLayout` into a `Drawing` for the "Detail Atap"
 * sheet — a parametric half-span roof section. No DOM, no three.js — safe to
 * unit test and reuse from SVG/PDF renderers. Coordinates are in meters with
 * y UP (the `Drawing` contract); y = 0 is the wall-top / eave level and x = 0
 * is the outer wall face, with the ridge at x = halfSpan.
 *
 * Sloped variant (pelana/limasan — the detail is identical for both, it cuts
 * across the slope): rafter line at the clamped `slopeDeg` from the eave tip
 * (−overhangM, 0) to the ridge (halfSpan, rise) — matching the 3D convention
 * where the eave TIP sits at wall-top level, so `rise = (halfSpan + ov) ·
 * tan(slopeDeg)` (Global Constraints) and the rafter's dy/dx is exactly
 * tan(slopeDeg). Plus a schematic king-post truss (bottom chord + king post +
 * 2 vertical webs), 3 gording cross-marks on the rafter, material/slope
 * labels and dim chains for overhang + ½ span (x) and rise (y).
 *
 * Datar variant: the flat build-up — structural slab (DRAW_SLAB_M), screed
 * and waterproofing layers, each labeled with a leader line.
 *
 * Roof params are read via elevation.ts's `effectiveRoof` (clamped reader:
 * slopeDeg 15–40, overhangM 0–1; absent roof = datar).
 */
import type { DesignLayout, RoofSpec } from "@/types"
import { round2 } from "@/lib/geometry"
import { ROOF_MATERIALS, ROOF_TYPES } from "@/lib/constants"
import {
  effectiveRoofCatchmentArea,
  effectiveRoofMaterialArea,
  hasExplicitRoofZones,
  projectRoofZonesPlan,
  roofZonePlanes,
} from "@/lib/exterior/roof-zones"
import { buildingFootprint } from "@/lib/structural/grid"
import {
  clampRooftopArea,
  deckAreaM2,
  isPartialRooftop,
  rooftopStrips,
  roofStripsAreaM2,
} from "@/lib/geometry/rooftop"
import { WALL_T } from "@/lib/three/build-model"
import { effectiveRoof, DRAW_SLAB_M } from "./elevation"
import type { Drawing, DrawLine, DrawLabel, DimChain } from "./types"

const ROOFTOP_FLOOR_ID = "floor-rooftop"
const TITLE = "Detail Atap"

/** Half-span fallback (m) when the layout has no rooms to measure. */
const FALLBACK_HALF_SPAN_M = 2
/** Depth (m) of the schematic wall stub drawn below the eave level. */
const WALL_STUB_M = 0.6
/** Half-size (m) of a gording cross-mark on the rafter. */
const GORDING_TICK_M = 0.08
/** Screed / waterproofing layer thicknesses (m) for the datar build-up. */
const SCREED_T_M = 0.05
const WATERPROOFING_T_M = 0.02

/** Two vertical lines marking the supporting wall below the eave level. */
function wallStub(): DrawLine[] {
  return [
    { x1: 0, y1: round2(-WALL_STUB_M), x2: 0, y2: 0, kind: "cut" },
    { x1: round2(WALL_T), y1: round2(-WALL_STUB_M), x2: round2(WALL_T), y2: 0, kind: "cut" },
  ]
}

function slopedDetail(roof: RoofSpec, halfSpan: number): Drawing {
  const ov = roof.overhangM
  const tanS = Math.tan((roof.slopeDeg * Math.PI) / 180)
  /** Height of the roof plane above the eave level at wall-relative x. */
  const rafterY = (x: number) => (x + ov) * tanS
  const rise = round2((halfSpan + ov) * tanS)

  const lines: DrawLine[] = [
    // Rafter / top chord: eave tip -> ridge, gradient tan(slopeDeg).
    { x1: round2(-ov), y1: 0, x2: round2(halfSpan), y2: rise, kind: "outline" },
    // Truss triangle: bottom chord (tie beam) + king post at the ridge.
    { x1: 0, y1: 0, x2: round2(halfSpan), y2: 0, kind: "outline" },
    { x1: round2(halfSpan), y1: 0, x2: round2(halfSpan), y2: rise, kind: "outline" },
    ...wallStub(),
  ]

  // 2 schematic web members: verticals from the bottom chord to the rafter.
  for (const x of [halfSpan / 3, (2 * halfSpan) / 3]) {
    lines.push({ x1: round2(x), y1: 0, x2: round2(x), y2: round2(rafterY(x)), kind: "opening" })
  }

  // 3 gording points on the rafter, marked as small crosses.
  const t = GORDING_TICK_M
  for (const f of [0.25, 0.5, 0.75]) {
    const gx = f * halfSpan
    const gy = rafterY(gx)
    lines.push({ x1: round2(gx - t), y1: round2(gy - t), x2: round2(gx + t), y2: round2(gy + t), kind: "opening" })
    lines.push({ x1: round2(gx - t), y1: round2(gy + t), x2: round2(gx + t), y2: round2(gy - t), kind: "opening" })
  }

  const labels: DrawLabel[] = [
    // Material above the upper half of the rafter.
    {
      x: round2(halfSpan * 0.75),
      y: round2(rafterY(halfSpan * 0.75) + 0.35),
      text: ROOF_MATERIALS[roof.material],
      kind: "room",
    },
    // Slope callout below the mid-rafter.
    {
      x: round2(halfSpan / 2),
      y: round2(rafterY(halfSpan / 2) - 0.35),
      text: `${round2(roof.slopeDeg)}°`,
      kind: "room",
    },
    { x: round2(halfSpan * 0.25), y: round2(rafterY(halfSpan * 0.25) + 0.35), text: "Gording", kind: "room" },
    { x: round2(halfSpan / 2), y: -0.3, text: "Kuda-kuda", kind: "room" },
  ]

  const dims: DimChain[] = [
    // Overhang + half-span along the bottom.
    { axis: "x", at: -0.9, points: [round2(-ov), 0, round2(halfSpan)] },
    // Rise beside the king post.
    { axis: "y", at: round2(halfSpan + 0.6), points: [0, rise] },
  ]

  return {
    widthM: round2(halfSpan + ov),
    heightM: round2(rise + 0.7), // headroom for the material label
    lines,
    labels,
    dims,
    levels: [],
    title: TITLE,
  }
}

function datarDetail(halfSpan: number): Drawing {
  const w = round2(halfSpan)
  const slabTop = round2(DRAW_SLAB_M)
  const screedTop = round2(DRAW_SLAB_M + SCREED_T_M)
  const wpTop = round2(DRAW_SLAB_M + SCREED_T_M + WATERPROOFING_T_M)
  const leaderX = round2(w + 0.8)
  // Layer notes START just right of the leader end (anchor "start" below) —
  // centring them at a far-off x let half the text swing back over the leader.
  const labelX = round2(w + 0.9)

  const lines: DrawLine[] = [
    // Structural slab rectangle.
    { x1: 0, y1: 0, x2: w, y2: 0, kind: "outline" },
    { x1: 0, y1: slabTop, x2: w, y2: slabTop, kind: "outline" },
    { x1: 0, y1: 0, x2: 0, y2: slabTop, kind: "outline" },
    { x1: w, y1: 0, x2: w, y2: slabTop, kind: "outline" },
    // Screed layer.
    { x1: 0, y1: screedTop, x2: w, y2: screedTop, kind: "opening" },
    { x1: 0, y1: slabTop, x2: 0, y2: screedTop, kind: "opening" },
    { x1: w, y1: slabTop, x2: w, y2: screedTop, kind: "opening" },
    // Waterproofing membrane on top.
    { x1: 0, y1: wpTop, x2: w, y2: wpTop, kind: "opening" },
    ...wallStub(),
    // Leader lines from each layer's right edge to its label.
    { x1: w, y1: round2(slabTop / 2), x2: leaderX, y2: 0.2, kind: "opening" },
    { x1: w, y1: round2((slabTop + screedTop) / 2), x2: leaderX, y2: 0.6, kind: "opening" },
    { x1: w, y1: wpTop, x2: leaderX, y2: 1, kind: "opening" },
  ]

  const labels: DrawLabel[] = [
    { x: labelX, y: 0.2, text: `Plat beton ${Math.round(DRAW_SLAB_M * 1000)} mm`, kind: "room", anchor: "start" },
    { x: labelX, y: 0.6, text: `Screed ${Math.round(SCREED_T_M * 1000)} mm`, kind: "room", anchor: "start" },
    { x: labelX, y: 1, text: "Lapisan waterproofing", kind: "room", anchor: "start" },
  ]

  const dims: DimChain[] = [
    { axis: "x", at: -0.4, points: [0, w] },
    { axis: "y", at: -0.4, points: [0, wpTop] },
  ]

  return {
    widthM: round2(w + 2.5), // room for the layer labels on the right
    heightM: 1.3,
    lines,
    labels,
    dims,
    levels: [],
    title: TITLE,
  }
}

/** Vertical gap (m) between the section detail and the roof-plan overview. */
const PLAN_GAP_M = 1.2
/** Diagonal hatch spacing (m) inside the deck rectangle. */
const HATCH_STEP_M = 0.6
/** Length (m) of a strip's slope-direction arrow. */
const SLOPE_ARROW_M = 0.5

/** A 4-line rectangle in the given draw kind. */
function rectLines(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  kind: DrawLine["kind"],
  refId?: string
): DrawLine[] {
  return [
    { x1: round2(x0), y1: round2(y0), x2: round2(x1), y2: round2(y0), kind, refId },
    { x1: round2(x0), y1: round2(y1), x2: round2(x1), y2: round2(y1), kind, refId },
    { x1: round2(x0), y1: round2(y0), x2: round2(x0), y2: round2(y1), kind, refId },
    { x1: round2(x1), y1: round2(y0), x2: round2(x1), y2: round2(y1), kind, refId },
  ]
}

/** A short arrow (shaft + 2 head strokes) from (x1,y1) to the tip (x2,y2). */
function slopeArrow(x1: number, y1: number, x2: number, y2: number): DrawLine[] {
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const h = 0.15 // arrowhead stroke length (m)
  // Rotate the (reversed) unit vector ±35° for the two head strokes.
  const head = (c: number, s: number): DrawLine => ({
    x1: round2(x2),
    y1: round2(y2),
    x2: round2(x2 - h * (ux * c - uy * s)),
    y2: round2(y2 - h * (uy * c + ux * s)),
    kind: "opening",
  })
  return [
    { x1: round2(x1), y1: round2(y1), x2: round2(x2), y2: round2(y2), kind: "opening" },
    head(0.819, 0.574),
    head(0.819, -0.574),
  ]
}

function explicitRoofZonePlan(
  layout: DesignLayout,
  oy: number
): { lines: DrawLine[]; labels: DrawLabel[]; dims: DimChain[]; widthM: number; heightM: number } {
  const fp = buildingFootprint(layout)
  const projections = projectRoofZonesPlan(layout)
  const planes = new Map(roofZonePlanes(layout).map((plane) => [plane.zoneId, plane]))

  const lx = (x: number) => round2(x - fp.x0)
  const ly = (y: number) => round2(y - fp.y0 + oy)

  const lines: DrawLine[] = []
  const labels: DrawLabel[] = []
  const dims: DimChain[] = []

  lines.push(...rectLines(lx(fp.x0), ly(fp.y0), lx(fp.x0 + fp.widthM), ly(fp.y0 + fp.depthM), "outline"))

  for (const projection of projections) {
    const [a, b, c] = projection.points
    const plane = planes.get(projection.refId)
    lines.push(...rectLines(lx(a.x), ly(a.y), lx(c.x), ly(c.y), "opening", projection.refId))
    labels.push({
      x: lx(projection.center.x),
      y: ly(projection.center.y),
      text: plane
        ? `Atap ${ROOF_TYPES[plane.kind]} — ${ROOF_MATERIALS[plane.materialId]} · ${round2(projection.materialAreaM2)} m²`
        : `${projection.label} · ${round2(projection.materialAreaM2)} m²`,
      kind: "room",
      refId: projection.refId,
    })

    if (plane?.ridgeAxis === "x") {
      lines.push({
        x1: lx(a.x),
        y1: ly(projection.center.y),
        x2: lx(b.x),
        y2: ly(projection.center.y),
        kind: "cut",
        refId: projection.refId,
      })
    } else if (plane?.ridgeAxis === "y") {
      lines.push({
        x1: lx(projection.center.x),
        y1: ly(a.y),
        x2: lx(projection.center.x),
        y2: ly(c.y),
        kind: "cut",
        refId: projection.refId,
      })
    }
  }

  const topY = ly(fp.y0 + fp.depthM)
  labels.push({
    x: lx(fp.x0),
    y: round2(topY + 0.9),
    text: `Jadwal zona atap (${projections.length} zona)`,
    kind: "title",
    anchor: "start",
  })
  labels.push({
    x: lx(fp.x0),
    y: round2(topY + 0.4),
    text: `Material ${round2(effectiveRoofMaterialArea(layout))} m² · Tangkapan ${round2(effectiveRoofCatchmentArea(layout))} m²`,
    kind: "room",
    anchor: "start",
  })

  dims.push(
    { axis: "x", at: round2(ly(fp.y0) - 0.4), points: [lx(fp.x0), lx(fp.x0 + fp.widthM)] },
    { axis: "y", at: round2(lx(fp.x0) - 0.4), points: [ly(fp.y0), ly(fp.y0 + fp.depthM)] }
  )

  return {
    lines,
    labels,
    dims,
    widthM: round2(fp.widthM + 2),
    heightM: round2(topY + 1.4),
  }
}

/**
 * Compact top-down roof PLAN overview for a partial rooftop, drawn ABOVE the
 * section detail (lifted by `oy`): the building-footprint outline, the deck
 * rectangle (light hatch + "Deck rooftop" label + w×d dimensions) and every
 * roof strip (rect + ridge centreline along its longer axis + a short
 * slope-direction arrow, for sloped roofs). Coordinates are footprint-local
 * (origin = footprint min corner). Schematic — plan orientation is not
 * load-bearing.
 */
function partialRoofPlan(
  layout: DesignLayout,
  oy: number
): { lines: DrawLine[]; labels: DrawLabel[]; dims: DimChain[]; widthM: number; heightM: number } {
  const fp = buildingFootprint(layout)
  const deck = clampRooftopArea(layout.rooftopArea!, fp)
  const strips = rooftopStrips(fp, deck)
  const roof = effectiveRoof(layout)
  const sloped = roof.type !== "datar"

  // Footprint-local mapping (subtract the min corner, lift by `oy`).
  const lx = (x: number) => round2(x - fp.x0)
  const ly = (y: number) => round2(y - fp.y0 + oy)

  const lines: DrawLine[] = []
  const labels: DrawLabel[] = []
  const dims: DimChain[] = []

  // Footprint outline.
  lines.push(...rectLines(lx(fp.x0), ly(fp.y0), lx(fp.x0 + fp.widthM), ly(fp.y0 + fp.depthM), "outline"))

  // Deck rectangle + light diagonal hatch (45°, clipped to the deck).
  const dxa = deck.x
  const dya = deck.y
  const dxb = deck.x + deck.width
  const dyb = deck.y + deck.depth
  lines.push(...rectLines(lx(dxa), ly(dya), lx(dxb), ly(dyb), "slab"))
  for (let hx = dxa + HATCH_STEP_M; hx < dxb - 0.01; hx += HATCH_STEP_M) {
    const span = Math.min(hx - dxa, deck.depth)
    lines.push({
      x1: lx(hx),
      y1: ly(dya),
      x2: lx(hx - span),
      y2: ly(dya + span),
      kind: "opening",
    })
  }
  labels.push({ x: lx(dxa + deck.width / 2), y: ly(dya + deck.depth / 2), text: "Deck rooftop", kind: "room" })
  dims.push(
    { axis: "x", at: round2(ly(dya) - 0.4), points: [lx(dxa), lx(dxb)] },
    { axis: "y", at: round2(lx(dxa) - 0.4), points: [ly(dya), ly(dyb)] }
  )

  // Roof strips: rect + (sloped) ridge along the longer axis + slope arrow.
  for (const s of strips) {
    lines.push(...rectLines(lx(s.x), ly(s.y), lx(s.x + s.width), ly(s.y + s.depth), "opening"))
    if (!sloped) continue
    const cx = s.x + s.width / 2
    const cy = s.y + s.depth / 2
    if (s.width >= s.depth) {
      // Ridge horizontal (along x) at mid-depth; slope falls in +y.
      lines.push({ x1: lx(s.x), y1: ly(cy), x2: lx(s.x + s.width), y2: ly(cy), kind: "cut" })
      lines.push(...slopeArrow(lx(cx), ly(cy), lx(cx), ly(cy + Math.min(SLOPE_ARROW_M, s.depth / 2))))
    } else {
      // Ridge vertical (along y) at mid-width; slope falls in +x.
      lines.push({ x1: lx(cx), y1: ly(s.y), x2: lx(cx), y2: ly(s.y + s.depth), kind: "cut" })
      lines.push(...slopeArrow(lx(cx), ly(cy), lx(cx + Math.min(SLOPE_ARROW_M, s.width / 2)), ly(cy)))
    }
  }

  // Roof type / material label (shared by all strips) + area summary, above
  // the plan. x = footprint's LEFT edge = left text edge → anchor "start".
  const topY = ly(fp.y0 + fp.depthM)
  labels.push({
    x: lx(fp.x0),
    y: round2(topY + 0.9),
    text: `Atap ${ROOF_TYPES[roof.type]} — ${ROOF_MATERIALS[roof.material]}`,
    kind: "room",
    anchor: "start",
  })
  labels.push({
    x: lx(fp.x0),
    y: round2(topY + 0.4),
    text: `Deck ${deckAreaM2(layout)} m² · Atap ${roofStripsAreaM2(layout)} m²`,
    kind: "title",
    anchor: "start",
  })

  return {
    lines,
    labels,
    dims,
    widthM: round2(fp.widthM + 2),
    heightM: round2(topY + 1.4),
  }
}

/**
 * Builds the parametric "Detail Atap" drawing for a layout. The half-span is
 * measured from the footprint bounding box of the non-rooftop rooms — span is
 * the SHORTER footprint dimension (the one the slope crosses, per the ridge
 * convention) — falling back to a nominal width for an empty layout.
 *
 * For a PARTIAL rooftop (`isPartialRooftop`), a compact top-down roof plan
 * (deck + strips) is stacked ABOVE the section detail so the sheet shows the
 * deck-vs-roof layout. Full-rooftop / non-rooftop output is unchanged.
 */
export function buildRoofDetail(layout: DesignLayout): Drawing {
  const roof = effectiveRoof(layout)
  const rooms = layout.rooms.filter((r) => r.floorId !== ROOFTOP_FLOOR_ID)
  const totalW = rooms.reduce((m, r) => Math.max(m, r.x + r.width), 0)
  const totalD = rooms.reduce((m, r) => Math.max(m, r.y + r.depth), 0)
  const span = Math.min(totalW, totalD)
  const halfSpan = span > 0 ? round2(span / 2) : FALLBACK_HALF_SPAN_M

  const base = roof.type === "datar" ? datarDetail(halfSpan) : slopedDetail(roof, halfSpan)
  if (hasExplicitRoofZones(layout)) {
    const plan = explicitRoofZonePlan(layout, round2(base.heightM + PLAN_GAP_M))
    return {
      ...base,
      lines: [...base.lines, ...plan.lines],
      labels: [...base.labels, ...plan.labels],
      dims: [...base.dims, ...plan.dims],
      widthM: round2(Math.max(base.widthM, plan.widthM)),
      heightM: round2(Math.max(base.heightM, plan.heightM)),
    }
  }

  if (!isPartialRooftop(layout)) return base

  const plan = partialRoofPlan(layout, round2(base.heightM + PLAN_GAP_M))
  return {
    ...base,
    lines: [...base.lines, ...plan.lines],
    labels: [...base.labels, ...plan.labels],
    dims: [...base.dims, ...plan.dims],
    widthM: round2(Math.max(base.widthM, plan.widthM)),
    heightM: round2(Math.max(base.heightM, plan.heightM)),
  }
}
