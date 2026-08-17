// @vitest-environment node
/**
 * E2E ENV PROD — regresi proj-modern-tropis-1 (2026-08-02).
 *
 * Memanggil pipeline agent SUNGGUHAN: LLM Agent Lab nyata (baruma-assistant +
 * baruma-floorplan-actions) dengan brief nyata dari database PRODUKSI, terhadap
 * denah yang KOSONG — kondisi persis saat pengguna melaporkan "agent masih
 * bodoh": agent menagih "nama dan ukuran 12 ruang eksisting" padahal daftar itu
 * duduk di brief yang tak pernah dikirim ke prompt.
 *
 * Test ini TIDAK menulis apa pun ke database (hasil hanya diperiksa di memori),
 * tapi ia MEMBELANJAKAN token Agent Lab — karena itu di-skip kecuali dijalankan
 * eksplisit dengan RUN_E2E_PROD=1:
 *
 *   node --env-file=.env.local node_modules/vitest/vitest.mjs run \
 *     src/lib/server/agent-empty-scene.e2e.test.ts
 *
 * (env var RUN_E2E_PROD=1 diset di .env.local atau di depan perintah)
 */
import { describe, it, expect } from "vitest"
import { Client } from "pg"

import { runFloorplanAgentPass } from "@/app/api/v1/projects/[id]/editor/assistant/route"
import { buildInitialFloorplan } from "./initial-floorplan"
import type { FloorplanScene } from "@/lib/assistant/actions"
import type { Brief, Project } from "@/types"

const ENABLED = process.env.RUN_E2E_PROD === "1" && !!process.env.DATABASE_URL
const PROJECT_ID = process.env.E2E_PROJECT_ID ?? "proj-modern-tropis-1"

/** Kalimat yang menagih data yang SUDAH ada di prompt — inti keluhan pengguna. */
const BEGGING =
  /(mohon|tolong|silakan)[^.]{0,90}(kirim|lampirkan|berikan|sebutkan|sediakan)[^.]{0,90}(ruang|daftar|ukuran)|perlu informasi lebih detail|daftar ruang[^.]{0,30}kosong/i

async function loadProject() {
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    const { rows } = await client.query(
      `select p.site, b.payload as brief,
              coalesce(dl.payload, '{}'::jsonb) as layout
         from projects p
         left join briefs b on b.project_id = p.id
         left join design_layouts dl
                on dl.project_id = p.id and dl.version_id = p.current_version_id
        where p.id = $1`,
      [PROJECT_ID]
    )
    return rows[0] as { site: { widthM: number; depthM: number }; brief: Brief | null; layout: Record<string, unknown> }
  } finally {
    await client.end()
  }
}

describe.runIf(ENABLED)("E2E prod — denah kosong + brief berisi (proj-modern-tropis-1)", () => {
  it(
    "membangun denah dari program ruang brief, bukan menagih data ke pengguna",
    { timeout: 180_000 },
    async () => {
      const row = await loadProject()
      expect(row, `Proyek ${PROJECT_ID} tidak ada di database`).toBeTruthy()

      const layout = row.layout as { floors?: unknown[]; rooms?: unknown[]; openings?: unknown[] }
      const scene = {
        site: { widthM: row.site.widthM, depthM: row.site.depthM },
        floors: (layout.floors ?? []) as FloorplanScene["floors"],
        selectedFloorId: null,
        selectedRoomId: null,
        rooms: (layout.rooms ?? []) as FloorplanScene["rooms"],
        openings: (layout.openings ?? []) as FloorplanScene["openings"],
      } satisfies FloorplanScene

      const program = row.brief?.spaceProgram ?? []
      // Prasyarat skenario: denah kosong, brief berisi. Kalau tidak, test ini
      // tidak menguji apa yang dimaksud — gagalkan dengan pesan jelas.
      expect(scene.rooms.length, "denah harus kosong untuk skenario ini").toBe(0)
      expect(program.length, "brief harus punya spaceProgram").toBeGreaterThan(0)

      // URUTAN SEPERTI DI RUNTIME: route mencoba handler denah-kosong lebih
      // dulu, dan hanya jatuh ke jalur LLM bila handler itu tak mengambil alih.
      // Menguji jalur LLM langsung akan melewatkan justru bagian yang menutup
      // regresi ini — dan jalur LLM memang MENTOK di sini (usulannya ditolak
      // validator sampai batas 90 detik), yang sebabnya handler itu ada.
      const project = {
        id: PROJECT_ID,
        name: "Rumah Tropis Modern",
        floors: 1,
        rooftop: false,
        site: row.site,
      } as unknown as Project

      const instruction = "buatkan denah 2 lantai, sesuai brief"
      const initial = buildInitialFloorplan(instruction, scene, project, row.brief)

      if (initial.matched) {
        console.log("\n=== JALUR: handler denah-kosong (deterministik) ===")
        console.log(initial.reply)
        const counts: Record<string, number> = {}
        for (const a of initial.actions) counts[a.type] = (counts[a.type] ?? 0) + 1
        console.log("\n=== AKSI ===\n" + JSON.stringify(counts))

        expect(initial.reply).not.toMatch(BEGGING)
        const added = initial.actions.filter((a) => a.type === "addRoom")
        expect(added.length, "tidak membangun apa pun").toBeGreaterThanOrEqual(program.length)

        const wanted = new Set(program.map((s) => s.roomType))
        const fromBrief = added.filter((a) => wanted.has((a as { roomType: string }).roomType as never))
        expect(fromBrief.length, "ruang yang dibuat tidak berasal dari brief").toBeGreaterThan(0)
        return
      }

      // Handler tidak mengambil alih → jalur LLM. Rencana Agent Utama tetap
      // tidak boleh menagih data yang sudah dipegang sistem.
      const res = await runFloorplanAgentPass(
        scene,
        instruction,
        [],
        undefined,
        undefined,
        undefined,
        row.brief,
        Date.now(),
        (m) => console.log(`  … ${m}`)
      )
      console.log("\n=== RENCANA AGENT UTAMA ===\n" + (res.plannerNote ?? "(kosong)"))
      console.log("\n=== BALASAN AGENT DENAH ===\n" + res.reply)
      expect(res.plannerNote ?? "").not.toMatch(BEGGING)
      expect(res.reply).not.toMatch(BEGGING)
    }
  )
})
