/**
 * Restore design_knowledge.keywords from a saved JSON snapshot (per-id write).
 * Deterministic — writes back exact known values, no LLM. Used to recover the
 * best-recall keyword state after a keyword experiment/regeneration underperformed.
 *
 * Jalankan: node scripts/asset-harvest/restore-dk-from-backup.mjs <backup.json>
 */
import pg from "pg"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadEnvLocal } from "./_shared.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
loadEnvLocal(repoRoot)

const file = process.argv[2]
if (!file) { console.error("usage: restore-dk-from-backup.mjs <backup.json>"); process.exit(1) }
const rows = JSON.parse(readFileSync(file, "utf8"))
console.log(`[restore] ${rows.length} baris dari ${path.basename(file)}`)

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false })
let n = 0, changed = 0
for (const r of rows) {
  const res = await pool.query(
    `update design_knowledge set keywords = $2, updated_at = now()
     where id = $1 and coalesce(keywords,'') is distinct from coalesce($2,'')`,
    [r.id, r.keywords])
  n++
  changed += res.rowCount
}
await pool.end()
console.log(`[restore] SELESAI: ${n} baris diproses, ${changed} keywords dipulihkan`)
