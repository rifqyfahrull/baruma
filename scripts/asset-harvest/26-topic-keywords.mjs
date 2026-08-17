/**
 * Tahap 26 — isi design_knowledge.keywords dgn BAHASA AWAM tiap topik.
 *
 * Eval tahap 25 mengukur: pertanyaan yang menyebut istilah topik → recall@3
 * 91%, tapi pertanyaan ala orang awam (gejala/situasi) → 16%. Pemilik rumah
 * bilang "atap cor rembes", bukan "waterproofing dak beton".
 *
 * Di sini LLM menulis frasa yang BENAR-BENAR diucapkan orang awam untuk tiap
 * topik: gejala, keluhan, sinonim sehari-hari, istilah tukang. Disimpan sbg
 * teks dan ikut dicocokkan retrieval — pola yang sama persis dgn
 * asset_knowledge.keywords yang sudah terbukti untuk pencarian aset.
 *
 * Resumable (lewati yg keywords-nya sudah terisi).
 */
import pg from "pg"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { faucetChat, loadEnvLocal, loadTokens } from "./_shared.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
loadEnvLocal(repoRoot)

// --force: regenerate even topics that already have keywords (overwrite in place).
// --types=a,b: restrict to those topic_type values. Used to RESTORE categories
// whose keywords were degraded by an experiment, back to this proven prompt.
const _args = process.argv.slice(2)
const FORCE = _args.includes("--force")
const _typesArg = (_args.find((a) => a.startsWith("--types=")) || "").split("=")[1]
const TYPES = _typesArg ? _typesArg.split(",").map((s) => s.trim()).filter(Boolean) : null

const cfg = {
  baseUrl: process.env.FAUCET_BASE_URL || "https://freetokenfaucet.com/v1",
  model: process.env.FAUCET_MODEL || "deepseek-v4-flash",
}
const TOKENS = loadTokens(repoRoot)
const CONCURRENCY = Number(process.env.HARVEST_LLM_CONCURRENCY || TOKENS.length)
const BATCH = 5

const SYSTEM = `Anda memetakan ISTILAH TEKNIS arsitektur ke BAHASA ORANG AWAM Indonesia.

Untuk tiap topik, tulis kata/frasa pencarian yang benar-benar diucapkan pemilik rumah awam
yang TIDAK tahu istilah teknisnya — termasuk GEJALA dan KELUHAN.

Balas STRICT JSON: {"results":[{"id":"<echo persis>","kw":["...","..."]}]}
- kw: 10-16 item, huruf kecil, ringkas (1-4 kata per item).
- WAJIB memuat campuran:
  * gejala/keluhan awam  → topik "Waterproofing dak beton": "atap cor rembes","dak bocor","plafon basah"
  * sinonim sehari-hari  → topik "Ventilasi silang": "angin masuk rumah","udara pengap","sirkulasi udara"
  * istilah tukang/pasar → topik "Bata ringan (hebel)": "hebel","bata putih","batu ringan"
  * kata benda terkait   → topik "Carport terbuka vs tertutup": "mobil kehujanan","tempat parkir mobil"
- JANGAN hanya mengulang nama topiknya. Fokus pada cara orang AWAM bicara.
- Bahasa Indonesia. Jangan menambah teks apa pun di luar JSON.`

function extractJson(text) {
  if (!text) return null
  const c = text.replace(/```json\s*/gi, "").replace(/```/g, "").trim()
  const s = c.indexOf("{"), e = c.lastIndexOf("}")
  if (s < 0 || e < 0) return null
  try { return JSON.parse(c.slice(s, e + 1)) } catch { return null }
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false, max: CONCURRENCY + 2 })
await pool.query(readFileSync(path.join(repoRoot, "db/migrations/0027_design_knowledge_keywords.sql"), "utf8"))

const _emptyCond = FORCE ? "true" : "(keywords is null or keywords = '')"
const _typeCond = TYPES ? "topic_type = any($1)" : "true"
const todo = (await pool.query(
  `select id, topic, topic_type from design_knowledge
   where ${_emptyCond} and ${_typeCond} order by topic_type, topic`,
  TYPES ? [TYPES] : [],
)).rows
console.log(`[kw] ${todo.length} topik${FORCE ? " (FORCE overwrite)" : ""}${TYPES ? " types=" + TYPES.join(",") : ""}, conc=${CONCURRENCY}, batch=${BATCH}`)

const batches = []
for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH))
const queue = [...batches]
let done = 0, tokens = 0

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
        { maxTokens: 1500, temperature: 0.5, tries: 10, token, thinking: "disabled" })
      tokens += usage.total_tokens ?? 0
      for (const r of extractJson(text)?.results ?? []) {
        if (!batch.some((t) => t.id === r.id)) continue
        const kw = Array.isArray(r.kw)
          ? [...new Set(r.kw.map((x) => String(x).toLowerCase().trim()).filter(Boolean))].slice(0, 18).join(" | ")
          : ""
        if (!kw) continue
        await pool.query(`update design_knowledge set keywords = $2, updated_at = now() where id = $1`, [r.id, kw])
        done++
      }
      if (done % 25 < BATCH) console.log(`[kw] ${done}/${todo.length} | tokens=${tokens}`)
    } catch (e) {
      console.error(`[kw] batch gagal: ${String(e.message).slice(0, 60)}`)
    }
  }
}))

await pool.end()
console.log(`[kw] SELESAI ${done}/${todo.length} | tokens=${tokens}`)
