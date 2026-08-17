/**
 * SNI-approach parametric sizing for land-level sanitation objects — septic
 * tank, soakwell (sumur resapan), and control boxes (bak kontrol). Pure
 * module — no react/zustand — so it is unit-testable and reusable from the
 * store, the AI action dispatcher, the sanitation-detail drawings (T5) and
 * the RAB (T9).
 *
 * Every formula is pinned VERBATIM by the SP5 plan's Global Constraints
 * (docs/superpowers/plans/2026-07-04-sp5-air-sanitasi.md):
 *
 * - `occupantsOf(layout) = max(4, bedroomCount × 2)`,
 *   bedroomCount = rooms of type "kamar_tidur".
 * - `sizeSepticTank(occupants)` (SNI 2398:2017 approach): Q = occupants·150 L;
 *   Vww = Q·3/1000; Vsludge = occupants·30·3/1000; V = round2(Vww+Vsludge);
 *   water depth 1.5 m → A = V/1.5; W = round2(√(A/2)); L = round2(2·W);
 *   depthM 1.8; capacity = V. (8 occupants → W 1.2 · L 2.4 · cap 4.32.)
 * - `sizeSoakwell(roofArea)` (SNI 8456 approach): Vr = round2(roofArea·0.05);
 *   H = 2.0; D = clamp(round2(√(4·Vr/(π·H))), 0.8, 1.4). (roofArea 70.4 →
 *   Vr 3.52 · D 1.4.)
 * - `sizeControlBoxes(wetRoomCount)`: count = wetRoomCount + 1; each box is
 *   0.4 × 0.4 × 0.5 m. A wet room is a room whose WATER_DEFAULTS contains a
 *   fixture whose WATER_SYSTEM is "kotor" or "limbah".
 * - `autoSizeSanitation(layout, roofArea, site)`: sizes + positions the three
 *   objects at their default lot positions, but ONLY those not already present
 *   in `layout.sanitation` (idempotent). Ids `sani-<nanoid8>`.
 *
 * DEVIATION (authorised by the task brief): `DesignLayout` carries no `Site`
 * (lot dims live on `Project.site`, mirrored by RAB via `project.site`), yet
 * the default-position formulas reference `site.widthM`/`site.depthM`. So
 * `autoSizeSanitation` takes an explicit `site: { widthM, depthM }` param
 * rather than reading it off the (site-less) layout.
 *
 * Defensive reads throughout: `layout.rooms`/`layout.sanitation` come from an
 * un-validated PUT (no zod), so malformed shapes are tolerated, never crashed
 * on (carry-forward from SP4/SP5 Task 1).
 */
import { nanoid } from "nanoid"

import type { DesignLayout, Room, RoomType, SanitationObject } from "@/types"
import { WATER_DEFAULTS } from "@/lib/constants"
import { WATER_SYSTEM } from "@/lib/water/water"
import { clamp, findFreeRect, rectsOverlap, round2, type Rect } from "@/lib/geometry"

const ROOFTOP_FLOOR_ID = "floor-rooftop"

/** Sizing-only dimensions (no id/position) for a tank-like object. */
type SizedObject = { widthM: number; lengthM: number; depthM: number; capacity: number }

/** Result of {@link autoSizeSanitation}: the three positioned objects, shaped
 *  to drop straight into `DesignLayout.sanitation`. */
export type SanitationSizing = {
  septicTank: SanitationObject
  soakwell: SanitationObject
  controlBoxes: SanitationObject[]
}

/** Occupant estimate: 2 per bedroom, floored at 4 (SP5 Global Constraints). */
export function occupantsOf(layout: DesignLayout): number {
  const rooms = Array.isArray(layout.rooms) ? layout.rooms : []
  const bedroomCount = rooms.filter((r) => r && r.type === "kamar_tidur").length
  return Math.max(4, bedroomCount * 2)
}

/** Septic tank size (SNI 2398:2017 approach) from the occupant count. */
export function sizeSepticTank(occupants: number): SizedObject {
  const qLitres = occupants * 150
  const vWastewater = (qLitres * 3) / 1000
  const vSludge = (occupants * 30 * 3) / 1000
  const v = round2(vWastewater + vSludge)
  const area = v / 1.5 // water depth 1.5 m
  const w = round2(Math.sqrt(area / 2))
  const l = round2(2 * w)
  return { widthM: w, lengthM: l, depthM: 1.8, capacity: v }
}

/** Soakwell size (SNI 8456 approach) from the roof (catchment) area in m². */
export function sizeSoakwell(roofArea: number): SizedObject {
  const vr = round2(roofArea * 0.05)
  const h = 2.0
  const d = clamp(round2(Math.sqrt((4 * vr) / (Math.PI * h))), 0.8, 1.4)
  return { widthM: d, lengthM: d, depthM: h, capacity: vr }
}

/** Control-box count + fixed dims: one per wet room plus one at the septic. */
export function sizeControlBoxes(wetRoomCount: number): {
  count: number
  dims: { widthM: number; lengthM: number; depthM: number }
} {
  return { count: wetRoomCount + 1, dims: { widthM: 0.4, lengthM: 0.4, depthM: 0.5 } }
}

/** A wet room type — one whose default fixtures include a "kotor"/"limbah"
 *  (grey/black) system fixture. Dry/supply-only room types return false. */
function isWetRoomType(type: RoomType): boolean {
  const defaults = WATER_DEFAULTS[type] ?? []
  return defaults.some((t) => {
    const system = WATER_SYSTEM[t]
    return system === "kotor" || system === "limbah"
  })
}

/** Count of wet rooms in the layout (defensive over malformed rooms). The
 *  single source of truth for the control-box count — reused by the sanitation
 *  DETAIL sheet builders (T5) so their box count can never drift from the
 *  sizing that `sizeControlBoxes`/`autoSizeSanitation` rely on here. */
export function wetRoomCountOf(layout: DesignLayout): number {
  const rooms = Array.isArray(layout.rooms) ? layout.rooms : []
  return rooms.filter((r): r is Room => Boolean(r) && isWetRoomType(r.type)).length
}

function isSanitationObject(v: unknown): v is SanitationObject {
  return Boolean(v) && typeof v === "object"
}

/** Build a positioned SanitationObject from sizing dims + a lot coordinate. */
function place(dims: SizedObject | { widthM: number; lengthM: number; depthM: number }, x: number, y: number): SanitationObject {
  const capacity = "capacity" in dims ? dims.capacity : undefined
  return {
    id: `sani-${nanoid(8)}`,
    x: round2(x),
    y: round2(y),
    widthM: dims.widthM,
    lengthM: dims.lengthM,
    depthM: dims.depthM,
    ...(capacity !== undefined ? { capacity } : {}),
  }
}

/** Footprint rects (top-left corner) of every room on a ground-level floor —
 *  the only rooms a yard fixture like a septic tank can physically conflict
 *  with. Defensive over malformed rooms/floors, same as the rest of this
 *  module. */
function groundFloorRoomRects(layout: DesignLayout): Rect[] {
  const floors = Array.isArray(layout.floors) ? layout.floors : []
  const groundIds = groundFloorIds(floors)
  const rooms = Array.isArray(layout.rooms) ? layout.rooms : []
  return rooms
    .filter((r): r is Room => Boolean(r) && groundIds.has(r.floorId))
    .map((r) => ({ x: r.x, y: r.y, width: r.width, depth: r.depth }))
}

/** Center-point rect of an already-placed sanitation object (for treating it
 *  as an obstacle for the NEXT one being placed). */
function sanitationRect(obj: { x: number; y: number; widthM: number; lengthM: number }): Rect {
  return { x: obj.x - obj.widthM / 2, y: obj.y - obj.lengthM / 2, width: obj.widthM, depth: obj.lengthM }
}

/**
 * Places a new sanitation object at `(fallbackCenterX, fallbackCenterY)` (the
 * SP5 default lot position) UNLESS that spot overlaps a ground-floor room or
 * another sanitation object already placed — in which case it searches for
 * the nearest free spot instead. Falls back to the original fixed position
 * if truly nothing else fits (no worse than the pre-fix behaviour).
 *
 * This is what was missing when septic tank/soakwell/control boxes landed
 * inside Ruang Tamu/Ruang Keluarga in production: the default formulas were
 * a fixed fraction of the lot size with zero awareness of what rooms already
 * occupy that fraction.
 */
function placeAvoidingObstacles(
  dims: SizedObject | { widthM: number; lengthM: number; depthM: number },
  fallbackCenterX: number,
  fallbackCenterY: number,
  obstacles: Rect[],
  site: { widthM: number; depthM: number }
): SanitationObject {
  const fallbackRect: Rect = {
    x: fallbackCenterX - dims.widthM / 2,
    y: fallbackCenterY - dims.lengthM / 2,
    width: dims.widthM,
    depth: dims.lengthM,
  }
  const tolerance = 0.01
  const withinSite =
    fallbackRect.x >= -tolerance &&
    fallbackRect.y >= -tolerance &&
    fallbackRect.x + fallbackRect.width <= site.widthM + tolerance &&
    fallbackRect.y + fallbackRect.depth <= site.depthM + tolerance
  if (withinSite && !obstacles.some((o) => rectsOverlap(fallbackRect, o))) {
    // The default lot position is already clear — use it verbatim (no
    // round-trip through findFreeRect's rounding, so this matches the
    // pre-fix numbers exactly whenever nothing actually changed).
    return place(dims, fallbackCenterX, fallbackCenterY)
  }

  const spot = findFreeRect({ width: dims.widthM, depth: dims.lengthM }, obstacles, site)
  if (spot) return place(dims, spot.x + dims.widthM / 2, spot.y + dims.lengthM / 2)

  // Nothing fits anywhere (e.g. the ground floor's rooms tile the entire
  // lot) — fall back to the original fixed position. Still overlapping, but
  // no worse than the pre-fix behaviour, and never throws.
  return place(dims, fallbackCenterX, fallbackCenterY)
}

/**
 * Sizes + positions the septic tank, soakwell and control boxes at their
 * default lot positions (SP5 Global Constraints), reusing any object already
 * present in `layout.sanitation` so the call is idempotent. Returns a fresh
 * object graph; the input layout is never mutated.
 *
 * @param roofArea catchment area (m²) — the SP3 roof-area formula's output.
 * @param site     lot dimensions (m); not carried on the site-less layout.
 */
export function autoSizeSanitation(
  layout: DesignLayout,
  roofArea: number,
  site: { widthM: number; depthM: number }
): SanitationSizing {
  const bag =
    layout.sanitation && typeof layout.sanitation === "object" ? layout.sanitation : {}
  const groundRects = groundFloorRoomRects(layout)

  // Septic — back yard, left quarter (unless a room is already there).
  const septicSize = sizeSepticTank(occupantsOf(layout))
  const septicTank = isSanitationObject(bag.septicTank)
    ? bag.septicTank
    : placeAvoidingObstacles(
        septicSize,
        site.widthM * 0.25,
        site.depthM - septicSize.lengthM / 2 - 0.5,
        groundRects,
        site
      )

  // Soakwell — back yard, right quarter (unless a room or the septic tank is
  // already there).
  const soakwellSize = sizeSoakwell(roofArea)
  const soakwell = isSanitationObject(bag.soakwell)
    ? bag.soakwell
    : placeAvoidingObstacles(
        soakwellSize,
        site.widthM * 0.75,
        site.depthM - soakwellSize.widthM / 2 - 0.5,
        [...groundRects, sanitationRect(septicTank)],
        site
      )

  // Control boxes — spread across the back, one per wet room + one at septic
  // (unless a room, the septic tank, the soakwell, or an earlier box is
  // already at that spot).
  const boxSpec = sizeControlBoxes(wetRoomCountOf(layout))
  const hasBoxes = Array.isArray(bag.controlBoxes) && bag.controlBoxes.length > 0
  const boxObstacles = [...groundRects, sanitationRect(septicTank), sanitationRect(soakwell)]
  const controlBoxes = hasBoxes
    ? bag.controlBoxes!
    : Array.from({ length: boxSpec.count }, (_, i) => {
        const box = placeAvoidingObstacles(
          boxSpec.dims,
          (site.widthM * (i + 1)) / (boxSpec.count + 1),
          site.depthM - 0.6,
          boxObstacles,
          site
        )
        boxObstacles.push(sanitationRect(box))
        return box
      })

  return { septicTank, soakwell, controlBoxes }
}

/** Shape needed to treat a sanitation bag as 2D obstacles — matches both
 *  `DesignLayout["sanitation"]` and the editor-assistant's structurally
 *  identical `FloorplanScene["sanitation"]` (kept as separate nominal types
 *  by each module), so this one helper works for both. */
export interface SanitationFootprintSource {
  septicTank?: { x: number; y: number; widthM: number; lengthM: number }
  soakwell?: { x: number; y: number; widthM: number; lengthM: number }
  controlBoxes?: { x: number; y: number; widthM: number; lengthM: number }[]
}

/** Which of the three sanitation object families an obstacle came from —
 *  they carry different real-world constraints when a room sits above them
 *  (desludging access vs. infiltration into open ground vs. just an
 *  inspection cover), so validation severities differ per kind. */
export type SanitationKind = "septic" | "soakwell" | "controlBox"

/**
 * Septic tank / soakwell / control boxes as top-left-corner `Rect`s (+ a
 * human label and `kind` each), for overlap-checking against room rectangles.
 *
 * Unlike rooms, a sanitation object's `(x, y)` is its CENTER, not its
 * top-left corner (see `plan-canvas.tsx`'s rendering — `x - widthM/2`,
 * `y - lengthM/2`) — this converts that so callers can reuse the same
 * `rectsOverlap`/`findFreeRect` used for rooms without re-deriving it.
 */
export function sanitationObstacles(
  sanitation: SanitationFootprintSource | undefined
): { rect: Rect; label: string; kind: SanitationKind }[] {
  if (!sanitation) return []
  const out: { rect: Rect; label: string; kind: SanitationKind }[] = []
  const add = (
    obj: { x: number; y: number; widthM: number; lengthM: number } | undefined,
    label: string,
    kind: SanitationKind
  ) => {
    if (!obj) return
    out.push({
      rect: { x: obj.x - obj.widthM / 2, y: obj.y - obj.lengthM / 2, width: obj.widthM, depth: obj.lengthM },
      label,
      kind,
    })
  }
  add(sanitation.septicTank, "septic tank", "septic")
  add(sanitation.soakwell, "sumur resapan", "soakwell")
  ;(sanitation.controlBoxes ?? []).forEach((box, i) => add(box, `bak kontrol ${i + 1}`, "controlBox"))
  return out
}

/**
 * Id(s) of the floor(s) resting on grade (lowest level, rooftop excluded) —
 * the only floor(s) whose rooms can physically conflict with ground-level
 * sanitation objects (the septic tank / soakwell / control boxes are yard
 * fixtures on the Site, not stacked underneath upper floors).
 */
export function groundFloorIds(floors: { id: string; level: number }[]): Set<string> {
  const regular = floors.filter((f) => f.id !== ROOFTOP_FLOOR_ID)
  if (regular.length === 0) return new Set()
  const minLevel = Math.min(...regular.map((f) => f.level))
  return new Set(regular.filter((f) => f.level === minLevel).map((f) => f.id))
}
