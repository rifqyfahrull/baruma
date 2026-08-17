/**
 * Tahap 42 — apakah app_knowledge benar-benar membuat agent lebih presisi?
 *
 * Uji A/B pada pertanyaan yang jawabannya HANYA mungkin bila agent tahu
 * mekanika aplikasi. Contoh pemicu dari pemilik produk: ruang terkurung bisa
 * diberi akses lewat VOID — gagasan yang mustahil muncul kalau agent tak tahu
 * void termasuk tipe yang dirender tanpa dinding.
 *
 * Membandingkan jawaban LLM TANPA vs DENGAN catatan mekanika, memakai
 * retrieval yang sama dengan produksi.
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
let ti = 0
const tok = () => TOKENS[ti++ % TOKENS.length]
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false, max: 4 })

const STOP = new Set(["yang","untuk","apa","itu","dan","atau","dengan","pakai","gimana","bagaimana",
  "kenapa","saya","mau","bisa","harus","di","ke","dari","pada","ini","cocok","bagus","buat","agar",
  "supaya","tidak","gak","ada","aja","nya","rumah","lebih","sudah","biar"])
const W = (q) => q.toLowerCase().replace(/[^a-z0-9\s]/g," ").split(/\s+/).filter(w=>w.length>=3&&!STOP.has(w))

async function mechanics(instruction, limit = 4) {
  const words = W(instruction)
  if (!words.length) return []
  const r = await pool.query(
    `WITH q AS (SELECT DISTINCT unnest($1::text[]) AS word),
     m AS (SELECT ak.id, q.word, (ak.name ILIKE '%'||q.word||'%') AS in_name
           FROM app_knowledge ak
           JOIN q ON ak.name ILIKE '%'||q.word||'%'
                  OR coalesce(ak.keywords,'') ~* ('\\m'||q.word||'\\M')),
     df AS (SELECT word, count(*)::float AS df FROM m GROUP BY word),
     total AS (SELECT count(*)::float AS n FROM app_knowledge),
     scored AS (SELECT m.id, sum(ln((SELECT n FROM total)/df.df)
                  * (CASE WHEN m.in_name THEN 2.0 ELSE 1.0 END)) AS score
                FROM m JOIN df ON df.word=m.word GROUP BY m.id)
     SELECT ak.name, ak.kind, ak.knowledge FROM scored s JOIN app_knowledge ak ON ak.id=s.id
     WHERE s.score >= 0.5*(SELECT max(score) FROM scored)
     ORDER BY s.score DESC LIMIT $2`, [words, limit])
  return r.rows
}

function note(rows) {
  if (!rows.length) return ""
  return rows.map((r) => {
    const k = r.knowledge
    const l = [`• ${r.name} (${r.kind})`]
    if (k.what) l.push(`  ${k.what}`)
    for (const key of ["effects", "constraints", "pitfalls"]) {
      if (Array.isArray(k[key]) && k[key].length) l.push(`  - ${key}: ${k[key].slice(0, 3).join("; ")}`)
    }
    return l.join("\n")
  }).join("\n")
}

const BASE =
  "Kamu asisten editor DENAH 2D aplikasi Baruma. Jawab ringkas dalam Bahasa Indonesia: " +
  "langkah konkret apa yang kamu ambil di aplikasi, dan kenapa. Jangan mengarang fitur."

async function ask(q, mech) {
  const sys = mech ? `${BASE}\n\nMEKANIKA APLIKASI (dari kode):\n${mech}` : BASE
  const { text } = await faucetChat(cfg,
    [{ role: "system", content: sys }, { role: "user", content: q }],
    { maxTokens: 600, temperature: 0.3, token: tok(), thinking: "disabled", tries: 8 })
  return text.trim()
}

const CASES = [
  {
    q: "Kamar tidur ini terkurung — semua tetangganya kamar tidur & kamar mandi, jadi tidak ada akses dari dalam rumah. Apa yang bisa dilakukan di aplikasi?",
    anchors: ["void", "koridor", "tanpa dinding", "open"],
  },
  {
    q: "Kalau saya tambah ruang baru di denah, apakah temboknya otomatis ada?",
    anchors: ["otomatis", "dinding", "tembok", "open_types", "terbuka", "void", "taman", "carport"],
  },
  {
    q: "Saya hapus satu ruang, apa yang terjadi dengan pintu yang menempel di dinding bersamanya?",
    anchors: ["wallid", "ikut terhapus", "tetangga", "bukaan", "tetap"],
  },
]

console.log(`PAYOFF app_knowledge — TANPA vs DENGAN mekanika\n${"=".repeat(66)}`)
for (const c of CASES) {
  const rows = await mechanics(c.q)
  const mech = note(rows)
  const without = await ask(c.q, "")
  const With = await ask(c.q, mech)
  const hit = (t) => c.anchors.filter((a) => t.toLowerCase().includes(a)).length
  console.log(`\nQ: ${c.q}`)
  console.log(`   konsep terambil: ${rows.map((r) => r.name).join(", ") || "(kosong)"}`)
  console.log(`   TANPA  (anchor ${hit(without)}): ${without.replace(/\s+/g, " ").slice(0, 230)}`)
  console.log(`   DENGAN (anchor ${hit(With)}): ${With.replace(/\s+/g, " ").slice(0, 260)}`)
}
await pool.end()
