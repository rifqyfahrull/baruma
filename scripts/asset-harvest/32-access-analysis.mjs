/**
 * Tahap 32 — ANALISIS aksesibilitas ruang pada denah produksi.
 *
 * Muncul saat menyelidiki adjacency: 36 pintu ada di 15 denah, tapi TIDAK SATU
 * pun milik kamar mandi (21 kamar mandi). Ruang tanpa pintu = ruang yang tak
 * bisa dimasuki — cacat yang objektif dan tak ambigu, jauh lebih kuat daripada
 * "taboo" adjacency yang tergantung selera.
 *
 * Audit Baruma saat ini memeriksa LEBAR pintu (kategori sirkulasi), tapi tidak
 * pernah memeriksa APAKAH ruang punya pintu sama sekali.
 *
 * Murni deterministik — nol token LLM.
 */
import pg from "pg"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadEnvLocal } from "./_shared.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
loadEnvLocal(repoRoot)
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false, max: 4 })

// Ruang terbuka/luar yang WAJAR tanpa daun pintu.
const OPEN_TYPES = new Set([
  "carport", "taman", "teras", "balkon", "kolam", "void",
  "rooftop_lounge", "area_jemur", "halaman",
])

const rows = (await pool.query(
  `select dl.project_id, dl.payload, p.name as project_name
   from design_layouts dl left join projects p on p.id = dl.project_id`,
)).rows

let totalRooms = 0, enclosed = 0, noDoor = 0, layoutsAffected = 0
const byType = new Map()
const examples = []
// CELAH SEBENARNYA: ruang yang punya jendela (validasi ventilasi LOLOS) tapi
// tak punya pintu (tak terjangkau) — cacat yang lewat tanpa peringatan apa pun.
let silentlyUnreachable = 0
const silentExamples = []

for (const row of rows) {
  const rooms = (row.payload?.rooms ?? []).filter((r) => r && typeof r.x === "number")
  const openings = row.payload?.openings ?? []
  // PENTING (lihat komentar di src/lib/validation.ts): satu pintu terdaftar di
  // SATU wallId tapi MELAYANI KEDUA sisi dinding. Versi pertama analisis ini
  // hanya menghitung pintu yang wallId-nya milik ruang itu sendiri, sehingga
  // melaporkan "21 kamar mandi tanpa pintu" — keliru. Ruang di seberang wall
  // yang sama juga mendapat akses dari pintu tersebut.
  const W_ = (r) => r.width ?? r.widthM ?? 0
  const D_ = (r) => r.depth ?? r.depthM ?? 0
  const TOL = 0.15, MIN_SHARE = 0.6
  const neighborOnSide = (room, side) => {
    const x2 = room.x + W_(room), y2 = room.y + D_(room)
    return rooms.find((b) => {
      if (b.id === room.id) return false
      const bx2 = b.x + W_(b), by2 = b.y + D_(b)
      const xOv = Math.min(x2, bx2) - Math.max(room.x, b.x)
      const yOv = Math.min(y2, by2) - Math.max(room.y, b.y)
      if (side === "n") return Math.abs(by2 - room.y) <= TOL && xOv >= MIN_SHARE
      if (side === "s") return Math.abs(b.y - y2) <= TOL && xOv >= MIN_SHARE
      if (side === "w") return Math.abs(bx2 - room.x) <= TOL && yOv >= MIN_SHARE
      if (side === "e") return Math.abs(b.x - x2) <= TOL && yOv >= MIN_SHARE
      return false
    })
  }
  const doorRoomIds = new Set()
  for (const o of openings) {
    if (o.type !== "door" || typeof o.wallId !== "string") continue
    const [rid, side] = o.wallId.split(":")
    doorRoomIds.add(rid)
    const host = rooms.find((r) => r.id === rid)
    if (!host || !side) continue
    const other = neighborOnSide(host, side)
    if (other) doorRoomIds.add(other.id) // pintu melayani kedua sisi
  }
  let affected = false
  for (const r of rooms) {
    totalRooms++
    if (OPEN_TYPES.has(r.type)) continue
    enclosed++
    if (doorRoomIds.has(r.id)) continue
    noDoor++
    affected = true
    byType.set(r.type, (byType.get(r.type) ?? 0) + 1)
    if (examples.length < 10) {
      examples.push(`${row.project_name ?? row.project_id}: "${r.name}" (${r.type})`)
    }
    // Punya bukaan apa pun (mis. jendela)? Kalau ya, aturan ventilasi yang ada
    // TIDAK menyala — ruang tak terjangkau ini lolos tanpa peringatan.
    const hasAnyOpening = openings.some((o) => {
      if (typeof o.wallId !== "string") return false
      const [rid, side] = o.wallId.split(":")
      if (rid === r.id) return true
      const host = rooms.find((x) => x.id === rid)
      return !!(host && side && neighborOnSide(host, side)?.id === r.id)
    })
    if (hasAnyOpening) {
      silentlyUnreachable++
      if (silentExamples.length < 8) {
        silentExamples.push(`${row.project_name ?? row.project_id}: "${r.name}" (${r.type}) — ada jendela, tak ada pintu`)
      }
    }
  }
  if (affected) layoutsAffected++
}

console.log(`ANALISIS AKSES RUANG — ${rows.length} denah produksi\n${"=".repeat(64)}`)
console.log(`total ruang                 : ${totalRooms}`)
console.log(`ruang tertutup (butuh pintu): ${enclosed}`)
console.log(`TANPA pintu sama sekali     : ${noDoor} (${enclosed ? Math.round((100 * noDoor) / enclosed) : 0}% dari ruang tertutup)`)
console.log(`denah terdampak             : ${layoutsAffected}/${rows.length}`)

console.log("\nPer tipe ruang:")
for (const [t, n] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(3)}×  ${t}`)
}
if (examples.length) {
  console.log("\nContoh:")
  for (const e of examples) console.log(`  • ${e}`)
}

console.log("\n" + "-".repeat(64))
console.log("CELAH YANG BELUM TERTUTUP — tak terjangkau TAPI validasi diam:")
console.log(`  ruang berjendela tanpa pintu : ${silentlyUnreachable}`)
console.log(`  (validasi ventilasi lolos karena ada jendela, padahal tak ada akses)`)
for (const e of silentExamples) console.log(`    • ${e}`)
await pool.end()
