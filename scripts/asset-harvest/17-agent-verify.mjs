/**
 * Verifikasi END-TO-END: agent "pintar & akurat" DAN benar-benar MENGONSUMSI
 * design_knowledge ("mini thinking"). Untuk tiap pertanyaan awam:
 *   1) retrieve design_knowledge (SQL sama persis dgn src/lib/server/repo/design-knowledge.ts)
 *   2) format jadi catatan kompak (sama dgn formatDesignKnowledgeNote)
 *   3) panggil LLM faucet NYATA dgn system prompt brief-assistant (+catatan)
 *   4) assert jawaban ter-grounding pd fakta kurasi (bukan karangan)
 * Plus 1 kontrol A/B (tanpa catatan) utk membuktikan nilai grounding.
 */
import path from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"
import { loadEnvLocal, loadTokens, faucetChat } from "./_shared.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
loadEnvLocal(repoRoot)

const cfg = {
  baseUrl: process.env.FAUCET_BASE_URL || "https://freetokenfaucet.com/v1",
  model: process.env.FAUCET_MODEL || "deepseek-v4-flash",
}
const tokens = loadTokens(repoRoot)
let tokIdx = 0
const nextToken = () => tokens[tokIdx++ % tokens.length]

// STOP set — cermin dari design-knowledge.ts (cukup utk pertanyaan uji).
const STOP = new Set([
  "yang","untuk","apa","itu","dan","atau","dengan","pakai","pake","gimana","bagaimana",
  "kenapa","mengapa","kalau","jika","saya","aku","mau","ingin","bisa","boleh","harus",
  "adalah","di","ke","dari","pada","ini","the","a","an","is","of","for","how","why",
  "what","cocok","bagus","baik","buat","sih","dong","ya","nih",
])
function significantWords(q) {
  return q.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP.has(w))
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false, max: 2 })

async function retrieve(question, limit = 3) {
  const words = significantWords(question)
  if (!words.length) return []
  const patterns = words.map((w) => `%${w}%`)
  const res = await pool.query(
    `SELECT id, topic_type, topic, knowledge,
       (SELECT count(*) FROM unnest($1::text[]) w WHERE topic ILIKE '%'||w||'%') AS score
     FROM design_knowledge WHERE topic ILIKE ANY($2)
     ORDER BY score DESC, length(topic) ASC LIMIT $3`,
    [words, patterns, limit],
  )
  return res.rows.filter((r) => Number(r.score) > 0)
}

function formatNote(rows) {
  if (!rows.length) return ""
  return rows.map((r) => {
    const lines = [`• ${r.topic} (${r.topic_type})`]
    for (const [k, v] of Object.entries(r.knowledge)) {
      if (Array.isArray(v) && v.length) lines.push(`  - ${k}: ${v.slice(0, 5).join("; ")}`)
      else if (typeof v === "string" && v.trim()) lines.push(`  - ${k}: ${v}`)
    }
    return lines.join("\n")
  }).join("\n")
}

// Cermin ringkas system prompt brief-assistant.ts (bagian relevan).
function systemPrompt(note) {
  return (
    "Kamu asisten arsitek di aplikasi Baruma. Jawab pertanyaan pemilik rumah dalam " +
    "Bahasa Indonesia yang ringkas, praktis, membantu. Jangan mengarang angka biaya " +
    "pasti atau klaim teknis tanpa dasar. Jawab maksimal beberapa paragraf pendek." +
    (note
      ? "\n\nPENGETAHUAN DESAIN (kurasi, pakai bila relevan dgn pertanyaan; jangan mengarang di luar ini):\n" + note
      : "")
  )
}

async function ask(question, note) {
  const messages = [
    { role: "system", content: systemPrompt(note) },
    { role: "user", content: question },
  ]
  const { text } = await faucetChat(cfg, messages, { maxTokens: 700, temperature: 0.4, token: nextToken(), tries: 8 })
  return text.trim()
}

// Kata-kunci penanda grounding: jika muncul di jawaban → agent memakai fakta
// kurasi (istilah/angka spesifik yg tak akan muncul dari jawaban generik).
const CASES = [
  {
    q: "kenapa sih sebaiknya pakai kitchen island di dapur rumah saya?",
    anchors: ["segitiga kerja", "peninsula", "90", "120", "penyimpanan", "sosial", "sempit"],
  },
  {
    q: "kapan sebaiknya saya TIDAK memakai kitchen island?",
    anchors: ["sempit", "2,5", "ventilasi", "lembap", "anggaran", "lalu lintas"],
  },
]

console.log(`[verify] model=${cfg.model} tokens=${tokens.length}\n`)
let pass = 0
for (const c of CASES) {
  const rows = await retrieve(c.q)
  const note = formatNote(rows)
  const topics = rows.map((r) => r.topic).join(", ") || "(none)"
  console.log("Q:", c.q)
  console.log("   retrieved:", topics)
  if (!note) { console.log("   ⚠ tidak ada knowledge ter-retrieve — SKIP\n"); continue }

  const withNote = await ask(c.q, note)
  const hits = c.anchors.filter((a) => withNote.toLowerCase().includes(a.toLowerCase()))
  const grounded = hits.length >= 2
  if (grounded) pass++
  console.log(`   grounding: ${grounded ? "PASS" : "WEAK"} (anchor hits: ${hits.join(", ") || "none"})`)
  console.log("   jawaban:", withNote.replace(/\s+/g, " ").slice(0, 320), "…\n")
}

// A/B kontrol: buktikan grounding mengubah jawaban (with vs without note).
const abQ = CASES[0].q
const rows = await retrieve(abQ)
const withN = await ask(abQ, formatNote(rows))
const without = await ask(abQ, "")
console.log("── A/B kontrol (kitchen island) ──")
console.log("TANPA knowledge:", without.replace(/\s+/g, " ").slice(0, 220), "…")
console.log("DENGAN knowledge:", withN.replace(/\s+/g, " ").slice(0, 220), "…")

console.log(`\n[verify] grounded ${pass}/${CASES.length} kasus`)
await pool.end()
process.exit(pass === CASES.length ? 0 : 1)
