/**
 * Tahap 34 — perbaiki ruang tanpa pintu pada denah produksi.
 *
 * Aturan audit baru (auditRoomAccess) menyalakan 83 peringatan di 15/15 proyek,
 * termasuk seluruh demo "Asset Bank" yang jadi kesan pertama pengguna.
 * Peringatannya benar — ruang-ruang itu memang tak berpintu — jadi yang
 * diperbaiki DATANYA, bukan aturannya dilemahkan.
 *
 * Prinsip penempatan (konservatif; pintu asal-taruh lebih buruk daripada tanpa
 * pintu):
 *   1. Masuk dari ruang SIRKULASI (tamu/keluarga/makan) bila bersebelahan.
 *   2. Kalau tidak ada, dari ruang interior lain yang bersebelahan.
 *   3. Kalau tidak ada, dari ruang luar bersebelahan (teras/carport/taman).
 *   4. Terakhir: dinding luar dengan bentang bebas terpanjang.
 * Pintu diletakkan di TENGAH bentang dinding bersama, dan segmen yang sudah
 * terpakai bukaan lain dihindari.
 *
 * Konvensi positionM = TITIK TENGAH bukaan diukur sepanjang dinding dari sudut
 * asal ruang (lihat openingSegment di src/lib/geometry/index.ts) — salah paham
 * di sini membuat pintu mendarat di tempat konyol.
 *
 * DRY-RUN secara default. Menulis ke DB produksi hanya dengan flag --apply.
 */
import pg from "pg"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadEnvLocal } from "./_shared.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
loadEnvLocal(repoRoot)
const APPLY = process.argv.includes("--apply")
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false, max: 4 })

const OPEN_TYPES = new Set(["kolam", "taman", "carport", "balkon", "rooftop_lounge", "void"])
const CIRCULATION = new Set(["ruang_tamu", "ruang_keluarga", "ruang_makan", "koridor", "foyer", "teras"])
/** Boleh dilewati, tapi bukan jalur utama. */
const SEMI = new Set(["dapur", "laundry", "gudang", "tangga", "area_jemur"])
/** Ruang PRIVAT — tidak boleh jadi jalur lintasan menuju ruang lain. */
const PRIVATE = new Set(["kamar_tidur", "kamar_mandi", "musholla", "kamar_art"])
/** BUKAN ruang yang bisa dipijak: void = lubang lantai, kolam = air.
 *  Pintu ke sini mustahil — dry-run pertama sempat menghasilkan
 *  "Musholla → Void" karena keduanya ikut terhitung "ruang terbuka". */
const NOT_WALKABLE = new Set(["void", "kolam"])

/**
 * Seberapa pantas `neighbor` dijadikan ASAL masuk ke `room`.
 *
 * Versi pertama menyamakan semua tetangga interior, sehingga menghasilkan
 * pintu "Kamar tidur 2 → Kamar tidur 1" dan "Musholla → Kamar mandi" —
 * secara arsitektur salah. Ruang privat kini dinilai lebih rendah daripada
 * dinding luar, jadi lebih baik pintu ke luar daripada menembus kamar orang.
 */
function sourceScore(room, neighbor, level) {
  // Pintu ke dinding LUAR hanya sah di lantai dasar. Di lantai atas tanpa
  // balkon itu berarti pintu menuju udara kosong — lebih baik dibiarkan
  // tertandai daripada ditambal dengan sesuatu yang mustahil.
  if (!neighbor) return level === 1 ? 1 : -1
  const t = neighbor.type
  if (NOT_WALKABLE.has(t)) return -1 // tak mungkin jadi akses
  if (PRIVATE.has(t)) {
    // Pengecualian sah: kamar mandi dalam (en-suite) diakses dari kamar tidur.
    if (room.type === "kamar_mandi" && t === "kamar_tidur") return 4
    // Selain itu TIDAK ditambal: menembus kamar tidur/kamar mandi orang sama
    // salahnya dengan pintu ke udara kosong. Kalau hanya ini yang tersisa,
    // denahnya memang tak punya sirkulasi — biarkan tertandai untuk ditangani
    // manusia daripada dipalsukan seolah beres.
    return -1
  }
  if (CIRCULATION.has(t)) return 4
  if (SEMI.has(t)) return 3
  if (OPEN_TYPES.has(t)) return 2
  return 2
}
const DOOR_W = 0.9      // hinged_door default; di atas MIN_DOOR_WIDTH_M (0.8)
const TOL = 0.15, MIN_SHARE = 0.6
const MARGIN = 0.15     // sisa dinding di tiap sisi daun pintu

const W = (r) => r.width ?? r.widthM ?? 0
const D = (r) => r.depth ?? r.depthM ?? 0
const SIDES = ["n", "s", "w", "e"]

/** Rentang dinding bersama antara `room` sisi `side` dan tetangganya. */
function sharedRange(room, side, rooms) {
  const x2 = room.x + W(room), y2 = room.y + D(room)
  for (const b of rooms) {
    if (b.id === room.id || b.floorId !== room.floorId) continue
    const bx2 = b.x + W(b), by2 = b.y + D(b)
    const xLo = Math.max(room.x, b.x), xHi = Math.min(x2, bx2)
    const yLo = Math.max(room.y, b.y), yHi = Math.min(y2, by2)
    const horizontal = side === "n" || side === "s"
    const touch =
      side === "n" ? Math.abs(by2 - room.y) <= TOL :
      side === "s" ? Math.abs(b.y - y2) <= TOL :
      side === "w" ? Math.abs(bx2 - room.x) <= TOL :
                     Math.abs(b.x - x2) <= TOL
    const lo = horizontal ? xLo : yLo
    const hi = horizontal ? xHi : yHi
    if (touch && hi - lo >= MIN_SHARE) return { neighbor: b, lo, hi }
  }
  return null
}

/** Panjang dinding pada sisi tsb. */
const edgeLen = (room, side) => (side === "n" || side === "s" ? W(room) : D(room))

/** Interval [start,end] bukaan lain di dinding yang sama (satuan positionM). */
function occupied(openings, roomId, side) {
  return openings
    .filter((o) => typeof o.wallId === "string" && o.wallId === `${roomId}:${side}`)
    .map((o) => [o.positionM - o.widthM / 2, o.positionM + o.widthM / 2])
}

/** Cari positionM bebas di dekat `preferred`; null bila tak muat. */
function freePosition(occ, preferred, len) {
  const half = DOOR_W / 2
  const lo = half + MARGIN, hi = len - half - MARGIN
  if (hi < lo) return null
  const clash = (p) => occ.some(([a, b]) => p - half < b + 0.05 && p + half > a - 0.05)
  const start = Math.min(Math.max(preferred, lo), hi)
  if (!clash(start)) return start
  // geser bertahap ke kiri/kanan mencari celah
  for (let d = 0.1; d <= len; d += 0.1) {
    for (const p of [start - d, start + d]) {
      if (p >= lo && p <= hi && !clash(p)) return p
    }
  }
  return null
}

const rows = (await pool.query(
  `select dl.project_id, dl.version_id, dl.payload, p.name as project_name
   from design_layouts dl left join projects p on p.id = dl.project_id order by p.name`,
)).rows

let totalAdded = 0, totalUnfixed = 0, projectsTouched = 0
const unfixed = []

for (const row of rows) {
  const payload = row.payload
  const levelOf = new Map((payload?.floors ?? []).map((f) => [f.id, f.level ?? 1]))
  const rooms = (payload?.rooms ?? []).filter((r) => r && typeof r.x === "number")
  const openings = payload?.openings ?? []

  // Ruang yang SUDAH punya akses (pintu melayani kedua sisi dinding bersama).
  const served = new Set()
  for (const o of openings) {
    if (o.type !== "door" || typeof o.wallId !== "string") continue
    const [rid, side] = o.wallId.split(":")
    served.add(rid)
    const host = rooms.find((r) => r.id === rid)
    if (host && side) {
      const sh = sharedRange(host, side, rooms)
      if (sh) served.add(sh.neighbor.id)
    }
  }

  const need = rooms.filter((r) => !OPEN_TYPES.has(r.type) && !served.has(r.id))
  if (!need.length) continue
  projectsTouched++
  const added = []

  for (const room of need) {
    if (served.has(room.id)) continue // mungkin sudah terlayani pintu yg baru ditambah
    // Nilai tiap sisi: sirkulasi > interior > ruang luar > dinding luar
    const candidates = []
    for (const side of SIDES) {
      const sh = sharedRange(room, side, rooms)
      const len = edgeLen(room, side)
      if (len < DOOR_W + 2 * MARGIN) continue
      if (sh) {
        const center = (sh.lo + sh.hi) / 2 - (side === "n" || side === "s" ? room.x : room.y)
        candidates.push({ side, score: sourceScore(room, sh.neighbor, levelOf.get(room.floorId) ?? 1), preferred: center, len, neighbor: sh.neighbor })
      } else {
        candidates.push({ side, score: sourceScore(room, null, levelOf.get(room.floorId) ?? 1), preferred: len / 2, len, neighbor: null })
      }
    }
    // Buang kandidat mustahil (mis. tembus void/kolam) sebelum diurutkan.
    const usable = candidates.filter((c) => c.score >= 0)
    usable.sort((a, b) => b.score - a.score || b.len - a.len)

    let placed = null
    for (const c of usable) {
      const pos = freePosition(occupied(openings, room.id, c.side), c.preferred, c.len)
      if (pos == null) continue
      placed = {
        id: `door-fix-${room.id}`,
        floorId: room.floorId,
        wallId: `${room.id}:${c.side}`,
        kind: "hinged_door",
        type: "door",
        positionM: Math.round(pos * 100) / 100,
        widthM: DOOR_W,
        heightM: 2.1,
        sillHeightM: 0,
        headHeightM: 2.1,
      }
      openings.push(placed)
      served.add(room.id)
      if (c.neighbor) served.add(c.neighbor.id)
      added.push(`${room.name} → ${c.neighbor ? c.neighbor.name : "luar"} (sisi ${c.side})`)
      break
    }
    if (!placed) {
      totalUnfixed++
      unfixed.push(`${row.project_name}: ${room.name} (${room.type})`)
    }
  }

  totalAdded += added.length
  console.log(`\n${row.project_name} — +${added.length} pintu`)
  for (const a of added) console.log(`   • ${a}`)

  if (APPLY && added.length) {
    payload.openings = openings
    await pool.query(
      `update design_layouts set payload = $1, revision = revision + 1, updated_at = now()
       where project_id = $2 and version_id = $3`,
      [JSON.stringify(payload), row.project_id, row.version_id],
    )
  }
}

console.log(`\n${"=".repeat(60)}`)
console.log(`${APPLY ? "DITERAPKAN" : "DRY-RUN (pakai --apply untuk menulis)"}`)
console.log(`pintu ditambahkan : ${totalAdded} di ${projectsTouched} proyek`)
console.log(`tidak bisa diperbaiki otomatis: ${totalUnfixed}`)
for (const u of unfixed) console.log(`   ! ${u}`)
await pool.end()
