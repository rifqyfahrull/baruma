/**
 * Tahap 28 — keywords ronde-2: sudut KEBUTUHAN/FUNGSI.
 *
 * Ronde-1 (tahap 26) memetakan GEJALA & KELUHAN ("dak bocor","rumah pengap")
 * dan menaikkan recall indirect 16%→59%. Analisis kegagalan sisa (tahap 27,
 * recall efektif 82%) menunjukkan pola yang belum tertutup: orang menyebut
 * KEBUTUHAN/FUNGSI saat belum tahu nama solusinya —
 *   "tempat dandan"          → Meja rias
 *   "dua anak tidur sekamar" → Ranjang tingkat
 *   "lemari simpan piring"   → Buffet / sideboard
 *
 * METODOLOGI: prompt ini SENGAJA tidak pernah melihat pertanyaan eval —
 * frasa digali dari topiknya sendiri. Kalau eval dipakai sbg bahan, kita
 * hanya melatih di atas soal ujian dan angkanya jadi bohong.
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
const BATCH = 5

const SYSTEM = `Anda memetakan topik arsitektur ke BAHASA KEBUTUHAN pemilik rumah awam Indonesia.

Orang sering tidak tahu NAMA solusinya — mereka menyebut KEBUTUHAN, FUNGSI, atau SITUASI.
Untuk tiap topik, tulis frasa pencarian dari sudut itu.

Balas STRICT JSON: {"results":[{"id":"<echo persis>","kw":["...","..."]}]}
- kw: 10-14 item, huruf kecil, 1-5 kata per item.
- WAJIB campuran sudut berikut:
  * fungsi/kegunaan   → "Meja rias": "tempat dandan","merias wajah","cermin kamar"
  * situasi pemicu    → "Ranjang tingkat": "dua anak satu kamar","kamar anak sempit"
  * benda yg disimpan → "Buffet / sideboard": "simpan piring","lemari ruang makan"
  * keinginan/hasil   → "Rak buku tinggi": "banyak buku","buku berantakan"
  * siapa yg butuh    → "Railing balkon": "anak main di balkon","takut jatuh"
- JANGAN mengulang nama topik. JANGAN memakai istilah teknis.
- Bahasa Indonesia percakapan. Tanpa teks di luar JSON.`

function extractJson(text) {
  if (!text) return null
  const c = text.replace(/```json\s*/gi, "").replace(/```/g, "").trim()
  const s = c.indexOf("{"), e = c.lastIndexOf("}")
  if (s < 0 || e < 0) return null
  try { return JSON.parse(c.slice(s, e + 1)) } catch { return null }
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false, max: CONCURRENCY + 2 })
const todo = (await pool.query(
  `select id, topic, topic_type, coalesce(keywords,'') as keywords from design_knowledge order by topic_type, topic`,
)).rows
console.log(`[kw2] ${todo.length} topik, conc=${CONCURRENCY}`)

const batches = []
for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH))
const queue = [...batches]
let done = 0, tokens = 0, added = 0

await Promise.all(Array.from({ length: CONCURRENCY }, async (_, wi) => {
  const token = TOKENS[wi % TOKENS.length]
  while (queue.length) {
    const batch = queue.shift()
    if (!batch) break
    const items = batch.map((t) => ({ id: t.id, topik: t.topic, tipe: t.topic_type }))
    try {
      const { text, usage } = await faucetChat(cfg,
        [{ role: "system", content: SYSTEM },
         { role: "user", content: `Petakan ${items.length} topik:\n${JSON.stringify(items)}` }],
        { maxTokens: 1500, temperature: 0.6, tries: 10, token, thinking: "disabled" })
      tokens += usage.total_tokens ?? 0
      for (const r of extractJson(text)?.results ?? []) {
        const src = batch.find((t) => t.id === r.id)
        if (!src || !Array.isArray(r.kw)) continue
        const old = src.keywords.split("|").map((x) => x.trim()).filter(Boolean)
        const fresh = r.kw.map((x) => String(x).toLowerCase().trim()).filter(Boolean)
        const merged = [...new Set([...old, ...fresh])].slice(0, 34)
        if (merged.length <= old.length) continue
        added += merged.length - old.length
        await pool.query(`update design_knowledge set keywords = $2, updated_at = now() where id = $1`,
          [r.id, merged.join(" | ")])
        done++
      }
      if (done % 25 < BATCH) console.log(`[kw2] ${done}/${todo.length} | +${added} frasa | tokens=${tokens}`)
    } catch (e) {
      console.error(`[kw2] batch gagal: ${String(e.message).slice(0, 60)}`)
    }
  }
}))

await pool.end()
console.log(`[kw2] SELESAI ${done}/${todo.length} topik | +${added} frasa baru | tokens=${tokens}`)
