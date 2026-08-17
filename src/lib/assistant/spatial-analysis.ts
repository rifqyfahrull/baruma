import { rectsOverlap, round2, type Rect } from "@/lib/geometry"
import { groundFloorIds, sanitationObstacles } from "@/lib/water/sanitation"
import type { FloorplanScene } from "./actions"

export type SceneRoom = FloorplanScene["rooms"][number]
export type PocketSide = "left" | "right" | "top" | "bottom"

export function roomRect(room: Pick<SceneRoom, "x" | "y" | "width" | "depth">): Rect {
  return { x: room.x, y: room.y, width: room.width, depth: room.depth }
}

export function sanitationRect(obj: { x: number; y: number; widthM: number; lengthM: number }): Rect {
  return {
    x: obj.x - obj.widthM / 2,
    y: obj.y - obj.lengthM / 2,
    width: obj.widthM,
    depth: obj.lengthM,
  }
}

export function axisOverlapLength(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))
}

export function sanitationObstaclesForFloor(scene: FloorplanScene, floorId: string): Rect[] {
  if (!groundFloorIds(scene.floors).has(floorId)) return []
  return sanitationObstacles(scene.sanitation).map((o) => o.rect)
}

export function groundSanitationRooms(scene: FloorplanScene, rooms = scene.rooms): SceneRoom[] {
  const groundIds = groundFloorIds(scene.floors)
  return rooms.filter((r) => groundIds.has(r.floorId) && r.type !== "taman")
}

export function sanitationRoomObstacles(scene: FloorplanScene): Rect[] {
  return groundSanitationRooms(scene).map(roomRect)
}

export function otherSanitationObstacles(scene: FloorplanScene): Rect[] {
  const sanitation = scene.sanitation
  if (!sanitation) return []
  const out: Rect[] = []
  if (sanitation.septicTank) out.push(sanitationRect(sanitation.septicTank))
  for (const box of sanitation.controlBoxes ?? []) out.push(sanitationRect(box))
  return out
}

export function openGroundPockets(scene: FloorplanScene, rooms = scene.rooms): Rect[] {
  const obstacles = groundSanitationRooms(scene, rooms).map(roomRect)
  const xs = new Set<number>([0, scene.site.widthM])
  const ys = new Set<number>([0, scene.site.depthM])
  for (const o of obstacles) {
    xs.add(round2(Math.max(0, o.x)))
    xs.add(round2(Math.min(scene.site.widthM, o.x + o.width)))
    ys.add(round2(Math.max(0, o.y)))
    ys.add(round2(Math.min(scene.site.depthM, o.y + o.depth)))
  }

  const sortedX = [...xs].sort((a, b) => a - b)
  const sortedY = [...ys].sort((a, b) => a - b)
  const pockets: Rect[] = []
  for (let xi = 0; xi < sortedX.length - 1; xi++) {
    for (let yi = 0; yi < sortedY.length - 1; yi++) {
      const x = sortedX[xi]
      const y = sortedY[yi]
      const width = round2(sortedX[xi + 1] - x)
      const depth = round2(sortedY[yi + 1] - y)
      if (width < 0.4 || depth < 0.4) continue
      const rect = { x, y, width, depth }
      if (obstacles.some((o) => rectsOverlap(rect, o))) continue
      pockets.push(rect)
    }
  }
  return pockets
}

export function roomMovePriority(room: SceneRoom): number {
  if (room.type === "kamar_mandi" || room.type === "dapur" || room.type === "laundry") return 0
  if (room.type === "carport" || room.type === "gudang" || room.type === "tangga") return 1
  if (room.type === "ruang_keluarga" || room.type === "ruang_tamu" || room.type === "kamar_tidur") return 3
  return 2
}

export function canMoveRoom(
  room: SceneRoom,
  dx: number,
  dy: number,
  rooms: SceneRoom[],
  site: FloorplanScene["site"]
): boolean {
  if (room.locked) return false
  const moved: Rect = {
    x: round2(room.x + dx),
    y: round2(room.y + dy),
    width: room.width,
    depth: room.depth,
  }
  if (moved.x < -0.01 || moved.y < -0.01) return false
  if (moved.x + moved.width > site.widthM + 0.01) return false
  if (moved.y + moved.depth > site.depthM + 0.01) return false
  return !rooms.some((other) => {
    if (other.id === room.id || other.floorId !== room.floorId) return false
    return rectsOverlap(moved, roomRect(other))
  })
}

export function roomsTouchingPocketSide(
  rooms: SceneRoom[],
  pocket: Rect,
  side: PocketSide
): SceneRoom[] {
  const edgeTol = 0.04
  const minOverlap = 0.15
  return rooms.filter((room) => {
    const rect = roomRect(room)
    if (side === "left" || side === "right") {
      const edge = side === "left" ? rect.x + rect.width : rect.x
      const target = side === "left" ? pocket.x : pocket.x + pocket.width
      return (
        Math.abs(edge - target) <= edgeTol &&
        axisOverlapLength(rect.y, rect.y + rect.depth, pocket.y, pocket.y + pocket.depth) >= minOverlap
      )
    }
    const edge = side === "top" ? rect.y + rect.depth : rect.y
    const target = side === "top" ? pocket.y : pocket.y + pocket.depth
    return (
      Math.abs(edge - target) <= edgeTol &&
      axisOverlapLength(rect.x, rect.x + rect.width, pocket.x, pocket.x + pocket.width) >= minOverlap
    )
  })
}
