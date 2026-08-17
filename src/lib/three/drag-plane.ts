/**
 * Convert a world-space floor point (from a raycast onto the room floor plane)
 * into room-local corner coordinates, with the furniture CENTER following the
 * pointer. Inverse of house-model's placement: worldX = roomX + x + widthM/2 - cx.
 * Pure — clamping is done downstream by movePlacedFurniture.
 */
export function worldToRoomLocal(opts: {
  worldX: number
  worldZ: number
  roomX: number
  roomY: number
  cx: number
  cz: number
  widthM: number
  depthM: number
}): { x: number; y: number } {
  return {
    x: opts.worldX + opts.cx - opts.roomX - opts.widthM / 2,
    y: opts.worldZ + opts.cz - opts.roomY - opts.depthM / 2,
  }
}
