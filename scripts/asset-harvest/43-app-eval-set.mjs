/**
 * Tahap 43 — set eval berlabel untuk retrieval app_knowledge.
 *
 * Label datang gratis: LLM menulis situasi yang MEMBUTUHKAN sebuah konsep,
 * dan konsep asalnya adalah jawaban benar. Saat dijalankan (tahap 44) murni
 * deterministik — nol token, nol judge.
 *
 * Dua gaya, karena keduanya menguji hal berbeda:
 *   by_name — menyebut nama aksi/konsepnya (mudah)
 *   by_goal — MENCERITAKAN masalah/tujuan tanpa menyebut istilahnya. Ini yang
 *             menyerupai pengguna & agent sungguhan: "kamar ini terkurung,
 *             tidak ada akses" — bukan "pakai OPEN_TYPES".
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
const BATCH = 4

const SYSTEM = `Anda menulis SITUASI UJI untuk AI agent aplikasi desain rumah "Baruma".

Untuk tiap konsep, tulis 2 kalimat permintaan/keluhan yang membuat agent PERLU memakai konsep itu.

Balas STRICT JSON: {"results":[{"id":"<echo persis>","by_name":"...","by_goal":"..."}]}
- by_name: menyebut nama konsep/aksinya. Maks 14 kata.
- by_goal: MENCERITAKAN masalah atau tujuan pengguna TANPA menyebut nama konsepnya.
  Contoh konsep "ruang tipe void" → "kamar ini terkurung, saya mau ada bukaan ke lantai bawah".
  Contoh konsep "addOpening" → "saya mau bikin jalan masuk ke kamar dari ruang keluarga".
  Maks 18 kata. WAJIB terdengar seperti pemilik rumah, bukan istilah teknis.
Bahasa Indonesia percakapan. Tanpa teks di luar JSON.`

function extractJson(text) {
  if (!text) return null
  const c = text.replace(/```json\s*/gi, "").replace(/```/g, "").trim()
  const s = c.indexOf("{"), e = c.lastIndexOf("}")
  if (s < 0 || e < 0) return null
  try { return JSON.parse(c.slice(s, e + 1)) } catch { return null }
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false, max: 4 })
const concepts = (await pool.query(`select id, kind, name, knowledge from app_knowledge order by id`)).rows
await pool.end()
console.log(`[app-eval] ${concepts.length} konsep → target ${concepts.length * 2} situasi`)

const batches = []
for (let i = 0; i < concepts.length; i += BATCH) batches.push(concepts.slice(i, i + BATCH))
const queue = [...batches]
const rows = []
let tokens = 0

await Promise.all(Array.from({ length: CONCURRENCY }, async (_, wi) => {
  const token = TOKENS[wi % TOKENS.length]
  while (queue.length) {
    const batch = queue.shift()
    if (!batch) break
    const items = batch.map((c) => ({
      id: c.id, konsep: c.name, jenis: c.kind,
      ringkas: String(c.knowledge?.what ?? "").slice(0, 160),
    }))
    try {
      const { text, usage } = await faucetChat(cfg,
        [{ role: "system", content: SYSTEM },
         { role: "user", content: `Tulis situasi uji untuk ${items.length} konsep:\n${JSON.stringify(items)}` }],
        { maxTokens: 1200, temperature: 0.7, tries: 10, token, thinking: "disabled" })
      tokens += usage.total_tokens ?? 0
      for (const r of extractJson(text)?.results ?? []) {
        const src = batch.find((c) => c.id === r.id)
        if (!src) continue
        for (const kind of ["by_name", "by_goal"]) {
          if (typeof r[kind] === "string" && r[kind].trim()) {
            rows.push({ q: r[kind].trim(), expect: src.id, name: src.name, type: src.kind, kind })
          }
        }
      }
    } catch (e) {
      console.error(`[app-eval] batch gagal: ${String(e.message).slice(0, 50)}`)
    }
  }
}))

const out = path.join(repoRoot, "scripts/asset-harvest/app-eval-set.jsonl")
writeFileSync(out, rows.map((r) => JSON.stringify(r)).join("\n") + "\n")
console.log(`[app-eval] SELESAI ${rows.length} situasi (${rows.filter((r) => r.kind === "by_goal").length} by_goal) | tokens=${tokens}`)
