// @vitest-environment node
/**
 * E2E DATA PROD — jalur denah-kosong proj-modern-tropis-1.
 *
 * Memakai brief & lahan NYATA dari database produksi, menjalankan pembangun
 * denah awal deterministik, lalu memverifikasi hasilnya dengan validator yang
 * sama seperti yang dipakai route sebelum usulan sampai ke pengguna.
 *
 * Inilah gerbang yang dulu membuang seluruh usulan LLM: koordinat bertabrakan
 * dan ruang tak terjangkau → 0 aksi di layar pengguna. Test ini memastikan
 * usulan deterministik LOLOS gerbang itu.
 *
 * Tidak memanggil LLM, tidak menulis ke database. Butuh DATABASE_URL:
 *   RUN_E2E_PROD=1 node --env-file=.env.local node_modules/vitest/vitest.mjs \
 *     run src/lib/server/initial-floorplan.e2e.test.ts
 */
import { describe, it, expect } from "vitest"
import { Client } from "pg"

import { buildInitialFloorplan } from "./initial-floorplan"
import { findFloorplanActionFeedback, simulateFloorplanActions } from "./editor-assistant"
import type { FloorplanScene } from "@/lib/assistant/actions"
import type { Brief, Project } from "@/types"

const ENABLED = process.env.RUN_E2E_PROD === "1" && !!process.env.DATABASE_URL
const PROJECT_ID = process.env.E2E_PROJECT_ID ?? "proj-modern-tropis-1"

async function loadProd() {
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    const { rows } = await client.query(
      `select p.id, p.name, p.floors, p.rooftop, p.site,
              b.payload as brief,
              coalesce(dl.payload, '{}'::jsonb) as layout
         from projects p
         left join briefs b on b.project_id = p.id
         left join design_layouts dl
                on dl.project_id = p.id and dl.version_id = p.current_version_id
        where p.id = $1`,
      [PROJECT_ID]
    )
    return rows[0]
  } finally {
    await client.end()
  }
}

describe.runIf(ENABLED)("E2E prod — denah awal deterministik lolos gerbang validator", () => {
  it("membangun 12 ruang dari brief nyata tanpa ditolak validator", async () => {
    const row = await loadProd()
    expect(row, `Proyek ${PROJECT_ID} tidak ada`).toBeTruthy()

    const project = {
      id: row.id, name: row.name, floors: row.floors, rooftop: row.rooftop, site: row.site,
    } as unknown as Project
    const brief = row.brief as Brief
    const layout = row.layout as { rooms?: unknown[]; floors?: unknown[]; openings?: unknown[] }

    const scene: FloorplanScene = {
      site: { widthM: row.site.widthM, depthM: row.site.depthM },
      floors: (layout.floors ?? []) as FloorplanScene["floors"],
      selectedFloorId: null,
      selectedRoomId: null,
      rooms: (layout.rooms ?? []) as FloorplanScene["rooms"],
      openings: (layout.openings ?? []) as FloorplanScene["openings"],
    }

    expect(scene.rooms.length, "skenario ini menuntut denah kosong").toBe(0)
    expect(brief?.spaceProgram?.length ?? 0).toBeGreaterThan(0)

    const res = buildInitialFloorplan("buatkan denah 2 lantai, sesuai brief", scene, project, brief)
    expect(res.matched, "handler tidak mengambil alih").toBe(true)

    const added = res.actions.filter((a) => a.type === "addRoom")
    const doors = res.actions.filter(
      (a) => a.type === "addOpening" && (a as { openingType?: string }).openingType === "door"
    )
    console.log(`\nRuang dibuat : ${added.length}`)
    console.log(`Pintu        : ${doors.length}`)
    console.log(`Lantai       : ${res.actions.filter((a) => a.type === "addFloor").length}`)
    console.log(`\n${res.reply}\n`)

    expect(added.length).toBeGreaterThanOrEqual(brief.spaceProgram.length)

    // GERBANG YANG DULU MEMBUANG USULAN LLM.
    const feedback = findFloorplanActionFeedback(scene, res.actions as never, "buatkan denah 2 lantai")
    if (feedback.length) console.log("DITOLAK:\n" + feedback.join("\n"))
    expect(feedback, "usulan ditolak validator — pengguna akan menerima 0 aksi").toEqual([])

    // Hasil akhir harus benar-benar bebas tabrakan setelah disimulasikan.
    const finalRooms = simulateFloorplanActions(res.actions as never, scene)
    for (const [i, a] of finalRooms.entries()) {
      for (const b of finalRooms.slice(i + 1)) {
        if (a.floorId !== b.floorId) continue
        const overlap =
          a.x < b.x + b.width && a.x + a.width > b.x &&
          a.y < b.y + b.depth && a.y + a.depth > b.y
        expect(overlap, `${a.name} menimpa ${b.name}`).toBe(false)
      }
    }
  })
})
