/**
 * Tahap 37 — KETERJANGKAUAN ruang (graf), bukan sekadar "punya pintu".
 *
 * Laporan pengguna: "kamar tidur 2 tidak ada akses ke dalam rumah, pintunya
 * hanya keluar rumah". Ternyata benar, dan menunjukkan aturan auditRoomAccess
 * yang saya buat MASIH terlalu longgar: ia menerima pintu apa pun sebagai
 * akses. Kamar tidur 2 punya pintu ke luar + pintu ke kamar mandinya sendiri
 * (buntu) — dari ruang keluarga tetap tak terjangkau tanpa keluar rumah.
 *
 * Ukuran yang benar: dari PINTU MASUK, ruang mana yang bisa dicapai dengan
 * berjalan lewat pintu interior? Ruang yang tidak terjangkau = cacat, meski
 * punya pintu.
 *
 * Deterministik, nol token.
 */
import pg from "pg"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadEnvLocal } from "./_shared.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
loadEnvLocal(repoRoot)
const ONLY = process.argv[2] || null
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

/**
 * Graf ruang: sisi = pintu antar dua ruang. Ruang terbuka (taman/carport)
 * dianggap "luar" — melewatinya berarti keluar rumah, jadi TIDAK dihitung
 * sebagai jalur interior.
 */
function analyze(payload) {
  const rooms = (payload?.rooms ?? []).filter((r) => r && typeof r.x === "number")
  const doors = (payload?.openings ?? []).filter((o) => o.type === "door")
  const indoor = rooms.filter((r) => !OPEN_TYPES.has(r.type))
  const adj = new Map(indoor.map((r) => [r.id, []]))
  const hasExteriorDoor = new Set()

  for (const d of doors) {
    const [rid, side] = String(d.wallId).split(":")
    const host = rooms.find((r) => r.id === rid)
    if (!host || !side) continue
    const nb = neighborOnSide(host, side, rooms)
    const hostIndoor = !OPEN_TYPES.has(host.type)
    const nbIndoor = nb && !OPEN_TYPES.has(nb.type)
    if (hostIndoor && nbIndoor) {
      adj.get(host.id)?.push(nb.id)
      adj.get(nb.id)?.push(host.id)
    } else if (hostIndoor) {
      hasExteriorDoor.add(host.id) // ke luar / ke ruang terbuka
    } else if (nbIndoor) {
      hasExteriorDoor.add(nb.id)
    }
  }

  // Titik awal: ruang yang punya pintu ke luar (pintu masuk rumah).
  const start = [...hasExteriorDoor]
  const seen = new Set(start)
  const queue = [...start]
  while (queue.length) {
    const cur = queue.shift()
    for (const nx of adj.get(cur) ?? []) {
      if (!seen.has(nx)) { seen.add(nx); queue.push(nx) }
    }
  }
  // Ruang yang HANYA bisa dimasuki dari luar (tak nyambung ke inti rumah).
  // Inti = komponen terbesar yang memuat pintu masuk utama.
  const compOf = new Map()
  let comp = 0
  for (const r of indoor) {
    if (compOf.has(r.id)) continue
    const q = [r.id]; compOf.set(r.id, comp)
    while (q.length) {
      const c = q.shift()
      for (const nx of adj.get(c) ?? []) if (!compOf.has(nx)) { compOf.set(nx, comp); q.push(nx) }
    }
    comp++
  }
  const sizes = new Map()
  for (const [, c] of compOf) sizes.set(c, (sizes.get(c) ?? 0) + 1)
  let mainComp = 0, best = -1
  for (const [c, n] of sizes) if (n > best) { best = n; mainComp = c }

  const isolated = indoor.filter((r) => compOf.get(r.id) !== mainComp)
  return { indoor, isolated, hasExteriorDoor, compOf, mainComp }
}

const rows = (await pool.query(
  `select dl.payload, p.name as project_name
   from design_layouts dl join projects p on p.id = dl.project_id
   ${ONLY ? "where p.name = $1" : ""} order by p.name`,
  ONLY ? [ONLY] : [],
)).rows

let totalIso = 0, projectsIso = 0
console.log(`KETERJANGKAUAN RUANG (graf pintu)\n${"=".repeat(60)}`)
for (const row of rows) {
  const { indoor, isolated, hasExteriorDoor } = analyze(row.payload)
  if (isolated.length) { projectsIso++; totalIso += isolated.length }
  const flag = isolated.length ? "✗" : "✓"
  console.log(`${flag} ${row.project_name}  (${indoor.length} ruang dalam, ${isolated.length} terputus)`)
  for (const r of isolated) {
    const via = hasExteriorDoor.has(r.id) ? "hanya bisa lewat luar rumah" : "tidak terjangkau sama sekali"
    console.log(`      • ${r.name} [${r.type}] — ${via}`)
  }
}
console.log(`\nTOTAL ruang terputus: ${totalIso} di ${projectsIso}/${rows.length} proyek`)
await pool.end()
