// @vitest-environment node
/**
 * FASE EDIT SETELAH BUILD — kasus nyata proj-modern-tropis-1.
 *
 * Build denah sudah deterministik (buildInitialFloorplan). Tapi "agent pintar"
 * berarti REPARASI di editor juga: begitu denah jadi, pemilik berkata
 * "hapus carport", "tambah kamar tidur di lantai 2", "pindahkan kamar mandi
 * lebih dekat", dst. Baterai di bawah menjalankan satu-per-satu terhadap DENAH
 * HASIL BUILD dan menegakkan tiga hal:
 *
 *   1. Usulan yang DICOCOKKAN handler deterministik harus LOLOS gerbang
 *      (`findFloorplanActionFeedback` kosong) — usulan yang ditolak berakhir
 *      sebagai 0 aksi di layar, sama tak bergunanya dengan menolak.
 *   2. Hasil tetap layak huni: tanpa tumpang-tindih, di dalam lahan, tiap ruang
 *      terjangkau dari dalam rumah.
 *   3. Keluhan yang TIDAK cocok handler mana pun (mis. butuh penilaian desain)
 *      boleh turun ke LLM — yang TIDAK boleh adalah cocok tapi dibuang gerbang.
 *
 * Berkas ini AUTO-RUN (tanpa DB): brief/project memakai data proj-modern-tropis-1
 * yang sama dengan produksi, lahan 12×18 m, program 12 ruang.
 */
import { describe, it, expect } from "vitest"

import { buildInitialFloorplan } from "./initial-floorplan"
import { handleFloorplanInstruction } from "@/lib/assistant/deterministic"
import { findFloorplanActionFeedback, simulateFloorplanActions } from "./editor-assistant"
import { analyzeRoomConnectivity, isOutdoorRoom } from "@/lib/geometry/connectivity"
import { parseOpeningWall } from "@/lib/geometry"
import type { FloorplanAction, FloorplanScene } from "@/lib/assistant/actions"
import type { Brief, Opening, Project, Room } from "@/types"

const project = {
  id: "proj-modern-tropis-1",
  name: "Rumah Tropis Modern",
  floors: 1,
  rooftop: false,
  site: { widthM: 12, depthM: 18, areaM2: 216 },
} as unknown as Project

const brief = {
  projectId: "proj-modern-tropis-1",
  summary: "Brief disusun berdasarkan denah eksisting (1 lantai, 12 ruang, ~199m²).",
  site: { widthM: 12, depthM: 18 },
  building: { floors: 1, rooftop: false },
  priorities: ["terasa_lega", "ventilasi", "banyak_cahaya"],
  spaceProgram: [
    { id: "sp-1", roomType: "carport", name: "Carport", required: true, quantity: 1 },
    { id: "sp-2", roomType: "ruang_tamu", name: "Ruang Tamu", required: true, quantity: 1 },
    { id: "sp-3", roomType: "ruang_keluarga", name: "Ruang Keluarga", required: true, quantity: 1 },
    { id: "sp-4", roomType: "dapur", name: "Dapur", required: true, quantity: 1 },
    { id: "sp-5", roomType: "ruang_makan", name: "Ruang Makan", required: true, quantity: 1 },
    { id: "sp-6", roomType: "kamar_tidur", name: "Kamar tidur 1", required: true, quantity: 1 },
    { id: "sp-7", roomType: "kamar_tidur", name: "Kamar tidur 2", required: true, quantity: 1 },
    { id: "sp-8", roomType: "kamar_tidur", name: "Kamar tidur 3", required: true, quantity: 1 },
    { id: "sp-9", roomType: "kamar_mandi", name: "Kamar mandi 1", required: true, quantity: 1 },
    { id: "sp-10", roomType: "kamar_mandi", name: "Kamar mandi 2", required: true, quantity: 1 },
    { id: "sp-11", roomType: "laundry", name: "Laundry", required: true, quantity: 1 },
    { id: "sp-12", roomType: "taman", name: "Taman Depan", required: true, quantity: 1 },
  ],
  assumptions: [],
  constraints: [],
  risks: [],
} as unknown as Brief

const EMPTY: FloorplanScene = {
  site: { widthM: 12, depthM: 18 },
  floors: [],
  selectedFloorId: null,
  selectedRoomId: null,
  rooms: [],
  openings: [],
}

/** Bangun denah, lalu materialisasi jadi scene yang siap diedit. */
function buildDenah(): { scene: FloorplanScene; rooms: Room[] } {
  const build = buildInitialFloorplan("buatkan denah 2 lantai, sesuai brief", EMPTY, project, brief)
  expect(build.matched, "build denah awal gagal").toBe(true)

  const rooms = simulateFloorplanActions(build.actions, EMPTY) as unknown as Room[]
  const floorOf = new Map(rooms.map((r) => [r.id, r.floorId]))
  let seq = 0
  const openings = build.actions
    .filter((a): a is Extract<FloorplanAction, { type: "addOpening" }> => a.type === "addOpening")
    .map((a) => ({
      id: `op-${seq++}`,
      roomId: a.roomId,
      side: a.side,
      type: a.openingType,
      positionM: a.positionM,
    }))

  const floors: FloorplanScene["floors"] = [...new Set(rooms.map((r) => r.floorId))].map((id) => {
    const level = Number(/^floor-(\d+)$/.exec(id)?.[1] ?? 1)
    return { id, name: `Lantai ${level}`, level }
  })

  const scene: FloorplanScene = { ...EMPTY, floors, selectedFloorId: floors[0]?.id ?? null, rooms, openings }
  return { scene, rooms }
}

/** Terapkan aksi edit → scene hasil, untuk menilai kelayakan. */
function editResult(scene: FloorplanScene, actions: FloorplanAction[]) {
  const rooms = simulateFloorplanActions(actions, scene) as unknown as Room[]
  const floorOf = new Map(rooms.map((r) => [r.id, r.floorId]))
  let seq = 0
  const openings: Opening[] = []
  const openingScene = [...scene.openings, ...actions.filter((a): a is Extract<FloorplanAction, { type: "addOpening" }> => a.type === "addOpening").map((a) => ({ id: `a-${seq++}`, roomId: a.roomId, side: a.side, type: a.openingType, positionM: a.positionM }))]
  // hapus bukaan di ruang yang dihapus
  const kept = openingScene.filter((o) => rooms.some((r) => r.id === o.roomId))
  for (const [i, o] of kept.entries()) {
    openings.push({
      id: `sim-${i}`,
      floorId: floorOf.get(o.roomId) ?? "",
      wallId: `${o.roomId}:${o.side}`,
      type: o.type,
      positionM: o.positionM,
      widthM: o.type === "door" ? 0.9 : 1.2,
      heightM: 2.1,
    } as Opening)
  }
  return { rooms, openings }
}

/** Kasus yang wajar diucapkan pemilik rumah SETELAH denah jadi.
 *  `wajibCocok: true` = permintaan yang SESUNGGUHNYA deterministic (hapus tipe,
 *  tambah tipe di lantai, tambah bukaan, pindah ruang antar lantai) — kalau
 *  tidak cocok berarti agent menyerah ke LLM padahal seharusnya bisa langsung
 *  dikerjakan = keluhan "agent bodoh". */
const EDITS: Array<{ kalimat: string; wajibCocok?: boolean }> = [
  { kalimat: "Hapus ruang Carport", wajibCocok: true },
  { kalimat: "hapus ruang Dapur", wajibCocok: true },
  { kalimat: "Tambah satu kamar tidur di lantai 2" },
  { kalimat: "tambahkan kamar mandi di lantai 1", wajibCocok: true },
  { kalimat: "Pindahkan kamar mandi 1 lebih dekat ke kamar tidur" },
  { kalimat: "Perbaiki pintu ruang keluarga" },
  { kalimat: "Tambahkan jendela di ruang makan", wajibCocok: true },
  { kalimat: "Kamar tidur 1 tidak bisa diakses dari dalam, tolong perbaiki" },
  { kalimat: "denahnya masih ada ruang yang tumpang tindih, perbaiki" },
  { kalimat: "ruang laundry terlalu sempit" },
  { kalimat: "pindahkan kamar tidur 1 ke lantai 1" },
  { kalimat: "pindahkan dapur dari lantai 1 ke lantai 2" },
  { kalimat: "tambahkan jendela di semua kamar tidur" },
  { kalimat: "ruang keluarga terlalu kecil" },
  { kalimat: "kamar mandi 2 tidak bisa diakses dari dalam" },
  // Family "perbaiki sesuai standar / kenyamanan" — wajib dicek ikke-nya dibuang.
  { kalimat: "perbaiki semua yang bermasalah sesuai standar", wajibCocok: true },
  { kalimat: "ruang tamu kurang cahaya, tambahkan jendela", wajibCocok: true },
  { kalimat: "kamar mandi 1 terlalu sempit" },
  { kalimat: "rumahnya dari depan ke belakang harus bisa dilewati, perbaiki akses" },
  { kalimat: "ruang keluarga dan dapur alirannya kurang, bukakan dinding di antaranya" },
]

describe("Fase edit — usulan yang cocok TIDAK boleh dibuang gerbang", () => {
  const { scene, rooms: denahRooms } = buildDenah()
  it("denah hasil build sehat terlebih dahulu", () => {
    expect(denahRooms.length).toBeGreaterThanOrEqual(12)
    expect(scene.openings.length).toBeGreaterThan(0)
    const doorHosts = new Set(scene.openings.filter((o) => o.type === "door").map((o) => o.roomId))
    const tanpaPintu = denahRooms.filter((r) => !isOutdoorRoom(r) && !doorHosts.has(r.id))
    expect(tanpaPintu.map((r) => r.name), "ruang dalam tanpa pintu").toEqual([])
  })

  for (const { kalimat, wajibCocok } of EDITS) {
    it(`"${kalimat}"`, () => {
      const res = handleFloorplanInstruction(kalimat, scene)
      if (!res.matched) {
        // Tak cocok hanya dibolehkan bila memang bukan kasus deterministic —
        // kalau WAJIB cocok, ini keluhan "agent bodoh" yang harus diperbaiki.
        expect(wajibCocok, `harusnya ditangani deterministik tapi tidak cocok`).toBeFalsy()
        return // boleh jatuh ke LLM — bukan kegagalan di sini
      }

      const feedback = findFloorplanActionFeedback(scene, res.actions, kalimat)
      expect(feedback, `usulan DICOCOKKAN tapi ditolak gerbang: ${feedback.join(" | ")}`)
        .toEqual([])

      const { rooms, openings } = editResult(scene, res.actions)
      // Bebas tumpang-tindih + di dalam lahan.
      for (const [i, a] of rooms.entries()) {
        for (const b of rooms.slice(i + 1)) {
          if (a.floorId !== b.floorId) continue
          const bertabrakan =
            a.x < b.x + b.width - 0.01 && a.x + a.width > b.x + 0.01 &&
            a.y < b.y + b.depth - 0.01 && a.y + a.depth > b.y + 0.01
          expect(bertabrakan, `${a.name} menimpa ${b.name}`).toBe(false)
        }
        expect(a.x + a.width).toBeLessThanOrEqual(project.site.widthM + 0.05)
        expect(a.y + a.depth).toBeLessThanOrEqual(project.site.depthM + 0.05)
      }
      // Tetap layak huni.
      const { isolated } = analyzeRoomConnectivity(rooms, openings)
      expect(isolated.map((r) => r.name), "ada ruang terkurung").toEqual([])
      const doorHosts = new Set(openings.filter((o) => o.type === "door").map((o) => parseOpeningWall(o.wallId)?.roomId))
      const tanpaPintu = rooms.filter((r) => !isOutdoorRoom(r) && !doorHosts.has(r.id))
      expect(tanpaPintu.map((r) => r.name), "ruang dalam tanpa pintu").toEqual([])
    })
  }
})
