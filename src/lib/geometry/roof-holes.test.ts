import { describe, it, expect } from "vitest"

import {
  clampToHost,
  flatRoofHosts,
  openToSkyRoofHoleAreaM2,
  resolveFlatHost,
  roofHoleRectsFor,
  roomUnderFlatRoof,
  skylightAreaServingRoom,
  unresolvedSkylights,
} from "./roof-holes"
import type { DesignLayout, Room } from "@/types"

const room = (over: Partial<Room>): Room => ({
  id: "r",
  floorId: "f1",
  name: "R",
  type: "ruang_tamu",
  x: 0,
  y: 0,
  width: 8,
  depth: 6,
  areaM2: 48,
  ...over,
})

const base = (over?: Partial<DesignLayout>): DesignLayout => ({
  id: "l",
  projectId: "p",
  versionId: "v",
  floors: [{ id: "f1", level: 1, name: "L1", heightM: 3 }],
  rooms: [room({ id: "a" })],
  walls: [],
  openings: [],
  stairs: [],
  pools: [],
  validation: { passed: true, issues: [] },
  ...over,
})

const sk = (over?: Partial<NonNullable<DesignLayout["skylights"]>[number]>) => ({
  id: "sk-1",
  x: 3,
  y: 2,
  widthM: 1.2,
  depthM: 1.2,
  kind: "fixed" as const,
  ...over,
})

describe("roof-holes — presedensi host (meniru emisi build-model)", () => {
  it("atap datar legacy → host legacy-flat seluas footprint", () => {
    const hosts = flatRoofHosts(base())
    expect(hosts).toHaveLength(1)
    expect(hosts[0]).toMatchObject({ kind: "legacy-flat", rect: { x: 0, y: 0, width: 8, depth: 6 } })
  })

  it("atap pelana → tanpa host; skylight jadi unresolved (warning, bukan hilang)", () => {
    const l = base({
      roof: { type: "pelana", slopeDeg: 30, overhangM: 0.5, material: "genteng_beton" },
      skylights: [sk()],
    })
    expect(flatRoofHosts(l)).toHaveLength(0)
    expect(unresolvedSkylights(l)).toEqual(["sk-1"])
  })

  it("dak rooftop menang atas atap legacy; deck parsial memakai rect deck", () => {
    const l = base({
      floors: [
        { id: "f1", level: 1, name: "L1", heightM: 3 },
        { id: "floor-rooftop", level: 2, name: "Rooftop", heightM: 0.3 },
      ],
      rooftopArea: { x: 1, y: 1, width: 4, depth: 3 },
    })
    const hosts = flatRoofHosts(l)
    expect(hosts).toHaveLength(1)
    expect(hosts[0].kind).toBe("deck")
    expect(hosts[0].rect).toEqual({ x: 1, y: 1, width: 4, depth: 3 })
  })

  it("roofZones eksplisit menang atas semuanya; hanya zona datar yang jadi host", () => {
    const l = base({
      roofZones: [
        { id: "z-flat", type: "datar", x: 2, y: 2, widthM: 4, depthM: 4, slopeDeg: 0, overhangM: 0 },
        { id: "z-gable", type: "pelana", x: 6, y: 3, widthM: 4, depthM: 4, slopeDeg: 30, overhangM: 0.5 },
      ],
    })
    const hosts = flatRoofHosts(l)
    expect(hosts).toHaveLength(1)
    expect(hosts[0]).toMatchObject({ kind: "zone-datar", zoneId: "z-flat" })
    // rect zona = konversi center→pojok
    expect(hosts[0].rect).toEqual({ x: 0, y: 0, width: 4, depth: 4 })
  })
})

describe("roof-holes — clamp & lubang per host", () => {
  it("clampToHost menjaga rect ⊆ host dengan ukuran min 0.4", () => {
    const host = { kind: "legacy-flat" as const, rect: { x: 0, y: 0, width: 8, depth: 6 } }
    expect(clampToHost({ x: 7.5, y: -1, width: 2, depth: 0.1 }, host)).toEqual({
      x: 6,
      y: 0,
      width: 2,
      depth: 0.4,
    })
  })

  it("roofHoleRectsFor hanya mengembalikan skylight milik host itu", () => {
    const l = base({ skylights: [sk(), sk({ id: "sk-2", x: 20, y: 20 })] })
    const host = flatRoofHosts(l)[0]
    const holes = roofHoleRectsFor(l, host)
    expect(holes).toHaveLength(1)
    expect(holes[0]).toEqual({ x: 3, y: 2, width: 1.2, depth: 1.2 })
  })
})

describe("roof-holes — kredit cahaya skylight", () => {
  it("skylight menaungi ruang lantai teratas → luas irisan dihitung; lantai bawah tidak", () => {
    const l = base({
      floors: [
        { id: "f1", level: 1, name: "L1", heightM: 3 },
        { id: "f2", level: 2, name: "L2", heightM: 3 },
      ],
      rooms: [
        room({ id: "bawah", floorId: "f1" }),
        room({ id: "atas", floorId: "f2", x: 0, y: 0, width: 8, depth: 6 }),
      ],
      skylights: [sk({ x: 1, y: 1, widthM: 2, depthM: 1 })],
    })
    expect(skylightAreaServingRoom(l, l.rooms[1])).toBe(2)
    expect(skylightAreaServingRoom(l, l.rooms[0])).toBe(0)
  })

  it("roomUnderFlatRoof: true di bawah atap datar, false utk pelana", () => {
    const flat = base()
    expect(roomUnderFlatRoof(flat, flat.rooms[0])).toBe(true)
    const gable = base({
      roof: { type: "pelana", slopeDeg: 30, overhangM: 0.5, material: "genteng_beton" },
    })
    expect(roomUnderFlatRoof(gable, gable.rooms[0])).toBe(false)
  })
})

describe("roof-holes — openToSkyRoofHoleAreaM2 (koreksi RAB/resapan)", () => {
  it("menjumlah luas lubang courtyard ∩ footprint; tanpa openToSky = 0", () => {
    const l = base({
      rooms: [
        room({ id: "a" }),
        room({ id: "t", x: 2, y: 1, width: 2, depth: 2, type: "taman", openToSky: true }),
      ],
    })
    expect(openToSkyRoofHoleAreaM2(l)).toBe(4)
    const l0 = base()
    expect(openToSkyRoofHoleAreaM2(l0)).toBe(0)
  })
})
