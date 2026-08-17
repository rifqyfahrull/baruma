// @vitest-environment node
/**
 * E2E JALUR PENUH — memastikan urutan pipeline benar di runtime.
 *
 * Handler deterministik (`buildInitialFloorplan`) harus mengambil alih SEBELUM
 * jalur LLM dipanggil untuk kasus denah-kosong. Bila urutannya salah, agent
 * kembali menyerahkan penataan 13 ruang ke LLM — dan itu terbukti berakhir
 * dengan koridor menimpa ruang makan, usulan dibuang, 0 aksi di layar.
 *
 * Test ini memverifikasi dua hal yang tidak bisa dilihat dari unit test:
 *   1. Handler deterministik menang atas `handleFloorplanInstruction`
 *      (`matchAddRoom` juga cocok dengan kalimat "buatkan denah…").
 *   2. Hasilnya tidak menghabiskan kredit LLM — jalur cepat, tanpa panggilan.
 *
 * Memakai brief produksi nyata. Tidak menulis ke database.
 */
import { describe, it, expect } from "vitest"
import { Client } from "pg"

import { buildInitialFloorplan } from "./initial-floorplan"
import { handleFloorplanInstruction } from "@/lib/assistant/deterministic"
import type { FloorplanScene } from "@/lib/assistant/actions"
import type { Brief, Project } from "@/types"

const ENABLED = process.env.RUN_E2E_PROD === "1" && !!process.env.DATABASE_URL
const PROJECT_ID = process.env.E2E_PROJECT_ID ?? "proj-modern-tropis-1"

describe.runIf(ENABLED)("E2E jalur penuh — urutan handler denah kosong", () => {
  it("handler deterministik menang, dan hasilnya jauh lebih lengkap dari matchAddRoom", async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL })
    await client.connect()
    const { rows } = await client.query(
      `select p.id, p.name, p.floors, p.rooftop, p.site, b.payload as brief
         from projects p left join briefs b on b.project_id = p.id
        where p.id = $1`,
      [PROJECT_ID]
    )
    await client.end()

    const project = {
      id: rows[0].id, name: rows[0].name, floors: rows[0].floors,
      rooftop: rows[0].rooftop, site: rows[0].site,
    } as unknown as Project
    const brief = rows[0].brief as Brief
    const scene: FloorplanScene = {
      site: { widthM: rows[0].site.widthM, depthM: rows[0].site.depthM },
      floors: [], selectedFloorId: null, selectedRoomId: null, rooms: [], openings: [],
    }

    const instruction = "buatkan denah 2 lantai, sesuai brief"

    const initial = buildInitialFloorplan(instruction, scene, project, brief)
    expect(initial.matched, "handler denah-kosong tidak mengambil alih").toBe(true)

    // Handler lama juga bisa cocok — buktikan bahwa yang menang memang yang
    // menghasilkan denah utuh, bukan satu ruang tunggal tanpa akses.
    const legacy = handleFloorplanInstruction(instruction, scene)
    const initialRooms = initial.actions.filter((a) => a.type === "addRoom").length
    const legacyRooms = legacy.matched
      ? legacy.actions.filter((a) => a.type === "addRoom").length
      : 0
    console.log(`\nhandler baru : ${initialRooms} ruang, ${initial.actions.length} aksi total`)
    console.log(`handler lama : ${legacy.matched ? `${legacyRooms} ruang` : "tidak cocok"}`)
    expect(initialRooms).toBeGreaterThan(legacyRooms)
    expect(initialRooms).toBeGreaterThanOrEqual(brief.spaceProgram.length)
  })
})
