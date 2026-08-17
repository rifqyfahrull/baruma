import { describe, expect, it } from "vitest"
import { worldToRoomLocal } from "./drag-plane"

describe("worldToRoomLocal", () => {
  it("inverts the house-model placement formula (center follows pointer)", () => {
    // house-model: worldX = roomX + x + widthM/2 - cx ; worldZ = roomY + y + depthM/2 - cz
    const roomX = 2, roomY = 3, cx = 4, cz = 5, widthM = 1.6, depthM = 2.0
    const x = 0.7, y = 1.1
    const worldX = roomX + x + widthM / 2 - cx
    const worldZ = roomY + y + depthM / 2 - cz
    const got = worldToRoomLocal({ worldX, worldZ, roomX, roomY, cx, cz, widthM, depthM })
    expect(got.x).toBeCloseTo(x, 6)
    expect(got.y).toBeCloseTo(y, 6)
  })

  it("places the furniture CENTER at the pointer (corner = center - half-size)", () => {
    // pointer at world origin, room origin 0, no centering offset → corner = -half size
    const got = worldToRoomLocal({ worldX: 0, worldZ: 0, roomX: 0, roomY: 0, cx: 0, cz: 0, widthM: 2, depthM: 1 })
    expect(got.x).toBeCloseTo(-1, 6)
    expect(got.y).toBeCloseTo(-0.5, 6)
  })
})
