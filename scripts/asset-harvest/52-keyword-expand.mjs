/**
 * Tahap 52 — PERLUAS (bukan timpa) design_knowledge.keywords dgn frasa awam
 * TAMBAHAN, untuk menutup celah "indirect" (bahasa awam) yang eval 25 ukur
 * masih 70% recall@3 vs 96% natural. Beda dari tahap 26:
 *   - Proses SEMUA topik (bukan hanya yg keywords kosong).
 *   - MERGE union dgn keyword lama (tak pernah membuang yg sudah terbukti).
 *   - Prompt minta frasa AWAM baru yg SPESIFIK ke topik (bukan generik) —
 *     gejala/keluhan/sinonim/istilah tukang/situasi — agar naik RECALL tanpa
 *     mengotori presisi dgn kata umum.
 *
 * Aman & terukur: union hanya MENAMBAH; jalankan per-kategori (--types=a,b),
 * lalu re-eval 25 (recall) + 29/50 (kualitas jawaban) sebelum rollout penuh.
 * Resumable via file .kw-expand-done.json (id yang sudah diperluas dilewati).
 *
 * Jalankan: FAUCET_MODEL=deepseek-v4-flash node scripts/asset-harvest/52-keyword-expand.mjs [--types=room,style] [--limit=N]
 */
import pg from "pg"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { faucetChat, loadEnvLocal, loadTokens } from "./_shared.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
loadEnvLocal(repoRoot)

const args = process.argv.slice(2)
const typesArg = (args.find((a) => a.startsWith("--types=")) || "").split("=")[1]
const types = typesArg ? typesArg.split(",").map((s) => s.trim()).filter(Boolean) : null
const limit = Number((args.find((a) => a.startsWith("--limit=")) || "").split("=")[1]) || Infinity

const cfg = {
  baseUrl: process.env.FAUCET_BASE_URL || "https://freetokenfaucet.com/v1",
  model: process.env.FAUCET_MODEL || "deepseek-v4-flash",
}
const TOKENS = loadTokens(repoRoot)
const CONCURRENCY = Number(process.env.HARVEST_LLM_CONCURRENCY || TOKENS.length)
const BATCH = 5

const DONE_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), ".kw-expand-done.json")
const done = existsSync(DONE_FILE) ? new Set(JSON.parse(readFileSync(DONE_FILE, "utf8"))) : new Set()

const SYSTEM = `Anda menambah kata pencarian BAHASA ORANG AWAM Indonesia untuk topik arsitektur.

Diberi topik + kata kunci LAMA. Tulis frasa awam BARU yang BELUM ada di daftar lama —
cara pemilik rumah yang TIDAK tahu istilah teknis benar-benar bertanya.

Balas STRICT JSON: {"results":[{"id":"<echo persis>","kw":["...","..."]}]}
- kw: 10-16 frasa BARU, huruf kecil, 1-4 kata, SPESIFIK ke topik (bukan kata umum
  seperti "rumah"/"desain" yang cocok ke mana-mana → itu merusak presisi).
- Campur: gejala/keluhan ("dak bocor","tembok lembab"), sinonim sehari-hari,
  istilah tukang/pasar, situasi/kebutuhan ("mobil kehujanan","kamar pengap"),
  pertanyaan awam ("kenapa panas","gimana biar terang").
- JANGAN mengulang kata kunci LAMA. JANGAN mengulang nama topik mentah.
- Bahasa Indonesia. HANYA JSON.`

function extractJson(text) {
  if (!text) return null
  const c = text.replace(/```json\s*/gi, "").replace(/```/g, "").trim()
  const s = c.indexOf("{"), e = c.lastIndexOf("}")
  if (s < 0 || e < 0) return null
  try { return JSON.parse(c.slice(s, e + 1)) } catch { return null }
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false, max: CONCURRENCY + 2 })

const where = types ? `where topic_type = any($1)` : ""
const params = types ? [types] : []
const all = (await pool.query(
  `select id, topic, topic_type, coalesce(keywords,'') as keywords from design_knowledge
   ${where} order by topic_type, topic`, params)).rows
const todo = all.filter((t) => !done.has(t.id)).slice(0, limit === Infinity ? undefined : limit)
console.log(`[kw-exp] ${todo.length}/${all.length} topik (types=${types ? types.join(",") : "ALL"}), conc=${CONCURRENCY}`)

const batches = []
for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH))
const queue = [...batches]
let processed = 0, tokens = 0, added = 0

await Promise.all(Array.from({ length: CONCURRENCY }, async (_, wi) => {
  const token = TOKENS[wi % TOKENS.length]
  while (queue.length) {
    const batch = queue.shift()
    if (!batch) break
    const items = batch.map((t) => ({
      id: t.id, topik: t.topic, tipe: t.topic_type,
      kw_lama: t.keywords.split(/\s*\|\s*/).filter(Boolean).slice(0, 24),
    }))
    try {
      const { text, usage } = await faucetChat(cfg,
        [{ role: "system", content: SYSTEM },
         { role: "user", content: `Tambah frasa awam untuk ${items.length} topik:\n${JSON.stringify(items)}` }],
        { maxTokens: 1600, temperature: 0.6, tries: 10, token, thinking: "disabled" })
      tokens += usage.total_tokens ?? 0
      for (const r of extractJson(text)?.results ?? []) {
        const row = batch.find((t) => t.id === r.id)
        if (!row || !Array.isArray(r.kw)) continue
        const old = new Set(row.keywords.split(/\s*\|\s*/).map((x) => x.toLowerCase().trim()).filter(Boolean))
        const fresh = r.kw.map((x) => String(x).toLowerCase().trim()).filter((x) => x && !old.has(x))
        if (!fresh.length) { done.add(r.id); continue }
        const merged = [...old, ...new Set(fresh)].join(" | ")
        await pool.query(`update design_knowledge set keywords = $2, updated_at = now() where id = $1`, [r.id, merged])
        added += fresh.length
        done.add(r.id)
      }
      processed += batch.length
      if (processed % 25 < BATCH) {
        writeFileSync(DONE_FILE, JSON.stringify([...done]))
        console.log(`[kw-exp] ${processed}/${todo.length} | +${added} kw | tokens=${tokens}`)
      }
    } catch (e) {
      console.error(`[kw-exp] batch gagal: ${String(e.message).slice(0, 70)}`)
    }
  }
}))

writeFileSync(DONE_FILE, JSON.stringify([...done]))
await pool.end()
console.log(`[kw-exp] SELESAI ${processed} topik | +${added} keyword awam | tokens=${tokens}`)
