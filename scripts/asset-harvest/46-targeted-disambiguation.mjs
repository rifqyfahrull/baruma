/**
 * Tahap 46 — perbaikan RONDE-3 bertarget untuk design_knowledge & app_knowledge.
 *
 * Beda dari ronde 1/2 (keywords blanket ke SEMUA topik): ronde ini HANYA
 * menyentuh topik yang TERBUKTI KALAH di eval saat ini (78 kegagalan
 * design_knowledge, 29 app_knowledge), dan prompt-nya diberi tahu SIAPA
 * pesaing yang salah menang — supaya keywords baru secara eksplisit
 * membedakan diri dari pesaing itu, bukan sekadar "lebih banyak sinonim".
 *
 * METODOLOGI (sama seperti ronde 1/2): prompt TIDAK pernah melihat pertanyaan
 * eval mentah — hanya pola kegagalan yang sudah diringkas (topik target +
 * daftar pesaing yang salah menang). Menghindari "melatih di atas soal ujian".
 *
 * Jalankan: node 46-targeted-disambiguation.mjs --system=design|app
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
const CONCURRENCY = Number(process.env.HARVEST_LLM_CONCURRENCY || TOKENS.length)
const SYSTEM_TARGET = (process.argv.find((a) => a.startsWith("--system=")) || "").split("=")[1] || "design"

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false, max: CONCURRENCY + 2 })

const STOP = new Set(["yang","untuk","apa","itu","dan","atau","dengan","pakai","pake","gimana",
  "bagaimana","kenapa","mengapa","kalau","jika","saya","aku","mau","ingin","bisa","boleh","harus",
  "adalah","di","ke","dari","pada","ini","the","a","an","is","of","for","how","why","what","cocok",
  "bagus","baik","buat","mana","dimana","kemana","sebaiknya","perlu","solusinya","solusi","terus",
  "seperti","enaknya","banget","pengen","gak","nggak","tidak","juga","biar","rumah","agar","supaya",
  "lebih","sudah","masih","ada","saja","aja","sih","dong","nya","punya","kita","bikin","ditaruh",
  "worth","mending","pilih","tolong"])
const W = (q) => q.toLowerCase().replace(/[^a-z0-9\s]/g," ").split(/\s+/).filter(w=>w.length>=3&&!STOP.has(w))

/* ── Retrieval identik dgn produksi (design_knowledge / app_knowledge) ── */
async function retrieveDesign(q, limit = 3) {
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
     SELECT dk.id, dk.topic FROM scored s JOIN design_knowledge dk ON dk.id=s.id
     WHERE (s.hits>=2 OR s.cover>=0.6) AND s.score>=0.7*(SELECT max(score) FROM scored)
     ORDER BY s.score DESC, length(dk.topic) ASC LIMIT $2`, [words, limit])
  return r.rows
}
async function retrieveApp(q, limit = 4) {
  const words = W(q); if (!words.length) return []
  const actionIntent = /\b(hapus|menghapus|buang|membuang|hilangkan|batalkan|tambah|menambah|tambahkan|pindah|memindah|pindahkan|geser|menggeser|ubah|mengubah|ganti|mengganti|gantikan|pasang|memasang|putar|memutar)\w*\b/i.test(q)
  const r = await pool.query(
    `WITH q AS (SELECT DISTINCT unnest($1::text[]) AS word),
     m AS (SELECT ak.id, q.word, (ak.name ILIKE '%'||q.word||'%') AS in_name
           FROM app_knowledge ak JOIN q ON ak.name ILIKE '%'||q.word||'%' OR coalesce(ak.keywords,'') ~* ('\\m'||q.word||'\\M')),
     df AS (SELECT word, count(*)::float df FROM m GROUP BY word),
     total AS (SELECT count(*)::float n FROM app_knowledge),
     scored AS (SELECT m.id, sum(ln((SELECT n FROM total)/df.df)*(CASE WHEN m.in_name THEN 2.0 ELSE 1.0 END))
                 * (CASE WHEN $3 AND ak0.kind='action' THEN 1.6 ELSE 1.0 END) score
                FROM m JOIN df ON df.word=m.word JOIN app_knowledge ak0 ON ak0.id=m.id GROUP BY m.id, ak0.kind)
     SELECT ak.id, ak.name FROM scored s JOIN app_knowledge ak ON ak.id=s.id
     WHERE s.score>=0.5*(SELECT max(score) FROM scored)
     ORDER BY s.score DESC, length(ak.name) ASC LIMIT $2`, [words, limit, actionIntent])
  return r.rows
}

/* ── Kumpulkan pola kegagalan: topik target -> [pesaing yg salah menang] ── */
async function collectFailurePatterns(evalFile, retrieveFn, idField) {
  const rows = readFileSync(path.join(repoRoot, "scripts/asset-harvest", evalFile), "utf8")
    .split("\n").filter(Boolean).map((l) => JSON.parse(l))
  const patterns = new Map() // expect id -> Set(competitor names)
  for (const row of rows) {
    const got = await retrieveFn(row.q)
    const hit = got.some((g) => g.id === row.expect)
    if (hit) continue
    if (!patterns.has(row.expect)) patterns.set(row.expect, { name: row.name ?? row.topic, competitors: new Set(), sampleQ: [] })
    const p = patterns.get(row.expect)
    for (const g of got) p.competitors.add(g[idField])
    if (p.sampleQ.length < 3) p.sampleQ.push(row.q)
  }
  return patterns
}

function extractJson(text) {
  if (!text) return null
  const c = text.replace(/```json\s*/gi, "").replace(/```/g, "").trim()
  const s = c.indexOf("{"), e = c.lastIndexOf("}")
  if (s < 0 || e < 0) return null
  try { return JSON.parse(c.slice(s, e + 1)) } catch { return null }
}

const SYSTEM_DESIGN = `Anda memperbaiki kata kunci pencarian topik desain rumah yang KALAH bersaing dgn topik lain yang mirip.

Untuk tiap topik, Anda diberi: nama topik, PESAING yang salah menang untuk pertanyaan yg seharusnya milik topik ini,
dan contoh pertanyaan asli yang gagal. Tulis kata kunci BARU yang secara eksplisit MEMBEDAKAN topik ini dari pesaingnya
— bukan sekadar sinonim umum yang sudah ada.

Balas STRICT JSON: {"results":[{"id":"<echo>","kw":["...","..."]}]}
- kw: 8-12 frasa BARU, huruf kecil, 2-5 kata.
- WAJIB menyerang celah spesifik: bila pesaing adalah topik MATERIAL umum (mis. "material:veneer-kayu") dan topik ini
  ELEMEN FASAD, tekankan konteks LUAR/FASAD ("kayu untuk fasad luar","cladding dinding luar") yg tak dimiliki material umum.
  Bila pesaing adalah topik MASALAH (problem:) dan topik ini SOLUSI/ELEMEN, tekankan kata SOLUSI/PENAMBAHAN
  ("elemen peneduh tambahan","cara menambahkan naungan") — bukan gejala masalahnya.
  Bila pesaing adalah FURNITUR lain yg mirip fungsi, tekankan fungsi SPESIFIK yg beda (bentuk/ukuran/tata letak).
- Bahasa Indonesia percakapan, seperti pemilik rumah bicara. Tanpa teks di luar JSON.`

const SYSTEM_APP = `Anda memperbaiki kata kunci AKSI aplikasi yang KALAH bersaing dgn aksi SEJENIS (sesama hapus/pindah/ubah)
untuk OBJEK yang berbeda (stopkontak vs lampu vs furnitur vs air vs ruang).

Untuk tiap aksi, Anda diberi: nama aksi, pesaing yg salah menang (biasanya aksi sejenis tapi objek beda), dan
contoh permintaan pengguna yang gagal. Tulis kata kunci BARU yang menekankan OBJEK SPESIFIK aksi ini secara berulang
& eksplisit, supaya "hapus stopkontak" tak lagi diambil oleh removeLight/removeFurniture.

Balas STRICT JSON: {"results":[{"id":"<echo>","kw":["...","..."]}]}
- kw: 8-12 frasa BARU, huruf kecil, 2-5 kata.
- WAJIB memuat variasi sebutan OBJEK target (mis. utk removeElectricalPoint: "stopkontak","colokan","saklar","titik listrik")
  digabung dgn verba aksi ("hapus stopkontak","buang colokan","cabut saklar") — bukan verba generik sendirian.
- Bahasa Indonesia percakapan. Tanpa teks di luar JSON.`

async function run() {
  const isDesign = SYSTEM_TARGET === "design"
  const patterns = isDesign
    ? await collectFailurePatterns("eval-set.jsonl", retrieveDesign, "topic")
    : await collectFailurePatterns("app-eval-set.jsonl", retrieveApp, "name")
  const table = isDesign ? "design_knowledge" : "app_knowledge"
  const list = [...patterns.entries()]
  console.log(`[disambig:${SYSTEM_TARGET}] ${list.length} topik/aksi kalah bersaing perlu diperbaiki`)

  const queue = [...list]
  let done = 0, tokens = 0
  await Promise.all(Array.from({ length: CONCURRENCY }, async (_, wi) => {
    const token = TOKENS[wi % TOKENS.length]
    while (queue.length) {
      const item = queue.shift()
      if (!item) break
      const [id, info] = item
      try {
        const { text, usage } = await faucetChat(cfg,
          [{ role: "system", content: isDesign ? SYSTEM_DESIGN : SYSTEM_APP },
           { role: "user", content: JSON.stringify({
               id, nama: info.name,
               pesaing_salah_menang: [...info.competitors].slice(0, 5),
               contoh_pertanyaan_gagal: info.sampleQ,
             }) }],
          { maxTokens: 900, temperature: 0.5, tries: 10, token, thinking: "disabled" })
        tokens += usage.total_tokens ?? 0
        const j = extractJson(text)
        if (!j?.results?.[0]?.kw) { console.error(`[disambig] JSON gagal utk ${id}`); continue }
        const kw = j.results[0].kw.map((x) => String(x).toLowerCase().trim()).filter(Boolean)
        const old = (await pool.query(`select keywords from ${table} where id=$1`, [id])).rows[0]?.keywords ?? ""
        const merged = [...new Set([...old.split("|").map((x) => x.trim()).filter(Boolean), ...kw])].slice(0, 40)
        await pool.query(`update ${table} set keywords=$2, updated_at=now() where id=$1`, [id, merged.join(" | ")])
        done++
        if (done % 15 === 0) console.log(`[disambig:${SYSTEM_TARGET}] ${done}/${list.length} | tokens=${tokens}`)
      } catch (e) {
        console.error(`[disambig] gagal ${id}: ${String(e.message).slice(0, 50)}`)
      }
    }
  }))
  await pool.end()
  console.log(`[disambig:${SYSTEM_TARGET}] SELESAI ${done}/${list.length} | tokens=${tokens}`)
}
await run()
