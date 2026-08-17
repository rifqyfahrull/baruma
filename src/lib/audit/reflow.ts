/**
 * Reflow solver — the "menata ulang denah" step the fix-all pipeline used to
 * refuse. When an undersized/too-narrow room can't grow because NEIGHBOURS
 * block it, this tries to *shrink the blocking neighbours* along one axis and
 * grow the deficient room into the vacated strip — but ONLY when every
 * neighbour stays fully compliant itself:
 *
 *   - a neighbour keeps its own SNI minimum area AND minimum short side
 *     (ROOM_STANDARDS), with an absolute floor of 1.2 m per side;
 *   - a neighbour that is ALREADY below its standard is never shrunk;
 *   - locked rooms and strips containing sanitation objects are untouched.
 *
 * Deterministic, pure, and sequential (each fix is applied to a running rect
 * map so later fixes see earlier ones) — same contract as auto-fix.ts.
 */
import type { RoomType } from "@/types"
import type { FloorplanAction, FloorplanScene } from "@/lib/assistant/actions"
import { round2, type Rect } from "@/lib/geometry"
import { sanitationObstaclesForFloor } from "@/lib/assistant/spatial-analysis"
import { ROOM_STANDARDS } from "./standards"

type SceneRoom = FloorplanScene["rooms"][number]
type Dir = "s" | "e" | "n" | "w"

const EPS = 0.02
const MIN_SIDE = 1.2

export type ReflowFix = {
  roomId: string
  roomName: string
  /** Names of the neighbours that were shrunk to make space. */
  movedNeighbors: string[]
  actions: Extract<FloorplanAction, { type: "updateRoom" }>[]
}

export type ReflowResult = {
  actions: FloorplanAction[]
  fixes: ReflowFix[]
  /** Deficient rooms that even reflow couldn't solve. */
  stillBlocked: SceneRoom[]
}

function overlaps1D(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 - EPS && a1 > b0 + EPS
}

function rectsIntersect(a: Rect, b: Rect): boolean {
  return overlaps1D(a.x, a.x + a.width, b.x, b.x + b.width) && overlaps1D(a.y, a.y + a.depth, b.y, b.y + b.depth)
}

/** The strip the room would newly occupy when growing `by` metres toward `dir`. */
function growthStrip(rect: Rect, dir: Dir, by: number): Rect {
  if (dir === "e") return { x: rect.x + rect.width, y: rect.y, width: by, depth: rect.depth }
  if (dir === "w") return { x: rect.x - by, y: rect.y, width: by, depth: rect.depth }
  if (dir === "s") return { x: rect.x, y: rect.y + rect.depth, width: rect.width, depth: by }
  return { x: rect.x, y: rect.y - by, width: rect.width, depth: by }
}

function grow(rect: Rect, dir: Dir, by: number): Rect {
  if (dir === "e") return { ...rect, width: rect.width + by }
  if (dir === "w") return { ...rect, x: rect.x - by, width: rect.width + by }
  if (dir === "s") return { ...rect, depth: rect.depth + by }
  return { ...rect, y: rect.y - by, depth: rect.depth + by }
}

/** Shrink `rect` so it no longer enters `strip` approached from `dir` (the
 *  deficient room grows toward `dir`; its neighbour must retreat the same way). */
function shrinkAwayFrom(rect: Rect, dir: Dir, strip: Rect): Rect {
  if (dir === "e") {
    const newX = strip.x + strip.width
    return { ...rect, x: newX, width: round2(rect.x + rect.width - newX) }
  }
  if (dir === "w") {
    return { ...rect, width: round2(strip.x - rect.x) }
  }
  if (dir === "s") {
    const newY = strip.y + strip.depth
    return { ...rect, y: newY, depth: round2(rect.y + rect.depth - newY) }
  }
  return { ...rect, depth: round2(strip.y - rect.y) }
}

/** Whether a room with this rect satisfies ITS OWN standard (or absolute floor). */
function meetsOwnStandard(room: SceneRoom, rect: Rect): boolean {
  const shortSide = Math.min(rect.width, rect.depth)
  if (shortSide + EPS < MIN_SIDE && room.type !== "void") return false
  const spec = ROOM_STANDARDS[room.type as RoomType]
  if (!spec) return true
  if (rect.width * rect.depth + 0.05 < spec.minAreaM2) return false
  if (shortSide + 0.02 < spec.minWidthM) return false
  return true
}

const ceil2 = (v: number) => Math.ceil(v * 100 - 1e-6) / 100

/** Deficits of a room against its standard (0 when compliant, within audit
 *  tolerance) — but the RAW gap, so growth targets are never undershot by
 *  double-discounted tolerances + round-down. */
function deficits(room: SceneRoom, rect: Rect): { area: number; shortSide: number } {
  const spec = ROOM_STANDARDS[room.type as RoomType]
  if (!spec) return { area: 0, shortSide: 0 }
  const area = rect.width * rect.depth
  const shortSide = Math.min(rect.width, rect.depth)
  const areaGap = spec.minAreaM2 - area
  const shortGap = spec.minWidthM - shortSide
  return {
    area: areaGap > 0.05 ? areaGap : 0,
    shortSide: shortGap > 0.02 ? shortGap : 0,
  }
}

/**
 * Candidate growth moves for one deficient room, smallest-change first:
 * width-deficit moves grow the SHORT axis; area-deficit moves try every
 * direction with exactly the metres needed to reach the minimum area.
 */
function candidateMoves(rect: Rect, def: { area: number; shortSide: number }): Array<{ dir: Dir; by: number }> {
  const moves: Array<{ dir: Dir; by: number }> = []
  if (def.shortSide > 0) {
    const alongWidth = rect.width <= rect.depth
    const by = ceil2(def.shortSide)
    if (alongWidth) moves.push({ dir: "e", by }, { dir: "w", by })
    else moves.push({ dir: "s", by }, { dir: "n", by })
  }
  if (def.area > 0) {
    for (const dir of ["s", "e", "n", "w"] as Dir[]) {
      const alongWidth = dir === "e" || dir === "w"
      const perp = alongWidth ? rect.depth : rect.width
      if (perp <= EPS) continue
      moves.push({ dir, by: ceil2(Math.max(def.area / perp, 0.1)) })
    }
  }
  return moves.sort((a, b) => a.by - b.by)
}

/** Collect reflow fixes for every deficient room the plain in-place enlargement
 *  couldn't handle. Operates on (and mutates a copy of) the CURRENT scene. */
export function reflowFixes(scene: FloorplanScene): ReflowResult {
  const actions: FloorplanAction[] = []
  const fixes: ReflowFix[] = []
  const stillBlocked: SceneRoom[] = []
  const currentById = new Map<string, Rect>(
    scene.rooms.map((r) => [r.id, { x: r.x, y: r.y, width: r.width, depth: r.depth }]),
  )

  for (const room of scene.rooms) {
    if (room.locked) continue
    const cur = currentById.get(room.id)!
    const def = deficits(room, cur)
    if (def.area <= 0 && def.shortSide <= 0) continue

    const sanitation = sanitationObstaclesForFloor(scene, room.floorId)
    const siblings = scene.rooms.filter((r) => r.floorId === room.floorId && r.id !== room.id)

    let solved = false
    // A room may need several passes (fix short side, then area) — bounded.
    for (let pass = 0; pass < 3 && !solved; pass++) {
      const rect = currentById.get(room.id)!
      const nowDef = deficits(room, rect)
      if (nowDef.area <= 0 && nowDef.shortSide <= 0) {
        solved = true
        break
      }

      let moved = false
      for (const move of candidateMoves(rect, nowDef)) {
        const strip = growthStrip(rect, move.dir, move.by)
        // Stay on the lot.
        if (strip.x < -EPS || strip.y < -EPS || strip.x + strip.width > scene.site.widthM + EPS || strip.y + strip.depth > scene.site.depthM + EPS) continue
        // Never bulldoze sanitation objects.
        if (sanitation.some((o) => rectsIntersect(strip, o))) continue

        const occupants = siblings.filter((n) => rectsIntersect(strip, currentById.get(n.id)!))
        // Every occupant must be shrinkable without breaking ITS standard.
        const shrunk: Array<{ n: SceneRoom; rect: Rect }> = []
        let viable = true
        for (const n of occupants) {
          if (n.locked) { viable = false; break }
          const nRect = currentById.get(n.id)!
          // Don't make an already-deficient room worse.
          if (!meetsOwnStandard(n, nRect)) { viable = false; break }
          const nNew = shrinkAwayFrom(nRect, move.dir, strip)
          if (nNew.width <= EPS || nNew.depth <= EPS || !meetsOwnStandard(n, nNew)) { viable = false; break }
          shrunk.push({ n, rect: nNew })
        }
        if (!viable) continue

        // Commit the move: neighbours retreat, the deficient room grows.
        const grown = grow(rect, move.dir, move.by)
        const roundedGrown: Rect = { x: round2(grown.x), y: round2(grown.y), width: round2(grown.width), depth: round2(grown.depth) }
        const moveActions: Extract<FloorplanAction, { type: "updateRoom" }>[] = []
        for (const { n, rect: nNew } of shrunk) {
          currentById.set(n.id, nNew)
          moveActions.push({ type: "updateRoom", roomId: n.id, patch: { x: round2(nNew.x), y: round2(nNew.y), width: round2(nNew.width), depth: round2(nNew.depth) } })
        }
        currentById.set(room.id, roundedGrown)
        moveActions.push({ type: "updateRoom", roomId: room.id, patch: { x: roundedGrown.x, y: roundedGrown.y, width: roundedGrown.width, depth: roundedGrown.depth } })

        actions.push(...moveActions)
        const existing = fixes.find((f) => f.roomId === room.id)
        const movedNames = shrunk.map((s) => s.n.name)
        if (existing) {
          existing.movedNeighbors = [...new Set([...existing.movedNeighbors, ...movedNames])]
          existing.actions.push(...moveActions)
        } else {
          fixes.push({ roomId: room.id, roomName: room.name, movedNeighbors: movedNames, actions: moveActions })
        }
        moved = true
        break
      }
      if (!moved) break
    }

    const finalDef = deficits(room, currentById.get(room.id)!)
    if (finalDef.area > 0 || finalDef.shortSide > 0) {
      // Partial progress still counts; only report as blocked when a deficit remains.
      stillBlocked.push(room)
    }
  }

  return { actions, fixes, stillBlocked }
}

export type OverlapReconcileResult = {
  actions: FloorplanAction[]
  /** Pairs [roomIdA, roomIdB] successfully separated. */
  resolvedPairs: [string, string][]
  /** Pairs where no safe fix was found within the displacement bound. */
  stillBlocked: [string, string][]
}

type Axis = "x" | "y"

/** Fraction of a room's own short side it may be displaced by, at most —
 *  keeps the reconciler from silently making large, surprising layout
 *  changes; anything bigger is left for the LLM revision / clarify path. */
const MAX_DISPLACEMENT_RATIO = 0.3

function overlapAmount(a: Rect, b: Rect): { axis: Axis; amount: number } | null {
  const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const overlapY = Math.min(a.y + a.depth, b.y + b.depth) - Math.max(a.y, b.y)
  if (overlapX <= EPS || overlapY <= EPS) return null
  return overlapX <= overlapY ? { axis: "x", amount: overlapX } : { axis: "y", amount: overlapY }
}

/** Slack above a room's own SNI minimum area — bigger slack, safer to shrink.
 *  Rooms with no standard (void, gudang, taman, ...) sort first (Infinity). */
function roomSlack(room: SceneRoom, rect: Rect): number {
  const spec = ROOM_STANDARDS[room.type as RoomType]
  if (!spec) return Infinity
  return rect.width * rect.depth - spec.minAreaM2
}

/** Shrink `mover` away from `anchor` along `axis` by `by` metres — the edge
 *  nearer the overlap recedes; the far edge is fixed, so the room's
 *  footprint only shrinks, never relocates into new territory. */
function pushAway(mover: Rect, anchor: Rect, axis: Axis, by: number): Rect {
  if (axis === "x") {
    return mover.x < anchor.x
      ? { ...mover, width: round2(mover.width - by) }
      : { ...mover, x: round2(mover.x + by), width: round2(mover.width - by) }
  }
  return mover.y < anchor.y
    ? { ...mover, depth: round2(mover.depth - by) }
    : { ...mover, y: round2(mover.y + by), depth: round2(mover.depth - by) }
}

function withinBounds(rect: Rect, site: { widthM: number; depthM: number }): boolean {
  return (
    rect.x >= -EPS &&
    rect.y >= -EPS &&
    rect.x + rect.width <= site.widthM + EPS &&
    rect.y + rect.depth <= site.depthM + EPS
  )
}

/** Try to separate one overlapping pair. Returns the single room that moved
 *  (with its corrected rect), or null when neither candidate is safe. */
function resolvePairOverlap(
  a: SceneRoom,
  rectA: Rect,
  b: SceneRoom,
  rectB: Rect,
  scene: FloorplanScene,
  sanitation: Rect[],
): { room: SceneRoom; rect: Rect } | null {
  const overlap = overlapAmount(rectA, rectB)
  if (!overlap) return null

  // Prefer moving whichever room has more slack above its own standard —
  // protect the room that's already closer to its SNI floor.
  const candidates = [
    { mover: a, moverRect: rectA, anchor: rectB, slack: roomSlack(a, rectA) },
    { mover: b, moverRect: rectB, anchor: rectA, slack: roomSlack(b, rectB) },
  ].sort((x, y) => y.slack - x.slack)

  for (const { mover, moverRect, anchor } of candidates) {
    if (mover.locked) continue
    const shortSide = Math.min(moverRect.width, moverRect.depth)
    if (overlap.amount > shortSide * MAX_DISPLACEMENT_RATIO) continue

    const moved = pushAway(moverRect, anchor, overlap.axis, overlap.amount)
    if (moved.width <= EPS || moved.depth <= EPS) continue
    if (!meetsOwnStandard(mover, moved)) continue
    if (!withinBounds(moved, scene.site)) continue
    if (sanitation.some((s) => rectsIntersect(moved, s))) continue

    return { room: mover, rect: moved }
  }
  return null
}

/**
 * Deterministic sibling of `reflowFixes`: where that solver grows ONE
 * undersized room by shrinking a neighbour, this one separates TWO rooms
 * that a proposal (usually the LLM's own) left overlapping each other.
 * Pure, synchronous, no DB/LLM — safe to run on every floorplan proposal
 * before ever asking the model to re-guess coordinates.
 */
export function reconcileOverlappingRooms(
  scene: FloorplanScene,
  proposedRooms: SceneRoom[],
): OverlapReconcileResult {
  const actions: FloorplanAction[] = []
  const resolvedPairs: [string, string][] = []
  const stillBlocked: [string, string][] = []
  const rectById = new Map<string, Rect>(
    proposedRooms.map((r) => [r.id, { x: r.x, y: r.y, width: r.width, depth: r.depth }]),
  )

  const byFloor = new Map<string, SceneRoom[]>()
  for (const room of proposedRooms) {
    const list = byFloor.get(room.floorId) ?? []
    list.push(room)
    byFloor.set(room.floorId, list)
  }

  for (const [floorId, list] of byFloor) {
    const sanitation = sanitationObstaclesForFloor(scene, floorId)
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]
        const b = list[j]
        const rectA = rectById.get(a.id)!
        const rectB = rectById.get(b.id)!
        if (!rectsIntersect(rectA, rectB)) continue

        const fixed = resolvePairOverlap(a, rectA, b, rectB, scene, sanitation)
        if (fixed) {
          rectById.set(fixed.room.id, fixed.rect)
          actions.push({
            type: "updateRoom",
            roomId: fixed.room.id,
            patch: { x: fixed.rect.x, y: fixed.rect.y, width: fixed.rect.width, depth: fixed.rect.depth },
          })
          resolvedPairs.push([a.id, b.id])
        } else {
          stillBlocked.push([a.id, b.id])
        }
      }
    }
  }

  return { actions, resolvedPairs, stillBlocked }
}
