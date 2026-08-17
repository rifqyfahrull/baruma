import { describe, it, expect } from "vitest"

import { generateConnectingDoors } from "./connect-rooms"
import { analyzeRoomConnectivity } from "./connectivity"
import type { Floor, Opening, Room } from "@/types"

function room(p: Partial<Room> & Pick<Room, "id" | "type" | "x" | "y" | "width" | "depth">): Room {
  return { floorId: "f1", name: p.name ?? p.type, areaM2: p.width * p.depth, ...p } as Room
}
const FLOORS: Pick<Floor, "id" | "level">[] = [{ id: "f1", level: 1 }]

describe("generateConnectingDoors — kasus dasar", () => {
  it("dua ruang bersebelahan: tersambung + satu diberi akses keluar", () => {
    const rooms = [
      room({ id: "tamu", type: "ruang_tamu", x: 0, y: 0, width: 4, depth: 4 }),
      room({ id: "kt1", type: "kamar_tidur", x: 4, y: 0, width: 3, depth: 4 }),
    ]
    const doors = generateConnectingDoors(rooms, [], FLOORS)
    const { isolated } = analyzeRoomConnectivity(rooms, doors)
    expect(isolated).toHaveLength(0)
    // ruang tamu (sirkulasi) yang jadi entrance, bukan kamar tidur
    const exterior = doors.filter((d) => d.wallId.startsWith("tamu:"))
    expect(exterior.length).toBeGreaterThan(0)
  })

  it("ruang sirkulasi diprioritaskan sbg titik masuk, bukan ruang privat", () => {
    const rooms = [
      room({ id: "kt1", type: "kamar_tidur", x: 0, y: 0, width: 3, depth: 3 }),
      room({ id: "keluarga", type: "ruang_keluarga", x: 3, y: 0, width: 4, depth: 4 }),
    ]
    const doors = generateConnectingDoors(rooms, [], FLOORS)
    // pintu ke arah luar (neighbor null, sisi n/w pada kt1 — tak bertetangga)
    // harus muncul di ruang keluarga, TIDAK di kamar tidur.
    const kt1ExteriorDoors = doors.filter(
      (d) => d.wallId.startsWith("kt1:") && (d.wallId.endsWith(":n") || d.wallId.endsWith(":w")),
    )
    expect(kt1ExteriorDoors).toHaveLength(0)
    const keluargaExteriorDoors = doors.filter(
      (d) => d.wallId.startsWith("keluarga:") && (d.wallId.endsWith(":n") || d.wallId.endsWith(":e")),
    )
    expect(keluargaExteriorDoors.length).toBeGreaterThan(0)
  })

  it("kamar mandi en-suite tersambung lewat kamar tidurnya", () => {
    const rooms = [
      room({ id: "tamu", type: "ruang_tamu", x: 0, y: 0, width: 4, depth: 4 }),
      room({ id: "kt1", type: "kamar_tidur", x: 4, y: 0, width: 3, depth: 4 }),
      room({ id: "km1", type: "kamar_mandi", x: 4, y: 4, width: 3, depth: 2 }),
    ]
    const doors = generateConnectingDoors(rooms, [], FLOORS)
    const { isolated } = analyzeRoomConnectivity(rooms, doors)
    expect(isolated).toHaveLength(0)
    const km1Door = doors.find((d) => d.wallId.startsWith("km1:"))
    expect(km1Door).toBeDefined()
  })

  it("TIDAK menembus ruang privat lain demi menyambung — kt2 & km2 dibiarkan terkurung", () => {
    // kt2 hanya bersebelahan dgn kt1 (privat, bukan en-suite) dan km2 (yg
    // sendirinya cuma bisa dicapai lewat kt2). Verifikasi: BUKAN cuma "tak
    // ada pintu ke sisi tertentu" — kt2 & km2 harus TAK DAPAT pintu sama
    // sekali (0), sinyal jujur bahwa denah ini butuh koridor, bukan tambalan
    // yg memaksakan lewat kamar orang.
    const rooms = [
      room({ id: "tamu", type: "ruang_tamu", x: 0, y: 0, width: 4, depth: 4 }),
      room({ id: "kt1", type: "kamar_tidur", x: 4, y: 0, width: 3, depth: 4 }),
      room({ id: "kt2", type: "kamar_tidur", x: 4, y: 4, width: 3, depth: 3 }),
      room({ id: "km2", type: "kamar_mandi", x: 7, y: 4, width: 2, depth: 3 }),
    ]
    const doors = generateConnectingDoors(rooms, [], FLOORS)
    expect(doors.filter((d) => d.wallId.startsWith("kt2:"))).toHaveLength(0)
    expect(doors.filter((d) => d.wallId.startsWith("km2:"))).toHaveLength(0)
    // tamu↔kt1 tetap tersambung normal (bukan seluruh fungsi yg gagal)
    const { isolated } = analyzeRoomConnectivity(rooms, doors)
    expect(isolated.map((r) => r.id).sort()).toEqual(["km2", "kt2"])
  })

  it("tidak menghasilkan pintu menembus void/kolam", () => {
    const rooms = [
      room({ id: "tamu", type: "ruang_tamu", x: 0, y: 0, width: 4, depth: 4 }),
      room({ id: "musholla", type: "musholla", x: 4, y: 0, width: 2, depth: 2 }),
      room({ id: "void1", type: "void", x: 4, y: 2, width: 2, depth: 2 }),
    ]
    const doors = generateConnectingDoors(rooms, [], FLOORS)
    const musDoors = doors.filter((d) => d.wallId.startsWith("musholla:"))
    for (const d of musDoors) expect(d.wallId).not.toBe("musholla:s") // sisi ke void1
  })
})

describe("generateConnectingDoors — lantai atas", () => {
  const UPPER: Pick<Floor, "id" | "level">[] = [
    { id: "f1", level: 1 },
    { id: "f2", level: 2 },
  ]

  it("tidak memasang pintu ke udara kosong di lantai atas", () => {
    const rooms = [
      room({ id: "kt1", type: "kamar_tidur", floorId: "f2", x: 0, y: 0, width: 3, depth: 3 }),
    ]
    const doors = generateConnectingDoors(rooms, [], UPPER)
    // Satu-satunya ruang di lantai 2, tanpa tetangga — tak boleh diberi pintu
    // ke sisi manapun (semua sisi = exterior di lantai atas = tak sah).
    expect(doors).toHaveLength(0)
  })

  it("ruang lantai atas yang bersebelahan tetap disambungkan, tanpa pintu ke exterior", () => {
    const rooms = [
      room({ id: "kt1", type: "kamar_tidur", floorId: "f2", x: 0, y: 0, width: 3, depth: 3 }),
      room({ id: "keluarga2", type: "ruang_keluarga", floorId: "f2", x: 3, y: 0, width: 4, depth: 4 }),
    ]
    const doors = generateConnectingDoors(rooms, [], UPPER)
    const { isolated } = analyzeRoomConnectivity(rooms, doors)
    expect(isolated).toHaveLength(0)
    // Satu-satunya pintu yang mungkin di sini adalah kt1↔keluarga2 (sisi
    // e/w, saling bertetangga) — sisi n/s pada kedua ruang tak bertetangga
    // apa pun, jadi TAK BOLEH muncul (itu akan berarti pintu ke udara kosong).
    for (const d of doors) {
      expect(d.wallId.endsWith(":n") || d.wallId.endsWith(":s")).toBe(false)
    }
  })
})

describe("generateConnectingDoors — jenis pintu per fungsi ruang", () => {
  it("kamar mandi kecil dapat pintu geser 0,7 m, bukan ayun 0,9 m seragam", () => {
    // domain-knowledge-pintu.md §3.1 — dulu SEMUA pintu generator 0,9 m
    // hinged tanpa kind, termasuk kamar mandi.
    const rooms = [
      room({ id: "tamu", type: "ruang_tamu", x: 0, y: 0, width: 4, depth: 4 }),
      room({ id: "km1", type: "kamar_mandi", x: 4, y: 0, width: 1.6, depth: 1.5 }),
    ]
    const doors = generateConnectingDoors(rooms, [], FLOORS)
    const kmDoor = doors.find((d) => d.wallId.startsWith("km1:"))
    expect(kmDoor).toBeDefined()
    expect(kmDoor!.kind).toBe("pocket_door")
    expect(kmDoor!.widthM).toBeCloseTo(0.7, 2)
  })

  it("kamar tidur dapat pintu 0,8 m", () => {
    const rooms = [
      room({ id: "tamu", type: "ruang_tamu", x: 0, y: 0, width: 4, depth: 4 }),
      room({ id: "kt1", type: "kamar_tidur", x: 4, y: 0, width: 3, depth: 4 }),
    ]
    const doors = generateConnectingDoors(rooms, [], FLOORS)
    const ktDoor = doors.find((d) => d.wallId.startsWith("kt1:"))
    expect(ktDoor).toBeDefined()
    expect(ktDoor!.widthM).toBeCloseTo(0.8, 2)
  })
})

describe("generateConnectingDoors — idempoten & aman", () => {
  it("dipanggil dgn openings sedia (pintu sudah ada) tidak menambah duplikat", () => {
    const rooms = [
      room({ id: "tamu", type: "ruang_tamu", x: 0, y: 0, width: 4, depth: 4 }),
      room({ id: "kt1", type: "kamar_tidur", x: 4, y: 0, width: 3, depth: 4 }),
    ]
    const existing: Opening[] = [
      { id: "d1", floorId: "f1", wallId: "tamu:e", type: "door", positionM: 2, widthM: 0.9, heightM: 2.1 },
      { id: "d2", floorId: "f1", wallId: "tamu:w", type: "door", positionM: 2, widthM: 0.9, heightM: 2.1 },
    ]
    const doors = generateConnectingDoors(rooms, existing, FLOORS)
    // Sudah tersambung & sudah punya akses luar → tak perlu pintu tambahan.
    expect(doors).toHaveLength(0)
  })

  it("ruang kosong (tak ada ruang di lantai) tidak melempar error", () => {
    expect(() => generateConnectingDoors([], [], FLOORS)).not.toThrow()
    expect(generateConnectingDoors([], [], FLOORS)).toEqual([])
  })
})
