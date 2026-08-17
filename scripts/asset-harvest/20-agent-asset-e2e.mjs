/**
 * E2E: agent MEREKOMENDASIKAN ASET NYATA dari library (grounded pada
 * enrichment describe). Jalur produksi se-faithful mungkin:
 *   1) gate intent (wantsAssetSuggestions — regex sama)
 *   2) cari aset NYATA di DB prod (SQL sama dgn asset-search.ts, incl.
 *      keywords/description dari asset_knowledge + sinonim ID↔EN)
 *   3) system prompt SAMA dgn brief-assistant.ts (blok MODEL TERSEDIA DI LIBRARY)
 *   4) LLM nyata (deepseek-v4-flash) menjawab
 *   5) assert: (a) jawaban menyebut >=1 NAMA ASET PERSIS dari daftar,
 *      (b) tidak merekomendasikan model di luar daftar (cek LLM-judge)
 * Termasuk kontrol negatif: pertanyaan desain umum TIDAK memicu pencarian aset.
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
let ti = 0
const nextToken = () => tokens[ti++ % tokens.length]
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false, max: 2 })

// ── cermin asset-search.ts ──────────────────────────────────────────────────
const STOP = new Set(["yang","untuk","apa","itu","dan","atau","dengan","pakai","pake","gimana","bagaimana",
  "kenapa","mengapa","kalau","jika","saya","aku","mau","ingin","bisa","boleh","harus","adalah","di","ke",
  "dari","pada","ini","the","a","an","is","of","for","how","why","what","cocok","bagus","baik","buat",
  "carikan","cari","rekomendasi","rekomendasikan","model","aset","ada","punya","dong","tolong"])
// sinonim inti (subset search-synonyms.ts yg relevan utk kasus uji)
const SYN = { gerbang: ["gate"], pagar: ["fence", "gate"], wastafel: ["sink"], sofa: ["sofa", "couch"], lampu: ["lamp", "light", "lighting"], gantung: ["pendant", "hanging"] }
function terms(q) {
  const words = q.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w))
  const out = new Set(words)
  for (const w of words) for (const s of SYN[w] ?? []) out.add(s)
  return [...out]
}
const ASSET_INTENT = /\b(carikan|cariin|cari|mencari|rekomendasi(kan)?|saran(kan|in)?|model|aset|furnitur(e)?|produk|pilihan|contoh|pasang|pakai(kan)?|butuh|tambah(kan)?|beli|ada(kah)?)\b/i

async function searchAssets(q, limit = 5) {
  const t = terms(q)
  if (!t.length) return []
  const res = await pool.query(
    `SELECT ua.id, ua.name, ua.category, ak.description_id AS description,
       (SELECT count(*) FROM unnest($1::text[]) w
          WHERE ua.name ILIKE '%'||w||'%' OR ua.category ILIKE '%'||w||'%'
             OR ak.keywords ILIKE '%'||w||'%' OR ak.description_id ILIKE '%'||w||'%') AS score
     FROM user_assets ua LEFT JOIN asset_knowledge ak ON ak.asset_id = ua.id
     WHERE ua.is_public = true AND (ua.name ILIKE ANY($2) OR ua.category ILIKE ANY($2)
       OR ak.keywords ILIKE ANY($2) OR ak.description_id ILIKE ANY($2))
     ORDER BY score DESC, length(ua.name) ASC LIMIT $3`,
    [t, t.map((w) => `%${w}%`), limit],
  )
  return res.rows.filter((r) => Number(r.score) > 0)
}
const fmtAssets = (rows) => rows.map((r) => `• ${r.name} [${r.category}]${r.description ? " — " + r.description.slice(0, 110) : ""}`).join("\n")

const BRIEF = { summary: "Rumah 2 lantai 7×14 m, Jakarta, tropis lembap, dana menengah.", priorities: ["terasa_lega"] }
function systemPrompt(assetNote) {
  return (
    "Kamu asisten arsitek di aplikasi Baruma. Jawab dalam Bahasa Indonesia ringkas & praktis. " +
    "Jangan mengarang angka biaya pasti atau klaim teknis tanpa dasar." +
    (assetNote
      ? "\n\nMODEL TERSEDIA DI LIBRARY (bila pengguna minta model/aset, rekomendasikan HANYA dari daftar ini, sebut nama persis; JANGAN mengarang model lain):\n" + assetNote
      : "") +
    "\n\nBRIEF:\n" + JSON.stringify(BRIEF)
  )
}
async function ask(q, note) {
  const { text } = await faucetChat(cfg,
    [{ role: "system", content: systemPrompt(note) }, { role: "user", content: q }],
    { maxTokens: 700, temperature: 0.4, token: nextToken(), tries: 8, thinking: "disabled" })
  return text.trim()
}
async function judgeNoFabrication(q, names, answer) {
  const sys = 'Anda evaluator QA. Balas STRICT JSON: {"onlyFromList":bool,"reason":"<=20 kata"}. ' +
    "onlyFromList=true bila SEMUA model/produk 3D spesifik yang direkomendasikan jawaban ada di DAFTAR (parafrasa deskriptif umum boleh)."
  const usr = `DAFTAR MODEL SAH:\n${names.join("\n")}\n\nPERTANYAAN: ${q}\n\nJAWABAN:\n${answer}`
  const { text } = await faucetChat(cfg, [{ role: "system", content: sys }, { role: "user", content: usr }],
    { maxTokens: 400, temperature: 0, token: nextToken(), tries: 8, thinking: "disabled" })
  const s = text.indexOf("{"), e = text.lastIndexOf("}")
  try { return JSON.parse(text.slice(s, e + 1)) } catch { return { onlyFromList: false, reason: "judge parse fail" } }
}

const CASES = [
  { q: "carikan model gerbang minimalis untuk fasad rumah saya" },
  { q: "saya butuh wastafel dapur, ada model yang cocok?" },
  { q: "rekomendasikan sofa untuk ruang keluarga sempit" },
  { q: "ada model lampu gantung buat ruang makan?" },
]

console.log(`[e2e-asset] model=${cfg.model} tokens=${tokens.length}\n${"=".repeat(66)}`)
let pass = 0
for (const c of CASES) {
  if (!ASSET_INTENT.test(c.q)) { console.log(`\n▶ ${c.q}\n  ✗ intent gate tidak terpicu (bug)`); continue }
  const assets = await searchAssets(c.q)
  const note = fmtAssets(assets)
  const names = assets.map((a) => a.name)
  const answer = await ask(c.q, note)
  const mentioned = names.filter((n) => answer.toLowerCase().includes(n.toLowerCase()))
  const v = await judgeNoFabrication(c.q, names, answer)
  const ok = mentioned.length >= 1 && v.onlyFromList
  if (ok) pass++
  console.log(`\n▶ ${c.q}`)
  console.log(`  kandidat  : ${names.join(" | ") || "(none)"}`)
  console.log(`  disebut   : ${mentioned.join(" | ") || "TIDAK ADA ✗"}`)
  console.log(`  no-fabrikasi: ${v.onlyFromList} — ${v.reason}`)
  console.log(`  verdict   : ${ok ? "PASS ✅" : "FAIL ✗"}`)
  console.log(`  jawaban   : ${answer.replace(/\s+/g, " ").slice(0, 380)} …`)
}

// kontrol negatif: pertanyaan umum → intent gate false → tak ada pencarian aset
const neg = "apakah desain saya sudah sesuai standar?"
const negGate = ASSET_INTENT.test(neg)
console.log(`\n▶ [kontrol negatif] "${neg}"`)
console.log(`  intent gate: ${negGate} (harus false) → ${!negGate ? "PASS ✅" : "FAIL ✗"}`)
if (!negGate) pass++

console.log(`\n${"=".repeat(66)}\n[e2e-asset] PASS ${pass}/${CASES.length + 1}`)
await pool.end()
process.exit(pass === CASES.length + 1 ? 0 : 1)
