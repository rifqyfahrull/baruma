/**
 * Tahap 49 — upgrade kualitas design_knowledge dgn gpt-5.6-terra, terarah
 * pada topik yang PALING MENENTUKAN menurut riset pasar user
 * (docs/growth-foundry/baruma-market-voice-synthesis.md):
 *   - problem  (24): keluhan sehari-hari — pain paling sering
 *   - process  (18, BARU): budget/urutan/kontraktor — tiga pain teratas riset
 *   - system   (9 terpilih): utilitas yang paling sering ditanya awam
 *
 * Pipeline sesuai rekomendasi riset user sendiri: "DeepSeek for extraction,
 * Terra for final synthesis on top-ranked outputs" — terra dipakai selektif
 * (≈50 topik), bukan massal; fallback ke deepseek bila terra gagal (524/
 * body kosong — terukur ~20% panggilan).
 *
 * Knowledge LAMA di-backup dulu ke out-design-knowledge-backup.json — bahan
 * A/B end-to-end (tahap 50) yang membuktikan upgrade ini benar-benar
 * memperbaiki JAWABAN agent, bukan sekadar mengganti data.
 */
import pg from "pg"
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { faucetChat, loadEnvLocal, loadTokens } from "./_shared.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
loadEnvLocal(repoRoot)
const TOKENS = loadTokens(repoRoot)
const CONCURRENCY = Number(process.env.HARVEST_LLM_CONCURRENCY || 3) // terra rawan 524 — jangan agresif
// Plafon gateway faucet ±15 dtk + laju terra ±100 tok/dtk: completion >~1100
// token SELALU 524 (terukur: schema 8-field @1400 gagal bahkan sekuensial).
// Solusi = pola riset user sendiri: "many small prompts" — tiap topik dipecah
// jadi 2 panggilan terra kecil (≈700 tok), hasil JSON digabung.
const MAX_TOKENS_HALF = 800
const MAX_TOKENS_FALLBACK = 1400 // deepseek cepat — 1 panggilan utuh aman
const TERRA = { baseUrl: "https://freetokenfaucet.com/v1", model: "gpt-5.6-terra" }
const DEEPSEEK = { baseUrl: "https://freetokenfaucet.com/v1", model: "deepseek-v4-flash" }
const BACKUP = path.join(repoRoot, "scripts/asset-harvest/out-design-knowledge-backup.json")

/** system ids paling user-facing (dari pola pertanyaan eval + riset). */
const SYSTEM_PRIORITY = [
  "system:titik-lampu-dan-penempatannya",
  "system:daya-listrik-pln-untuk-rumah-tinggal",
  "system:septic-tank-dan-resapan",
  "system:sumur-bor-vs-pdam",
  "system:water-heater-listrik-vs-gas-vs-solar",
  "system:ac-split-vs-cassette",
  "system:ventilasi-silang-cross-ventilation",
  "system:toren-tandon-air",
  "system:pompa-air-rumah-tangga",
]

const COMMON = `Balas STRICT JSON saja, bahasa Indonesia. Padat tapi DALAM: tiap poin harus actionable & spesifik (bukan generik "sesuaikan kebutuhan").
DILARANG: harga/angka rupiah, persentase pasti, kode SNI, kuantitas material. Itu domain sistem lain.
Konteks: rumah tinggal Indonesia (tropis lembap, kebiasaan lokal, keputusan keluarga).
Job pengguna: menghindari kesalahan besar SEBELUM komit ke vendor — jelaskan trade-off & konsekuensi keputusan, bukan cuma definisi.`

/* Tiap tipe topik = 2 paruh schema. Terra mengerjakan per-paruh (muat di
 * bawah plafon gateway); deepseek fallback mengerjakan gabungan sekaligus. */
const HALVES = {
  problem: [
    `Bentuk: {"gejala":["2-4"],"penyebab_umum":["3-5, urutkan dari paling sering"],"solusi_pasif":["2-4 solusi desain tanpa alat"],"solusi_aktif":["2-4"]}`,
    `Bentuk: {"pencegahan":["2-3"],"trade_off":["2-3 konsekuensi/biaya-kualitatif tiap pilihan solusi"],"kapan_panggil_ahli":["1-3 tanda WAJIB profesional"],"tropical_note":"1 kalimat"}`,
  ],
  process: [
    `Bentuk: {"inti":"2-3 kalimat inti","langkah":["3-6 langkah praktis berurutan"],"jebakan_umum":["3-5 kesalahan nyata yang mahal"]}`,
    `Bentuk: {"trade_off":["2-3 pilihan & konsekuensinya"],"pertanyaan_untuk_vendor":["2-4 pertanyaan konkret ke arsitek/kontraktor"],"kapan_panggil_ahli":["1-3"],"catatan_jujur":"1 kalimat batas ketidakpastian"}`,
  ],
  system: [
    `Bentuk: {"fungsi":"1-2 kalimat","pilihan_umum":["2-4 opsi + kapan tiap opsi unggul"],"pertimbangan":["3-5 faktor penentu"]}`,
    `Bentuk: {"trade_off":["2-3 konsekuensi tiap pilihan"],"kesalahan_umum":["2-4"],"perawatan":["1-3"],"kapan_panggil_ahli":["1-3"],"tropical_note":"1 kalimat"}`,
  ],
}
function headerFor(t) {
  if (t.topic_type === "problem") return `Topik MASALAH rumah: "${t.topic}".\n${COMMON}`
  if (t.topic_type === "process")
    return `Topik PROSES membangun rumah (pemilik awam): "${t.topic}".\n${COMMON}\nTAMBAHAN: PBG/perizinan hanya sbg urutan langkah + arahan "cek dinas setempat" — bukan isi aturan.`
  return `Topik SISTEM/UTILITAS rumah: "${t.topic}".\n${COMMON}`
}
const halvesFor = (t) => HALVES[t.topic_type] ?? HALVES.system
function promptFor(t) {
  // Prompt utuh (kedua paruh digabung) — dipakai fallback deepseek.
  const halves = halvesFor(t)
  const merged = halves.map((h) => h.replace(/^Bentuk: \{/, "").replace(/\}$/, "")).join(",")
  return `${headerFor(t)}\nBentuk: {${merged}}`
}

function extractJson(text) {
  if (!text) return null
  const c = text.replace(/```json\s*/gi, "").replace(/```/g, "").trim()
  const s = c.indexOf("{"), e = c.lastIndexOf("}")
  if (s < 0 || e < 0) return null
  try { return JSON.parse(c.slice(s, e + 1)) } catch { return null }
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false, max: CONCURRENCY + 2 })
await pool.query(readFileSync(path.join(repoRoot, "db/migrations/0029_design_knowledge_process.sql"), "utf8"))

/* Target: problem semua + system prioritas (upgrade), process semua (baru). */
const existing = (await pool.query(
  `select id, topic_type, topic, knowledge from design_knowledge
   where topic_type in ('problem','process') or id = any($1)`,
  [SYSTEM_PRIORITY],
)).rows

// Topik process dari kurasi (cermin daftar di 16-design-knowledge.mjs).
const PROCESS_TOPICS = [
  "Urutan tahapan membangun rumah dari nol", "Desain dulu atau hitung RAB dulu",
  "Perlu arsitek, kontraktor, atau cukup tukang", "Kapan PBG diurus dalam urutan membangun",
  "Membangun rumah bertahap (rumah tumbuh)", "Menyusun brief kebutuhan sebelum bertemu arsitek",
  "Biaya tersembunyi yang sering terlewat saat bangun rumah", "Apa yang dipangkas dulu bila budget kurang",
  "Skenario budget hemat vs target vs aman", "Dampak perubahan desain di tengah pembangunan (change order)",
  "Menerjemahkan referensi Pinterest jadi kebutuhan ruang", "Versi impian vs versi masuk budget",
  "Cara memilih kontraktor yang benar", "Checklist membandingkan proposal kontraktor",
  "Termin pembayaran kontraktor yang aman", "Tanda bahaya (red flag) proposal kontraktor",
  "Mengawasi pembangunan dari jarak jauh", "Serah terima rumah dan garansi pekerjaan",
]
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60)
const haveIds = new Set((await pool.query(`select id from design_knowledge`)).rows.map((r) => r.id))
const newProcess = PROCESS_TOPICS
  .map((topic) => ({ id: `process:${slug(topic)}`, topic_type: "process", topic, knowledge: null }))
  .filter((t) => !haveIds.has(t.id))

const targets = [...existing, ...newProcess]
console.log(`[terra] target: ${existing.length} upgrade (problem+system) + ${newProcess.length} baru (process) = ${targets.length}`)

// Backup knowledge lama SEBELUM ditimpa — bahan A/B tahap 50. Merge dgn
// backup yang sudah ada supaya run ulang tak menimpa baseline asli.
const backup = existsSync(BACKUP) ? JSON.parse(readFileSync(BACKUP, "utf8")) : {}
// Baris process TIDAK pernah masuk backup: baseline pra-upgrade mereka adalah
// "tidak ada topiknya sama sekali" — A/B tahap 50 mengandalkan ketiadaan ini.
for (const t of existing) if (t.topic_type !== "process" && !(t.id in backup)) backup[t.id] = { topic: t.topic, topic_type: t.topic_type, knowledge: t.knowledge }
writeFileSync(BACKUP, JSON.stringify(backup, null, 1))
console.log(`[terra] backup lama: ${Object.keys(backup).length} topik → ${path.basename(BACKUP)}`)

let ti = 0
const tok = () => TOKENS[ti++ % TOKENS.length]
const queue = [...targets]
let done = 0, viaTerra = 0, viaFallback = 0, tokens = 0

await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (queue.length) {
    const t = queue.shift()
    if (!t) break
    let j = null, used = "terra"
    // Terra: 2 panggilan kecil (paruh schema), gabung. Gagal salah satu → fallback.
    try {
      const parts = []
      for (const half of halvesFor(t)) {
        const msgs = [
          { role: "system", content: `${headerFor(t)}\n${half}` },
          { role: "user", content: `Topik: "${t.topic}".` },
        ]
        const r = await faucetChat(TERRA, msgs, { maxTokens: MAX_TOKENS_HALF, temperature: 0.4, tries: 3, token: tok(), thinking: "disabled" })
        tokens += r.usage.total_tokens ?? 0
        const p = extractJson(r.text)
        if (!p) throw new Error("paruh gagal parse")
        parts.push(p)
      }
      j = Object.assign({}, ...parts)
    } catch { j = null }
    if (!j) {
      used = "deepseek-fallback"
      const messages = [{ role: "system", content: promptFor(t) }, { role: "user", content: `Topik: "${t.topic}".` }]
      try {
        const r = await faucetChat(DEEPSEEK, messages, { maxTokens: MAX_TOKENS_FALLBACK, temperature: 0.4, tries: 6, token: tok(), thinking: "disabled" })
        tokens += r.usage.total_tokens ?? 0
        j = extractJson(r.text)
      } catch { /* gagal total */ }
    }
    if (!j) { console.error(`[terra] GAGAL total: ${t.id}`); continue }
    await pool.query(
      `insert into design_knowledge (id, topic_type, topic, knowledge, updated_at)
       values ($1,$2,$3,$4,now())
       on conflict (id) do update set knowledge = excluded.knowledge, updated_at = now()`,
      [t.id, t.topic_type, t.topic, JSON.stringify(j)],
    )
    done++
    if (used === "terra") viaTerra++; else viaFallback++
    if (done % 10 === 0) console.log(`[terra] ${done}/${targets.length} | terra=${viaTerra} fallback=${viaFallback} | tokens=${tokens}`)
  }
}))
await pool.end()
console.log(`[terra] SELESAI ${done}/${targets.length} | via terra: ${viaTerra}, fallback deepseek: ${viaFallback} | tokens=${tokens}`)
