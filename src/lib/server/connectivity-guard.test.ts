import { describe, expect, it } from "vitest"

import { findConnectivityRegressions } from "./connectivity-guard"
import type { FloorplanAction, FloorplanScene } from "@/lib/assistant/actions"

/**
 * INVARIANT ARSITEKTUR, bukan constraint per-bukaan.
 *
 * Keluhan pemilik: "yang namanya ruangan itu harus bisa diakses dari dalam
 * rumah, bukan sembarangan naruh pintu; dan rumah itu dari depan ke belakang
 * bisa diakses dari dalam rumah — lumrahnya desain rumah seperti ini."
 *
 * `analyzeRoomConnectivity` sudah menjawab pertanyaan itu dengan benar sejak
 * lama (properti GLOBAL: bisakah berjalan antar-ruang tanpa keluar rumah),
 * tapi hanya dipanggil REAKTIF — saat user mengeluh (deterministic.ts
 * matchFixRoomAccess, di-gate ACCESS_COMPLAINT) atau di audit pasif. Gerbang
 * yang memvalidasi setiap aksi agent (findFloorplanActionFeedback) TIDAK
 * memeriksanya sama sekali.
 *
 * Akibatnya agent bisa menghapus pintu satu-satunya ke sebuah ruang, atau
 * menggeser ruang sampai terputus, tanpa ada yang menegur.
 *
 * Guard ini menutup celah itu: usulan disimulasikan, konektivitas dihitung
 * SEBELUM dan SESUDAH, dan hanya REGRESI yang dilaporkan — cacat yang sudah
 * ada sebelumnya bukan salah aksi ini.
 */

const FLOORS = [{ id: "f1", name: "Lantai 1", level: 1 }]

/** Rumah waras: tamu <-> kamar, tamu punya pintu keluar. */
function baseScene(): FloorplanScene {
  return {
    site: { widthM: 12, depthM: 12 },
    floors: FLOORS,
    selectedFloorId: "f1",
    rooms: [
      { id: "tamu", name: "Ruang tamu", type: "ruang_tamu", floorId: "f1", x: 0, y: 0, width: 4, depth: 4, areaM2: 16 },
      { id: "kamar", name: "Kamar tidur", type: "kamar_tidur", floorId: "f1", x: 4, y: 0, width: 3, depth: 4, areaM2: 12 },
    ],
    openings: [
      // tamu <-> kamar (dinding timur tamu)
      { id: "d-dalam", roomId: "tamu", side: "e", type: "door", positionM: 2, widthM: 0.9, heightM: 2.1 },
      // pintu masuk
      { id: "d-luar", roomId: "tamu", side: "n", type: "door", positionM: 2, widthM: 0.9, heightM: 2.1 },
    ],
  } as unknown as FloorplanScene
}

describe("findConnectivityRegressions — ruang harus tetap terjangkau dari dalam", () => {
  it("menegur penghapusan pintu yang memutus satu-satunya akses dalam ke sebuah ruang", () => {
    const scene = baseScene()
    const actions: FloorplanAction[] = [{ type: "deleteOpening", openingId: "d-dalam" }]
    const out = findConnectivityRegressions(scene, actions)
    expect(out.length).toBeGreaterThan(0)
    expect(out.join(" ")).toContain("Kamar tidur")
  })

  it("tidak menegur aksi yang tidak menyentuh konektivitas", () => {
    const scene = baseScene()
    const actions: FloorplanAction[] = [
      { type: "updateRoom", roomId: "tamu", patch: { name: "Ruang Tamu Baru" } },
    ]
    expect(findConnectivityRegressions(scene, actions)).toEqual([])
  })

  it("menegur ruang BARU yang lahir tanpa akses dari dalam rumah", () => {
    // Menambah kamar tanpa pintu = ruang yang tak bisa dimasuki. Lumrahnya
    // desain rumah tidak begitu.
    const scene = baseScene()
    const actions: FloorplanAction[] = [
      { type: "addRoom", roomType: "kamar_tidur", floorId: "f1", x: 0, y: 4, width: 3, depth: 3 },
    ]
    const out = findConnectivityRegressions(scene, actions)
    expect(out.length).toBeGreaterThan(0)
  })

  it("TIDAK menegur ruang baru yang sekaligus diberi pintu ke gugus utama", () => {
    const scene = baseScene()
    const actions: FloorplanAction[] = [
      { type: "addRoom", roomType: "kamar_tidur", floorId: "f1", x: 0, y: 4, width: 3, depth: 3 },
      // pintu di dinding utara ruang baru, menghadap tamu (y 0–4)
      { type: "addOpening", roomId: "new-2", side: "n", positionM: 1.5, openingType: "door" },
    ]
    expect(findConnectivityRegressions(scene, actions)).toEqual([])
  })

  it("tidak menyalahkan aksi atas ruang yang MEMANG sudah terputus sebelumnya", () => {
    // Gudang sudah terisolasi sejak awal; aksi hanya mengganti nama ruang lain.
    const scene = baseScene()
    ;(scene.rooms as unknown as Array<Record<string, unknown>>).push({
      id: "gudang", name: "Gudang", type: "gudang", floorId: "f1",
      x: 8, y: 8, width: 2, depth: 2, areaM2: 4,
    })
    const actions: FloorplanAction[] = [
      { type: "updateRoom", roomId: "tamu", patch: { name: "Ruang Tamu" } },
    ]
    expect(findConnectivityRegressions(scene, actions)).toEqual([])
  })

  it("menegur pintu yang hanya keluar rumah untuk ruang yang jadi terputus", () => {
    // Hapus pintu dalam, ganti pintu ke luar: kamar "punya pintu" tapi tak
    // terjangkau dari dalam rumah — persis keluhan produksi yang melahirkan
    // modul connectivity.
    const scene = baseScene()
    const actions: FloorplanAction[] = [
      { type: "deleteOpening", openingId: "d-dalam" },
      { type: "addOpening", roomId: "kamar", side: "e", positionM: 2, openingType: "door" },
    ]
    const out = findConnectivityRegressions(scene, actions)
    expect(out.length).toBeGreaterThan(0)
    expect(out.join(" ")).toMatch(/dalam rumah|terputus|terjangkau/i)
  })
})
