// @vitest-environment node
/**
 * PEMBANGUN DENAH AWAL DETERMINISTIK — menutup regresi proj-modern-tropis-1.
 *
 * Riwayat masalahnya berlapis. Tiga lapis pertama sudah ditutup di prompt:
 * brief tak terkirim, denah kosong tak dibedakan dari data hilang, dan konflik
 * jumlah lantai dijadikan alasan berhenti. Setelah itu agent BENAR-BENAR
 * menggambar — dan tetap gagal, karena koordinat 9 ruang + koridor yang
 * dikarang LLM selalu bertabrakan; validator menolak, seluruh usulan dibuang,
 * pengguna kembali menerima 0 aksi.
 *
 * Menghitung tata letak bebas tabrakan bukan pekerjaan LLM — dan proyek ini
 * sudah punya solvernya (`generateLayout`, treemap + generateConnectingDoors,
 * dipakai review/rab/layout). Pola "solver ada tapi jalur agent tidak pakai"
 * sudah berulang empat kali di Baruma; modul ini memutusnya untuk kasus denah
 * kosong.
 */
import { describe, it, expect } from "vitest"

import { buildInitialFloorplan } from "./initial-floorplan"
import type { Brief, Project } from "@/types"
import type { FloorplanScene } from "@/lib/assistant/actions"

const project = {
  id: "proj-modern-tropis-1",
  name: "Rumah Tropis Modern",
  floors: 1,
  rooftop: false,
  site: { widthM: 12, depthM: 18, areaM2: 216 },
} as unknown as Project

/** Program ruang PERSIS milik proj-modern-tropis-1 di produksi. */
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

const emptyScene: FloorplanScene = {
  site: { widthM: 12, depthM: 18 },
  floors: [],
  selectedFloorId: null,
  selectedRoomId: null,
  rooms: [],
  openings: [],
}

const sceneWithRooms: FloorplanScene = {
  ...emptyScene,
  floors: [{ id: "floor-1", name: "Lantai 1", level: 1 }],
  selectedFloorId: "floor-1",
  rooms: [
    { id: "r1", name: "Ruang Tamu", type: "ruang_tamu", floorId: "floor-1", x: 0, y: 0, width: 3, depth: 3, areaM2: 9, locked: false },
  ],
}

/** Mirip kondisi prod proj-modern-tropis-1: lantai 2 ber-id acak. */
const sceneTerisiProdLike: FloorplanScene = {
  ...emptyScene,
  floors: [
    { id: "floor-1", name: "Lantai 1", level: 1 },
    { id: "floor-k4KTN1", name: "Lantai 2", level: 2 },
  ],
  selectedFloorId: "floor-1",
  rooms: [
    { id: "r1", name: "Ruang Tamu", type: "ruang_tamu", floorId: "floor-1", x: 0, y: 0, width: 3, depth: 3, areaM2: 9, locked: false },
    { id: "r2", name: "Dapur", type: "dapur", floorId: "floor-1", x: 4, y: 0, width: 3, depth: 3, areaM2: 9, locked: false },
    { id: "r3", name: "Kamar tidur", type: "kamar_tidur", floorId: "floor-k4KTN1", x: 0, y: 0, width: 3, depth: 3, areaM2: 9, locked: false },
  ],
}

describe("buildInitialFloorplan — kapan handler ini mengambil alih", () => {
  it("menangani permintaan membangun denah saat denah kosong & brief berisi", () => {
    const res = buildInitialFloorplan("buatkan denah 2 lantai, sesuai brief", emptyScene, project, brief)
    expect(res.matched).toBe(true)
  })

  it("mengabaikan permintaan bila denah SUDAH berisi ruang (jangan menimpa karya pengguna)", () => {
    const res = buildInitialFloorplan("buatkan denah 2 lantai, sesuai brief", sceneWithRooms, project, brief)
    expect(res.matched).toBe(false)
  })

  it("mengabaikan bila brief tidak punya program ruang (tak ada bahan)", () => {
    const kosong = { ...brief, spaceProgram: [] } as Brief
    const res = buildInitialFloorplan("buatkan denah", emptyScene, project, kosong)
    expect(res.matched).toBe(false)
  })

  it("mengabaikan instruksi yang bukan permintaan membangun denah", () => {
    const res = buildInitialFloorplan("kenapa pakai kitchen island?", emptyScene, project, brief)
    expect(res.matched).toBe(false)
  })

  it("mengenali beragam ungkapan pengguna untuk membangun denah", () => {
    for (const kalimat of [
      "buatkan denah 2 lantai, sesuai brief",
      "tolong buat denah rumahnya",
      "gambarkan denah sesuai brief",
      "susun denah dari awal",
      "bikin layout rumah dong",
      "generate denah",
    ]) {
      expect(buildInitialFloorplan(kalimat, emptyScene, project, brief).matched, kalimat).toBe(true)
    }
  })
})

describe("buildInitialFloorplan — kualitas denah yang dihasilkan", () => {
  const run = (instruction = "buatkan denah 2 lantai, sesuai brief") =>
    buildInitialFloorplan(instruction, emptyScene, project, brief)

  it("membuat semua ruang dari program ruang brief", () => {
    const { actions } = run()
    const added = actions.filter((a) => a.type === "addRoom")
    // 12 ruang program; koridor tambahan boleh ada.
    expect(added.length).toBeGreaterThanOrEqual(12)
    const types = added.map((a) => (a as { roomType: string }).roomType)
    expect(types.filter((t) => t === "kamar_tidur")).toHaveLength(3)
    expect(types.filter((t) => t === "kamar_mandi")).toHaveLength(2)
    expect(types).toContain("carport")
    expect(types).toContain("laundry")
    expect(types).toContain("taman")
  })

  it("menghormati jumlah lantai yang diminta pengguna, bukan angka lama di brief", () => {
    const { actions } = run("buatkan denah 2 lantai, sesuai brief")
    const floors = actions.filter((a) => a.type === "addFloor")
    expect(floors.length).toBe(2)
    const floorIds = new Set(
      actions.filter((a) => a.type === "addRoom").map((a) => (a as { floorId?: string }).floorId)
    )
    expect(floorIds.has("floor-2")).toBe(true)
  })

  it("menempatkan ruang privat di lantai atas dan publik di lantai dasar", () => {
    const { actions } = run("buatkan denah 2 lantai sesuai brief")
    const rooms = actions.filter((a) => a.type === "addRoom") as Array<{ roomType: string; floorId?: string }>
    const carport = rooms.find((r) => r.roomType === "carport")
    const bedrooms = rooms.filter((r) => r.roomType === "kamar_tidur")
    expect(carport?.floorId).toBe("floor-1")
    expect(bedrooms.every((b) => b.floorId === "floor-2")).toBe(true)
  })

  it("tidak menghasilkan ruang yang tumpang-tindih", () => {
    const { actions } = run()
    const rooms = actions.filter((a) => a.type === "addRoom") as Array<{
      floorId?: string; x?: number; y?: number; width?: number; depth?: number
    }>
    for (const [i, a] of rooms.entries()) {
      for (const b of rooms.slice(i + 1)) {
        if (a.floorId !== b.floorId) continue
        const overlap =
          a.x! < b.x! + b.width! && a.x! + a.width! > b.x! &&
          a.y! < b.y! + b.depth! && a.y! + a.depth! > b.y!
        expect(overlap, `${JSON.stringify(a)} vs ${JSON.stringify(b)}`).toBe(false)
      }
    }
  })

  it("menjaga semua ruang di dalam batas lahan", () => {
    const { actions } = run()
    for (const a of actions.filter((x) => x.type === "addRoom") as Array<{
      x?: number; y?: number; width?: number; depth?: number
    }>) {
      expect(a.x! + a.width!).toBeLessThanOrEqual(12.001)
      expect(a.y! + a.depth!).toBeLessThanOrEqual(18.001)
      expect(a.x!).toBeGreaterThanOrEqual(-0.001)
      expect(a.y!).toBeGreaterThanOrEqual(-0.001)
    }
  })

  it("menyertakan pintu penghubung, bukan hanya kotak-kotak ruang", () => {
    const { actions } = run()
    const doors = actions.filter(
      (a) => a.type === "addOpening" && (a as { openingType?: string }).openingType === "door"
    )
    expect(doors.length).toBeGreaterThan(0)
  })

  it("balasannya menyebut jumlah ruang & lantai, tanpa menagih data ke pengguna", () => {
    const { reply } = run()
    expect(reply).toMatch(/\d+ ruang/)
    expect(reply).not.toMatch(/mohon|perlu informasi lebih detail/i)
  })

  /**
   * Brief ini menargetkan 1 lantai, tapi 12 ruang di lahan 12×18 m tidak bisa
   * ditata layak huni dalam satu lantai — treemap mengubur ruang di tengah dan
   * `ensureCorridor` sengaja tidak menyisipkan koridor bila lantai sudah punya
   * ruang sirkulasi (catatan lib/mock/layout.ts). Menaikkannya ke 2 lantai
   * DENGAN penjelasan lebih berguna daripada menyerahkan usulan yang dibuang
   * validator, yang di layar pengguna tampak sebagai 0 aksi.
   */
  it("menaikkan ke 2 lantai bila program padat tak layak di satu lantai, dan menjelaskannya", () => {
    const { actions, reply } = run("tolong buatkan denahnya")
    expect(actions.filter((a) => a.type === "addFloor").length).toBe(2)
    expect(reply).toMatch(/tidak bisa ditata layak huni dalam 1 lantai/i)
  })

  it("program kecil tetap satu lantai (tidak menaikkan tanpa alasan)", () => {
    const kecil = {
      ...brief,
      spaceProgram: brief.spaceProgram.slice(0, 4),
    } as Brief
    const res = buildInitialFloorplan("tolong buatkan denahnya", emptyScene, project, kecil)
    expect(res.matched).toBe(true)
    expect(res.actions.filter((a) => a.type === "addFloor").length).toBe(1)
    expect(res.reply).not.toMatch(/sebagai gantinya/i)
  })
})

describe("buildInitialFloorplan — bangun ulang dari nol (reset eksplisit)", () => {
  it("menolak build biasa di denah terisi (anti-menimpa tetap berlaku)", () => {
    const res = buildInitialFloorplan("buatkan denah 2 lantai sesuai brief", sceneTerisiProdLike, project, brief)
    expect(res.matched).toBe(false)
  })

  it("mengambil alih bila pengguna EKSPLISIT minta bangun ulang dari nol", () => {
    const res = buildInitialFloorplan(
      "bangun ulang denah ini dari nol, 2 lantai",
      sceneTerisiProdLike,
      project,
      brief
    )
    expect(res.matched).toBe(true)
    expect(res.reset).toBe(true)
    expect(res.reply).toMatch(/kosongkan/i)

    // Semua ruang lama dikosongkan.
    const deletes = res.actions.filter((a) => a.type === "deleteRoom")
    expect(deletes.map((d) => d.roomId).sort()).toEqual(["r1", "r2", "r3"])

    // Lantai yang SUDAH ADA tidak dibuat ulang (tanpa addFloor) — kalau tidak,
    // rebuild di denah berlantai melahirkan lantai hantu level 3/4.
    expect(res.actions.filter((a) => a.type === "addFloor").length).toBe(0)

    // Ruang lantai 2 merujuk lantai NYATA di scene, bukan label "floor-2".
    const level2 = res.actions.filter(
      (a) => a.type === "addRoom" && (a as { floorId?: string }).floorId === "floor-k4KTN1"
    )
    expect(level2.length).toBeGreaterThan(0)
  })

  it("lolos gerbang validator (usulan tak akan dibuang saat di-apply)", () => {
    const res = buildInitialFloorplan(
      "reset denah, susun ulang sesuai brief",
      sceneTerisiProdLike,
      project,
      brief
    )
    expect(res.matched).toBe(true)
    const rooms = res.actions.filter((a) => a.type === "addRoom") as Array<{
      floorId?: string; x?: number; y?: number; width?: number; depth?: number
    }>
    // Tak boleh ada ruang yang tumpang-tindih di lantai yang sama.
    for (const [i, a] of rooms.entries()) {
      for (const b of rooms.slice(i + 1)) {
        if (a.floorId !== b.floorId) continue
        const overlap =
          a.x! < b.x! + b.width! && a.x! + a.width! > b.x! &&
          a.y! < b.y! + b.depth! && a.y! + a.depth! > b.y!
        expect(overlap, `${a.floorId} menimpa`).toBe(false)
      }
    }
  })

  it("mengenali beberapa ungkapan reset", () => {
    for (const kalimat of [
      "bangun ulang denah dari nol",
      "reset denah, mulai dari nol",
      "buat ulang layout sesuai brief",
      "mulai ulang denah dari awal",
      "susun ulang denah sesuai brief",
    ]) {
      const res = buildInitialFloorplan(kalimat, sceneTerisiProdLike, project, brief)
      expect(res.matched, kalimat).toBe(true)
    }
  })

  it("di denah KOSONG, 'dari nol' tetap build biasa (bukan reset)", () => {
    const res = buildInitialFloorplan("buatkan denah dari nol, 2 lantai", emptyScene, project, brief)
    expect(res.matched).toBe(true)
    expect(res.reset).toBeFalsy()
    expect(res.actions.filter((a) => a.type === "deleteRoom").length).toBe(0)
  })
})
