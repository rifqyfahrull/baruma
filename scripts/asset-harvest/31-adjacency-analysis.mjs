/**
 * Tahap 31 — ANALISIS hubungan antar-ruang pada denah NYATA di produksi.
 *
 * Audit Baruma saat ini memeriksa ukuran/rasio/keberadaan (ruang, cahaya,
 * sirkulasi=lebar pintu, struktur, sanitasi, regulasi, program) — tak ada satu
 * pun aturan tentang RELASI antar-ruang. Sebelum membangun aturan baru, skrip
 * ini mengukur apakah masalahnya memang ADA di data nyata.
 *
 * Murni geometri deterministik — nol token LLM.
 *
 * Adjacency = dua ruang di lantai yang sama berbagi dinding (bukan sekadar
 * bersentuhan di titik sudut): proyeksi pada sumbu tegak lurus harus tumpang
 * tindih lebih dari AMBANG, dan jarak antar-tepi ~0.
 */
import pg from "pg"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadEnvLocal } from "./_shared.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
loadEnvLocal(repoRoot)
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false, max: 4 })

const TOL = 0.15      // toleransi sentuh (m) — tebal dinding & pembulatan
const MIN_SHARE = 0.6 // panjang dinding bersama minimal (m) agar dihitung

/** Ruang produksi memakai `width`/`depth` (bukan widthM/depthM) dan tersimpan
 *  DATAR di payload.rooms[] dengan `floorId` — bukan bersarang di floors[]. */
const W = (r) => r.width ?? r.widthM ?? 0
const D = (r) => r.depth ?? r.depthM ?? 0

/** Apakah dua rect berbagi DINDING (bukan cuma bersinggungan di sudut)? */
function sharesWall(a, b) {
  const ax2 = a.x + W(a), ay2 = a.y + D(a)
  const bx2 = b.x + W(b), by2 = b.y + D(b)
  // vertikal: tepi kiri/kanan bertemu, proyeksi Y tumpang tindih
  const vTouch = Math.abs(ax2 - b.x) <= TOL || Math.abs(bx2 - a.x) <= TOL
  const yOverlap = Math.min(ay2, by2) - Math.max(a.y, b.y)
  if (vTouch && yOverlap >= MIN_SHARE) return true
  // horizontal: tepi atas/bawah bertemu, proyeksi X tumpang tindih
  const hTouch = Math.abs(ay2 - b.y) <= TOL || Math.abs(by2 - a.y) <= TOL
  const xOverlap = Math.min(ax2, bx2) - Math.max(a.x, b.x)
  return hTouch && xOverlap >= MIN_SHARE
}

/**
 * Pasangan yang secara praktik dihindari di rumah tinggal Indonesia.
 * SENGAJA dikurasi tangan (himpunan kecil & menyangkut kualitas desain) —
 * bukan digenerate LLM. Angka/severity ditentukan di sini, bukan ditebak model.
 */
const AVOID = [
  { a: "kamar_mandi", b: "dapur", why: "higienis: area basah/kotor menempel area masak", sev: "warning" },
  { a: "kamar_mandi", b: "ruang_makan", why: "higienis & kenyamanan saat makan", sev: "warning" },
  { a: "kamar_mandi", b: "ruang_tamu", why: "privasi: tamu melihat/mendengar area basah", sev: "advisory" },
  { a: "dapur", b: "kamar_tidur", why: "asap & bau masakan masuk kamar", sev: "advisory" },
  { a: "musholla", b: "kamar_mandi", why: "adab: ruang ibadah berdempet area najis", sev: "warning" },
]
const key = (x, y) => [x, y].sort().join("|")
const AVOID_MAP = new Map(AVOID.map((r) => [key(r.a, r.b), r]))

const rows = (await pool.query(
  `select dl.project_id, dl.payload, p.name as project_name
   from design_layouts dl left join projects p on p.id = dl.project_id`,
)).rows
console.log(`ANALISIS ADJACENCY — ${rows.length} denah produksi\n${"=".repeat(64)}`)

/**
 * Ruang di seberang SISI tertentu sebuah ruang. Konvensi sumbu sama dengan
 * kompas 2D: sisi "n" = tepi y terkecil (atas kanvas = utara).
 */
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

/** Ruang yang TIDAK pantas dihadapi langsung oleh pintu kamar mandi. */
const DOOR_FACING_AVOID = new Set(["dapur", "ruang_makan", "ruang_tamu"])

const hitCounts = new Map()
let layoutsWithIssue = 0, totalPairs = 0, totalRooms = 0
const examples = []
// Aturan presisi: PINTU kamar mandi membuka langsung ke area makan/masak/tamu.
let doorViolations = 0, layoutsWithDoorIssue = 0, bathroomsWithDoor = 0
const doorExamples = []

for (const row of rows) {
  const all = (row.payload?.rooms ?? []).filter((r) => r && typeof r.x === "number")
  const byFloor = new Map()
  for (const r of all) {
    const f = r.floorId ?? "?"
    if (!byFloor.has(f)) byFloor.set(f, [])
    byFloor.get(f).push(r)
  }
  let layoutHas = false
  // Adjacency hanya bermakna dalam SATU lantai.
  for (const rooms of byFloor.values()) {
    totalRooms += rooms.length
    for (let i = 0; i < rooms.length; i++) {
      for (let j = i + 1; j < rooms.length; j++) {
        const A = rooms[i], B = rooms[j]
        if (!sharesWall(A, B)) continue
        totalPairs++
        const rule = AVOID_MAP.get(key(A.type, B.type))
        if (!rule) continue
        layoutHas = true
        hitCounts.set(rule.why, (hitCounts.get(rule.why) ?? 0) + 1)
        if (examples.length < 12) {
          examples.push(`${row.project_name ?? row.project_id}: "${A.name}" (${A.type}) ↔ "${B.name}" (${B.type}) — ${rule.why}`)
        }
      }
    }
  }
  if (layoutHas) layoutsWithIssue++

  // ── Aturan presisi: ke mana PINTU kamar mandi membuka? ──
  const openings = row.payload?.openings ?? []
  let layoutDoorIssue = false
  for (const [, rooms] of byFloor) {
    for (const bath of rooms.filter((r) => r.type === "kamar_mandi")) {
      const doors = openings.filter(
        (o) => o.type === "door" && typeof o.wallId === "string" && o.wallId.split(":")[0] === bath.id,
      )
      if (doors.length) bathroomsWithDoor++
      for (const d of doors) {
        const side = d.wallId.split(":")[1]
        const facing = neighborOnSide(bath, side, rooms)
        if (!facing || !DOOR_FACING_AVOID.has(facing.type)) continue
        doorViolations++
        layoutDoorIssue = true
        if (doorExamples.length < 8) {
          doorExamples.push(`${row.project_name ?? row.project_id}: pintu "${bath.name}" (sisi ${side}) → "${facing.name}" (${facing.type})`)
        }
      }
    }
  }
  if (layoutDoorIssue) layoutsWithDoorIssue++
}

console.log(`denah dianalisis   : ${rows.length}`)
console.log(`total ruang        : ${totalRooms}`)
console.log(`pasangan bersebelah: ${totalPairs}`)
console.log(`denah BERMASALAH   : ${layoutsWithIssue}/${rows.length}` +
  ` (${rows.length ? Math.round((100 * layoutsWithIssue) / rows.length) : 0}%)`)

console.log("\nTemuan per jenis:")
if (hitCounts.size === 0) console.log("  (tidak ada pelanggaran adjacency ditemukan)")
for (const [why, n] of [...hitCounts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(3)}×  ${why}`)
}
if (examples.length) {
  console.log("\nContoh nyata:")
  for (const e of examples) console.log(`  • ${e}`)
}

console.log("\n" + "-".repeat(64))
console.log("ATURAN PRESISI — pintu kamar mandi membuka ke area masak/makan/tamu:")
console.log(`  kamar mandi berpintu   : ${bathroomsWithDoor}`)
console.log(`  pelanggaran pintu      : ${doorViolations}`)
console.log(`  denah kena             : ${layoutsWithDoorIssue}/${rows.length}` +
  ` (${rows.length ? Math.round((100 * layoutsWithDoorIssue) / rows.length) : 0}%)`)
for (const e of doorExamples) console.log(`    • ${e}`)

// Distribusi tipe ruang — konteks seberapa sering tipe rawan muncul.
const typeCount = new Map()
for (const row of rows) {
  for (const r of row.payload?.rooms ?? []) typeCount.set(r.type, (typeCount.get(r.type) ?? 0) + 1)
}
console.log("\nTipe ruang terbanyak:")
for (const [t, n] of [...typeCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`  ${String(n).padStart(3)}×  ${t}`)
}
await pool.end()
