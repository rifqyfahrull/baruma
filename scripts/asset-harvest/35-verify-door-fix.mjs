/**
 * Tahap 35 — verifikasi geometri pintu hasil tahap 34 di DATA PRODUKSI.
 *
 * Menulis ke produksi menuntut pembuktian, bukan asumsi "skripnya benar".
 * Yang diperiksa untuk setiap pintu `door-fix-*`:
 *   1. wallId menunjuk ruang yang ADA
 *   2. daun pintu berada DI DALAM bentang dinding (tidak menjorok keluar)
 *   3. tidak bertabrakan dengan bukaan lain di dinding yang sama
 *   4. lebar >= MIN_DOOR_WIDTH_M (0,8) agar tak memicu aturan pintu-sempit
 */
import pg from "pg"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadEnvLocal } from "./_shared.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
loadEnvLocal(repoRoot)
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false, max: 4 })

const MIN_DOOR_W = 0.8
const W = (r) => r.width ?? r.widthM ?? 0
const D = (r) => r.depth ?? r.depthM ?? 0
const edgeLen = (room, side) => (side === "n" || side === "s" ? W(room) : D(room))

const rows = (await pool.query(
  `select dl.payload, p.name as project_name
   from design_layouts dl left join projects p on p.id = dl.project_id order by p.name`,
)).rows

let checked = 0
const problems = []

for (const row of rows) {
  const rooms = row.payload?.rooms ?? []
  const openings = row.payload?.openings ?? []
  for (const o of openings) {
    if (!String(o.id ?? "").startsWith("door-fix-")) continue
    checked++
    const [rid, side] = String(o.wallId).split(":")
    const room = rooms.find((r) => r.id === rid)
    const tag = `${row.project_name} / ${o.id}`
    if (!room) { problems.push(`${tag}: ruang "${rid}" tidak ada`); continue }
    if (!["n", "s", "w", "e"].includes(side)) { problems.push(`${tag}: sisi "${side}" tak sah`); continue }

    const len = edgeLen(room, side)
    const half = o.widthM / 2
    if (o.positionM - half < -1e-6 || o.positionM + half > len + 1e-6) {
      problems.push(`${tag}: menjorok keluar dinding (pos ${o.positionM}±${half} vs panjang ${len.toFixed(2)})`)
    }
    if (o.widthM + 1e-6 < MIN_DOOR_W) {
      problems.push(`${tag}: lebar ${o.widthM} < ${MIN_DOOR_W}`)
    }
    for (const other of openings) {
      if (other === o || other.wallId !== o.wallId) continue
      const gap = Math.abs(other.positionM - o.positionM) - (other.widthM + o.widthM) / 2
      if (gap < -1e-6) problems.push(`${tag}: bertabrakan dengan ${other.id}`)
    }
  }
}

console.log(`VERIFIKASI PINTU HASIL PERBAIKAN\n${"=".repeat(52)}`)
console.log(`pintu door-fix-* diperiksa : ${checked}`)
console.log(`masalah geometri           : ${problems.length}`)
for (const p of problems) console.log(`  ✗ ${p}`)
if (!problems.length && checked > 0) console.log("\nSemua pintu valid: di dalam dinding, tak bertabrakan, lebar cukup.")
await pool.end()
process.exit(problems.length ? 1 : 0)
