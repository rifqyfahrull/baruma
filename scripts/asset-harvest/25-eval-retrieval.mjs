/**
 * Tahap 25 — EVAL RETRIEVAL deterministik (nol token, nol LLM-judge).
 *
 * Menjalankan set berlabel dari tahap 24 lewat SQL retrieval yang SAMA dengan
 * src/lib/server/repo/design-knowledge.ts, lalu mengukur:
 *   recall@1 / recall@3 — apakah topik yang benar terambil?
 *   dipecah per `kind`  — natural (menyebut istilah) vs indirect (ala awam).
 *     Selisih keduanya = ukuran sejati "apakah agent mengerti bahasa awam".
 *   dipecah per topic_type — menunjukkan domain mana yang lemah.
 *
 * Karena labelnya melekat pada data, eval ini bisa diulang selamanya tanpa
 * biaya — cocok jadi penjaga regresi.
 *
 * Jalankan: node scripts/asset-harvest/25-eval-retrieval.mjs [--verbose]
 * Keluar kode 1 bila recall@3 turun di bawah ambang (default 0.70).
 */
import pg from "pg"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadEnvLocal } from "./_shared.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
loadEnvLocal(repoRoot)
const verbose = process.argv.includes("--verbose")
const MIN_RECALL3 = Number(process.env.MIN_RECALL3 || 0.7)

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false, max: 6 })

// Cermin significantWords() di design-knowledge.ts (STOP + panjang >= 3).
// Sinonim ID↔EN tidak ikut di sini: eval mengukur SQL-nya, dan ekspansi
// sinonim diuji terpisah di unit test repo.
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
       SELECT dk.id, q.word,
              (dk.topic ~* ('\\m' || q.word || '\\M')) AS in_topic
       FROM design_knowledge dk
       JOIN q ON dk.topic ~* ('\\m' || q.word || '\\M')
              OR coalesce(dk.keywords,'') ~* ('\\m' || q.word || '\\M')
     ),
     df AS (SELECT word, count(*)::float AS df FROM m GROUP BY word),
     total AS (SELECT count(*)::float AS n FROM design_knowledge),
     scored AS (
       SELECT m.id,
              sum(ln((SELECT n FROM total)/df.df)
                  * (CASE WHEN m.in_topic THEN 1.5 ELSE 1.0 END)) AS score,
              count(*) AS hits,
              max(CASE WHEN m.in_topic
                       THEN length(m.word)::float / greatest(length(dk0.topic),1)
                       ELSE 0 END) AS cover
       FROM m JOIN df ON df.word = m.word
       JOIN design_knowledge dk0 ON dk0.id = m.id
       GROUP BY m.id
     )
     SELECT dk.id FROM scored s JOIN design_knowledge dk ON dk.id = s.id
     WHERE (s.hits >= 2 OR s.cover >= 0.6)
       AND s.score >= 0.7 * (SELECT max(score) FROM scored)
     ORDER BY s.score DESC, length(dk.topic) ASC LIMIT $2`,
    [words, limit])
  return r.rows.map((x) => x.id)
}

const rows = readFileSync(path.join(repoRoot, "scripts/asset-harvest/eval-set.jsonl"), "utf8")
  .split("\n").filter(Boolean).map((l) => JSON.parse(l))

const stat = () => ({ n: 0, r1: 0, r3: 0, empty: 0 })
const all = stat()
const byKind = {}, byType = {}
const misses = []

for (const row of rows) {
  const got = await retrieve(row.q)
  const hit3 = got.includes(row.expect)
  const hit1 = got[0] === row.expect
  for (const s of [all, (byKind[row.kind] ||= stat()), (byType[row.type] ||= stat())]) {
    s.n++; if (hit1) s.r1++; if (hit3) s.r3++; if (!got.length) s.empty++
  }
  if (!hit3) misses.push({ ...row, got })
}

const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0)
const line = (label, s) =>
  `  ${label.padEnd(12)} n=${String(s.n).padStart(4)}  recall@1 ${String(pct(s.r1,s.n)).padStart(3)}%  recall@3 ${String(pct(s.r3,s.n)).padStart(3)}%  kosong ${pct(s.empty,s.n)}%`

console.log(`EVAL RETRIEVAL — ${rows.length} pertanyaan berlabel\n${"=".repeat(64)}`)
console.log(line("SEMUA", all))
console.log("\nPer gaya bertanya:")
for (const k of Object.keys(byKind).sort()) console.log(line(k, byKind[k]))
console.log("\nPer domain:")
for (const t of Object.keys(byType).sort()) console.log(line(t, byType[t]))

const indirect = byKind.indirect, natural = byKind.natural
if (indirect && natural) {
  console.log(`\nCelah bahasa awam: recall@3 natural ${pct(natural.r3,natural.n)}% → indirect ${pct(indirect.r3,indirect.n)}%`
    + ` (selisih ${pct(natural.r3,natural.n) - pct(indirect.r3,indirect.n)} poin)`)
}

if (verbose) {
  console.log(`\nContoh gagal (${misses.length} total):`)
  for (const m of misses.slice(0, 25)) {
    console.log(`  [${m.kind}/${m.type}] "${m.q}"\n      harap: ${m.expect}\n      dapat: ${m.got.join(", ") || "(kosong)"}`)
  }
}

await pool.end()
const ok = all.r3 / all.n >= MIN_RECALL3
console.log(`\n${ok ? "LULUS" : "GAGAL"}: recall@3 ${pct(all.r3, all.n)}% (ambang ${Math.round(MIN_RECALL3*100)}%)`)
process.exit(ok ? 0 : 1)
