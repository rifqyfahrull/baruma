/** Stable tint per open-plan zone id (for the 2D canvas). */
const ZONE_COLORS = ["#2F5D50", "#8B6F47", "#6F92A3", "#9A5A35", "#446B5B", "#7B5234"]

export function zoneColor(zoneId: string): string {
  let h = 0
  for (let i = 0; i < zoneId.length; i++) h = (h * 31 + zoneId.charCodeAt(i)) | 0
  return ZONE_COLORS[Math.abs(h) % ZONE_COLORS.length]
}

import type { Room } from "@/types"

/** All open-plan zones a room belongs to. `zoneIds` (multi) wins; legacy
 *  single `zoneId` is honored for saved layouts and AI patches. */
export function roomZones(room: Pick<Room, "zoneId" | "zoneIds">): string[] {
  if (room.zoneIds && room.zoneIds.length > 0) return room.zoneIds
  return room.zoneId ? [room.zoneId] : []
}

/** Whether two rooms share at least one open-plan zone (→ no wall between them). */
export function sharesZone(
  a: Pick<Room, "zoneId" | "zoneIds">,
  b: Pick<Room, "zoneId" | "zoneIds">
): boolean {
  const za = roomZones(a)
  if (za.length === 0) return false
  const zb = new Set(roomZones(b))
  return za.some((z) => zb.has(z))
}
