/**
 * Regresi DETERMINISTIK retrieval design_knowledge (nol token LLM).
 *
 * Menjaga dua sisi sekaligus — tanpa kontrol POSITIF, "semua noise hilang"
 * bisa berarti retrieval-nya mati total dan kita salah menyimpulkan sukses.
 *   NEGATIF: pasangan ngawur yang terukur di riset presisi HARUS hilang.
 *   POSITIF: topik yang memang benar HARUS tetap terambil.
 *
 * SQL di sini SENGAJA menyalin src/lib/server/repo/design-knowledge.ts.
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

async function retrieve(question) {
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
     SELECT dk.topic FROM scored s JOIN design_knowledge dk ON dk.id = s.id
     WHERE (s.hits >= 2 OR s.cover >= 0.6)
       AND s.score >= 0.7 * (SELECT max(score) FROM scored)
     ORDER BY s.score DESC, length(dk.topic) ASC LIMIT 3`,
    [words])
  return r.rows.map((x) => x.topic)
}

// Pasangan ngawur NYATA yang terukur sebelum perbaikan.
const NEGATIVE = [
  ["gudang sebaiknya ditaruh di mana?", "Batu palimanan"],
  ["septic tank sebaiknya ditaruh di mana?", "Batu palimanan"],
  ["perlu gak ruang cuci jemur terpisah?", "Ruang tamu"],
  ["ruang kerja di rumah enaknya seperti apa?", "Ruang tamu"],
  ["dak beton bocor kenapa ya?", "Roster beton"],
  ["cladding kayu untuk fasad awet gak?", "Veneer kayu"],
  ["dinding retak rambut bahaya gak?", "Rak dinding terbuka"],
  ["dinding lembap dan berjamur gimana?", "Rak dinding terbuka"],
  ["berapa titik lampu ideal per ruangan?", "Pergola kayu"],
  ["dapur kotor terpisah worth it gak?", "Quartz (meja dapur)"],
]
// Topik yang WAJIB tetap terambil (jaga recall).
const POSITIVE = [
  ["kenapa pakai kitchen island?", "Kitchen island"],
  ["gaya japandi itu seperti apa?", "Japandi"],
  ["quartz untuk meja dapur bagaimana?", "Quartz (meja dapur)"],
  ["railing kaca atau railing besi?", "Railing kaca"],
  ["balkon amankah untuk anak kecil?", "Balkon"],
  ["taman kering perawatannya gimana?", "Taman kering (dry garden)"],
  ["kitchen set bentuk L atau U?", "Kitchen set bentuk L"],
  ["kanopi carport bahannya apa?", "Kanopi carport"],
]

let pass = 0, fail = 0
console.log("NEGATIF — grounding ngawur harus HILANG:")
for (const [q, forbidden] of NEGATIVE) {
  const got = await retrieve(q)
  const leaked = got.includes(forbidden)
  console.log(`  ${leaked ? "✗ MASIH BOCOR" : "✓"}  "${q}"\n      → [${got.join(", ") || "(kosong)"}]`)
  leaked ? fail++ : pass++
}
console.log("\nPOSITIF — topik benar harus TETAP terambil:")
for (const [q, want] of POSITIVE) {
  const got = await retrieve(q)
  const has = got.includes(want)
  console.log(`  ${has ? "✓" : "✗ HILANG"}  "${q}"\n      → [${got.join(", ") || "(kosong)"}]`)
  has ? pass++ : fail++
}
console.log(`\nHASIL: ${pass} lulus / ${fail} gagal (dari ${NEGATIVE.length + POSITIVE.length})`)
await pool.end()
process.exit(fail === 0 ? 0 : 1)
