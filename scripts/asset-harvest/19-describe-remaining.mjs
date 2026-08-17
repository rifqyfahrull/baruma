/**
 * Tahap 19 — tuntaskan enrichment: enrich SEMUA aset publik yang belum punya
 * asset_knowledge, bersumber langsung dari tabel user_assets (bukan
 * catalog.jsonl). Menyapu dua sisa:
 *   - ±15 aset harvest yang gagal parse berulang di tahap 15
 *   - ±263 aset ASLI app (furnitur SKP→GLB, rumah) yang di luar katalog Objaverse
 * Tujuan: cakupan mendekati 100% supaya search & agent konsisten utk semua aset.
 *
 * Prompt & tabel sama dgn tahap 15 (kualitatif murni, tanpa angka otoritatif).
 * thinking OFF + konkurensi tinggi (per bukti tahap 15: itu unlock throughput).
 */
import pg from "pg"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { faucetConfig, faucetChat, loadEnvLocal, loadTokens } from "./_shared.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
loadEnvLocal(repoRoot)

const args = process.argv.slice(2)
const batchSize = Number((args.find((a) => a.startsWith("--batch=")) || "").split("=")[1]) || 3
const TOKENS = loadTokens(repoRoot)
const CONCURRENCY = Number(process.env.HARVEST_LLM_CONCURRENCY || TOKENS.length)

const SYSTEM_PROMPT = `Anda penulis metadata katalog aset 3D untuk platform desain rumah Indonesia (Baruma).
Untuk TIAP item (id + name + category + tags/style/material), tulis metadata pencarian dwibahasa.
Balas STRICT JSON saja: {"results":[{"id":"<echo persis>","desc":"...","use":"...","rooms":[...],"kw":[...]}]}
- desc: 1-2 kalimat bahasa Indonesia natural menggambarkan aset (jenis, gaya, material/warna bila tersirat dari nama/tag). Jangan mengarang detail yang tak ada.
- use: 1 kalimat kapan/di mana aset ini cocok dipakai di rumah.
- rooms: ruangan/area cocok, pilih dari: kamar_tidur, kamar_mandi, dapur, ruang_tamu, ruang_keluarga, ruang_makan, teras, fasad, taman, carport, balkon, area_umum.
- kw: 6-10 kata kunci pencarian gabungan Indonesia+Inggris. lowercase.`

function extractJson(text) {
  if (!text) return null
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```/g, "").trim()
  const s = cleaned.indexOf("{"), e = cleaned.lastIndexOf("}")
  if (s < 0 || e < 0) return null
  try { return JSON.parse(cleaned.slice(s, e + 1)) } catch { return null }
}

async function main() {
  const cfg = faucetConfig()
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false, max: CONCURRENCY + 2 })
  const rows = (await pool.query(
    `select ua.id, ua.name, ua.category, ua.style_tags, ua.material_tags, ua.color_tags
     from user_assets ua
     where ua.is_public = true
       and not exists (select 1 from asset_knowledge ak where ak.asset_id = ua.id)`,
  )).rows
  console.log(`[remaining] ${rows.length} aset publik belum ter-enrich, batch=${batchSize}, conc=${CONCURRENCY}, token=${TOKENS.length}`)
  if (!rows.length) { await pool.end(); return }

  const byId = new Map(rows.map((r) => [r.id, r]))
  const batches = []
  for (let i = 0; i < rows.length; i += batchSize) batches.push(rows.slice(i, i + batchSize))
  const queue = [...batches]
  let done = 0, tokens = 0

  await Promise.all(Array.from({ length: CONCURRENCY }, async (_, wi) => {
    const token = TOKENS[wi % TOKENS.length]
    while (queue.length) {
      const batch = queue.shift()
      if (!batch) break
      const items = batch.map((a) => ({
        id: a.id, name: a.name, category: a.category,
        style: a.style_tags?.length ? a.style_tags : undefined,
        material: a.material_tags?.length ? a.material_tags : undefined,
        color: a.color_tags?.length ? a.color_tags : undefined,
      }))
      try {
        const { text, usage } = await faucetChat(cfg,
          [{ role: "system", content: SYSTEM_PROMPT },
           { role: "user", content: `Tulis metadata untuk ${items.length} item:\n${JSON.stringify(items)}` }],
          { maxTokens: 2200, temperature: 0.3, tries: 10, token, thinking: "disabled" })
        tokens += usage.total_tokens ?? 0
        for (const r of extractJson(text)?.results ?? []) {
          if (!byId.has(r.id)) continue
          await pool.query(
            `insert into asset_knowledge (asset_id, description_id, use_case, room_types, keywords, raw, updated_at)
             values ($1,$2,$3,$4,$5,$6,now())
             on conflict (asset_id) do update set description_id=excluded.description_id, use_case=excluded.use_case,
               room_types=excluded.room_types, keywords=excluded.keywords, raw=excluded.raw, updated_at=now()`,
            [r.id, String(r.desc ?? "").slice(0, 600), String(r.use ?? "").slice(0, 300),
             JSON.stringify(Array.isArray(r.rooms) ? r.rooms.slice(0, 8) : []),
             Array.isArray(r.kw) ? r.kw.map(String).slice(0, 12).join(" ") : "", JSON.stringify(r)])
          done++
        }
        if (done % 30 < batchSize) console.log(`[remaining] done=${done}/${rows.length} tokens=${tokens}`)
      } catch (e) {
        console.error(`[remaining] batch failed: ${String(e.message).slice(0, 50)}`)
      }
    }
  }))
  await pool.end()
  console.log(`[remaining] done=${done}/${rows.length} tokens=${tokens}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
