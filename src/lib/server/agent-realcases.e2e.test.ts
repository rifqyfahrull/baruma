// @vitest-environment node
/**
 * LATIHAN AGENT ATAS KASUS NYATA — brief produksi proj-modern-tropis-1.
 *
 * Satu skenario yang lulus tidak membuktikan agent pintar; ia hanya
 * membuktikan satu kalimat kebetulan cocok. Berkas ini menjalankan RAGAM
 * permintaan yang wajar diucapkan pemilik rumah terhadap denah kosong, lalu
 * memeriksa tiga hal yang selama ini gagal di produksi:
 *
 *   1. Agent MEMBANGUN (ada aksi), bukan menagih data yang sudah ia pegang.
 *   2. Usulannya LOLOS gerbang validator — sebab usulan yang ditolak berakhir
 *      sebagai 0 aksi di layar pengguna, sama tak bergunanya dengan menolak.
 *   3. Hasilnya LAYAK HUNI: tanpa tumpang-tindih, di dalam lahan, tiap ruang
 *      dalam terjangkau dari dalam rumah.
 *
 * Sekaligus menjaga batas: kalimat yang BUKAN permintaan membangun tidak boleh
 * memicu pembangunan, dan denah yang sudah berisi ruang tidak boleh ditimpa.
 *
 *   RUN_E2E_PROD=1 node --env-file=.env.local node_modules/vitest/vitest.mjs \
 *     run src/lib/server/agent-realcases.e2e.test.ts
 */
import { describe, it, expect, beforeAll } from "vitest"
import { Client } from "pg"

import { buildInitialFloorplan } from "./initial-floorplan"
import { findFloorplanActionFeedback, simulateFloorplanActions } from "./editor-assistant"
import { analyzeRoomConnectivity, isOutdoorRoom } from "@/lib/geometry/connectivity"
import { parseOpeningWall } from "@/lib/geometry"
import type { FloorplanAction, FloorplanScene } from "@/lib/assistant/actions"
import type { Brief, Opening, Project, Room } from "@/types"

const ENABLED = process.env.RUN_E2E_PROD === "1" && !!process.env.DATABASE_URL
const PROJECT_ID = process.env.E2E_PROJECT_ID ?? "proj-modern-tropis-1"

let project: Project
let brief: Brief
let emptyScene: FloorplanScene

beforeAll(async () => {
  if (!ENABLED) return
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    const { rows } = await client.query(
      `select p.id, p.name, p.floors, p.rooftop, p.site, b.payload as brief
         from projects p left join briefs b on b.project_id = p.id
        where p.id = $1`,
      [PROJECT_ID]
    )
    project = {
      id: rows[0].id, name: rows[0].name, floors: rows[0].floors,
      rooftop: rows[0].rooftop, site: rows[0].site,
    } as unknown as Project
    brief = rows[0].brief as Brief
    emptyScene = {
      site: { widthM: rows[0].site.widthM, depthM: rows[0].site.depthM },
      floors: [], selectedFloorId: null, selectedRoomId: null, rooms: [], openings: [],
    }
  } finally {
    await client.end()
  }
})

/** Denah hasil usulan, direkonstruksi seperti yang dilihat server. */
function materialize(actions: FloorplanAction[], scene: FloorplanScene) {
  const rooms = simulateFloorplanActions(actions, scene) as unknown as Room[]
  const floorOf = new Map(rooms.map((r) => [r.id, r.floorId]))
  let seq = 0
  const openings: Opening[] = []
  for (const a of actions) {
    if (a.type !== "addOpening") continue
    openings.push({
      id: `sim-${seq++}`,
      floorId: floorOf.get(a.roomId) ?? "",
      wallId: `${a.roomId}:${a.side}`,
      type: a.openingType,
      positionM: a.positionM,
      widthM: a.openingType === "door" ? 0.9 : 1.2,
      heightM: 2.1,
    } as Opening)
  }
  return { rooms, openings }
}

/**
 * Kasus yang benar-benar diucapkan pemilik rumah.
 *
 * `lantai` = jumlah lantai yang WAJIB dihasilkan. Untuk "1 lantai saja" nilainya
 * null dengan sengaja: program 12 ruang tidak bisa ditata layak huni di satu
 * lantai pada lahan 12×18 m (ruang tengah selalu terkunci), jadi menaikkannya
 * ke 2 lantai DENGAN penjelasan adalah jawaban yang benar — memaksakan 1 lantai
 * hanya menghasilkan usulan yang dibuang validator dan 0 aksi di layar.
 */
const MEMBANGUN = [
  { kalimat: "buatkan denah 2 lantai, sesuai brief", lantai: 2 },
  { kalimat: "tolong buatkan denah rumahnya sesuai brief", lantai: null },
  { kalimat: "gambarkan denah 2 lantai dong", lantai: 2 },
  { kalimat: "bikin layout rumah 1 lantai saja", lantai: null, jelaskanNaikTingkat: true },
  { kalimat: "susun denah rumah dari awal, 2 lantai", lantai: 2 },
  { kalimat: "rancang denah rumah 3 lantai", lantai: 3 },
]

describe.runIf(ENABLED)("Kasus nyata — agent membangun denah kosong", () => {
  for (const { kalimat, lantai, jelaskanNaikTingkat } of MEMBANGUN) {
    it(`"${kalimat}" → denah layak huni yang lolos validator`, () => {
      const res = buildInitialFloorplan(kalimat, emptyScene, project, brief)
      expect(res.matched, "agent tidak mengambil alih permintaan ini").toBe(true)

      const added = res.actions.filter((a) => a.type === "addRoom")
      expect(added.length, "tidak membangun apa pun").toBeGreaterThanOrEqual(brief.spaceProgram.length)

      // Tak boleh ada kalimat menagih data yang sudah dipegang sistem.
      expect(res.reply).not.toMatch(/mohon (kirim|lampirkan|berikan)|perlu informasi lebih detail/i)

      // Gerbang yang menentukan apakah pengguna melihat hasil atau 0 aksi.
      const feedback = findFloorplanActionFeedback(emptyScene, res.actions, kalimat)
      expect(feedback, `usulan ditolak: ${feedback.join(" | ")}`).toEqual([])

      const { rooms, openings } = materialize(res.actions, emptyScene)

      // Bebas tumpang-tindih, di dalam batas lahan.
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

      // Tiap ruang dalam terjangkau dari dalam rumah.
      const { isolated } = analyzeRoomConnectivity(rooms, openings)
      expect(isolated.map((r) => r.name), "ada ruang terkurung").toEqual([])

      // Tiap ruang dalam punya setidaknya satu pintu atas namanya.
      const doorHosts = new Set(
        openings.filter((o) => o.type === "door").map((o) => parseOpeningWall(o.wallId)?.roomId)
      )
      const tanpaPintu = rooms.filter((r) => !isOutdoorRoom(r) && !doorHosts.has(r.id))
      expect(tanpaPintu.map((r) => r.name), "ruang dalam tanpa pintu").toEqual([])

      if (lantai != null) {
        const floorIds = new Set(added.map((a) => (a as { floorId?: string }).floorId))
        expect(floorIds.size, `harus ${lantai} lantai`).toBe(lantai)
      }

      // AKSES VERTIKAL: rumah bertingkat tanpa tangga = penghuni tak bisa naik.
      // Cacat ini lolos senyap karena analisis konektivitas sengaja tidak
      // melintasi lantai, jadi tiap lantai tampak sehat sendiri-sendiri.
      const floorsUsed = new Set(added.map((a) => (a as { floorId?: string }).floorId))
      if (floorsUsed.size > 1) {
        const stairs = added.filter((a) => (a as { roomType: string }).roomType === "tangga")
        expect(stairs.length, "rumah bertingkat tanpa tangga").toBeGreaterThan(0)
        // Tangga wajib ada di setiap lantai kecuali yang teratas.
        const stairFloors = new Set(stairs.map((a) => (a as { floorId?: string }).floorId))
        expect(stairFloors.size).toBe(floorsUsed.size - 1)
      }

      // Bila jumlah lantai dinaikkan demi kelayakan, pengguna WAJIB diberi tahu
      // alasannya — mengubah permintaan diam-diam adalah kegagalan tersendiri.
      if (jelaskanNaikTingkat) {
        expect(res.reply).toMatch(/tidak bisa ditata layak huni dalam 1 lantai/i)
        expect(res.reply).toMatch(/2 lantai sebagai gantinya/i)
      }
    })
  }
})

describe.runIf(ENABLED)("Kasus nyata — agent menahan diri", () => {
  it("tidak menimpa denah yang sudah berisi karya pengguna", () => {
    const berisi: FloorplanScene = {
      ...emptyScene,
      floors: [{ id: "floor-1", name: "Lantai 1", level: 1 }],
      selectedFloorId: "floor-1",
      rooms: [{
        id: "r1", name: "Ruang Tamu", type: "ruang_tamu", floorId: "floor-1",
        x: 0, y: 0, width: 4, depth: 4, areaM2: 16, locked: false,
      }],
    }
    expect(buildInitialFloorplan("buatkan denah 2 lantai sesuai brief", berisi, project, brief).matched)
      .toBe(false)
  })

  for (const kalimat of [
    "kenapa dapur ditaruh di depan?",
    "pindahkan kamar mandi ke lantai 2",
    "tambah satu kamar tidur",
    "warna fasadnya diganti abu-abu",
    "berapa estimasi biayanya?",
  ]) {
    it(`"${kalimat}" bukan permintaan membangun — diserahkan ke jalur lain`, () => {
      expect(buildInitialFloorplan(kalimat, emptyScene, project, brief).matched).toBe(false)
    })
  }

  it("tanpa program ruang di brief, tidak menebak-nebak", () => {
    const kosong = { ...brief, spaceProgram: [] } as Brief
    expect(buildInitialFloorplan("buatkan denah rumah", emptyScene, project, kosong).matched).toBe(false)
  })
})

describe.runIf(ENABLED)("Kasus nyata — bangun ulang dari nol (reset eksplisit)", () => {
  // Denah terisi yang MIRIP kondisi prod proj-modern-tropis-1: lantai 2 ber-id acak.
  const terisi: FloorplanScene = {
    ...emptyScene,
    floors: [
      { id: "floor-1", name: "Lantai 1", level: 1 },
      { id: "floor-k4KTN1", name: "Lantai 2", level: 2 },
    ],
    selectedFloorId: "floor-1",
    rooms: [
      { id: "r-old-1", name: "Ruang Tamu Lama", type: "ruang_tamu", floorId: "floor-1", x: 0, y: 0, width: 4, depth: 4, areaM2: 16, locked: false },
      { id: "r-old-2", name: "Dapur Lama", type: "dapur", floorId: "floor-1", x: 5, y: 0, width: 3, depth: 3, areaM2: 9, locked: false },
    ],
  }

  it("mengosongkan denah lama lalu membangun ulang sesuai brief, layak huni", () => {
    const res = buildInitialFloorplan(
      "bangun ulang denah ini dari nol, 2 lantai",
      terisi,
      project,
      brief
    )
    expect(res.matched).toBe(true)
    expect(res.reset).toBe(true)
    expect(res.reply).toMatch(/kosongkan/i)

    // Semua ruang lama diusulkan untuk dihapus — inilah SATU-SATUNYA saat
    // deleteRoom massal dibolehkan (pengguna eksplisit minta bangun ulang).
    const deletes = res.actions.filter((a) => a.type === "deleteRoom")
    expect(deletes.map((d) => d.roomId).sort()).toEqual(["r-old-1", "r-old-2"])

    // Lolos gerbang yang menentukan apakah pengguna melihat hasil atau 0 aksi.
    const feedback = findFloorplanActionFeedback(
      terisi,
      res.actions,
      "bangun ulang denah ini dari nol, 2 lantai",
      { allowFullReset: true }
    )
    expect(feedback, `usulan ditolak: ${feedback.join(" | ")}`).toEqual([])

    const { rooms, openings } = materialize(res.actions, terisi)
    expect(rooms.length).toBeGreaterThanOrEqual(brief.spaceProgram.length)

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

    const { isolated } = analyzeRoomConnectivity(rooms, openings)
    expect(isolated.map((r) => r.name), "ada ruang terkurung").toEqual([])
  })

  it("build biasa di denah terisi TETAP ditolak (anti-menimpa tidak dilonggarkan)", () => {
    const res = buildInitialFloorplan("buatkan denah 2 lantai, sesuai brief", terisi, project, brief)
    expect(res.matched).toBe(false)
  })
})
