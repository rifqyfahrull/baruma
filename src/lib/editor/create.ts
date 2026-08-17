/** Pure constructors for new rooms/floors created in the editor. */
import { nanoid } from "nanoid"

import type { Floor, Room, RoomType } from "@/types"
import { ROOM_TYPES } from "@/lib/constants"
import { clamp, roomArea, round2 } from "@/lib/geometry"
import { DEFAULT_FLOOR_TO_FLOOR_M } from "@/lib/geometry/vertical";

export const MIN_ROOM = 1.2

/**
 * Default square footprint for a brand-new room of `type`, derived from its
 * catalog area (`ROOM_TYPES[type].defaultAreaM2`) and snapped to the nearest
 * 0.5 m per side (floored at `MIN_ROOM`). This is the single source of truth
 * for "how big is a new room before the user resizes it" — shared by the
 * interactive click-to-place tool (`makeRoom` below) and the server-side
 * assistant (simulation + auto-placement in `lib/server/editor-assistant.ts`
 * and `lib/assistant/deterministic.ts`) so a predicted size never drifts from
 * what actually gets created.
 */
export function defaultRoomSize(type: RoomType): { width: number; depth: number } {
  const side = Math.max(MIN_ROOM, Math.round(Math.sqrt(ROOM_TYPES[type].defaultAreaM2) * 2) / 2)
  return { width: side, depth: side }
}

export function makeRoom(
  type: RoomType,
  x: number,
  y: number,
  floorId: string,
  site: { widthM: number; depthM: number },
  snap?: (v: number) => number
): Room {
  const defaultSize = defaultRoomSize(type)
  const width = round2(clamp(defaultSize.width, MIN_ROOM, site.widthM))
  const depth = round2(clamp(defaultSize.depth, MIN_ROOM, site.depthM))
  const sx = snap ? snap(x) : x
  const sy = snap ? snap(y) : y
  return {
    id: `room-${nanoid(8)}`,
    floorId,
    name: ROOM_TYPES[type].label,
    type,
    x: round2(clamp(sx, 0, Math.max(0, site.widthM - width))),
    y: round2(clamp(sy, 0, Math.max(0, site.depthM - depth))),
    width,
    depth,
    areaM2: roomArea(width, depth),
  }
}

export function makeFloor(existing: Floor[]): Floor {
  const level = Math.max(0, ...existing.map((f) => f.level)) + 1
  const regular = existing.filter((f) => f.id !== "floor-rooftop")
  const tallest = regular.reduce<Floor | undefined>(
    (best, f) => (!best || f.level > best.level ? f : best),
    undefined,
  )
  return {
    id: `floor-${nanoid(6)}`,
    level,
    name: `Lantai ${level}`,
    heightM: tallest?.heightM ?? DEFAULT_FLOOR_TO_FLOOR_M,
  }
}
