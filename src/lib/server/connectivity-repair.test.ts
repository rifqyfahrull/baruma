import { describe, expect, it } from "vitest"

import { repairConnectivity } from "./connectivity-repair"
import { findConnectivityRegressions } from "./connectivity-guard"
import type { FloorplanAction, FloorplanScene } from "@/lib/assistant/actions"

/**
 * DARI MENEGUR MENJADI MENYELESAIKAN.
 *
 * `connectivity-guard` hanya bisa bilang "ruang X terputus" — agent lalu
 * menebak sendiri perbaikannya, dan tebakan itulah yang selama ini melahirkan
 * pintu asal-asalan. Padahal `generateConnectingDoors` sudah tahu cara
 * menyambungkan denah dengan benar: memilih tetangga yang PANTAS (tidak
 * menembus kamar orang), menaruh pintu di bentang bersama, bebas tabrakan.
 *
 * Modul ini menjembatani keduanya — persis pola `reconcileFloorplanOverlaps`
 * yang sudah dipakai untuk ruang bertumpuk: hitung patch perbaikan secara
 * deterministik, gabungkan ke usulan agent, lalu validasi ulang.
 *
 * "Yang namanya ruangan itu harus bisa diakses dari dalam rumah, bukan
 *  sembarangan naruh pintu."
 */

const FLOORS = [{ id: "f1", name: "Lantai 1", level: 1 }]

function scene(rooms: unknown[], openings: unknown[] = []): FloorplanScene {
  return {
    site: { widthM: 14, depthM: 14 },
    floors: FLOORS,
    selectedFloorId: "f1",
    rooms,
    openings,
  } as unknown as FloorplanScene
}

const tamu = { id: "tamu", name: "Ruang tamu", type: "ruang_tamu", floorId: "f1", x: 0, y: 0, width: 4, depth: 4, areaM2: 16 }
const kamar = { id: "kamar", name: "Kamar tidur", type: "kamar_tidur", floorId: "f1", x: 4, y: 0, width: 3, depth: 4, areaM2: 12 }
const dapur = { id: "dapur", name: "Dapur", type: "dapur", floorId: "f1", x: 0, y: 4, width: 4, depth: 3, areaM2: 12 }

describe("repairConnectivity — menyelesaikan, bukan sekadar menegur", () => {
  it("menyambungkan ruang yang terputus dengan menambah pintu ke tetangga yang pantas", () => {
    // Denah tanpa pintu sama sekali — persis kondisi 15/16 denah produksi.
    const s = scene([tamu, kamar, dapur])
    const out = repairConnectivity(s, [])
    expect(out.actions.length).toBeGreaterThan(0)
    expect(out.actions.every((a) => a.type === "addOpening")).toBe(true)
    // Setelah perbaikan, tidak ada lagi regresi konektivitas.
    expect(out.remainingIssues).toEqual([])
  })

  it("pintu perbaikan menyambung ke gugus utama, bukan asal tempel", () => {
    const s = scene([tamu, kamar, dapur])
    const out = repairConnectivity(s, [])
    // Terapkan hasilnya: guard tidak boleh menemukan ruang terputus lagi.
    expect(findConnectivityRegressions(s, out.actions)).toEqual([])
  })

  it("TIDAK menembus kamar tidur lain demi menyambung (aturan kepantasan)", () => {
    // kamar2 hanya bersebelahan dengan kamar (privat, bukan en-suite).
    // generateConnectingDoors sengaja membiarkannya — sinyal butuh koridor,
    // bukan menambal lewat kamar orang.
    const kamar2 = { id: "kamar2", name: "Kamar 2", type: "kamar_tidur", floorId: "f1", x: 7, y: 0, width: 3, depth: 4, areaM2: 12 }
    const s = scene([tamu, kamar, kamar2])
    const out = repairConnectivity(s, [])
    const viaKamar2 = out.actions.filter(
      (a) => a.type === "addOpening" && a.roomId === "kamar2"
    )
    // Boleh tidak menyambung kamar2 sama sekali; yang dilarang adalah
    // menyambungnya dengan menembus kamar tidur lain.
    if (viaKamar2.length) {
      // Bila disambung, harus lewat sisi yang menghadap tamu/koridor.
      expect(viaKamar2.every((a) => a.type === "addOpening" && a.side !== "w")).toBe(true)
    }
  })

  it("mempertahankan aksi asli agent dan hanya MENAMBAH pintu perbaikan", () => {
    const s = scene([tamu, kamar, dapur])
    const original: FloorplanAction[] = [
      { type: "updateRoom", roomId: "tamu", patch: { name: "Ruang Tamu Utama" } },
    ]
    const out = repairConnectivity(s, original)
    expect(out.actions[0]).toEqual(original[0])
    expect(out.actions.length).toBeGreaterThan(1)
  })

  it("tidak menambah apa pun bila denah sudah tersambung", () => {
    const s = scene(
      [tamu, kamar],
      [
        { id: "d1", roomId: "tamu", side: "e", type: "door", positionM: 2, widthM: 0.9 },
        { id: "d2", roomId: "tamu", side: "n", type: "door", positionM: 2, widthM: 0.9 },
      ]
    )
    const out = repairConnectivity(s, [])
    expect(out.actions).toEqual([])
  })

  it("MENGUSULKAN KORIDOR bila ruang terkurung tak bisa dicapai tanpa menembus kamar orang", () => {
    // KASUS NYATA proj-asset-rumah-2-lantai lantai 2: kamar berjejer di sisi
    // timur, hanya bertetangga satu sama lain. Solver pintu sengaja menolak
    // menembus kamar orang — jawabannya koridor, dan sekarang agent BISA
    // membuatnya (koridor sudah terdaftar di RoomType).
    const kamarA = { id: "kamarA", name: "Kamar 2", type: "kamar_tidur", floorId: "f1", x: 5.5, y: 0, width: 3, depth: 3, areaM2: 9 }
    const kamarB = { id: "kamarB", name: "Kamar 3", type: "kamar_tidur", floorId: "f1", x: 5.5, y: 3, width: 3, depth: 3, areaM2: 9 }
    const s = scene([tamu, kamarA, kamarB])
    const out = repairConnectivity(s, [])

    const corridor = out.actions.find((a) => a.type === "addRoom" && a.roomType === "koridor")
    expect(corridor, "harus mengusulkan koridor").toBeDefined()
    // Koridor harus punya dimensi konkret, bukan default kosong.
    if (corridor?.type === "addRoom") {
      expect(corridor.width).toBeGreaterThan(0)
      expect(corridor.depth).toBeGreaterThan(0)
      expect(corridor.floorId).toBe("f1")
    }
  })

  it("koridor yang diusulkan disertai pintu penghubung, bukan petak kosong", () => {
    const kamarA = { id: "kamarA", name: "Kamar 2", type: "kamar_tidur", floorId: "f1", x: 5.5, y: 0, width: 3, depth: 3, areaM2: 9 }
    const kamarB = { id: "kamarB", name: "Kamar 3", type: "kamar_tidur", floorId: "f1", x: 5.5, y: 3, width: 3, depth: 3, areaM2: 9 }
    const s = scene([tamu, kamarA, kamarB])
    const out = repairConnectivity(s, [])

    const hasCorridor = out.actions.some((a) => a.type === "addRoom" && a.roomType === "koridor")
    if (hasCorridor) {
      // Menambah petak koridor tanpa pintu = ruang mati. Harus ada bukaan juga.
      expect(out.actions.some((a) => a.type === "addOpening")).toBe(true)
    }
  })

  it("melaporkan sisa masalah yang JUJUR bila denah tak bisa disambung otomatis", () => {
    // Ruang terkurung total (tak bersinggungan dinding dengan siapa pun).
    const terpencil = { id: "jauh", name: "Gudang", type: "gudang", floorId: "f1", x: 10, y: 10, width: 2, depth: 2, areaM2: 4 }
    const s = scene([tamu, kamar, terpencil])
    const out = repairConnectivity(s, [])
    expect(out.remainingIssues.length).toBeGreaterThan(0)
    expect(out.remainingIssues.join(" ")).toContain("Gudang")
  })
})
