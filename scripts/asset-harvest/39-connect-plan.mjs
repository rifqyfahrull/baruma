/**
 * Tahap 39 — "solusinya bagaimana?": pilah 53 ruang terputus jadi dua kategori
 * yang menentukan tindakan berbeda.
 *
 *   A. KURANG PINTU  — ruang sudah bersebelahan dgn ruang sirkulasi/semi yang
 *                      tersambung; cukup tambah pintu. Deterministik, aman.
 *   B. TERKURUNG     — tetangganya hanya ruang privat / tak ada tetangga
 *                      tersambung; butuh koridor atau ubah tata letak.
 *
 * Simulasi memakai penggabungan BERULANG: setelah satu pintu ditambahkan, dua
 * gugus menyatu, sehingga ruang lain bisa ikut tersambung. Skrip 34 dulu hanya
 * menambah pintu per-ruang tanpa memperhatikan konektivitas global — itulah
 * sebabnya 53 ruang tetap terputus meski setiap ruang "punya pintu".
 *
 * Nol token. Simulasi murni — tidak menulis apa pun.
 */
import pg from "pg"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadEnvLocal } from "./_shared.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
loadEnvLocal(repoRoot)
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false, max: 4 })

const OPEN_TYPES = new Set(["kolam", "taman", "carport", "balkon", "rooftop_lounge", "void"])
const CIRCULATION = new Set(["ruang_tamu", "ruang_keluarga", "ruang_makan", "koridor", "foyer", "teras"])
const SEMI = new Set(["dapur", "laundry", "gudang", "tangga", "area_jemur"])
const PRIVATE = new Set(["kamar_tidur", "kamar_mandi", "musholla", "kamar_art"])
const TOL = 0.12, MIN_SHARE = 0.6
const W = (r) => r.width ?? r.widthM ?? 0
const D = (r) => r.depth ?? r.depthM ?? 0

function sharedWall(a, b) {
  if (a.floorId !== b.floorId) return false
  const ax2 = a.x + W(a), ay2 = a.y + D(a), bx2 = b.x + W(b), by2 = b.y + D(b)
  const xOv = Math.min(ax2, bx2) - Math.max(a.x, b.x)
  const yOv = Math.min(ay2, by2) - Math.max(a.y, b.y)
  if ((Math.abs(ax2 - b.x) <= TOL || Math.abs(bx2 - a.x) <= TOL) && yOv >= MIN_SHARE) return true
  return (Math.abs(ay2 - b.y) <= TOL || Math.abs(by2 - a.y) <= TOL) && xOv >= MIN_SHARE
}

/**
 * Pantaskah menyambung ruang TERPUTUS `target` lewat ruang `via` yang sudah
 * tersambung? Yang dibatasi adalah ruang yang DILALUI, bukan tujuannya —
 * kamar tidur memang tujuan privat, dan membukanya langsung ke ruang keluarga
 * itu lazim di rumah kecil Indonesia. Versi pertama fungsi ini menolak bila
 * SALAH SATU sisi privat, sehingga kamar yang menempel ruang keluarga pun
 * ikut dicap "terkurung" — keliru.
 */
function acceptable(target, via) {
  if (!PRIVATE.has(via.type)) return true
  // Pengecualian: kamar mandi dalam diakses dari kamar tidurnya.
  return target.type === "kamar_mandi" && via.type === "kamar_tidur"
}

const rows = (await pool.query(
  `select dl.payload, p.name as project_name
   from design_layouts dl join projects p on p.id = dl.project_id order by p.name`,
)).rows

let totalIsolated = 0, fixableByDoor = 0, stranded = 0
const strandedList = []

for (const row of rows) {
  const rooms = (row.payload?.rooms ?? []).filter((r) => r && typeof r.x === "number")
  const doors = (row.payload?.openings ?? []).filter((o) => o.type === "door")
  const indoor = rooms.filter((r) => !OPEN_TYPES.has(r.type))

  // Union-find sederhana atas ruang dalam.
  const parent = new Map(indoor.map((r) => [r.id, r.id]))
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x) } return x }
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb) }

  for (const d of doors) {
    const [rid, side] = String(d.wallId).split(":")
    const host = rooms.find((r) => r.id === rid)
    if (!host) continue
    const nb = rooms.find((r) => r.id !== host.id && sharedWall(host, r) && (() => {
      // pastikan tetangga memang di sisi pintu tsb
      const hx2 = host.x + W(host), hy2 = host.y + D(host)
      if (side === "n") return Math.abs(r.y + D(r) - host.y) <= TOL
      if (side === "s") return Math.abs(r.y - hy2) <= TOL
      if (side === "w") return Math.abs(r.x + W(r) - host.x) <= TOL
      if (side === "e") return Math.abs(r.x - hx2) <= TOL
      return false
    })())
    if (nb && !OPEN_TYPES.has(nb.type) && !OPEN_TYPES.has(host.type)) union(host.id, nb.id)
  }

  const sizeOf = () => {
    const m = new Map()
    for (const r of indoor) m.set(find(r.id), (m.get(find(r.id)) ?? 0) + 1)
    return m
  }
  const mainRoot = () => {
    let best = null, n = -1
    for (const [root, c] of sizeOf()) if (c > n) { n = c; best = root }
    return best
  }

  const before = indoor.filter((r) => find(r.id) !== mainRoot()).length
  totalIsolated += before

  // Gabungkan berulang lewat pintu yang PANTAS sampai tak ada lagi yang bisa.
  let merged = true
  while (merged) {
    merged = false
    const main = mainRoot()
    for (const r of indoor) {
      if (find(r.id) === main) continue
      for (const other of indoor) {
        if (find(other.id) !== main) continue
        if (!sharedWall(r, other) || !acceptable(r, other)) continue
        union(r.id, other.id)
        merged = true
        break
      }
      if (merged) break
    }
  }

  const after = indoor.filter((r) => find(r.id) !== mainRoot())
  fixableByDoor += before - after.length
  stranded += after.length
  for (const r of after) {
    const nbTypes = indoor.filter((x) => x.id !== r.id && sharedWall(r, x)).map((x) => x.type)
    strandedList.push(`${row.project_name}: ${r.name} [${r.type}] — tetangga: ${nbTypes.join(", ") || "tidak ada"}`)
  }
}

console.log(`RENCANA PENYAMBUNGAN — ${rows.length} denah\n${"=".repeat(64)}`)
console.log(`ruang terputus saat ini          : ${totalIsolated}`)
console.log(`A. cukup TAMBAH PINTU (aman)     : ${fixableByDoor}`)
console.log(`B. TERKURUNG (butuh ubah layout) : ${stranded}`)
console.log(`\nDetail kategori B:`)
for (const s of strandedList) console.log(`  • ${s}`)
await pool.end()
