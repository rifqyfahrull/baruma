/**
 * Tahap 33 — dampak aturan akses baru terhadap proyek yang SUDAH ADA.
 *
 * auditRoomAccess() menandai ruang tertutup tanpa pintu. Aturannya benar, tapi
 * konsekuensinya perlu dilihat: proyek demo "Asset Bank" adalah yang pertama
 * dilihat pengguna. Kalau semuanya penuh peringatan, yang rusak adalah kesan
 * pertama produk — bukan aturannya.
 *
 * Deterministik, nol token.
 */
import pg from "pg"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadEnvLocal } from "./_shared.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
loadEnvLocal(repoRoot)
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false, max: 4 })

const OPEN_TYPES = new Set([
  "carport", "taman", "teras", "balkon", "kolam", "void",
  "rooftop_lounge", "area_jemur", "halaman",
])
const W = (r) => r.width ?? r.widthM ?? 0
const D = (r) => r.depth ?? r.depthM ?? 0
const TOL = 0.15, MIN_SHARE = 0.6

function neighborOnSide(room, side, rooms) {
  const x2 = room.x + W(room), y2 = room.y + D(room)
  return rooms.find((b) => {
    if (b.id === room.id) return false
    const bx2 = b.x + W(b), by2 = b.y + D(b)
    const xOv = Math.min(x2, bx2) - Math.max(room.x, b.x)
    const yOv = Math.min(y2, by2) - Math.max(room.y, b.y)
    if (side === "n") return Math.abs(by2 - room.y) <= TOL && xOv >= MIN_SHARE
    if (side === "s") return Math.abs(b.y - y2) <= TOL && xOv >= MIN_SHARE
    if (side === "w") return Math.abs(bx2 - room.x) <= TOL && yOv >= MIN_SHARE
    if (side === "e") return Math.abs(b.x - x2) <= TOL && yOv >= MIN_SHARE
    return false
  })
}

const rows = (await pool.query(
  `select dl.project_id, dl.payload, p.name as project_name
   from design_layouts dl left join projects p on p.id = dl.project_id
   order by p.name`,
)).rows

console.log(`DAMPAK ATURAN AKSES pada proyek yang sudah ada\n${"=".repeat(60)}`)
let grand = 0
const perProject = []
for (const row of rows) {
  const rooms = (row.payload?.rooms ?? []).filter((r) => r && typeof r.x === "number")
  const openings = row.payload?.openings ?? []
  const served = new Set()
  for (const o of openings) {
    if (o.type !== "door" || typeof o.wallId !== "string") continue
    const [rid, side] = o.wallId.split(":")
    served.add(rid)
    const host = rooms.find((r) => r.id === rid)
    if (host && side) {
      const other = neighborOnSide(host, side, rooms.filter((r) => r.floorId === host.floorId))
      if (other) served.add(other.id)
    }
  }
  const flagged = rooms.filter((r) => !OPEN_TYPES.has(r.type) && !served.has(r.id))
  grand += flagged.length
  perProject.push({ name: row.project_name ?? row.project_id, n: flagged.length, total: rooms.length })
}
for (const p of perProject.sort((a, b) => b.n - a.n)) {
  const bar = "█".repeat(Math.min(p.n, 12))
  console.log(`  ${String(p.n).padStart(2)} peringatan  ${bar.padEnd(12)} ${p.name}`)
}
console.log(`\nTOTAL peringatan baru: ${grand} di ${perProject.filter((p) => p.n > 0).length}/${rows.length} proyek`)
await pool.end()
