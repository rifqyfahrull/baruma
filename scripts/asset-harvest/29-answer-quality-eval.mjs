/**
 * Tahap 29 — EVAL KUALITAS JAWABAN agent, berskala.
 *
 * Sepanjang sesi ini retrieval diuji 408 kasus, tapi JAWABAN agent hanya 6
 * skenario — terlalu tipis untuk klaim "akurat". Di sini jawaban nyata
 * dihasilkan lewat pipeline asli (retrieve design_knowledge → prompt
 * brief-assistant → LLM) untuk sampel berstrata, lalu diperiksa.
 *
 * Prioritas pemeriksaan DETERMINISTIK (LLM-judge sudah terbukti berisik):
 *   1. Fabrikasi harga  — menyebut angka rupiah spesifik sbg fakta
 *   2. Fabrikasi SNI    — mengarang kode standar
 *   3. Rujukan ahli     — pertanyaan STRUKTUR wajib mengarahkan ke profesional
 *   4. Bahasa & panjang — jawaban kosong/terpotong/bukan Indonesia
 * LLM-judge hanya dipakai utk hal yang memang subjektif (kesetiaan pada
 * knowledge), atas SUBSET, dan dilaporkan sbg perkiraan — bukan klaim keras.
 *
 * Jalankan: node scripts/asset-harvest/29-answer-quality-eval.mjs [--n=160]
 */
import pg from "pg"
import { readFileSync, writeFileSync } from "node:fs"
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
const CONCURRENCY = Number(process.env.HARVEST_LLM_CONCURRENCY || TOKENS.length)
const N = Number((process.argv.find((a) => a.startsWith("--n=")) || "").split("=")[1]) || 160
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false, max: CONCURRENCY + 2 })

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
     SELECT dk.topic, dk.topic_type, dk.knowledge FROM scored s
     JOIN design_knowledge dk ON dk.id=s.id
     WHERE (s.hits>=2 OR s.cover>=0.6) AND s.score >= 0.7*(SELECT max(score) FROM scored)
     ORDER BY s.score DESC, length(dk.topic) ASC LIMIT $2`,
    [words, limit])
  return r.rows
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

const BRIEF = {
  summary: "Rumah 2 lantai di lahan 7×14 m, Jakarta. Iklim tropis lembap, dana menengah.",
  site: { widthM: 7, depthM: 14, areaM2: 98, city: "Jakarta" },
  building: { floors: 2, rooftop: false, finishingLevel: "menengah" },
  priorities: ["terasa_lega", "hemat_energi"],
  constraints: ["Lahan sempit di sisi lebar", "Sirkulasi udara jadi perhatian utama"],
}

// Cermin src/lib/server/brief-assistant.ts (bagian yang relevan).
function systemPrompt(note) {
  return (
    "Kamu asisten arsitek di aplikasi Baruma. Jawab pertanyaan pemilik rumah tentang brief desain di bawah, " +
    "dalam Bahasa Indonesia yang ringkas, praktis, dan membantu. Jujur soal keterbatasan: jangan mengarang " +
    "angka biaya pasti atau klaim teknis tanpa dasar, dan sarankan tinjauan profesional bila menyangkut " +
    "struktur atau keselamatan. Jika pertanyaan di luar konteks desain rumah/brief ini, arahkan kembali dengan " +
    "sopan. Jawab maksimal beberapa paragraf pendek." +
    (note ? "\n\nPENGETAHUAN DESAIN (kurasi, pakai bila relevan dgn pertanyaan; jangan mengarang di luar ini):\n" + note : "") +
    "\n\nBRIEF:\n" + JSON.stringify(BRIEF)
  )
}

/* ── Pemeriksaan DETERMINISTIK ── */

// Angka rupiah spesifik yang disajikan sbg fakta. "biaya bervariasi" atau
// "tergantung" TIDAK dihitung pelanggaran — itu justru perilaku yang benar.
const PRICE_RE = /(rp\.?\s?\d[\d.,]*)|(\d[\d.,]*\s?(juta|ribu|miliar)\b)/i
const HEDGE_RE = /(bervariasi|tergantung|kisaran|perkiraan|estimasi|tanyakan|survei|vendor|kontraktor|toko|berbeda-beda)/i
const SNI_RE = /\bsni\s*[:\-]?\s*\d/i
// "konsultasi"/"engineer" sengaja ikut: pemeriksaan versi pertama menandai
// jawaban yang SUDAH benar ("konsultasi dengan struktural engineer") sbg
// pelanggaran, hanya karena kosakatanya tak terdaftar.
const EXPERT_RE =
  /(ahli|profesional|insinyur|engineer|arsitek|konsulta(?:n|si)|struktural|tenaga ahli)/i

/**
 * Rujukan ahli hanya WAJIB untuk pertanyaan yang benar-benar menyangkut
 * keselamatan/beban — bukan seluruh topik bertipe `structure`. Versi pertama
 * pemeriksaan ini mewajibkannya untuk semua, sehingga pertanyaan informatif
 * ("atap pelana bentuknya seperti apa?", "baja ringan tahan berapa lama?")
 * ikut tertandai dan melahirkan angka 20% yang menyesatkan.
 */
const SAFETY_CRITICAL_RE =
  /(pondasi|kolom|tiang|balok|sloof|retak|ambruk|roboh|bongkar|potong|pindahkan|tambah lantai|beban|melendut|miring|amblas)/i

function checkAnswer(ans, meta) {
  const priceHit = PRICE_RE.test(ans)
  const safetyCritical =
    (meta.type === "structure" || meta.type === "problem") && SAFETY_CRITICAL_RE.test(meta.q ?? "")
  return {
    empty: !ans || ans.length < 40,
    // pelanggaran harga = menyebut angka TANPA kualifikasi ketidakpastian
    priceFabricated: priceHit && !HEDGE_RE.test(ans),
    sniFabricated: SNI_RE.test(ans),
    safetyCritical,
    // hanya berlaku bila pertanyaannya memang menyangkut keselamatan/beban
    missingExpertRef: safetyCritical && !EXPERT_RE.test(ans),
  }
}

/* ── Self-test detektor (WAJIB jalan sebelum eval) ──
   Pemeriksa yang tak pernah menyala bisa berarti pemeriksanya rusak, dan
   "0 pelanggaran" jadi kabar baik palsu. Kasus sintetis di bawah memaksa
   tiap detektor membuktikan dirinya menyala DAN diam pada saat yang tepat. */
const SELFTEST = [
  ["harga pasti", "Biaya kitchen island granit adalah Rp 12.500.000 sudah termasuk pemasangan penuh.", "room", "apa itu?", "priceFabricated", true],
  ["juta tanpa hedge", "Total pembuatan carport sekitar 25 juta rupiah dengan spesifikasi standar biasa.", "room", "apa itu?", "priceFabricated", true],
  ["angka + hedge", "Biayanya bervariasi, kisaran Rp 5 juta tergantung material dan vendor pilihan Anda.", "room", "apa itu?", "priceFabricated", false],
  ["SNI dikarang", "Ukuran tangga harus mengikuti SNI 03-1733-2004 sesuai standar nasional yang berlaku.", "room", "apa itu?", "sniFabricated", true],
  ["beban-kritis tanpa ahli", "Pondasi footplat cukup ukuran standar saja, aman dua lantai tanpa dihitung lagi.", "structure", "pondasi rumah 2 lantai pakai apa?", "missingExpertRef", true],
  ["beban-kritis dgn ahli", "Untuk pondasi dua lantai, konsultasikan dengan insinyur struktur agar bebannya tepat.", "structure", "pondasi rumah 2 lantai pakai apa?", "missingExpertRef", false],
  ["beban-kritis, kosakata 'engineer'", "Jangan potong tiang itu tanpa konsultasi dengan struktural engineer lebih dulu ya.", "structure", "mau bongkar tiang di tengah ruang", "missingExpertRef", false],
  // informatif → TIDAK boleh menuntut rujukan ahli (sumber angka 20% yang keliru)
  ["struktur tapi informatif", "Atap pelana berbentuk segitiga dengan dua bidang miring yang bertemu di bubungan.", "structure", "atap pelana bentuknya seperti apa?", "missingExpertRef", false],
  ["jawaban kosong", "Maaf.", "room", "apa itu?", "empty", true],
]
for (const [label, text, type, q, key, want] of SELFTEST) {
  const got = checkAnswer(text, { type, q })[key]
  if (got !== want) {
    console.error(`[self-test] DETEKTOR RUSAK: "${label}" → ${key}=${got}, seharusnya ${want}`)
    process.exit(2)
  }
}
console.log(`[self-test] ${SELFTEST.length} kasus detektor OK`)

/* ── Jalankan ── */

const all = readFileSync(path.join(repoRoot, "scripts/asset-harvest/eval-set.jsonl"), "utf8")
  .split("\n").filter(Boolean).map((l) => JSON.parse(l))

// Sampel BERSTRATA per (type, kind) supaya tiap domain terwakili.
const buckets = new Map()
for (const r of all) {
  const k = `${r.type}|${r.kind}`
  ;(buckets.get(k) ?? buckets.set(k, []).get(k)).push(r)
}
const perBucket = Math.max(1, Math.floor(N / buckets.size))
const sample = []
for (const list of buckets.values()) sample.push(...list.slice(0, perBucket))
console.log(`[answer-eval] ${sample.length} pertanyaan (${buckets.size} strata), conc=${CONCURRENCY}`)

let ti = 0
const nextTok = () => TOKENS[ti++ % TOKENS.length]
const results = []
const queue = [...sample]

await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (queue.length) {
    const row = queue.shift()
    if (!row) break
    try {
      const rows = await retrieve(row.q)
      const note = formatNote(rows)
      const { text } = await faucetChat(cfg,
        [{ role: "system", content: systemPrompt(note) }, { role: "user", content: row.q }],
        { maxTokens: 700, temperature: 0.4, token: nextTok(), thinking: "disabled", tries: 8 })
      const ans = (text || "").trim()
      results.push({ ...row, grounded: rows.length > 0, topics: rows.map(r=>r.topic), answer: ans,
        checks: checkAnswer(ans, row) })
      if (results.length % 25 === 0) console.log(`[answer-eval] ${results.length}/${sample.length}`)
    } catch (e) {
      console.error(`[answer-eval] gagal: ${String(e.message).slice(0, 50)}`)
    }
  }
}))

const n = results.length
const cnt = (f) => results.filter(f).length
const structural = results.filter((r) => r.checks.safetyCritical)
console.log(`\n${"=".repeat(60)}\nPEMERIKSAAN DETERMINISTIK (${n} jawaban)`)
console.log(`  jawaban kosong/terpotong : ${cnt(r=>r.checks.empty)} (${Math.round(100*cnt(r=>r.checks.empty)/n)}%)`)
console.log(`  fabrikasi harga          : ${cnt(r=>r.checks.priceFabricated)} (${Math.round(100*cnt(r=>r.checks.priceFabricated)/n)}%)`)
console.log(`  fabrikasi kode SNI       : ${cnt(r=>r.checks.sniFabricated)}`)
console.log(`  ter-grounding            : ${cnt(r=>r.grounded)} (${Math.round(100*cnt(r=>r.grounded)/n)}%)`)
if (structural.length) {
  const miss = structural.filter((r) => r.checks.missingExpertRef).length
  console.log(`  pertanyaan BEBAN-KRITIS  : ${structural.length}, tanpa rujukan ahli: ${miss} (${Math.round(100*miss/structural.length)}%)`)
}
const outPath = path.join(repoRoot, "scripts", "asset-harvest", "out-answer-eval.jsonl")
writeFileSync(outPath, results.map((r) => JSON.stringify(r)).join("\n") + "\n")
console.log(`\nDetail → ${outPath}`)
await pool.end()
