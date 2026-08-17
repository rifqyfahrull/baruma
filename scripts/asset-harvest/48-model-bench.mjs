/**
 * Tahap 48 — benchmark segar 3 model faucet pada BEBAN KERJA ASLI.
 *
 * Angka lama (terra 1/6 sukses, luna 3/6) berumur beberapa hari; kondisi
 * gateway faucet berubah-ubah, jadi keputusan "model mana untuk apa" harus
 * dari pengukuran sekarang, bukan ingatan. Tugas uji = persis format
 * generate design_knowledge (schema-bound JSON, thinking disabled).
 *
 * Ukuran: sukses (JSON valid), latensi, token/panggilan → efisiensi nyata =
 * token per topik JADI (memperhitungkan retry karena gagal).
 */
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadEnvLocal, loadTokens } from "./_shared.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
loadEnvLocal(repoRoot)
const TOKENS = loadTokens(repoRoot)
const BASE = process.env.FAUCET_BASE_URL || "https://freetokenfaucet.com/v1"
const MODELS = ["deepseek-v4-flash", "gpt-5.6-terra", "mimo-v2.5"]
const N = 5

const SYS = `Anda konsultan arsitek Indonesia. Balas STRICT JSON:
{"why_used":["3-5 alasan"],"when_not_to_use":["2-4 kondisi"],"alternatives":["2-4 alternatif"],"tropical_note":"1 kalimat"}
Bahasa Indonesia. DILARANG angka harga/SNI/kuantitas.`
const TOPICS = ["Pergola kayu", "Kanopi carport", "Wastafel countertop", "Pagar besi hollow", "Railing kaca"]

let ti = 0
const tok = () => TOKENS[ti++ % TOKENS.length]

function validJson(text) {
  if (!text) return false
  const s = text.indexOf("{"), e = text.lastIndexOf("}")
  if (s < 0 || e < 0) return false
  try {
    const j = JSON.parse(text.slice(s, e + 1))
    return Array.isArray(j.why_used) && j.why_used.length >= 1
  } catch { return false }
}

async function once(model, topic) {
  const t0 = Date.now()
  try {
    const r = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${tok()}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: SYS }, { role: "user", content: `Topik: "${topic}".` }],
        max_tokens: 1400, temperature: 0.3, thinking: { type: "disabled" },
      }),
    })
    const raw = await r.text()
    const ms = Date.now() - t0
    if (!r.ok) return { ok: false, ms, why: `HTTP ${r.status}`, tk: 0 }
    if (!raw.trim()) return { ok: false, ms, why: "body kosong (gateway timeout)", tk: 0 }
    const d = JSON.parse(raw)
    const content = d.choices?.[0]?.message?.content ?? ""
    const tk = d.usage?.total_tokens ?? 0
    return { ok: validJson(content), ms, why: validJson(content) ? "" : "JSON tak valid", tk }
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, why: String(e.message).slice(0, 40), tk: 0 }
  }
}

console.log(`BENCHMARK SEGAR — ${N} panggilan/model, tugas = generate design_knowledge\n${"=".repeat(66)}`)
for (const model of MODELS) {
  const results = []
  for (let i = 0; i < N; i++) results.push(await once(model, TOPICS[i % TOPICS.length]))
  const ok = results.filter((r) => r.ok)
  const totalTk = results.reduce((a, r) => a + r.tk, 0)
  const avgOkTk = ok.length ? Math.round(ok.reduce((a, r) => a + r.tk, 0) / ok.length) : 0
  // efisiensi nyata: total token terbakar (termasuk yg gagal) per hasil jadi
  const perDone = ok.length ? Math.round(totalTk / ok.length) : Infinity
  console.log(`\n${model}`)
  console.log(`  sukses        : ${ok.length}/${N}`)
  console.log(`  latensi       : ${results.map((r) => (r.ok ? "" : "✗") + (r.ms / 1000).toFixed(1) + "s").join("  ")}`)
  console.log(`  token/sukses  : ${avgOkTk}`)
  console.log(`  token/JADI    : ${perDone === Infinity ? "∞ (nol hasil)" : perDone} (termasuk yang terbuang)`)
  const fails = results.filter((r) => !r.ok)
  if (fails.length) console.log(`  gagal         : ${[...new Set(fails.map((f) => f.why))].join("; ")}`)
}
