// @vitest-environment node
/**
 * PELATIHAN AGENT — RAGAM ISU DENAH NYATA (bukan hanya bangun-dari-nol).
 *
 * Denah hasil pembangunan awal dipakai sebagai bahan uji lanjutan: setelah
 * rumah berdiri, pemilik mengeluh soal hal-hal yang lazim. Berkas ini memeriksa
 * apakah pipeline agent MENGHASILKAN AKSI untuk keluhan itu — bukan sekadar
 * balasan sopan tanpa perubahan, dan bukan pula usulan yang dibuang validator.
 *
 * Aturan yang dijaga di sini:
 *   - Denah eksisting TIDAK boleh diborong ulang oleh pembangun awal.
 *   - Setiap usulan wajib lolos gerbang `findFloorplanActionFeedback`.
 *   - Guard anti-destruktif tetap menolak penghapusan massal.
 *
 * Memakai brief PRODUKSI proj-modern-tropis-1. Tidak menulis ke database.
 *   RUN_E2E_PROD=1 node --env-file=.env.local node_modules/vitest/vitest.mjs \
 *     run src/lib/server/agent-followup.e2e.test.ts
 */
import { describe, it, expect, beforeAll } from "vitest"
import { Client } from "pg"

import { buildInitialFloorplan } from "./initial-floorplan"
import {
  findDestructiveDeletionFeedback,
  findFloorplanActionFeedback,
  simulateFloorplanActions,
} from "./editor-assistant"
import { handleFloorplanInstruction } from "@/lib/assistant/deterministic"
import { findFreeRect } from "@/lib/geometry"
import type { FloorplanAction, FloorplanScene } from "@/lib/assistant/actions"
import type { Brief, Project, Room } from "@/types"

const ENABLED = process.env.RUN_E2E_PROD === "1" && !!process.env.DATABASE_URL
const PROJECT_ID = process.env.E2E_PROJECT_ID ?? "proj-modern-tropis-1"

let project: Project
let brief: Brief
/** Denah 2 lantai hasil pembangunan awal — titik tolak semua kasus lanjutan. */
let builtScene: FloorplanScene

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
  } finally {
    await client.end()
  }

  const empty: FloorplanScene = {
    site: { widthM: project.site.widthM, depthM: project.site.depthM },
    floors: [], selectedFloorId: null, selectedRoomId: null, rooms: [], openings: [],
  }
  const initial = buildInitialFloorplan("buatkan denah 2 lantai, sesuai brief", empty, project, brief)
  const rooms = simulateFloorplanActions(initial.actions, empty) as unknown as Room[]
  const floorIds = [...new Set(rooms.map((r) => r.floorId))]
  let seq = 0
  builtScene = {
    site: empty.site,
    floors: floorIds.map((id, i) => ({ id, name: `Lantai ${i + 1}`, level: i + 1 })),
    selectedFloorId: floorIds[0] ?? null,
    selectedRoomId: null,
    rooms: rooms as never,
    // Bentuk bukaan HARUS sama dengan scene sungguhan (`floorplanSceneFromLayout`):
    // {roomId, side}, bukan wallId gabungan. Versi pertama fixture ini memakai
    // `wallId`, sehingga `simulateOpenings` di connectivity-guard membaca
    // `roomId: undefined` — seluruh pintu tak terhitung dan setiap ruang tampak
    // terkurung. Fixture yang salah bentuk menghasilkan kegagalan palsu yang
    // sangat meyakinkan; itu sebabnya bentuknya dijaga di sini.
    openings: initial.actions
      .filter((a) => a.type === "addOpening")
      .map((a) => {
        const o = a as Extract<FloorplanAction, { type: "addOpening" }>
        return {
          id: `op-${seq++}`,
          roomId: o.roomId,
          side: o.side,
          type: o.openingType,
          positionM: o.positionM,
          widthM: o.openingType === "door" ? 0.9 : 1.2,
          heightM: 2.1,
        }
      }) as never,
  }
})

describe.runIf(ENABLED)("Denah baru harus bisa DISUNTING, bukan beku", () => {
  /**
   * Treemap mengisi footprint 100%, jadi denah baru lahir tanpa satu pun petak
   * kosong — diukur: lantai 1 terisi 91,1%, tapi 19 m² sisanya hanyalah margin
   * tepi 0,28 m + celah antar-ruang 0,06 m, dan petak 1×1 m pun tidak ada.
   *
   * Akibatnya SETIAP penyuntingan lanjutan yang butuh ruang (tambah gudang,
   * pindahkan laundry turun, geser kamar mandi) langsung mentok: `findFreeRect`
   * menolak dengan benar, lalu diserahkan ke LLM — dan LLM sudah terbukti
   * mentok juga untuk denah sepadat ini. Pengguna dapat 0 aksi.
   *
   * Rumah yang baru digambar harus punya sedikit kelonggaran untuk disunting.
   */
  it("menyisakan petak kosong yang cukup untuk menambah satu ruang kecil", () => {
    const lantai1 = builtScene.floors[0].id
    const isi = builtScene.rooms.filter((r) => r.floorId === lantai1)
    const spot = findFreeRect({ width: 2, depth: 2 }, isi as never, builtScene.site, {})
    expect(spot, "denah baru tak menyisakan petak 2×2 m — mustahil disunting").not.toBeNull()
  })
})

describe.runIf(ENABLED)("Denah eksisting — pembangun awal harus menahan diri", () => {
  it("denah yang sudah berisi 14 ruang tidak diborong ulang", () => {
    expect(builtScene.rooms.length).toBeGreaterThan(10)
    for (const kalimat of [
      "buatkan denah 2 lantai sesuai brief",
      "gambarkan denah rumahnya",
      "susun denah dari awal",
    ]) {
      expect(
        buildInitialFloorplan(kalimat, builtScene, project, brief).matched,
        `"${kalimat}" menimpa denah eksisting`
      ).toBe(false)
    }
  })

  it("denah awal memang punya akses vertikal (tangga) untuk dilanjutkan", () => {
    const stairs = builtScene.rooms.filter((r) => r.type === "tangga")
    expect(stairs.length, "denah bertingkat tanpa tangga").toBeGreaterThan(0)
  })
})

describe.runIf(ENABLED)("Isu denah nyata — jalur deterministik menghasilkan aksi", () => {
  /**
   * Keluhan yang lazim diucapkan setelah denah berdiri.
   *
   * `wajibDitangani` menandai keluhan yang HARUS diselesaikan deterministik.
   * Sisanya boleh menyerah ke LLM — tapi hanya untuk alasan yang sah, dan
   * hasilnya tetap dicatat supaya "lulus" tidak berarti "tak diperiksa".
   *
   * TEMUAN LAPANGAN 2026-08-02 (diukur, bukan dikira): pada denah 12×18 m ini
   * lantai 1 terisi 91,1% — dan 19 m² sisanya BUKAN kantong yang bisa dipakai,
   * melainkan serpihan: margin tepi 0,28 m + celah antar-ruang 0,06 m. Petak
   * 1×1 m pun tidak ada. Jadi setiap permintaan yang butuh RUANG BARU di lantai
   * itu (tambah ruang, pindahkan ruang dari lantai lain, geser ruang) memang
   * mustahil tanpa keputusan mengecilkan/menyusun ulang ruang lain — dan itu
   * trade-off desain, bukan pattern match. `findFreeRect` menolaknya dengan
   * BENAR; menyerah ke LLM di situ adalah perilaku yang tepat, bukan cacat.
   *
   * Konsekuensinya dicatat sebagai batas jujur: generator mengisi footprint
   * 100% via treemap, sehingga tak menyisakan slack untuk penyuntingan lanjut.
   */
  const KELUHAN = [
    { kalimat: "perbaiki semua peringatan", wajibDitangani: true },
    // Laundry di lantai berkoridor lahir sebagai SLICE selebar rumah
    // (10,44 × 2,15 m = 22 m²) karena packFloor menjamin tiap slice menyentuh
    // koridor. Dipindah utuh ke lantai lain, petak sebesar itu tak bersentuhan
    // apa pun sehingga tak ada dinding untuk dipasangi pintu — yang dibutuhkan
    // perancangan ulang ukuran, bukan pemindahan. Jalur LLM yang menanganinya.
    { kalimat: "pindahkan laundry ke lantai 1", wajibDitangani: false },
    { kalimat: "pindahkan kamar mandi 2 dari lantai 2 ke lantai 1", wajibDitangani: true },
    { kalimat: "kamar mandi di lantai 2 posisinya kurang pas, tolong digeser", wajibDitangani: false },
    { kalimat: "tambah gudang di lantai 1", wajibDitangani: true },
    { kalimat: "dapur dan ruang makan bikin open plan dong", wajibDitangani: false },
    { kalimat: "kenapa taman ditaruh di depan?", wajibDitangani: false },
  ]

  for (const { kalimat, wajibDitangani } of KELUHAN) {
    it(`"${kalimat}" → usulan yang lolos gerbang validator`, () => {
      const res = handleFloorplanInstruction(kalimat, builtScene)
      console.log(
        `  ${res.matched ? "DITANGANI" : "ke-LLM  "} | ${kalimat}` +
          (res.matched ? ` → ${res.actions.length} aksi` : "")
      )

      if (wajibDitangani) {
        expect(res.matched, "keluhan ini punya matcher, tak boleh jatuh ke LLM").toBe(true)
      }
      if (!res.matched) return

      // Mengaku menangani lalu menghasilkan usulan cacat adalah kegagalan
      // terburuk: pengguna melihat 0 aksi tanpa penjelasan.
      const feedback = res.actions.length
        ? findFloorplanActionFeedback(builtScene, res.actions, kalimat)
        : []
      expect(feedback, `usulan ditolak: ${feedback.join(" | ")}`).toEqual([])

      // Bila mengaku menangani TANPA aksi, balasannya wajib menjelaskan sebabnya
      // — bukan sekadar basa-basi.
      if (res.actions.length === 0) {
        expect(res.reply.length, "mengaku menangani tapi diam saja").toBeGreaterThan(20)
      }
    })
  }
})

describe.runIf(ENABLED)("Guard anti-destruktif tetap berjaga di denah nyata", () => {
  it("menolak penghapusan mayoritas ruang satu lantai (insiden 2026-08-01)", () => {
    const lantai1 = builtScene.rooms.filter((r) => r.floorId === builtScene.floors[0].id)
    const massal = lantai1.map(
      (r) => ({ type: "deleteRoom", roomId: r.id }) as FloorplanAction
    )
    const feedback = findDestructiveDeletionFeedback(builtScene, massal, "kerjakan lantai 2")
    expect(feedback.length, "penghapusan massal lolos guard").toBeGreaterThan(0)
  })

  it("memindah ruang antar lantai lewat updateRoom.floorId tidak dianggap destruktif", () => {
    const laundry = builtScene.rooms.find((r) => r.type === "laundry")
    expect(laundry, "denah uji tidak punya laundry").toBeTruthy()
    const pindah = [
      {
        type: "updateRoom",
        roomId: laundry!.id,
        patch: { floorId: builtScene.floors[0].id },
      } as FloorplanAction,
    ]
    expect(findDestructiveDeletionFeedback(builtScene, pindah, "pindahkan laundry ke lantai 1")).toEqual([])
  })
})
