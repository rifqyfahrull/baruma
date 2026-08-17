/**
 * Tahap 44 — eval retrieval app_knowledge (deterministik, nol token).
 *
 * SQL-nya cermin src/lib/server/repo/app-knowledge.ts. Dipecah per gaya:
 *   by_name — menyebut nama konsep (batas atas)
 *   by_goal — menceritakan masalah (yang sebenarnya terjadi di produksi)
 * Selisih keduanya = ukuran sejati "apakah agent menemukan mekanika yang
 * tepat saat pengguna hanya bicara soal masalahnya".
 */
import pg from "pg"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadEnvLocal } from "./_shared.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
loadEnvLocal(repoRoot)
const verbose = process.argv.includes("--verbose")
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false, max: 6 })

const STOP = new Set(["yang","untuk","apa","itu","dan","atau","dengan","pakai","pake","gimana",
  "bagaimana","kenapa","mengapa","kalau","jika","saya","aku","mau","ingin","bisa","boleh","harus",
  "adalah","di","ke","dari","pada","ini","the","a","an","is","of","for","how","why","what","cocok",
  "bagus","baik","buat","mana","dimana","kemana","sebaiknya","perlu","solusinya","solusi","terus",
  "seperti","enaknya","banget","pengen","gak","nggak","tidak","juga","biar","rumah","agar","supaya",
  "lebih","sudah","masih","ada","saja","aja","sih","dong","nya","punya","kita","bikin","ditaruh",
  "worth","mending","pilih","tolong"])
const W = (q) => q.toLowerCase().replace(/[^a-z0-9\s]/g," ").split(/\s+/).filter(w=>w.length>=3&&!STOP.has(w))
// Cermin src/lib/server/repo/app-knowledge.ts — verba aksi menaikkan bobot
// kind='action' supaya "hapus stopkontak" tak kalah oleh fakta mechanic yang
// cakupan kata kuncinya lebih luas.
const ACTION_VERB_RE =
  /\b(hapus|menghapus|buang|membuang|hilangkan|batalkan|tambah|menambah|tambahkan|pindah|memindah|pindahkan|geser|menggeser|ubah|mengubah|ganti|mengganti|gantikan|pasang|memasang|putar|memutar|atur ulang|reset)\w*\b/i

async function retrieve(q, limit = 4) {
  const words = W(q)
  if (!words.length) return []
  const actionIntent = ACTION_VERB_RE.test(q)
  const r = await pool.query(
    `WITH q AS (SELECT DISTINCT unnest($1::text[]) AS word),
     m AS (SELECT ak.id, q.word, (ak.name ILIKE '%'||q.word||'%') AS in_name
           FROM app_knowledge ak
           JOIN q ON ak.name ILIKE '%'||q.word||'%'
                  OR coalesce(ak.keywords,'') ~* ('\\m'||q.word||'\\M')),
     df AS (SELECT word, count(*)::float AS df FROM m GROUP BY word),
     total AS (SELECT count(*)::float AS n FROM app_knowledge),
     scored AS (SELECT m.id, sum(ln((SELECT n FROM total)/df.df)
                  * (CASE WHEN m.in_name THEN 2.0 ELSE 1.0 END))
                  * (CASE WHEN $3 AND ak0.kind='action' THEN 1.6 ELSE 1.0 END) AS score
                FROM m JOIN df ON df.word=m.word
                JOIN app_knowledge ak0 ON ak0.id=m.id
                GROUP BY m.id, ak0.kind)
     SELECT ak.id FROM scored s JOIN app_knowledge ak ON ak.id=s.id
     WHERE s.score >= 0.5*(SELECT max(score) FROM scored)
     ORDER BY s.score DESC, length(ak.name) ASC LIMIT $2`,
    [words, limit, actionIntent])
  return r.rows.map((x) => x.id)
}

const rows = readFileSync(path.join(repoRoot, "scripts/asset-harvest/app-eval-set.jsonl"), "utf8")
  .split("\n").filter(Boolean).map((l) => JSON.parse(l))

const stat = () => ({ n: 0, hit: 0, empty: 0 })
const all = stat(), byKind = {}, byType = {}
const misses = []
for (const row of rows) {
  const got = await retrieve(row.q)
  const hit = got.includes(row.expect)
  for (const s of [all, (byKind[row.kind] ||= stat()), (byType[row.type] ||= stat())]) {
    s.n++; if (hit) s.hit++; if (!got.length) s.empty++
  }
  if (!hit) misses.push({ ...row, got })
}
const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0)
const line = (l, s) => `  ${l.padEnd(10)} n=${String(s.n).padStart(4)}  recall@4 ${String(pct(s.hit,s.n)).padStart(3)}%  kosong ${pct(s.empty,s.n)}%`

console.log(`EVAL RETRIEVAL app_knowledge — ${rows.length} situasi\n${"=".repeat(58)}`)
console.log(line("SEMUA", all))
console.log("\nPer gaya:")
for (const k of Object.keys(byKind).sort()) console.log(line(k, byKind[k]))
console.log("\nPer jenis konsep:")
for (const t of Object.keys(byType).sort()) console.log(line(t, byType[t]))
if (byKind.by_name && byKind.by_goal) {
  console.log(`\nCelah niat-vs-nama: ${pct(byKind.by_name.hit, byKind.by_name.n)}% → ${pct(byKind.by_goal.hit, byKind.by_goal.n)}%`)
}
if (verbose) {
  console.log(`\nContoh gagal (${misses.length}):`)
  for (const m of misses.slice(0, 20)) console.log(`  [${m.kind}] "${m.q}"\n      harap: ${m.expect}\n      dapat: ${m.got.join(", ") || "(kosong)"}`)
}
await pool.end()
