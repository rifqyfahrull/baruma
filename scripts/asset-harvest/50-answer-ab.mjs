/**
 * Tahap 50 — bukti END-TO-END: apakah upgrade terra benar-benar memperbaiki
 * JAWABAN agent (bukan sekadar mengganti data)?
 *
 * Desain eksperimen:
 *  - Pertanyaan nyata dari pain-point riset pasar (budget/urutan/kontraktor)
 *    + keluhan sehari-hari (problem) + utilitas (system).
 *  - Jawaban A = grounding LAMA (knowledge dari backup pra-upgrade; utk topik
 *    process yang baru, A = tanpa grounding — persis keadaan agent sebelum).
 *  - Jawaban B = grounding BARU (DB live hasil terra).
 *  - KEDUA jawaban dibuat model yang SAMA (deepseek) — yang diukur murni
 *    efek pengetahuan, bukan beda model.
 *  - Juri lintas-model: deepseek + mimo-v2.5, BUTA (label "Jawaban 1/2"),
 *    tiap juri menilai dua kali dgn posisi ditukar → 4 suara per pertanyaan.
 *    (mimo dipakai krn juri satu-model terbukti berisik; terra tak boleh jadi
 *    juri krn ia pengarang konten B.)
 */
import pg from "pg"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { faucetChat, loadEnvLocal, loadTokens } from "./_shared.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
loadEnvLocal(repoRoot)
const TOKENS = loadTokens(repoRoot)
const DEEPSEEK = { baseUrl: "https://freetokenfaucet.com/v1", model: "deepseek-v4-flash" }
const MIMO = { baseUrl: "https://freetokenfaucet.com/v1", model: "mimo-v2.5" }
const BACKUP = JSON.parse(readFileSync(path.join(repoRoot, "scripts/asset-harvest/out-design-knowledge-backup.json"), "utf8"))

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false, max: 4 })
let ti = 0
const tok = () => TOKENS[ti++ % TOKENS.length]

/* Retrieval — cermin produksi (design-knowledge.ts). */
const STOP = new Set(["yang","untuk","apa","itu","dan","atau","dengan","pakai","pake","gimana",
  "bagaimana","kenapa","mengapa","kalau","jika","saya","aku","mau","ingin","bisa","boleh","harus",
  "adalah","di","ke","dari","pada","ini","cocok","bagus","baik","buat","mana","dimana","sebaiknya",
  "perlu","solusinya","terus","seperti","banget","gak","nggak","tidak","juga","rumah","agar","lebih",
  "sudah","ada","saja","aja","nya","tolong"])
const W = (q) => q.toLowerCase().replace(/[^a-z0-9\s]/g," ").split(/\s+/).filter(w=>w.length>=3&&!STOP.has(w))

async function retrieve(q, limit = 3) {
  const words = W(q); if (!words.length) return []
  const r = await pool.query(
    `WITH q AS (SELECT DISTINCT unnest($1::text[]) AS word),
     m AS (SELECT dk.id, q.word, (dk.topic ~* ('\\m'||q.word||'\\M')) AS in_topic
           FROM design_knowledge dk
           JOIN q ON dk.topic ~* ('\\m'||q.word||'\\M') OR coalesce(dk.keywords,'') ~* ('\\m'||q.word||'\\M')),
     df AS (SELECT word, count(*)::float df FROM m GROUP BY word),
     total AS (SELECT count(*)::float n FROM design_knowledge),
     scored AS (SELECT m.id, sum(ln((SELECT n FROM total)/df.df)*(CASE WHEN m.in_topic THEN 1.5 ELSE 1.0 END)) score,
       count(*) hits, max(CASE WHEN m.in_topic THEN length(m.word)::float/greatest(length(dk0.topic),1) ELSE 0 END) cover
       FROM m JOIN df ON df.word=m.word JOIN design_knowledge dk0 ON dk0.id=m.id GROUP BY m.id)
     SELECT dk.id, dk.topic, dk.topic_type, dk.knowledge FROM scored s JOIN design_knowledge dk ON dk.id=s.id
     WHERE (s.hits>=2 OR s.cover>=0.6) AND s.score>=0.7*(SELECT max(score) FROM scored)
     ORDER BY s.score DESC, length(dk.topic) ASC LIMIT $2`, [words, limit])
  return r.rows
}

function note(rows) {
  if (!rows.length) return ""
  return rows.map((r) => {
    const lines = [`• ${r.topic} (${r.topic_type})`]
    for (const [k, v] of Object.entries(r.knowledge ?? {})) {
      if (Array.isArray(v) && v.length) lines.push(`  - ${k}: ${v.slice(0, 5).join("; ")}`)
      else if (typeof v === "string" && v.trim()) lines.push(`  - ${k}: ${v}`)
    }
    return lines.join("\n")
  }).join("\n")
}

const SYSTEM_BASE =
  "Kamu asisten arsitek di aplikasi Baruma. Jawab pertanyaan pemilik rumah dalam Bahasa Indonesia " +
  "yang ringkas, praktis, jujur soal keterbatasan. Jangan mengarang angka biaya pasti; sarankan " +
  "profesional utk struktur/keselamatan."

async function answer(q, groundingNote) {
  const sys = SYSTEM_BASE + (groundingNote
    ? "\n\nPENGETAHUAN (kurasi — pakai bila relevan; jangan mengarang di luar ini):\n" + groundingNote
    : "")
  const { text } = await faucetChat(DEEPSEEK,
    [{ role: "system", content: sys }, { role: "user", content: q }],
    { maxTokens: 700, temperature: 0.4, token: tok(), thinking: "disabled", tries: 6 })
  return text.trim()
}

async function judgeOnce(cfg, q, ans1, ans2) {
  const sys = `Anda juri kualitas jawaban asisten desain-rumah utk pemilik awam Indonesia.
Kriteria (dari riset pengguna): (a) actionable & spesifik — membantu menghindari kesalahan mahal sebelum komit ke vendor; (b) menjelaskan trade-off keputusan; (c) jujur soal batas (tanpa angka karangan, arahkan profesional bila perlu); (d) relevan konteks Indonesia.
Balas STRICT JSON: {"lebih_baik": 1 | 2 | 0} (0 = seri). Jangan menilai panjang — nilai isi.`
  const usr = `PERTANYAAN: ${q}\n\n=== JAWABAN 1 ===\n${ans1}\n\n=== JAWABAN 2 ===\n${ans2}`
  const { text } = await faucetChat(cfg,
    [{ role: "system", content: sys }, { role: "user", content: usr }],
    { maxTokens: 200, temperature: 0, token: tok(), thinking: "disabled", tries: 6 })
  const s = text.indexOf("{"), e = text.lastIndexOf("}")
  try { return JSON.parse(text.slice(s, e + 1)).lebih_baik } catch { return null }
}

const QUESTIONS = [
  // process (baseline = tanpa grounding)
  "Budget saya sepertinya pas-pasan. Apa saja yang biasanya dipangkas dulu tanpa merusak kualitas rumah?",
  "Apa saja biaya yang sering tidak kelihatan di awal saat bangun rumah?",
  "Bangun rumah itu desain dulu atau hitung anggaran dulu sih?",
  "Saya perlu arsitek atau cukup tukang berpengalaman saja?",
  "Bagaimana cara membandingkan proposal dari dua kontraktor yang beda jauh harganya?",
  "Termin pembayaran ke kontraktor yang aman itu seperti apa?",
  "Saya kerja di luar kota. Bagaimana mengawasi pembangunan rumah dari jauh?",
  // problem (upgrade — baseline = knowledge lama)
  "Rumah saya panas banget siang hari, solusinya apa?",
  "Dak beton saya bocor kalau hujan deras, kenapa ya?",
  "Listrik di rumah sering turun sendiri (MCB jeglek), apa penyebabnya?",
  // system (upgrade)
  "Lebih baik sumur bor atau PDAM untuk rumah baru?",
  "Septic tank sebaiknya ditaruh di mana dan apa yang perlu diperhatikan?",
]

console.log(`A/B END-TO-END — ${QUESTIONS.length} pertanyaan, 4 suara/pertanyaan (deepseek+mimo × 2 posisi)\n${"=".repeat(70)}`)
let newWins = 0, oldWins = 0, ties = 0
const perDomain = {}

for (const q of QUESTIONS) {
  const rows = await retrieve(q)
  const newNote = note(rows)
  // Grounding LAMA: knowledge dari backup utk topik yang sama; topik yang
  // belum ada pra-upgrade (process baru) di-drop → persis keadaan dulu.
  const oldRows = rows
    .filter((r) => BACKUP[r.id])
    .map((r) => ({ ...r, knowledge: BACKUP[r.id].knowledge }))
  const oldNote = note(oldRows)

  const [ansOld, ansNew] = await Promise.all([answer(q, oldNote), answer(q, newNote)])

  // 4 penilaian buta: (deepseek, mimo) × (lama-dulu, baru-dulu)
  const votes = await Promise.all([
    judgeOnce(DEEPSEEK, q, ansOld, ansNew).then((v) => (v === 2 ? "new" : v === 1 ? "old" : "tie")),
    judgeOnce(DEEPSEEK, q, ansNew, ansOld).then((v) => (v === 1 ? "new" : v === 2 ? "old" : "tie")),
    judgeOnce(MIMO, q, ansOld, ansNew).then((v) => (v === 2 ? "new" : v === 1 ? "old" : "tie")),
    judgeOnce(MIMO, q, ansNew, ansOld).then((v) => (v === 1 ? "new" : v === 2 ? "old" : "tie")),
  ])
  const n = votes.filter((v) => v === "new").length
  const o = votes.filter((v) => v === "old").length
  const verdict = n > o ? "BARU" : o > n ? "LAMA" : "SERI"
  if (n > o) newWins++; else if (o > n) oldWins++; else ties++
  const domain = rows[0]?.topic_type ?? "tanpa-grounding"
  perDomain[domain] = perDomain[domain] ?? { new: 0, old: 0, tie: 0 }
  perDomain[domain][n > o ? "new" : o > n ? "old" : "tie"]++
  console.log(`\n[${verdict} ${n}-${o}] ${q}`)
  console.log(`   topik: ${rows.map((r) => r.topic).join(", ") || "(tanpa grounding lama & baru)"}`)
}

console.log(`\n${"=".repeat(70)}`)
console.log(`HASIL: BARU menang ${newWins} | LAMA menang ${oldWins} | seri ${ties} (dari ${QUESTIONS.length})`)
console.log(`Per domain: ${JSON.stringify(perDomain)}`)
await pool.end()
