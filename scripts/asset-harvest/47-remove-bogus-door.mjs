/**
 * Tahap 47 — hapus pintu hasil keputusan agent yang cacat (pra-perbaikan
 * segmen) dari proyek produksi.
 *
 * op-1044657083 ("Rumah Tropis Modern - Carport Batu Alam"): pintu di dinding
 * utara Ruang Tamu, dunia x 8.90–9.80 — jatuh di depan Ruang Makan (bukan
 * Dapur yang dijanjikan), tumpang tindih 0,14 m dgn pintu makan yang sudah
 * ada (door-fix-room-XEa1RA), dan duplikat koneksi tamu↔makan. Setelah
 * dihapus, pengguna bisa minta agent lagi di UI — kode yang sudah diperbaiki
 * akan menaruh pintu yang benar ke Dapur (terverifikasi 38-agent-access-e2e).
 *
 * DRY-RUN default; tulis dgn --apply.
 */
import pg from "pg"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadEnvLocal } from "./_shared.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
loadEnvLocal(repoRoot)
const APPLY = process.argv.includes("--apply")
const PROJECT_ID = "proj-modern-tropis-1"
const BOGUS_ID = "op-1044657083"

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false, max: 2 })
const row = (await pool.query(
  `select payload, version_id, revision from design_layouts where project_id = $1`,
  [PROJECT_ID],
)).rows[0]
if (!row) { console.log("layout tidak ditemukan"); process.exit(1) }

const target = row.payload.openings.find((o) => o.id === BOGUS_ID)
if (!target) {
  console.log(`${BOGUS_ID} sudah tidak ada — tidak ada yang perlu dihapus.`)
  await pool.end()
  process.exit(0)
}
console.log("Akan dihapus:", JSON.stringify(target))
console.log(`Bukaan: ${row.payload.openings.length} → ${row.payload.openings.length - 1}`)

if (APPLY) {
  row.payload.openings = row.payload.openings.filter((o) => o.id !== BOGUS_ID)
  await pool.query(
    `update design_layouts set payload = $1, revision = revision + 1, updated_at = now()
     where project_id = $2 and version_id = $3`,
    [JSON.stringify(row.payload), PROJECT_ID, row.version_id],
  )
  console.log("DITERAPKAN.")
} else {
  console.log("DRY-RUN (pakai --apply untuk menulis).")
}
await pool.end()
