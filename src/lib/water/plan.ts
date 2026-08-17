/**
 * Auto-generation of default water fixtures per room type. Pure module —
 * no zustand/react — so it is unit-testable and callable from the store,
 * the AI action dispatcher, and (later) server code.
 *
 * Placement rules are pinned by the SP5 plan's Global Constraints
 * (docs/superpowers/plans/2026-07-04-sp5-air-sanitasi.md), mirroring SP4's
 * `autoGenerateElectrical`:
 *
 * - `WALL_OFFSET_M = 0.3` inset from the room's bottom edge.
 * - A room's WATER_DEFAULTS fixtures are spread EVENLY along the BOTTOM wall
 *   (`y = room.y + WALL_OFFSET_M`). "Evenly" = fixture i of n sits at
 *   fraction (i+1)/(n+1) of the wall length, so every point is strictly
 *   inside the room bbox.
 *
 * Idempotent: rooms that already have ANY water point are skipped, and the
 * existing array is prepended untouched (malformed entries from the
 * un-validated layout PUT are tolerated, never crashed on).
 */
import { nanoid } from "nanoid"

import type { DesignLayout, Room, WaterPoint, WaterPointType } from "@/types"
import { WATER_DEFAULTS } from "@/lib/constants"
import { round2 } from "@/lib/geometry"

/** Inset (m) from the room's bottom edge for auto-placed fixtures. */
export const WALL_OFFSET_M = 0.3

type XY = { x: number; y: number }

function makePoint(roomId: string, type: WaterPointType, at: XY): WaterPoint {
  return { id: `water-${nanoid(8)}`, roomId, type, x: round2(at.x), y: round2(at.y) }
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

/** Even spread of n fixtures along the bottom wall, inset by WALL_OFFSET_M
 *  (halved for shallow rooms so points stay strictly inside the bbox). */
function bottomWallPositions(room: Room, n: number): XY[] {
  const oy = Math.min(WALL_OFFSET_M, room.depth / 2)
  const out: XY[] = []
  for (let i = 0; i < n; i++) {
    out.push({ x: room.x + (room.width * (i + 1)) / (n + 1), y: room.y + oy })
  }
  return out
}

/**
 * Returns a NEW array: the existing `layout.water` (untouched, malformed
 * entries included) + generated default fixtures for every non-void room
 * that has NO existing water point. `floorId` restricts generation to one
 * floor. Dry rooms (empty WATER_DEFAULTS) produce nothing.
 */
export function autoGenerateWater(layout: DesignLayout, floorId?: string): WaterPoint[] {
  const existing = Array.isArray(layout.water) ? layout.water : []

  const roomsWithPoints = new Set<string>()
  for (const p of existing) {
    if (!p || typeof p !== "object") continue
    if (typeof p.roomId === "string") roomsWithPoints.add(p.roomId)
  }

  const generated: WaterPoint[] = []
  const rooms = layout.rooms.filter(
    (r): r is Room => Boolean(r) && (!floorId || r.floorId === floorId)
  )

  for (const room of rooms) {
    if (room.type === "void" || roomsWithPoints.has(room.id) || !isPlaceableRoom(room)) continue
    const fixtures = WATER_DEFAULTS[room.type] ?? []
    if (fixtures.length === 0) continue
    const positions = bottomWallPositions(room, fixtures.length)
    fixtures.forEach((type, i) => generated.push(makePoint(room.id, type, positions[i])))
  }

  return [...existing, ...generated]
}
