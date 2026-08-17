/**
 * Tahap 38 — E2E: apakah agent menangani keluhan akses pada denah PRODUKSI?
 *
 * Memakai kalimat pengguna apa adanya:
 *   "Tolong perbaiki lagi designnya, kamar tidur 2 tidak ada akses ke dalam
 *    rumah, pintunya hanya keluar rumah"
 * pada proyek "Rumah Tropis Modern - Carport Batu Alam", lalu MEMVERIFIKASI
 * bahwa pintu yang diusulkan benar-benar menyambungkan ruang itu ke inti rumah
 * (bukan sekadar menempel daun pintu di sisi mana pun).
 *
 * Nol token LLM — jalur deterministik.
 */
import pg from "pg"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { loadEnvLocal } from "./_shared.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
loadEnvLocal(repoRoot)

// Modul TS dijalankan lewat tsx supaya logika yang diuji BENAR-BENAR yang
// dipakai aplikasi, bukan salinan.
const { handleFloorplanInstruction } = await import(
  pathToFileURL(path.join(repoRoot, "src/lib/assistant/deterministic.ts")).href
)
const { analyzeRoomConnectivity } = await import(
  pathToFileURL(path.join(repoRoot, "src/lib/geometry/connectivity.ts")).href
)

const PROJECT = "Rumah Tropis Modern - Carport Batu Alam"
const INSTRUCTION =
  process.argv[2] ??
  "Tolong perbaiki lagi designnya, kamar tidur 2 tidak ada akses ke dalam rumah, pintunya hanya keluar rumah"

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false, max: 2 })
const row = (await pool.query(
  `select dl.payload from design_layouts dl join projects p on p.id = dl.project_id where p.name = $1`,
  [PROJECT],
)).rows[0]
await pool.end()
if (!row) { console.log("proyek tak ditemukan"); process.exit(1) }

const payload = row.payload
const rooms = payload.rooms.filter((r) => r && typeof r.x === "number")
const openings = payload.openings ?? []

// Scene seperti yang dikirim editor (openings pakai roomId + side).
const scene = {
  site: { widthM: payload.site?.widthM ?? 12, depthM: payload.site?.depthM ?? 15 },
  floors: payload.floors ?? [],
  selectedRoomId: null,
  rooms,
  openings: openings.map((o) => {
    const [roomId, side] = String(o.wallId).split(":")
    return { ...o, roomId, side }
  }),
}

const before = analyzeRoomConnectivity(rooms, openings)
console.log(`E2E AGENT — ${PROJECT}\n${"=".repeat(64)}`)
console.log(`Instruksi: "${INSTRUCTION}"\n`)
console.log(`Sebelum — ruang terputus (${before.isolated.length}): ${before.isolated.map((r) => r.name).join(", ")}`)

const res = handleFloorplanInstruction(INSTRUCTION, scene)
console.log(`\nDitangani deterministik : ${res.matched}`)
if (!res.matched) { console.log("GAGAL: agent tidak mengenali keluhan"); process.exit(1) }
console.log(`Balasan  : ${res.reply}`)
console.log(`Aksi     : ${JSON.stringify(res.actions)}`)

if (!res.actions.length) { console.log("\nTidak ada aksi diusulkan."); process.exit(1) }
const a = res.actions[0]

// Terapkan usulan ke salinan, lalu ukur ulang konektivitasnya.
const applied = [...openings, {
  id: "e2e-proposed", wallId: `${a.roomId}:${a.side}`, type: "door",
  positionM: a.positionM, widthM: 0.9, heightM: 2.1,
  floorId: rooms.find((r) => r.id === a.roomId)?.floorId,
}]
const after = analyzeRoomConnectivity(rooms, applied)
const target = rooms.find((r) => r.id === a.roomId)
const stillIsolated = after.isolated.some((r) => r.id === a.roomId)

console.log(`\nSesudah — ruang terputus (${after.isolated.length}): ${after.isolated.map((r) => r.name).join(", ") || "(tidak ada)"}`)
console.log(`\n${stillIsolated ? "GAGAL" : "LULUS"}: "${target?.name}" ${stillIsolated ? "MASIH" : "kini"} terhubung ke dalam rumah`)
console.log(`ruang terputus: ${before.isolated.length} → ${after.isolated.length}`)
process.exit(stillIsolated ? 1 : 0)
