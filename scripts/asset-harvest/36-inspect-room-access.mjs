/**
 * Tahap 36 — periksa AKSES sebuah ruang secara rinci pada satu proyek.
 *
 * Dipakai menindaklanjuti laporan pengguna: "kamar tidur 2 tidak ada akses ke
 * dalam rumah, pintunya hanya keluar rumah". Aturan auditRoomAccess yang ada
 * menghitung pintu APA PUN sebagai akses — termasuk pintu yang hanya menuju
 * luar. Skrip ini memisahkan keduanya:
 *   - akses INTERIOR : pintu ke ruang lain di dalam rumah
 *   - akses LUAR     : pintu ke dinding luar / ruang terbuka
 *
 * Jalankan: node scripts/asset-harvest/36-inspect-room-access.mjs "<nama proyek>"
 */
import pg from "pg"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadEnvLocal } from "./_shared.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
loadEnvLocal(repoRoot)
const PROJECT = process.argv[2] || "Rumah Tropis Modern - Carport Batu Alam"
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false, max: 4 })

const OPEN_TYPES = new Set(["kolam", "taman", "carport", "balkon", "rooftop_lounge", "void"])
const TOL = 0.15, MIN_SHARE = 0.6
const W = (r) => r.width ?? r.widthM ?? 0
const D = (r) => r.depth ?? r.depthM ?? 0

function neighborOnSide(room, side, rooms) {
  const x2 = room.x + W(room), y2 = room.y + D(room)
  return rooms.find((b) => {
    if (b.id === room.id || b.floorId !== room.floorId) return false
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

const row = (await pool.query(
  `select dl.payload from design_layouts dl join projects p on p.id = dl.project_id where p.name = $1`,
  [PROJECT],
)).rows[0]
if (!row) { console.log(`Proyek "${PROJECT}" tidak ditemukan`); await pool.end(); process.exit(1) }

const rooms = (row.payload?.rooms ?? []).filter((r) => r && typeof r.x === "number")
const openings = row.payload?.openings ?? []
const doors = openings.filter((o) => o.type === "door")

console.log(`AKSES RUANG — ${PROJECT}\n${"=".repeat(66)}`)
for (const room of rooms) {
  if (OPEN_TYPES.has(room.type)) continue
  const interior = [], exterior = []
  for (const d of doors) {
    const [rid, side] = String(d.wallId).split(":")
    // pintu milik ruang ini
    if (rid === room.id) {
      const nb = neighborOnSide(room, side, rooms)
      if (nb && !OPEN_TYPES.has(nb.type)) interior.push(`${d.id} → ${nb.name}`)
      else exterior.push(`${d.id} → ${nb ? nb.name : "LUAR"} (sisi ${side})`)
      continue
    }
    // pintu milik tetangga di dinding bersama (melayani kedua sisi)
    const host = rooms.find((r) => r.id === rid)
    if (!host || !side) continue
    if (neighborOnSide(host, side, rooms)?.id === room.id) {
      interior.push(`${d.id} → ${host.name}`)
    }
  }
  const status = interior.length ? "OK" : exterior.length ? "HANYA KE LUAR" : "TIDAK ADA PINTU"
  const mark = interior.length ? "  " : "✗ "
  console.log(`${mark}${room.name.padEnd(22)} [${room.type}] ${status}`)
  for (const i of interior) console.log(`      dalam : ${i}`)
  for (const e of exterior) console.log(`      luar  : ${e}`)
}
await pool.end()
