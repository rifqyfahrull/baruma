/**
 * RISET presisi grounding: berapa persen topik design_knowledge yang
 * DISUNTIKKAN ke prompt agent sebenarnya RELEVAN dgn pertanyaannya?
 *
 * Retrieval saat ini mencocokkan substring nama topik (`topic ILIKE '%kata%'`),
 * jadi "septic tank" bisa menarik "Batu paliMANan". Grounding yang salah
 * konteks lebih berbahaya daripada tanpa grounding — ini mengukurnya.
 *
 * Output: precision keseluruhan + daftar pasangan paling ngawur.
 */
import pg from "pg"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadEnvLocal, loadTokens, faucetChat } from "./_shared.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
loadEnvLocal(repoRoot)
const cfg = {
  baseUrl: process.env.FAUCET_BASE_URL || "https://freetokenfaucet.com/v1",
  model: process.env.FAUCET_MODEL || "deepseek-v4-flash",
}
const TOKENS = loadTokens(repoRoot)
let ti = 0
const nextTok = () => TOKENS[ti++ % TOKENS.length]
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false, max: 4 })

// STOP + retrieval MENIRU src/lib/server/repo/design-knowledge.ts.
// Set MODE=old untuk mengukur perilaku LAMA (substring) sbg pembanding.
const MODE = process.env.MODE || "new"
const STOP = new Set(["yang","untuk","apa","itu","dan","atau","dengan","pakai","pake","gimana",
  "bagaimana","kenapa","mengapa","kalau","jika","saya","aku","mau","ingin","bisa","boleh","harus",
  "adalah","di","ke","dari","pada","ini","cocok","bagus","baik","buat","sih","banget","pengen",
  "gak","nggak","tidak","juga","biar","rumah","agar","supaya","lebih","sudah","ada","aja","nya",
  ...(MODE === "new"
    ? ["mana","dimana","kemana","sebaiknya","perlu","solusinya","solusi","terus","seperti",
       "enaknya","masih","saja","dong","punya","kita","bikin","ditaruh","worth","mending","pilih"]
    : [])])
const W = (q) => q.toLowerCase().replace(/[^a-z0-9\s]/g," ").split(/\s+/).filter(w=>w.length>=3&&!STOP.has(w))

const QUESTIONS = [
  "kitchen island cocok gak untuk dapur saya?","wardrobe built-in atau lepas ya?",
  "sofa L atau sofa 2 dudukan untuk ruang tamu kecil?","railing kaca atau besi untuk tangga?",
  "gudang sebaiknya ditaruh di mana?","perlu gak ruang cuci jemur terpisah?",
  "kamar mandi tamu itu perlu?","ruang kerja di rumah enaknya seperti apa?",
  "dapur kotor terpisah worth it gak?","void di ruang keluarga bagus gak?",
  "atap pelana atau limasan lebih baik?","dak beton bocor kenapa ya?",
  "genteng metal vs genteng beton pilih mana?","secondary skin fungsinya apa?",
  "cladding kayu untuk fasad awet gak?","louver aluminium buat apa?",
  "kanopi carport sebaiknya bahan apa?","berapa titik lampu ideal per ruangan?",
  "septic tank sebaiknya ditaruh di mana?","AC split atau cassette untuk ruang keluarga?",
  "rumah saya panas banget siang hari, solusinya?","dinding lembap dan berjamur gimana?",
  "kamar mandi bau terus solusinya apa?","dinding retak rambut bahaya gak?",
  "rangka atap baja ringan vs kayu?","waterproofing dak sebaiknya pakai apa?",
  "pondasi untuk rumah 2 lantai pakai apa?","taman kering perawatannya gimana?",
]

async function retrieve(q) {
  const w = W(q)
  if (!w.length) return []
  if (MODE === "old") {
    const r = await pool.query(
      `SELECT topic, topic_type,
         (SELECT count(*) FROM unnest($1::text[]) x WHERE topic ILIKE '%'||x||'%') score
       FROM design_knowledge WHERE topic ILIKE ANY($2)
       ORDER BY score DESC, length(topic) ASC LIMIT 3`,
      [w, w.map(x=>`%${x}%`)])
    return r.rows.filter(x=>Number(x.score)>0)
  }
  const r = await pool.query(
    `WITH q AS (SELECT DISTINCT unnest($1::text[]) AS word),
     m AS (SELECT dk.id, q.word FROM design_knowledge dk JOIN q ON dk.topic ~* ('\\m'||q.word||'\\M')),
     df AS (SELECT word, count(*)::float AS df FROM m GROUP BY word),
     total AS (SELECT count(*)::float AS n FROM design_knowledge),
     scored AS (
       SELECT m.id, sum(ln((SELECT n FROM total)/df.df)) AS score, count(*) AS hits,
              max(length(m.word)::float / greatest(length(dk0.topic),1)) AS cover
       FROM m JOIN df ON df.word=m.word
       JOIN design_knowledge dk0 ON dk0.id=m.id GROUP BY m.id)
     SELECT dk.topic, dk.topic_type
     FROM scored s JOIN design_knowledge dk ON dk.id=s.id
     WHERE (s.hits >= 2 OR s.cover >= 0.6)
       AND s.score >= 0.7*(SELECT max(score) FROM scored)
     ORDER BY s.score DESC, length(dk.topic) ASC LIMIT 3`,
    [w])
  return r.rows
}

const SYS = `Anda evaluator retrieval. Untuk tiap pasangan {pertanyaan, topik}, nilai apakah topik itu RELEVAN sebagai bahan menjawab pertanyaan tsb.
RELEVAN = topik benar-benar membahas hal yang ditanyakan. TIDAK relevan = kebetulan mirip kata saja / beda konteks.
Balas STRICT JSON: {"results":[{"i":<index>,"rel":true|false}]}`

async function judgeBatch(pairs) {
  const listing = pairs.map((p,i)=>({ i, pertanyaan: p.q, topik: p.topic }))
  const { text } = await faucetChat(cfg,
    [{ role:"system", content: SYS },
     { role:"user", content: `Nilai ${listing.length} pasangan:\n${JSON.stringify(listing)}` }],
    { maxTokens: 1500, temperature: 0, token: nextTok(), thinking: "disabled", tries: 8 })
  const s = text.indexOf("{"), e = text.lastIndexOf("}")
  try { return JSON.parse(text.slice(s, e+1)).results ?? [] } catch { return [] }
}

const pairs = []
for (const q of QUESTIONS) {
  for (const row of await retrieve(q)) pairs.push({ q, topic: row.topic, type: row.topic_type })
}
console.log(`[presisi] ${pairs.length} pasangan (pertanyaan → topik disuntikkan) dari ${QUESTIONS.length} pertanyaan\n`)

const verdicts = new Map()
for (let i = 0; i < pairs.length; i += 12) {
  const slice = pairs.slice(i, i+12)
  const res = await judgeBatch(slice)
  for (const r of res) {
    const p = slice[r.i]
    if (p) verdicts.set(`${p.q}||${p.topic}`, !!r.rel)
  }
}

let rel = 0, irr = 0
const bad = []
for (const p of pairs) {
  const v = verdicts.get(`${p.q}||${p.topic}`)
  if (v === undefined) continue
  if (v) rel++; else { irr++; bad.push(p) }
}
const total = rel + irr
console.log("=".repeat(66))
console.log(`PRESISI GROUNDING: ${rel}/${total} topik relevan (${Math.round(100*rel/total)}%)`)
console.log(`NOISE: ${irr} topik SALAH KONTEKS disuntikkan ke prompt agent (${Math.round(100*irr/total)}%)`)
console.log("\nContoh grounding ngawur:")
for (const b of bad.slice(0, 12)) console.log(`  "${b.q}"\n     → ${b.topic} [${b.type}]`)
await pool.end()
