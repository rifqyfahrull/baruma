/**
 * Tahap 27 — RECALL EFEKTIF: berapa banyak "kegagalan" eval yang sebenarnya
 * masih memungkinkan agent menjawab dengan benar?
 *
 * Eval tahap 25 menuntut ID topik PERSIS. Padahal beberapa topik nyaris
 * bersinonim: pertanyaan "dinding kepanasan kena matahari" diharap
 * `teras-dan-overstek` tapi dapat `kanopi-dan-overstek` — agent tetap
 * menjawab benar. Recall mentah karenanya MEREMEHKAN kualitas sebenarnya.
 *
 * Di sini LLM menilai tiap kegagalan: apakah topik yang TERAMBIL masih
 * memadai untuk menjawab pertanyaan itu? Hasilnya "recall efektif" =
 * (benar persis + pengganti yang memadai) / total.
 *
 * Catatan metodologi: ini SAMPEL & pakai judge yang diketahui berisik —
 * dipakai untuk MENAFSIRKAN angka, bukan sebagai target optimasi.
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
let ti = 0
const nextTok = () => TOKENS[ti++ % TOKENS.length]
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false, max: 6 })

const STOP = new Set(["yang","untuk","apa","itu","dan","atau","dengan","pakai","pake","gimana",
  "bagaimana","kenapa","mengapa","kalau","jika","saya","aku","mau","ingin","bisa","boleh","harus",
  "adalah","di","ke","dari","pada","ini","the","a","an","is","of","for","how","why","what","cocok",
  "bagus","baik","buat","mana","dimana","kemana","sebaiknya","perlu","solusinya","solusi","terus",
  "seperti","enaknya","banget","pengen","gak","nggak","tidak","juga","biar","rumah","agar","supaya",
  "lebih","sudah","masih","ada","saja","aja","sih","dong","nya","punya","kita","bikin","ditaruh",
  "worth","mending","pilih"])
const W = (q) => q.toLowerCase().replace(/[^a-z0-9\s]/g," ").split(/\s+/).filter(w=>w.length>=3&&!STOP.has(w))

async function retrieve(question, limit = 3) {
  const words = W(question)
  if (!words.length) return []
  const r = await pool.query(
    `WITH q AS (SELECT DISTINCT unnest($1::text[]) AS word),
     m AS (
       SELECT dk.id, q.word, (dk.topic ~* ('\\m'||q.word||'\\M')) AS in_topic
       FROM design_knowledge dk
       JOIN q ON dk.topic ~* ('\\m'||q.word||'\\M')
              OR coalesce(dk.keywords,'') ~* ('\\m'||q.word||'\\M')
     ),
     df AS (SELECT word, count(*)::float AS df FROM m GROUP BY word),
     total AS (SELECT count(*)::float AS n FROM design_knowledge),
     scored AS (
       SELECT m.id, sum(ln((SELECT n FROM total)/df.df)
                        * (CASE WHEN m.in_topic THEN 1.5 ELSE 1.0 END)) AS score,
              count(*) AS hits,
              max(CASE WHEN m.in_topic
                       THEN length(m.word)::float/greatest(length(dk0.topic),1) ELSE 0 END) AS cover
       FROM m JOIN df ON df.word=m.word JOIN design_knowledge dk0 ON dk0.id=m.id GROUP BY m.id
     )
     SELECT dk.id, dk.topic FROM scored s JOIN design_knowledge dk ON dk.id=s.id
     WHERE (s.hits>=2 OR s.cover>=0.6) AND s.score >= 0.7*(SELECT max(score) FROM scored)
     ORDER BY s.score DESC, length(dk.topic) ASC LIMIT $2`,
    [words, limit])
  return r.rows
}

const rows = readFileSync(path.join(repoRoot, "scripts/asset-harvest/eval-set.jsonl"), "utf8")
  .split("\n").filter(Boolean).map((l) => JSON.parse(l))

const fails = []
let exact = 0
for (const row of rows) {
  const got = await retrieve(row.q)
  if (got.some((g) => g.id === row.expect)) exact++
  else if (got.length) fails.push({ ...row, got })
  else fails.push({ ...row, got: [] })
}
console.log(`[eff] ${rows.length} pertanyaan | benar-persis ${exact} | gagal ${fails.length}`)

const judgeable = fails.filter((f) => f.got.length)
const SAMPLE = Math.min(60, judgeable.length)
const sample = judgeable.slice(0, SAMPLE)

const SYS = `Anda evaluator QA asisten desain rumah Indonesia.
Untuk tiap kasus: pengguna bertanya X. Sistem TIDAK mengambil topik ideal, tapi mengambil topik lain.
Nilai: apakah topik yang TERAMBIL masih memadai untuk menjawab pertanyaan itu dengan benar & bermanfaat?
Balas STRICT JSON: {"results":[{"i":<index>,"ok":true|false}]}
ok=true bila topik terambil membahas hal yang pada dasarnya sama / cukup untuk menjawab.
ok=false bila topiknya beda konteks sehingga jawaban akan meleset.`

async function judge(batch, offset) {
  const items = batch.map((f, i) => ({
    i: offset + i, pertanyaan: f.q, topik_ideal: f.topic, topik_terambil: f.got.map((g) => g.topic),
  }))
  const { text } = await faucetChat(cfg,
    [{ role: "system", content: SYS }, { role: "user", content: JSON.stringify(items) }],
    { maxTokens: 1200, temperature: 0, token: nextTok(), thinking: "disabled", tries: 8 })
  const s = text.indexOf("{"), e = text.lastIndexOf("}")
  try { return JSON.parse(text.slice(s, e+1)).results ?? [] } catch { return [] }
}

let acceptable = 0, judged = 0
for (let i = 0; i < sample.length; i += 10) {
  const res = await judge(sample.slice(i, i+10), i)
  for (const r of res) { judged++; if (r.ok) acceptable++ }
}

const rateAcceptable = judged ? acceptable / judged : 0
const estAcceptableAll = Math.round(rateAcceptable * judgeable.length)
const effective = exact + estAcceptableAll
console.log(`\nSampel dinilai: ${judged} | memadai: ${acceptable} (${Math.round(100*rateAcceptable)}%)`)
console.log(`Kegagalan yang punya hasil (bisa dinilai): ${judgeable.length}; kosong total: ${fails.length - judgeable.length}`)
console.log(`\nRECALL MENTAH    : ${Math.round(100*exact/rows.length)}%  (${exact}/${rows.length})`)
console.log(`RECALL EFEKTIF ~ : ${Math.round(100*effective/rows.length)}%  (persis ${exact} + ~${estAcceptableAll} pengganti memadai)`)
await pool.end()
