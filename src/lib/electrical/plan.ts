/**
 * Auto-generation of default electrical points per room type. Pure module —
 * no zustand/react — so it is unit-testable and callable from the store,
 * the AI action dispatcher, and (later) server code.
 *
 * Placement rules are pinned by the SP4 plan's Global Constraints
 * (docs/superpowers/plans/2026-07-04-sp4-instalasi-listrik.md):
 *
 * - `WALL_OFFSET_M = 0.3` inset from the room edges.
 * - Stopkontak/stopkontak_daya/data are spread EVENLY along the BOTTOM wall
 *   (`y = room.y + WALL_OFFSET_M`); when there are more than 2 such points,
 *   the first 2 stay on the bottom wall and the remainder go on the RIGHT
 *   wall (`x = room.x + room.width − WALL_OFFSET_M`). "Evenly" = point i of
 *   n sits at fraction (i+1)/(n+1) of the wall length, so every point is
 *   strictly inside the room bbox.
 * - The switch (saklar_tunggal/ganda) goes at the inset corner NEAREST the
 *   room's first door (`layout.openings`, `type: "door"`, wallId
 *   `${roomId}:${side}` — see geometry's parseOpeningWall/openingSegment),
 *   or the bottom-left inset corner when the room has no door.
 * - Exactly 1 `panel` per HOUSE: added only when no panel exists anywhere,
 *   in the first non-void room of `layout.floors[0]`, at the bottom-left
 *   inset corner — and only when generating for that floor (or all floors).
 *
 * Idempotent: rooms that already have ANY electrical point are skipped, and
 * the existing array is prepended untouched (malformed entries from the
 * un-validated layout PUT are tolerated, never crashed on — carry-forward
 * from SP4 Task 1).
 */
import { nanoid } from "nanoid"

import type { DesignLayout, ElectricalPoint, ElectricalPointType, Opening, Room } from "@/types"
import { ELECTRICAL_DEFAULTS } from "@/lib/constants"
import { openingSegment, parseOpeningWall, round2 } from "@/lib/geometry"

/** Inset (m) from room edges for auto-placed points (SP4 Global Constraints). */
export const WALL_OFFSET_M = 0.3

/** Defaults for room types missing from ELECTRICAL_DEFAULTS (malformed data). */
const FALLBACK_DEFAULTS: (typeof ELECTRICAL_DEFAULTS)[keyof typeof ELECTRICAL_DEFAULTS] = {
  stopkontak: 1,
  saklar: "tunggal",
}

type XY = { x: number; y: number }

function makePoint(roomId: string, type: ElectricalPointType, at: XY): ElectricalPoint {
  return { id: `elec-${nanoid(8)}`, roomId, type, x: round2(at.x), y: round2(at.y) }
}

/** Room with finite, positive dimensions — anything else is skipped defensively. */
function isPlaceableRoom(room: Room): boolean {
  return (
    Number.isFinite(room.x) &&
    Number.isFinite(room.y) &&
    Number.isFinite(room.width) &&
    Number.isFinite(room.depth) &&
    room.width > 0 &&
    room.depth > 0
  )
}

/** Wall inset per axis, halved for rooms narrower than 2×WALL_OFFSET_M so
 *  points always stay strictly inside the bbox. */
function insets(room: Room): XY {
  return {
    x: Math.min(WALL_OFFSET_M, room.width / 2),
    y: Math.min(WALL_OFFSET_M, room.depth / 2),
  }
}

/** Even spread of n positions: bottom wall first, then (when n > 2) the
 *  remainder on the right wall. */
function wallPositions(room: Room, n: number): XY[] {
  const { x: ox, y: oy } = insets(room)
  const bottomCount = Math.min(n, 2)
  const rightCount = n - bottomCount
  const out: XY[] = []
  for (let i = 0; i < bottomCount; i++) {
    out.push({ x: room.x + (room.width * (i + 1)) / (bottomCount + 1), y: room.y + oy })
  }
  for (let i = 0; i < rightCount; i++) {
    out.push({ x: room.x + room.width - ox, y: room.y + (room.depth * (i + 1)) / (rightCount + 1) })
  }
  return out
}

/** The room's four inset corners, bottom-left first (deterministic tie-break). */
function insetCorners(room: Room): XY[] {
  const { x: ox, y: oy } = insets(room)
  return [
    { x: room.x + ox, y: room.y + oy },
    { x: room.x + room.width - ox, y: room.y + oy },
    { x: room.x + ox, y: room.y + room.depth - oy },
    { x: room.x + room.width - ox, y: room.y + room.depth - oy },
  ]
}

/** Inset corner nearest the room's first door, else the bottom-left corner. */
function switchPosition(room: Room, openings: Opening[]): XY {
  const corners = insetCorners(room)
  const door = openings.find(
    (o) => o && o.type === "door" && parseOpeningWall(o.wallId ?? "")?.roomId === room.id
  )
  if (!door) return corners[0]
  const side = parseOpeningWall(door.wallId)!.side
  const seg = openingSegment(room, side, door.positionM, door.widthM)
  const mid = { x: (seg.x1 + seg.x2) / 2, y: (seg.y1 + seg.y2) / 2 }
  let best = corners[0]
  let bestD = Number.POSITIVE_INFINITY
  for (const c of corners) {
    const d = (c.x - mid.x) ** 2 + (c.y - mid.y) ** 2
    if (d < bestD) {
      bestD = d
      best = c
    }
  }
  return best
}

/**
 * Returns a NEW array: the existing `layout.electrical` (untouched, malformed
 * entries included) + generated default points for every non-void room that
 * has NO existing point. `floorId` restricts generation to one floor.
 */
export function autoGenerateElectrical(layout: DesignLayout, floorId?: string): ElectricalPoint[] {
  const existing = Array.isArray(layout.electrical) ? layout.electrical : []
  const openings = Array.isArray(layout.openings) ? layout.openings : []

  const roomsWithPoints = new Set<string>()
  let hasPanel = false
  for (const p of existing) {
    if (!p || typeof p !== "object") continue
    if (typeof p.roomId === "string") roomsWithPoints.add(p.roomId)
    if (p.type === "panel") hasPanel = true
  }

  const generated: ElectricalPoint[] = []
  const rooms = layout.rooms.filter(
    (r): r is Room => Boolean(r) && (!floorId || r.floorId === floorId)
  )

  for (const room of rooms) {
    if (room.type === "void" || roomsWithPoints.has(room.id) || !isPlaceableRoom(room)) continue
    const defaults = ELECTRICAL_DEFAULTS[room.type] ?? FALLBACK_DEFAULTS

    const wallTypes: ElectricalPointType[] = [
      ...Array<ElectricalPointType>(Math.max(0, Math.floor(defaults.stopkontak ?? 0))).fill("stopkontak"),
      ...Array<ElectricalPointType>(Math.max(0, Math.floor(defaults.stopkontak_daya ?? 0))).fill("stopkontak_daya"),
      ...Array<ElectricalPointType>(Math.max(0, Math.floor(defaults.data ?? 0))).fill("data"),
    ]
    const positions = wallPositions(room, wallTypes.length)
    wallTypes.forEach((type, i) => generated.push(makePoint(room.id, type, positions[i])))

    if (defaults.saklar) {
      const type = defaults.saklar === "ganda" ? "saklar_ganda" : "saklar_tunggal"
      generated.push(makePoint(room.id, type, switchPosition(room, openings)))
    }
  }

  // Exactly 1 panel per house — only when none exists anywhere, only when
  // generating for the ground floor (floors[0]) or for all floors.
  const groundFloor = layout.floors[0]
  if (!hasPanel && groundFloor && (!floorId || floorId === groundFloor.id)) {
    const panelRoom = layout.rooms.find(
      (r) => Boolean(r) && r.floorId === groundFloor.id && r.type !== "void" && isPlaceableRoom(r)
    )
    if (panelRoom) {
      const { x: ox, y: oy } = insets(panelRoom)
      generated.push(
        makePoint(panelRoom.id, "panel", { x: panelRoom.x + ox, y: panelRoom.y + oy })
      )
    }
  }

  return [...existing, ...generated]
}
