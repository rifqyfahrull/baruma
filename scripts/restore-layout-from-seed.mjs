/**
 * Restore layout proj-modern-tropis-1 dari payload seed (migration 0021).
 *
 * LATAR BELAKANG (insiden 2026-08-01): user minta "kerjakan lantai 2", agent
 * floorplan membalas deleteRoom ×10 yang menghapus SEMUA ruang lantai 1 dan
 * berstatus "applied" → design_layouts revision 132 berisi 0 ruang. Tidak ada
 * tabel revisi/alternatives yang menyimpan payload lama, jadi satu-satunya
 * sumber recovery di repo ini = payload seed 0021 (kondisi AWAL proyek:
 * 1 lantai, 12 ruang). SEMUA edit user 25 Jul–1 Agu (fasad, lantai 2, koridor,
 * tata ulang servis) TIDAK dapat dipulihkan dari DB.
 *
 * DEFAULT = DRY-RUN (hanya menampilkan rencana). Menulis ke produksi hanya
 * dengan `--apply` dan hanya setelah persetujuan pemilik.
 *
 * Usage:
 *   node scripts/restore-layout-from-seed.mjs            # dry-run
 *   DATABASE_URL=... node scripts/restore-layout-from-seed.mjs --apply
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

const PROJECT_ID = "proj-modern-tropis-1"
const SEED_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations", "0021_seed_two_reference_houses.sql")

/** Ekstrak payload JSON design_layouts untuk proj-modern-tropis-1 dari SQL seed.
 *  Pendekatan indexOf (bukan regex dollar-quoting yang rapuh): blok insert
 *  design_layouts proyek ini berformat `...$j${<JSON>}$j$::jsonb`. */
function extractSeedPayload() {
  const sql = readFileSync(SEED_FILE, "utf8")
  const insertAt = sql.indexOf("design_layouts (project_id, version_id, payload)")
  if (insertAt < 0) throw new Error("Blok insert design_layouts tidak ditemukan di 0021")
  const blockStart = sql.indexOf("$j${", insertAt)
  if (blockStart < 0) throw new Error("Awal payload ($j${) tidak ditemukan")
  const blockEnd = sql.indexOf("}$j$::jsonb", blockStart)
  if (blockEnd < 0) throw new Error("Akhir payload (}$j$::jsonb) tidak ditemukan")
  // `$j${` = 4 karakter; payload JSON mulai dari `{` (posisi blockStart + 3).
  const json = sql.slice(blockStart + 3, blockEnd + 1)
  if (!json.includes('"projectId":"proj-modern-tropis-1"')) {
    throw new Error("Payload yang ditemukan bukan milik proj-modern-tropis-1")
  }
  return JSON.parse(json)
}

async function main() {
  const apply = process.argv.includes("--apply")
  const payload = extractSeedPayload()

  const roomCount = payload.rooms?.length ?? 0
  const floorNames = (payload.floors ?? []).map((f) => `${f.name} (${f.id})`).join(", ")
  const roomNames = (payload.rooms ?? []).map((r) => r.name).join(", ")

  console.log(`[restore] payload seed 0021 untuk ${PROJECT_ID}:`)
  console.log(`  versionId : ${payload.versionId}`)
  console.log(`  lantai    : ${floorNames}`)
  console.log(`  ruang (${roomCount}) : ${roomNames}`)

  if (!apply) {
    console.log("\n[restore] DRY-RUN — tidak ada perubahan. Jalankan dengan --apply untuk menulis.")
    console.log("[restore] CATATAN: kondisi DB saat ini = 0 ruang (revision 132, 2026-08-01T14:45).")
    console.log("[restore] CATATAN: edit user 25 Jul–1 Agu TIDAK bisa dipulihkan dari DB — hanya seed tersedia.")
    return
  }

  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error("[restore] DATABASE_URL tidak diset — berhenti (tidak menulis apa pun).")
    process.exit(1)
  }

  const client = new pg.Client({ connectionString, ssl: false })
  await client.connect()
  try {
    const before = await client.query(
      `SELECT version_id, revision, jsonb_array_length(payload->'rooms') AS rooms
         FROM design_layouts WHERE project_id = $1`,
      [PROJECT_ID]
    )
    console.log("\n[restore] kondisi sebelum:", before.rows[0] ?? "(tidak ada)")

    const res = await client.query(
      `UPDATE design_layouts
          SET version_id = $2, payload = $3, revision = revision + 1, updated_at = now()
        WHERE project_id = $1
        RETURNING revision, jsonb_array_length(payload->'rooms') AS rooms`,
      [PROJECT_ID, payload.versionId, JSON.stringify(payload)]
    )
    console.log("[restore] kondisi sesudah:", res.rows[0])
    console.log("[restore] SELESAI — refresh halaman editor untuk memuat ulang denah.")
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error("[restore] error:", e?.message ?? e)
  process.exit(1)
})
