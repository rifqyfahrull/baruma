/**
 * Pure placement helpers for electrical points in the 2D editor. Kept out of
 * the React component so they are unit-testable and reusable (click-to-place
 * hit-test + drag clamp). Coordinates are absolute editor metres (y-UP room
 * space), matching `ElectricalPoint.x/y` and `Room.x/y/width/depth`.
 */
import type { Room } from "@/types"
import { clamp } from "@/lib/geometry"

/**
 * The room whose rect contains (x, y), searching last-first so the room drawn
 * on top (later in the array) wins overlaps; `null` when the point is on empty
 * canvas. Pass an already floor-filtered list.
 */
export function roomAt(rooms: Room[], x: number, y: number): Room | null {
  for (let i = rooms.length - 1; i >= 0; i--) {
    const r = rooms[i]
    if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.depth) return r
  }
  return null
}

/** Clamp (x, y) so it stays within a room's bounding box. */
export function clampToRoom(room: Room, x: number, y: number): { x: number; y: number } {
  return {
    x: clamp(x, room.x, room.x + room.width),
    y: clamp(y, room.y, room.y + room.depth),
  }
}
