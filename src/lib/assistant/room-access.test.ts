// @vitest-environment node
import { describe, it, expect } from "vitest"

import { handleFloorplanInstruction } from "./deterministic"
import { analyzeRoomConnectivity } from "@/lib/geometry/connectivity"
import type { FloorplanScene } from "./actions"
import type { Opening, Room } from "@/types"

/**
 * Meniru cacat NYATA yang dilaporkan pemilik rumah di proyek
 * "Rumah Tropis Modern - Carport Batu Alam":
 *   Kamar tidur 2 punya pintu ke LUAR + pintu ke kamar mandinya sendiri
 *   (buntu) — dari Ruang Keluarga tetap tak terjangkau tanpa keluar rumah.
 * Pemeriksaan "punya pintu" lolos; pemeriksaan konektivitas menangkapnya.
 */
function scene(): FloorplanScene {
  const rooms = [
    { id: "keluarga", name: "Ruang Keluarga", type: "ruang_keluarga", floorId: "f1", x: 0, y: 0, width: 4, depth: 4, areaM2: 16 },
    { id: "dapur", name: "Dapur", type: "dapur", floorId: "f1", x: 4, y: 0, width: 3, depth: 4, areaM2: 12 },
    { id: "kt2", name: "Kamar tidur 2", type: "kamar_tidur", floorId: "f1", x: 0, y: 4, width: 3, depth: 3, areaM2: 9 },
    { id: "km2", name: "Kamar mandi 2", type: "kamar_mandi", floorId: "f1", x: 3, y: 4, width: 2, depth: 3, areaM2: 6 },
  ]
  const openings = [
    // pintu masuk rumah (keluarga → luar)
    { id: "d-entry", roomId: "keluarga", side: "n", type: "door", positionM: 2, widthM: 0.9, heightM: 2.1, floorId: "f1" },
    // keluarga ↔ dapur
    { id: "d-kel-dapur", roomId: "keluarga", side: "e", type: "door", positionM: 2, widthM: 0.9, heightM: 2.1, floorId: "f1" },
    // kamar tidur 2 → LUAR saja
    { id: "d-kt2-luar", roomId: "kt2", side: "s", type: "door", positionM: 1.5, widthM: 0.9, heightM: 2.1, floorId: "f1" },
    // kamar tidur 2 ↔ kamar mandinya sendiri (buntu)
    { id: "d-kt2-km2", roomId: "kt2", side: "e", type: "door", positionM: 1.5, widthM: 0.8, heightM: 2.1, floorId: "f1" },
  ]
  return { site: { widthM: 10, depthM: 10 }, floors: [{ id: "f1", name: "Lantai 1", level: 1 }], rooms, openings } as unknown as FloorplanScene
}

describe("konektivitas ruang", () => {
  it("menandai kamar yang hanya bisa dicapai lewat luar, meski punya 2 pintu", () => {
    const s = scene()
    const { isolated, withExteriorDoor } = analyzeRoomConnectivity(
      s.rooms as unknown as Room[],
      s.openings.map((o) => ({ ...o, wallId: `${o.roomId}:${o.side}` })) as unknown as Opening[],
    )
    const names = isolated.map((r) => r.name)
    expect(names).toContain("Kamar tidur 2")
    expect(names).toContain("Kamar mandi 2") // ikut terputus (buntu di balik kt2)
    expect(names).not.toContain("Ruang Keluarga")
    expect(withExteriorDoor.has("kt2")).toBe(true)
  })
})

describe("agent — keluhan akses ruang", () => {
  const PHRASES = [
    "Tolong perbaiki lagi designnya, kamar tidur 2 tidak ada akses ke dalam rumah, pintunya hanya keluar rumah",
    "kamar tidur 2 gak ada akses ke dalam rumah",
    "kamar tidur 2 pintunya cuma keluar, gak bisa masuk dari dalam",
    "kamar tidur 2 terputus dari rumah",
  ]

  it.each(PHRASES)("menangani keluhan: %s", (phrase) => {
    const res = handleFloorplanInstruction(phrase, scene())
    expect(res.matched).toBe(true)
    if (!res.matched) return
    expect(res.actions).toHaveLength(1)
    const a = res.actions[0]
    expect(a.type).toBe("addOpening")
    if (a.type !== "addOpening") return
    expect(a.roomId).toBe("kt2")
    expect(a.openingType).toBe("door")
    // WAJIB menembus ke gugus utama (Ruang Keluarga di sisi utara kt2)
    expect(a.side).toBe("n")
  })

  it("pintu baru benar-benar menyambungkan ruang (diverifikasi ulang)", () => {
    const s = scene()
    const res = handleFloorplanInstruction(PHRASES[0], s)
    expect(res.matched).toBe(true)
    if (!res.matched || res.actions[0]?.type !== "addOpening") throw new Error("aksi tak terduga")
    const a = res.actions[0]
    const openings = [
      ...s.openings.map((o) => ({ ...o, wallId: `${o.roomId}:${o.side}` })),
      { id: "baru", wallId: `${a.roomId}:${a.side}`, type: "door", positionM: a.positionM, widthM: 0.9, heightM: 2.1, floorId: "f1" },
    ]
    const { isolated } = analyzeRoomConnectivity(s.rooms as unknown as Room[], openings as unknown as Opening[])
    expect(isolated.map((r) => r.name)).not.toContain("Kamar tidur 2")
    expect(isolated).toHaveLength(0) // kamar mandi ikut tersambung lewat kt2
  })

  it("tidak salah picu pada instruksi lain", () => {
    for (const q of ["tambah jendela di dapur", "perbesar kamar tidur 2", "pindahkan dapur ke lantai 2"]) {
      const res = handleFloorplanInstruction(q, scene())
      if (res.matched) {
        expect(res.actions.every((a) => a.type !== "addOpening" || a.roomId !== "kt2" || a.side !== "n")).toBe(true)
      }
    }
  })

  it("MENOLAK menembus kamar privat — menjelaskan butuh koridor, bukan sekadar pintu", () => {
    // Kamar terputus yang tetangga tersambungnya HANYA kamar tidur lain.
    // Menyambungkannya membuat graf "tersambung" tapi memaksa penghuni
    // melewati kamar orang — memperbaiki angka, bukan denahnya.
    const s = scene()
    // Sambungkan kt2 ke inti rumah dulu, supaya kt2/km2 masuk gugus utama.
    s.openings.push({ id: "d-kel-kt2", roomId: "keluarga", side: "s", type: "door", positionM: 1.5, widthM: 0.9, heightM: 2.1, floorId: "f1" } as never)
    // kt9 ditaruh tepat di SELATAN kamar mandi 2 — satu-satunya tetangganya.
    // Dua percobaan sebelumnya gagal jadi skenario yang dimaksud: di bawah kt2
    // (mengubah pintu-ke-luar kt2 jadi pintu antar-kamar) dan di timur km2
    // (ternyata juga menempel Dapur, yang bukan ruang privat).
    s.rooms.push({
      id: "kt9", name: "Kamar tidur 9", type: "kamar_tidur", floorId: "f1",
      x: 3, y: 7, width: 2, depth: 3, areaM2: 6,
    } as never)
    const res = handleFloorplanInstruction("kamar tidur 9 tidak ada akses ke dalam rumah", s)
    expect(res.matched).toBe(true)
    if (!res.matched) return
    expect(res.actions).toHaveLength(0)
    expect(res.reply).toContain("ruang privat")
    expect(res.reply).toContain("koridor")
  })

  it("bila semua sudah tersambung, menjawab tanpa mengubah apa pun", () => {
    const s = scene()
    s.openings.push({ id: "d-fix", roomId: "kt2", side: "n", type: "door", positionM: 1.5, widthM: 0.9, heightM: 2.1, floorId: "f1" } as never)
    const res = handleFloorplanInstruction(PHRASES[0], s)
    expect(res.matched).toBe(true)
    if (!res.matched) return
    expect(res.actions).toHaveLength(0)
    expect(res.reply).toContain("sudah terhubung")
  })
})
