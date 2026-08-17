/**
 * RISET cakupan grounding agent: ukur berapa persen pertanyaan NYATA pemilik
 * rumah Indonesia yang berhasil di-ground ke design_knowledge. Tujuannya
 * menentukan ke mana sisa budget token paling berdampak — berbasis bukti,
 * bukan tebakan.
 *
 * Memakai SQL retrieval yang SAMA dgn src/lib/server/repo/design-knowledge.ts.
 * Nol token LLM (murni kueri DB).
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
  "bagus","baik","buat","sih","dong","banget","pengen","gak","nggak","tidak","juga","biar","rumah",
  "agar","supaya","lebih","sudah","masih","ada","saja","aja","bikin","punya","kita","nya"])
const words = (q) => q.toLowerCase().replace(/[^a-z0-9\s]/g," ").split(/\s+/).filter(w=>w.length>=3&&!STOP.has(w))

async function grounded(q) {
  const w = words(q)
  if (!w.length) return []
  const r = await pool.query(
    `SELECT topic, topic_type,
       (SELECT count(*) FROM unnest($1::text[]) x WHERE topic ILIKE '%'||x||'%') AS score
     FROM design_knowledge WHERE topic ILIKE ANY($2)
     ORDER BY score DESC, length(topic) ASC LIMIT 3`,
    [w, w.map(x=>`%${x}%`)])
  return r.rows.filter(x=>Number(x.score)>0)
}

// Pertanyaan NYATA pemilik rumah awam Indonesia, dikelompokkan per domain.
const SETS = {
  "Objek/furnitur (domain yg sudah dikaver)": [
    "kitchen island cocok gak untuk dapur saya?",
    "wardrobe built-in atau lepas ya?",
    "sofa L atau sofa 2 dudukan untuk ruang tamu kecil?",
    "railing kaca atau besi untuk tangga?",
  ],
  "Ruang (baru 12 topik)": [
    "gudang sebaiknya ditaruh di mana?",
    "perlu gak ruang cuci jemur terpisah?",
    "kamar mandi tamu itu perlu?",
    "ruang kerja di rumah enaknya seperti apa?",
    "dapur kotor terpisah worth it gak?",
    "kamar ART perlu kamar mandi sendiri?",
    "foyer atau ruang transisi di pintu masuk perlu?",
    "void di ruang keluarga bagus gak?",
  ],
  "Atap (fitur app: roof zones)": [
    "atap pelana atau limasan lebih baik?",
    "dak beton bocor kenapa ya?",
    "genteng metal vs genteng beton pilih mana?",
    "atap skillion cocok untuk rumah tropis?",
  ],
  "Fasad/eksterior (fitur app)": [
    "secondary skin fungsinya apa?",
    "cladding kayu untuk fasad awet gak?",
    "louver aluminium buat apa?",
    "kanopi carport sebaiknya bahan apa?",
  ],
  "MEP: listrik/air (fitur app)": [
    "berapa titik lampu ideal per ruangan?",
    "pompa air sebaiknya jenis apa?",
    "septic tank sebaiknya ditaruh di mana?",
    "water heater listrik atau gas?",
    "AC split atau cassette untuk ruang keluarga?",
    "sumur bor atau PDAM?",
  ],
  "Masalah rumah (keluhan paling sering)": [
    "rumah saya panas banget siang hari, solusinya?",
    "dinding lembap dan berjamur gimana?",
    "rumah terasa sempit padahal luas, kenapa?",
    "kamar mandi bau terus solusinya apa?",
    "rumah bising dari jalan raya, gimana meredamnya?",
    "halaman sering banjir kalau hujan deras",
    "dinding retak rambut bahaya gak?",
  ],
  "Struktur & konstruksi": [
    "pondasi untuk rumah 2 lantai pakai apa?",
    "kolom praktis itu apa fungsinya?",
    "waterproofing dak sebaiknya pakai apa?",
    "rangka atap baja ringan vs kayu?",
  ],
  "Proses & regulasi": [
    "urutan tahapan membangun rumah apa saja?",
    "cara memilih kontraktor yang benar?",
    "PBG/IMB itu apa dan kapan diurus?",
    "sistem pembayaran termin ke kontraktor gimana?",
  ],
}

console.log("RISET CAKUPAN GROUNDING AGENT (design_knowledge, 107 topik)\n" + "=".repeat(66))
let totalQ = 0, totalHit = 0
const gaps = []
for (const [domain, qs] of Object.entries(SETS)) {
  let hit = 0
  const misses = []
  for (const q of qs) {
    const rows = await grounded(q)
    if (rows.length) hit++
    else misses.push(q)
  }
  totalQ += qs.length; totalHit += hit
  const pct = Math.round((100 * hit) / qs.length)
  console.log(`\n${pct === 0 ? "❌" : pct === 100 ? "✅" : "⚠️ "} ${domain}: ${hit}/${qs.length} ter-grounding (${pct}%)`)
  if (misses.length) {
    for (const m of misses.slice(0, 3)) console.log(`     miss: "${m}"`)
    if (misses.length > 3) console.log(`     …+${misses.length - 3} lagi`)
    gaps.push({ domain, missed: misses.length, total: qs.length })
  }
}
console.log("\n" + "=".repeat(66))
console.log(`TOTAL: ${totalHit}/${totalQ} ter-grounding (${Math.round((100*totalHit)/totalQ)}%) — ${totalQ-totalHit} pertanyaan dijawab TANPA grounding`)
console.log("\nDomain paling bolong (prioritas token):")
for (const g of gaps.sort((a,b)=>b.missed-a.missed)) console.log(`  • ${g.domain}: ${g.missed}/${g.total} miss`)
await pool.end()
