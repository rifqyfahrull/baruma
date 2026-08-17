/**
 * Deterministic auto-fixes derived from audit findings — the "and I can fix it"
 * half of the standards assistant (phase 2). Currently covers the highest-value,
 * always-safe fix: adding a daylight window to a habitable room that has none,
 * on a wall that actually faces outside. Pure + scene-based so it plugs into the
 * editor assistant's deterministic layer (no LLM, no credits) and can be unit
 * tested without a DB.
 *
 * Adding a window never introduces a room overlap, so unlike relocation/shrink
 * fixes it needs no propose→simulate→revise loop — it's unconditionally safe.
 */
import type { RoomType } from "@/types"
import type { FloorplanAction, FloorplanScene } from "@/lib/assistant/actions"
import { rectsOverlap, round2, type Rect } from "@/lib/geometry"
import { sanitationObstaclesForFloor } from "@/lib/assistant/spatial-analysis"
import { ROOM_STANDARDS } from "./standards"

type SceneRoom = FloorplanScene["rooms"][number]
export type Side = "n" | "e" | "s" | "w"

const HABITABLE_TYPES: Set<string> = new Set(
  Object.entries(ROOM_STANDARDS)
    .filter(([, spec]) => spec?.habitable)
    .map(([type]) => type),
)

/** A habitable room needs daylight if its type is habitable OR it is explicitly
 *  flagged requiresNaturalLight (and not explicitly opted out). */
export function needsDaylight(room: SceneRoom): boolean {
  if (room.requiresNaturalLight === false) return false
  return room.requiresNaturalLight === true || HABITABLE_TYPES.has(room.type)
}

/** True if the room already has at least one window opening. */
export function roomHasWindow(scene: FloorplanScene, roomId: string): boolean {
  return scene.openings.some((o) => o.roomId === roomId && o.type === "window")
}

const TOL = 0.05

/**
 * The best wall of `room` that touches the site boundary (so a window there
 * faces outside), plus the centered position along that wall. Preference order
 * s → n → e → w (long exterior walls first tends to read well and, in ID's
 * near-equatorial light, any orientation daylights fine). Null when the room is
 * landlocked (no exterior wall — can't add an exterior window).
 */
export function bestExteriorWindow(
  room: Pick<SceneRoom, "x" | "y" | "width" | "depth">,
  site: { widthM: number; depthM: number },
): { side: Side; positionM: number } | null {
  const onNorth = room.y <= TOL
  const onSouth = room.y + room.depth >= site.depthM - TOL
  const onWest = room.x <= TOL
  const onEast = room.x + room.width >= site.widthM - TOL

  if (onSouth) return { side: "s", positionM: round2(room.width / 2) }
  if (onNorth) return { side: "n", positionM: round2(room.width / 2) }
  if (onEast) return { side: "e", positionM: round2(room.depth / 2) }
  if (onWest) return { side: "w", positionM: round2(room.depth / 2) }
  return null
}

export type DaylightFix = {
  roomId: string
  roomName: string
  action: Extract<FloorplanAction, { type: "addOpening" }>
}

/** Every habitable, windowless room with an exterior wall, and the addOpening
 *  action that daylights it. Rooms that are landlocked (no exterior wall) are
 *  returned separately so the assistant can explain why it can't fix them. */
export function daylightFixes(scene: FloorplanScene): {
  fixes: DaylightFix[]
  landlocked: SceneRoom[]
} {
  const fixes: DaylightFix[] = []
  const landlocked: SceneRoom[] = []
  for (const room of scene.rooms) {
    if (!needsDaylight(room)) continue
    if (roomHasWindow(scene, room.id)) continue
    const spot = bestExteriorWindow(room, scene.site)
    if (!spot) {
      landlocked.push(room)
      continue
    }
    fixes.push({
      roomId: room.id,
      roomName: room.name,
      action: {
        type: "addOpening",
        roomId: room.id,
        side: spot.side,
        positionM: spot.positionM,
        openingType: "window",
      },
    })
  }
  return { fixes, landlocked }
}

/** Cast a room type string to RoomType-narrowed use where callers need it. */
export function isHabitableType(type: string): type is RoomType {
  return HABITABLE_TYPES.has(type)
}

/* ------------------------------------------------------------------ */
/* Room-size auto-fix — enlarge an undersized room into free space     */
/* ------------------------------------------------------------------ */

const EPS = 0.02
type Dir = "s" | "e" | "n" | "w"

function spanOverlaps(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 - EPS && a1 > b0 + EPS
}

/** Max distance `rect` can grow in `dir` before hitting an obstacle or the
 *  site boundary, measured against rect's CURRENT perpendicular span (so a
 *  half-blocking neighbour only limits the part it actually covers). */
function expandGap(rect: Rect, dir: Dir, obstacles: Rect[], site: { widthM: number; depthM: number }): number {
  const right = rect.x + rect.width
  const bottom = rect.y + rect.depth
  if (dir === "e") {
    let limit = site.widthM
    for (const o of obstacles) {
      if (o.x + EPS >= right && spanOverlaps(rect.y, bottom, o.y, o.y + o.depth)) limit = Math.min(limit, o.x)
    }
    return Math.max(0, limit - right)
  }
  if (dir === "w") {
    let limit = 0
    for (const o of obstacles) {
      if (o.x + o.width - EPS <= rect.x && spanOverlaps(rect.y, bottom, o.y, o.y + o.depth)) limit = Math.max(limit, o.x + o.width)
    }
    return Math.max(0, rect.x - limit)
  }
  if (dir === "s") {
    let limit = site.depthM
    for (const o of obstacles) {
      if (o.y + EPS >= bottom && spanOverlaps(rect.x, right, o.x, o.x + o.width)) limit = Math.min(limit, o.y)
    }
    return Math.max(0, limit - bottom)
  }
  // n
  let limit = 0
  for (const o of obstacles) {
    if (o.y + o.depth - EPS <= rect.y && spanOverlaps(rect.x, right, o.x, o.x + o.width)) limit = Math.max(limit, o.y + o.depth)
  }
  return Math.max(0, rect.y - limit)
}

function grow(rect: Rect, dir: Dir, by: number): Rect {
  if (dir === "e") return { ...rect, width: rect.width + by }
  if (dir === "w") return { ...rect, x: rect.x - by, width: rect.width + by }
  if (dir === "s") return { ...rect, depth: rect.depth + by }
  return { ...rect, y: rect.y - by, depth: rect.depth + by }
}

/**
 * Grow `room` to reach `targetArea` by expanding into adjacent free space,
 * one verified direction at a time (never shrinking below the original, never
 * overlapping an obstacle, staying on the lot). Returns the enlarged rect, or
 * null when the surrounding space can't accommodate the target — exactly the
 * "would need to move a neighbour" case a human architect must judge.
 */
export function enlargeRoomToTarget(
  room: Rect,
  targetArea: number,
  obstacles: Rect[],
  site: { widthM: number; depthM: number },
): Rect | null {
  let rect: Rect = { ...room }
  const dirs: Dir[] = ["s", "e", "n", "w"]
  let guard = 0
  while (rect.width * rect.depth + EPS < targetArea && guard++ < 40) {
    let grew = false
    for (const dir of dirs) {
      if (rect.width * rect.depth + EPS >= targetArea) break
      const gap = expandGap(rect, dir, obstacles, site)
      if (gap <= EPS) continue
      const alongWidth = dir === "e" || dir === "w"
      const needed = alongWidth
        ? targetArea / rect.depth - rect.width
        : targetArea / rect.width - rect.depth
      const by = Math.min(gap, Math.max(needed, 0.1))
      if (by <= EPS) continue
      rect = grow(rect, dir, by)
      grew = true
    }
    if (!grew) break
  }
  if (rect.width * rect.depth + EPS < targetArea) return null
  const out: Rect = { x: round2(rect.x), y: round2(rect.y), width: round2(rect.width), depth: round2(rect.depth) }
  // Final safety: the rounded rect must clear every obstacle and stay on lot.
  if (out.x < -EPS || out.y < -EPS || out.x + out.width > site.widthM + EPS || out.y + out.depth > site.depthM + EPS) return null
  if (obstacles.some((o) => rectsOverlap(out, o))) return null
  return out
}

export type RoomSizeFix = {
  roomId: string
  roomName: string
  fromAreaM2: number
  toAreaM2: number
  action: Extract<FloorplanAction, { type: "updateRoom" }>
}

/** Every room below its per-type SNI minimum area that can be safely enlarged
 *  in place, plus the ones that can't (blocked — need rearranging first).
 *  Processed sequentially: each enlargement is applied to a running rect map
 *  so later rooms treat already-grown rooms as obstacles — two rooms can never
 *  both expand into the same pocket and end up overlapping when applied. */
export function roomSizeFixes(scene: FloorplanScene): { fixes: RoomSizeFix[]; blocked: SceneRoom[] } {
  const fixes: RoomSizeFix[] = []
  const blocked: SceneRoom[] = []
  const currentById = new Map<string, Rect>(
    scene.rooms.map((r) => [r.id, { x: r.x, y: r.y, width: r.width, depth: r.depth }]),
  )

  for (const room of scene.rooms) {
    const spec = ROOM_STANDARDS[room.type as RoomType]
    if (!spec) continue
    const cur = currentById.get(room.id)!
    const area = cur.width * cur.depth
    if (area + 0.05 >= spec.minAreaM2) continue

    const obstacles: Rect[] = scene.rooms
      .filter((r) => r.floorId === room.floorId && r.id !== room.id)
      .map((r) => currentById.get(r.id)!)
    obstacles.push(...sanitationObstaclesForFloor(scene, room.floorId))

    const enlarged = enlargeRoomToTarget(cur, spec.minAreaM2, obstacles, scene.site)
    if (!enlarged) {
      blocked.push(room)
      continue
    }
    currentById.set(room.id, enlarged)
    fixes.push({
      roomId: room.id,
      roomName: room.name,
      fromAreaM2: round2(area),
      toAreaM2: round2(enlarged.width * enlarged.depth),
      action: { type: "updateRoom", roomId: room.id, patch: { x: enlarged.x, y: enlarged.y, width: enlarged.width, depth: enlarged.depth } },
    })
  }
  return { fixes, blocked }
}
