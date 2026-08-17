import { describe, expect, it } from "vitest"

import { levelConnectors } from "./level-connectors"
import type { Opening, Room } from "@/types"

const room = (over: Partial<Room>): Room => ({
  id: "r", floorId: "f1", name: "R", type: "ruang_tamu",
  x: 0, y: 0, width: 4, depth: 3, areaM2: 12, ...over,
})

describe("levelConnectors — undakan otomatis split-level", () => {
  it("via PINTU: Δ 0.36 → 2 anak, bentang = segmen pintu, di sisi ruang rendah", () => {
    const rooms = [
      room({ id: "bawah", x: 0, y: 0 }),
      room({ id: "atas", x: 0, y: 3, levelOffsetM: 0.36 }),
    ]
    const openings: Opening[] = [
      { id: "d1", floorId: "f1", wallId: "bawah:s", type: "door", positionM: 2, widthM: 0.9, heightM: 2.1 },
    ]
    const out = levelConnectors(rooms, openings)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      lowRoomId: "bawah", highRoomId: "atas", side: "s", steps: 2, riserM: 0.18,
    })
    expect(out[0].span.end - out[0].span.start).toBeCloseTo(0.9, 6)
  })

  it("via ZONA bersama: bentang = overlap penuh; Δ ≤ 0.2 tidak menghasilkan undakan", () => {
    const rooms = [
      room({ id: "a", x: 0, y: 0, zoneId: "z1" }),
      room({ id: "b", x: 0, y: 3, zoneId: "z1", levelOffsetM: 0.54 }),
      room({ id: "c", x: 4, y: 0, zoneId: "z2" }),
      room({ id: "d", x: 4, y: 3, zoneId: "z2", levelOffsetM: 0.18 }),
    ]
    const out = levelConnectors(rooms, [])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ lowRoomId: "a", highRoomId: "b", steps: 3 })
    expect(out[0].span).toEqual({ start: 0, end: 4 })
  })

  it("ruang tak terhubung (tanpa pintu/zona) → tidak ada undakan (warning saja)", () => {
    const rooms = [
      room({ id: "a", x: 0, y: 0 }),
      room({ id: "b", x: 0, y: 3, levelOffsetM: 0.36 }),
    ]
    expect(levelConnectors(rooms, [])).toHaveLength(0)
  })
})
