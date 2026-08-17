/**
 * Tahap 45 — keywords bersudut NIAT/MASALAH untuk app_knowledge.
 *
 * Eval tahap 44: menyebut nama konsep → recall 92%, menceritakan masalah →
 * 44%. Celah 48 poin. Keywords ronde-1 (tahap 41) lahir dari sudut "konsep
 * ini apa"; yang hilang adalah "masalah apa yang konsep ini selesaikan" —
 * dan itulah yang sebenarnya diketik pengguna & dipikirkan agent.
 *
 * METODOLOGI: prompt ini TIDAK pernah melihat app-eval-set.jsonl. Memakai
 * soal ujian sebagai bahan latihan hanya membuat angkanya bohong.
 *
 * Idempoten: keywords lama + baru digabung & dideduplikasi.
 */
import pg from "pg"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { faucetChat, loadEnvLocal, loadTokens } from "./_shared.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
loadEnvLocal(repoRoot)
const cfg = {
  baseUrl: process.env.FAUCET_BASE_URL || "https://freetokenfaucet.com/v1",
  model: process.env.FAUCET_MODEL || "deepseek-v4-flash",
}
const TOKENS = loadTokens(repoRoot)
const CONCURRENCY = Number(process.env.HARVEST_LLM_CONCURRENCY || TOKENS.length)
const BATCH = 4

const SYSTEM = `Anda memetakan konsep teknis aplikasi desain rumah ke BAHASA NIAT penggunanya.

Untuk tiap konsep, tulis frasa yang diketik/dipikirkan orang saat mereka MEMBUTUHKAN konsep itu —
padahal mereka tidak tahu namanya.

Balas STRICT JSON: {"results":[{"id":"<echo persis>","kw":["...","..."]}]}
- kw: 10-14 item, huruf kecil, 2-5 kata per item.
- WAJIB memuat campuran sudut:
  * masalah/keluhan  → konsep "void": "kamar terkurung","tidak ada akses","biar terhubung"
  * tujuan pengguna  → konsep "addOpening": "bikin jalan masuk","biar bisa lewat"
  * kata kerja awam  → konsep "deleteRoom": "buang ruangan","hapus kamar","batalkan ruang"
  * gejala/akibat    → konsep "dinding otomatis": "temboknya muncul sendiri","kok ada dinding"
- JANGAN sekadar mengulang nama konsep atau istilah teknisnya.
- Bahasa Indonesia percakapan. Tanpa teks di luar JSON.`

function extractJson(text) {
  if (!text) return null
  const c = text.replace(/```json\s*/gi, "").replace(/```/g, "").trim()
  const s = c.indexOf("{"), e = c.lastIndexOf("}")
  if (s < 0 || e < 0) return null
  try { return JSON.parse(c.slice(s, e + 1)) } catch { return null }
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false, max: CONCURRENCY + 2 })
const rows = (await pool.query(
  `select id, kind, name, knowledge, coalesce(keywords,'') as keywords from app_knowledge order by id`,
)).rows
console.log(`[app-kw2] ${rows.length} konsep, conc=${CONCURRENCY}`)

const batches = []
for (let i = 0; i < rows.length; i += BATCH) batches.push(rows.slice(i, i + BATCH))
const queue = [...batches]
let done = 0, added = 0, tokens = 0

await Promise.all(Array.from({ length: CONCURRENCY }, async (_, wi) => {
  const token = TOKENS[wi % TOKENS.length]
  while (queue.length) {
    const batch = queue.shift()
    if (!batch) break
    const items = batch.map((c) => ({
      id: c.id, konsep: c.name, jenis: c.kind,
      ringkas: String(c.knowledge?.what ?? "").slice(0, 180),
    }))
    try {
      const { text, usage } = await faucetChat(cfg,
        [{ role: "system", content: SYSTEM },
         { role: "user", content: `Petakan ${items.length} konsep:\n${JSON.stringify(items)}` }],
        { maxTokens: 1300, temperature: 0.6, tries: 10, token, thinking: "disabled" })
      tokens += usage.total_tokens ?? 0
      for (const r of extractJson(text)?.results ?? []) {
        const src = batch.find((c) => c.id === r.id)
        if (!src || !Array.isArray(r.kw)) continue
        const old = src.keywords.split("|").map((x) => x.trim()).filter(Boolean)
        const fresh = r.kw.map((x) => String(x).toLowerCase().trim()).filter(Boolean)
        const merged = [...new Set([...old, ...fresh])].slice(0, 30)
        if (merged.length <= old.length) continue
        added += merged.length - old.length
        await pool.query(`update app_knowledge set keywords=$2, updated_at=now() where id=$1`,
          [r.id, merged.join(" | ")])
        done++
      }
      if (done % 20 < BATCH) console.log(`[app-kw2] ${done}/${rows.length} | +${added} frasa`)
    } catch (e) {
      console.error(`[app-kw2] batch gagal: ${String(e.message).slice(0, 50)}`)
    }
  }
}))
await pool.end()
console.log(`[app-kw2] SELESAI ${done}/${rows.length} | +${added} frasa | tokens=${tokens}`)
