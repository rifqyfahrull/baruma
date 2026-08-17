/**
 * Tahap 24 — bangun SET EVAL RETRIEVAL berlabel-otomatis.
 *
 * Trik labelnya: untuk tiap topik design_knowledge, LLM menulis pertanyaan
 * ala pemilik rumah awam — dan topik ASALNYA adalah jawaban benar. Jadi
 * ratusan kasus uji berlabel tanpa anotasi manual, dan saat DIJALANKAN nanti
 * (tahap 25) murni deterministik: nol token, nol LLM-judge yang berisik.
 *
 * Tiap topik menghasilkan 2 pertanyaan:
 *   natural  — cara orang bertanya sehari-hari (boleh menyebut istilahnya)
 *   indirect — MENCERITAKAN situasi/gejala TANPA menyebut istilah topik.
 *              Ini yang benar-benar menguji: pemilik rumah awam tak tahu
 *              istilah "waterproofing", dia bilang "atap cor saya rembes".
 *
 * Output: scripts/asset-harvest/eval-set.jsonl (di-commit, jadi aset durable).
 */
import pg from "pg"
import { writeFileSync } from "node:fs"
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
const OUT = path.join(repoRoot, "scripts", "asset-harvest", "eval-set.jsonl")
const BATCH = 5

const SYSTEM = `Anda menulis PERTANYAAN UJI untuk asisten desain rumah Indonesia.
Untuk tiap topik, tulis 2 pertanyaan yang realistis diajukan PEMILIK RUMAH AWAM (bukan arsitek).

Balas STRICT JSON: {"results":[{"id":"<echo persis>","natural":"...","indirect":"..."}]}
- natural: pertanyaan sehari-hari; BOLEH menyebut istilah topiknya. Maksimal 15 kata.
- indirect: MENCERITAKAN situasi/kebutuhan/gejala TANPA menyebut istilah kunci topik.
  Contoh topik "Waterproofing dak beton" → "atap cor rumah saya rembes kalau hujan deras, harus diapain?"
  Contoh topik "Ventilasi silang" → "gimana caranya biar angin bisa mengalir di dalam rumah?"
  Maksimal 20 kata. Ini WAJIB terdengar seperti orang awam, bukan istilah teknis.
Bahasa Indonesia percakapan. Jangan menambah penjelasan apa pun di luar JSON.`

function extractJson(text) {
  if (!text) return null
  const c = text.replace(/```json\s*/gi, "").replace(/```/g, "").trim()
  const s = c.indexOf("{"), e = c.lastIndexOf("}")
  if (s < 0 || e < 0) return null
  try { return JSON.parse(c.slice(s, e + 1)) } catch { return null }
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false, max: 4 })
const topics = (await pool.query(
  `select id, topic, topic_type from design_knowledge order by topic_type, topic`,
)).rows
await pool.end()
console.log(`[eval-set] ${topics.length} topik → target ${topics.length * 2} pertanyaan, conc=${CONCURRENCY}`)

const batches = []
for (let i = 0; i < topics.length; i += BATCH) batches.push(topics.slice(i, i + BATCH))
const queue = [...batches]
const rows = []
let tokens = 0, done = 0

await Promise.all(Array.from({ length: CONCURRENCY }, async (_, wi) => {
  const token = TOKENS[wi % TOKENS.length]
  while (queue.length) {
    const batch = queue.shift()
    if (!batch) break
    const items = batch.map((t) => ({ id: t.id, topik: t.topic, tipe: t.topic_type }))
    try {
      const { text, usage } = await faucetChat(cfg,
        [{ role: "system", content: SYSTEM },
         { role: "user", content: `Tulis pertanyaan uji untuk ${items.length} topik:\n${JSON.stringify(items)}` }],
        { maxTokens: 1600, temperature: 0.7, tries: 10, token, thinking: "disabled" })
      tokens += usage.total_tokens ?? 0
      for (const r of extractJson(text)?.results ?? []) {
        const src = batch.find((t) => t.id === r.id)
        if (!src) continue
        if (typeof r.natural === "string" && r.natural.trim()) {
          rows.push({ q: r.natural.trim(), expect: src.id, topic: src.topic, type: src.topic_type, kind: "natural" })
        }
        if (typeof r.indirect === "string" && r.indirect.trim()) {
          rows.push({ q: r.indirect.trim(), expect: src.id, topic: src.topic, type: src.topic_type, kind: "indirect" })
        }
      }
      done += batch.length
      if (done % 25 < BATCH) console.log(`[eval-set] ${done}/${topics.length} topik | ${rows.length} pertanyaan | tokens=${tokens}`)
    } catch (e) {
      console.error(`[eval-set] batch gagal: ${String(e.message).slice(0, 60)}`)
    }
  }
}))

writeFileSync(OUT, rows.map((r) => JSON.stringify(r)).join("\n") + "\n")
console.log(`[eval-set] SELESAI ${rows.length} pertanyaan (${rows.filter(r=>r.kind==="indirect").length} indirect) | tokens=${tokens}`)
console.log(`[eval-set] → ${OUT}`)
