import { describe, expect, it } from "vitest"

import type { FloorElevation } from "@/lib/geometry/vertical"
import { SLAB_T, WALL_H } from "@/lib/geometry/vertical"

import { interiorCameraPose } from "./interior-camera"

import type { Room } from "@/types"

const SITE = { widthM: 10, depthM: 8 }

function makeRoom(overrides: Partial<Room> = {}): Room {
  return {
    id: "r1",
    floorId: "floor-1",
    name: "Ruang Keluarga",
    type: "ruang_keluarga",
    x: 1,
    y: 1,
    width: 4,
    depth: 3,
    areaM2: 12,
    ...overrides,
  }
}

function makeElev(overrides: Partial<FloorElevation> = {}): FloorElevation {
  return {
    index: 0,
    baseY: 0,
    floorToFloorM: WALL_H + SLAB_T,
    wallHM: WALL_H,
    ...overrides,
  }
}

describe("interiorCameraPose", () => {
  it("(a) ruang biasa, lantai default → eye = baseY + SLAB_T + 1.5", () => {
    const room = makeRoom()
    const elev = makeElev()
    const pose = interiorCameraPose(room, elev, SITE, false)
    expect(pose.position[1]).toBeCloseTo(elev.baseY + SLAB_T + 1.5, 6)
  })

  it("(b) levelOffsetM 1.2 → platform (dan eye) bergeser +1.2", () => {
    const room = makeRoom({ levelOffsetM: 1.2 })
    const elev = makeElev()
    const flat = interiorCameraPose(makeRoom(), elev, SITE, false)
    const raised = interiorCameraPose(room, elev, SITE, false)
    expect(raised.position[1]).toBeCloseTo(flat.position[1] + 1.2, 6)
    expect(raised.target[1]).toBeCloseTo(flat.target[1] + 1.2, 6)
  })

  it("(c) wallHM 2.05 → eyeOffset = min(1.5, 1.75) = 1.5 (tetap, tidak berubah dari default)", () => {
    const room = makeRoom()
    const elev = makeElev({ wallHM: 2.05 })
    const pose = interiorCameraPose(room, elev, SITE, false)
    expect(pose.position[1]).toBeCloseTo(elev.baseY + SLAB_T + 1.5, 6)
  })

  it("(c) wallHM 1.6 (mezzanine rendah) → eyeOffset = 1.3", () => {
    const room = makeRoom()
    const elev = makeElev({ wallHM: 1.6 })
    const pose = interiorCameraPose(room, elev, SITE, false)
    expect(pose.position[1]).toBeCloseTo(elev.baseY + SLAB_T + 1.3, 6)
  })

  it("(c) wallHM sangat kecil → eyeOffset di-clamp lantai 0.8 (tak absurd negatif)", () => {
    const room = makeRoom()
    const elev = makeElev({ wallHM: 0.5 })
    const pose = interiorCameraPose(room, elev, SITE, false)
    expect(pose.position[1]).toBeCloseTo(elev.baseY + SLAB_T + 0.8, 6)
  })

  it("(d) target.y selalu < position.y (default, wallHM tinggi, wallHM rendah, clamp lantai)", () => {
    const room = makeRoom()
    for (const wallHM of [2.05, 1.6, 0.5, WALL_H]) {
      const elev = makeElev({ wallHM })
      const pose = interiorCameraPose(room, elev, SITE, false)
      expect(pose.target[1]).toBeLessThan(pose.position[1])
    }
  })

  it("(e) posisi xz tetap di dalam rect ruang (world coords) — ruang lebar", () => {
    const room = makeRoom({ x: 2, y: 1, width: 6, depth: 2 })
    const elev = makeElev()
    const pose = interiorCameraPose(room, elev, SITE, false)
    const xMin = room.x - SITE.widthM / 2
    const xMax = room.x + room.width - SITE.widthM / 2
    const zMin = room.y - SITE.depthM / 2
    const zMax = room.y + room.depth - SITE.depthM / 2
    expect(pose.position[0]).toBeGreaterThanOrEqual(xMin)
    expect(pose.position[0]).toBeLessThanOrEqual(xMax)
    expect(pose.position[2]).toBeGreaterThanOrEqual(zMin)
    expect(pose.position[2]).toBeLessThanOrEqual(zMax)
  })

  it("(e) posisi xz tetap di dalam rect ruang (world coords) — ruang dalam (deep)", () => {
    const room = makeRoom({ x: 1, y: 0.5, width: 2, depth: 6 })
    const elev = makeElev()
    const pose = interiorCameraPose(room, elev, SITE, false)
    const xMin = room.x - SITE.widthM / 2
    const xMax = room.x + room.width - SITE.widthM / 2
    const zMin = room.y - SITE.depthM / 2
    const zMax = room.y + room.depth - SITE.depthM / 2
    expect(pose.position[0]).toBeGreaterThanOrEqual(xMin)
    expect(pose.position[0]).toBeLessThanOrEqual(xMax)
    expect(pose.position[2]).toBeGreaterThanOrEqual(zMin)
    expect(pose.position[2]).toBeLessThanOrEqual(zMax)
  })

  it("(f) exploded true menggeser position.y DAN target.y sebesar index × EXPLODE_GAP", () => {
    const room = makeRoom()
    const elev = makeElev({ index: 2 })
    const EXPLODE_GAP = 2.6
    const flat = interiorCameraPose(room, elev, SITE, false)
    const exploded = interiorCameraPose(room, elev, SITE, true)
    expect(exploded.position[1]).toBeCloseTo(flat.position[1] + 2 * EXPLODE_GAP, 6)
    expect(exploded.target[1]).toBeCloseTo(flat.target[1] + 2 * EXPLODE_GAP, 6)
  })

  it("elev absen (lantai tak dikenal) → baseY 0, wallHM fallback WALL_H", () => {
    const room = makeRoom()
    const pose = interiorCameraPose(room, undefined, SITE, false)
    expect(pose.position[1]).toBeCloseTo(SLAB_T + 1.5, 6)
  })

  it("rooftop deck (wallHM 0) → eye tetap 1.5 di atas platform, bukan 0.8 (regresi I1)", () => {
    const room = makeRoom({ floorId: "floor-rooftop", type: "rooftop_lounge" })
    const elev = makeElev({ index: 2, baseY: 5.9, floorToFloorM: 0.3, wallHM: 0 })
    const pose = interiorCameraPose(room, elev, SITE, false)
    expect(pose.position[1]).toBeCloseTo(5.9 + SLAB_T + 1.5, 6)
  })
})
