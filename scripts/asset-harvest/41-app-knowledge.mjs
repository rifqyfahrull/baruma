/**
 * Tahap 41 — bangun app_knowledge: pemahaman agent tentang MEKANIKA Baruma.
 *
 * Masukannya fakta hasil ekstraksi kode (tahap 40), bukan ingatan model.
 * Tugas LLM hanya MENJELASKAN bukti yang diberikan — termasuk efek samping &
 * jebakan yang tak terbaca dari nama aksinya. Contoh yang jadi pemicu:
 * "addRoom" tidak menyebut bahwa ruang baru otomatis berdinding, dan bahwa
 * tipe OPEN_TYPES justru tidak. Agent yang tak tahu itu tak akan pernah
 * sampai pada langkah presisi seperti "akses ruang terkurung bisa lewat void".
 *
 * PAGAR: dilarang menyebut aksi/parameter yang tidak ada di bukti. Agent yang
 * percaya diri menjalankan aksi fiktif lebih berbahaya daripada agent yang
 * mengaku tidak tahu.
 */
import pg from "pg"
import { readFileSync } from "node:fs"
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
const LIMIT = Number((process.argv.find((a) => a.startsWith("--limit=")) || "").split("=")[1]) || Infinity

const SYSTEM = () => `Anda mendokumentasikan MEKANIKA aplikasi desain rumah "Baruma" untuk dibaca AI agent-nya sendiri.

Anda diberi BUKTI berupa cuplikan kode sumber. Jelaskan HANYA apa yang didukung bukti itu.
DILARANG KERAS mengarang aksi, parameter, atau perilaku yang tidak ada di bukti — agent akan
benar-benar menjalankannya dan merusak desain pengguna. Bila sesuatu tidak terbaca dari bukti,
jangan disebut.

Balas STRICT JSON:
{"what":"1-2 kalimat: ini apa & untuk apa",
 "effects":["akibat/efek samping yang TIDAK terbaca dari namanya, 1-4 poin"],
 "constraints":["syarat/batasan/nilai sah, 1-4 poin"],
 "when_to_use":["kapan agent sebaiknya memakai ini, 1-3 poin"],
 "pitfalls":["kesalahan yang mudah terjadi, 0-3 poin"],
 "related":["nama aksi/konsep lain yang terkait, 0-4 item"],
 "kw":["8-12 frasa pencarian: campuran istilah teknis & bahasa awam pengguna"]}

"related" HANYA boleh diisi nama dari daftar sah ini (selain itu dikosongkan):
${VOCAB_LIST}

Bahasa Indonesia, padat, gaya catatan teknis untuk agent (bukan prosa pemasaran).`

function extractJson(text) {
  if (!text) return null
  const c = text.replace(/```json\s*/gi, "").replace(/```/g, "").trim()
  const s = c.indexOf("{"), e = c.lastIndexOf("}")
  if (s < 0 || e < 0) return null
  try { return JSON.parse(c.slice(s, e + 1)) } catch { return null }
}

const facts = JSON.parse(readFileSync(path.join(repoRoot, "scripts/asset-harvest/out-app-facts.json"), "utf8"))
/** Kosakata sah — `related` disaring ke sini. Kalibrasi pertama menghasilkan
 *  "removeOpening" (aslinya deleteOpening) dan "clearDesign" (tidak ada);
 *  agent yang yakin aksi fiktif itu ada akan mencoba menjalankannya. */
const VOCAB = new Set(facts.map((f) => f.name))
const VOCAB_LIST = [...VOCAB].join(", ")
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false, max: CONCURRENCY + 2 })
await pool.query(readFileSync(path.join(repoRoot, "db/migrations/0028_app_knowledge.sql"), "utf8"))

const have = new Set((await pool.query(`select id from app_knowledge`)).rows.map((r) => r.id))
const todo = facts.filter((f) => !have.has(f.id)).slice(0, Number.isFinite(LIMIT) ? LIMIT : undefined)
console.log(`[app-kb] ${todo.length} konsep (sudah ${have.size}/${facts.length}), conc=${CONCURRENCY}`)

const queue = [...todo]
let done = 0, tokens = 0, invented = 0
await Promise.all(Array.from({ length: CONCURRENCY }, async (_, wi) => {
  const token = TOKENS[wi % TOKENS.length]
  while (queue.length) {
    const f = queue.shift()
    if (!f) break
    try {
      const { text, usage } = await faucetChat(cfg,
        [{ role: "system", content: SYSTEM() },
         { role: "user", content: `KONSEP: ${f.name}\nJENIS: ${f.kind}\n\nBUKTI KODE:\n${f.evidence}` }],
        { maxTokens: 1400, temperature: 0.3, tries: 10, token, thinking: "disabled" })
      tokens += usage.total_tokens ?? 0
      const j = extractJson(text)
      if (!j || !j.what) { console.error(`[app-kb] JSON gagal: ${f.id}`); continue }
      // Buang nama yang tidak ada di kosakata nyata, apa pun kata modelnya.
      if (Array.isArray(j.related)) {
        const kept = j.related.filter((r) => VOCAB.has(String(r).trim()))
        if (kept.length !== j.related.length) invented += j.related.length - kept.length
        j.related = kept
      }
      const kw = Array.isArray(j.kw) ? [...new Set(j.kw.map((x) => String(x).toLowerCase().trim()))].join(" | ") : ""
      delete j.kw
      await pool.query(
        `insert into app_knowledge (id, kind, name, knowledge, evidence, keywords, updated_at)
         values ($1,$2,$3,$4,$5,$6,now())
         on conflict (id) do update set knowledge=excluded.knowledge, evidence=excluded.evidence,
           keywords=excluded.keywords, updated_at=now()`,
        [f.id, f.kind, f.name, JSON.stringify(j), f.evidence.slice(0, 4000), kw],
      )
      done++
      if (done % 15 === 0) console.log(`[app-kb] ${done}/${todo.length} | tokens=${tokens}`)
    } catch (e) {
      console.error(`[app-kb] gagal ${f.id}: ${String(e.message).slice(0, 50)}`)
    }
  }
}))
await pool.end()
console.log(`[app-kb] SELESAI ${done}/${todo.length} | tokens=${tokens} | nama fiktif dibuang: ${invented}`)
