/**
 * Tahap 30 — cek grounding untuk mode EDITOR (denah & interior).
 *
 * Instruksi editor sering sangat pendek ("rapikan", "tata ulang") sehingga
 * pencocokan dari instruksi saja tak menemukan apa pun. sceneKnowledgeNote()
 * menambahkan nama/tipe ruang yang sedang digarap sebagai konteks. Skrip ini
 * mengukur seberapa besar bedanya — nol token LLM.
 *
 * CATATAN: file ini WAJIB ditulis lewat editor, bukan heredoc bash. Heredoc
 * memakan satu lapis escape sehingga regex `\m`/`\M` berubah jadi huruf biasa
 * dan SEMUA kueri diam-diam mengembalikan kosong (pernah bikin salah simpul
 * "grounding 0/7" padahal fiturnya normal).
 */
import pg from "pg"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadEnvLocal } from "./_shared.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
loadEnvLocal(repoRoot)
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false, max: 4 })

const STOP = new Set(["yang","untuk","apa","itu","dan","atau","dengan","pakai","pake","gimana",
  "bagaimana","kenapa","mengapa","kalau","jika","saya","aku","mau","ingin","bisa","boleh","harus",
  "adalah","di","ke","dari","pada","ini","the","a","an","is","of","for","how","why","what","cocok",
  "bagus","baik","buat","mana","dimana","kemana","sebaiknya","perlu","solusinya","solusi","terus",
  "seperti","enaknya","banget","pengen","gak","nggak","tidak","juga","biar","rumah","agar","supaya",
  "lebih","sudah","masih","ada","saja","aja","sih","dong","nya","punya","kita","bikin","ditaruh",
  "worth","mending","pilih"])
const W = (q) => q.toLowerCase().replace(/[^a-z0-9\s]/g," ").split(/\s+/).filter(w=>w.length>=3&&!STOP.has(w))

async function retrieve(text) {
  const words = W(text)
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
     SELECT dk.topic FROM scored s JOIN design_knowledge dk ON dk.id=s.id
     WHERE (s.hits>=2 OR s.cover>=0.6) AND s.score >= 0.7*(SELECT max(score) FROM scored)
     ORDER BY s.score DESC, length(dk.topic) ASC LIMIT 3`,
    [words])
  return r.rows.map((x) => x.topic)
}

// Instruksi editor NYATA + ruang yang sedang digarap (name, type).
const CASES = [
  ["rapikan", ["Kamar tidur utama", "kamar_tidur"]],
  ["tata ulang", ["Dapur", "dapur"]],
  ["tambah sofa", ["Ruang keluarga", "ruang_keluarga"]],
  ["kasih lampu yang pas", ["Kamar tidur anak", "kamar_tidur"]],
  ["tolong perbaiki tata letaknya", ["Kamar mandi", "kamar_mandi"]],
  ["perbesar dapur", ["Dapur", "dapur"]],
  ["tambah kamar mandi di lantai 2", []],
  ["atur furniturnya biar lega", ["Ruang tamu", "ruang_tamu"]],
]

/** Cermin sceneKnowledgeNote(): topik ruang diambil LANGSUNG by-nama lalu
 *  digabung dgn hasil fuzzy, supaya kata instruksi generik tak menggeser
 *  topik ruang yang sedang digarap. */
async function sceneNote(instr, labels, limit = 3) {
  const name = labels[0]
  const exact = name
    ? (await pool.query(`SELECT topic FROM design_knowledge WHERE lower(topic) = lower($1) LIMIT 1`, [name])).rows.map(r=>r.topic)
    : []
  const fuzzy = await retrieve([instr, ...labels].join(" "))
  return [...exact, ...fuzzy.filter((t) => !exact.includes(t))].slice(0, limit)
}

let withCtx = 0, without = 0, roomHit = 0, roomCases = 0
console.log("GROUNDING MODE EDITOR — instruksi pendek + konteks ruang\n" + "=".repeat(62))
for (const [instr, labels] of CASES) {
  const bare = await retrieve(instr)
  const ctx = await sceneNote(instr, labels)
  if (bare.length) without++
  if (ctx.length) withCtx++
  if (labels.length) {
    roomCases++
    if (ctx.some((t) => t.toLowerCase() === labels[0].toLowerCase())) roomHit++
  }
  console.log(`\n"${instr}"${labels.length ? `  (ruang: ${labels[0]})` : ""}`)
  console.log(`   tanpa konteks : ${bare.join(", ") || "(kosong)"}`)
  console.log(`   dgn konteks   : ${ctx.join(", ") || "(kosong)"}`)
}
console.log("\n" + "=".repeat(62))
console.log(`ter-grounding tanpa konteks ruang : ${without}/${CASES.length}`)
console.log(`ter-grounding DENGAN konteks ruang: ${withCtx}/${CASES.length}`)
console.log(`topik ruang yang digarap IKUT terambil: ${roomHit}/${roomCases}`)
await pool.end()
