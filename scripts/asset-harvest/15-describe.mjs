/**
 * Tahap 15 — enrichment per-aset via DeepSeek faucet (budget 5jt token / 2
 * hari): deskripsi Indonesia natural + use-case + ruangan cocok + kata kunci
 * dwibahasa untuk TIAP aset katalog. Ini "makanan otak" retrieval: search &
 * agent menemukan aset by-makna, dan teks kaya ini jadi bahan embedding v2.
 *
 * Prinsip pemakaian token yang dipegang:
 *  - Volume di sini (±9.9k aset) memang butuh LLM — bukan pengetahuan kecil
 *    yang bisa ditulis tangan.
 *  - Murni kualitatif (deskripsi/kata kunci) — LLM andal; TIDAK menghasilkan
 *    angka otoritatif (harga/SNI/kuantitas BOM) yang rawan halusinasi.
 *  - Prioritas kategori P0 dulu (facade/gate/window/fence/door) → kalau token
 *    habis di tengah, cakupan paling bernilai sudah selesai.
 *
 * Output: tabel asset_knowledge (+ resumable dari sana), usage ke
 * out/describe-usage.json. Round-robin token (tokens.txt), batch kecil di
 * bawah gateway-timeout ~15s.
 *
 * Jalankan: node scripts/asset-harvest/15-describe.mjs [--limit=N] [--batch=4]
 */
import pg from "pg"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { faucetConfig, faucetChat, loadEnvLocal, loadTokens, OUT_DIR } from "./_shared.mjs"

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"),
  "..",
  "..",
)
loadEnvLocal(repoRoot)

const args = process.argv.slice(2)
const limit = Number((args.find((a) => a.startsWith("--limit=")) || "").split("=")[1]) || Infinity
const batchSize = Number((args.find((a) => a.startsWith("--batch=")) || "").split("=")[1]) || 4
const TOKENS = loadTokens(repoRoot)
const CONCURRENCY = Number(process.env.HARVEST_LLM_CONCURRENCY || TOKENS.length)
const USAGE = path.join(OUT_DIR, "describe-usage.json")

// Urutan prioritas kategori — P0 PRD dulu.
const CATEGORY_PRIORITY = [
  "facade", "gate", "window", "fence", "door",
  "arch_element", "kitchen", "sanitary", "bedroom",
  "seating", "table", "lighting", "decor",
]

const SYSTEM_PROMPT = `Anda penulis metadata katalog aset 3D untuk platform desain rumah Indonesia (Baruma).
Untuk TIAP item (id + name + category + tags/style/material), tulis metadata pencarian dwibahasa.
Balas STRICT JSON saja: {"results":[{"id":"<echo persis>","desc":"...","use":"...","rooms":[...],"kw":[...]}]}
- desc: 1-2 kalimat bahasa Indonesia natural menggambarkan aset (jenis, gaya, material/warna bila tersirat dari nama/tag). Jangan mengarang detail yang tak ada.
- use: 1 kalimat kapan/di mana aset ini cocok dipakai di rumah.
- rooms: ruangan/area cocok, pilih dari: kamar_tidur, kamar_mandi, dapur, ruang_tamu, ruang_keluarga, ruang_makan, teras, fasad, taman, carport, balkon, area_umum.
- kw: 6-10 kata kunci pencarian gabungan Indonesia+Inggris (mis. "gerbang","pagar","gate","besi","minimalis"). lowercase.`

function extractJson(text) {
  if (!text) return null
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```/g, "").trim()
  const start = cleaned.indexOf("{")
  const end = cleaned.lastIndexOf("}")
  if (start < 0 || end < 0) return null
  try {
    return JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    return null
  }
}

function loadUsage() {
  if (existsSync(USAGE)) {
    try {
      return JSON.parse(readFileSync(USAGE, "utf8"))
    } catch {
      /* ignore */
    }
  }
  return { calls: 0, totalTokens: 0, described: 0 }
}

async function main() {
  const cfg = faucetConfig()
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false, max: CONCURRENCY + 2 })
  await pool.query(`
    create table if not exists asset_knowledge (
      asset_id       text primary key references user_assets(id) on delete cascade,
      description_id text,
      use_case       text,
      room_types     jsonb default '[]',
      keywords       text,
      raw            jsonb,
      updated_at     timestamptz not null default now()
    )
  `)

  const catalog = readFileSync(
    path.join(process.env.HARVEST_DIR || "D:/tmp/glb-harvest", "out", "catalog.jsonl"),
    "utf8",
  )
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
  const dbId = (uid) => `asset-obj-${uid.slice(0, 16)}`

  const have = new Set((await pool.query(`select asset_id from asset_knowledge`)).rows.map((r) => r.asset_id))
  const prio = (c) => {
    const i = CATEGORY_PRIORITY.indexOf(c.category)
    return i < 0 ? 99 : i
  }
  const todo = catalog
    .map((a) => ({ ...a, dbId: dbId(a.id) }))
    .filter((a) => !have.has(a.dbId))
    .sort((a, b) => prio(a) - prio(b))
    .slice(0, Number.isFinite(limit) ? limit : undefined)
  console.log(`[describe] ${todo.length} to describe (sudah ${have.size}), batch=${batchSize}, conc=${CONCURRENCY} token=${TOKENS.length}`)

  const usage = loadUsage()
  const batches = []
  for (let i = 0; i < todo.length; i += batchSize) batches.push(todo.slice(i, i + batchSize))
  const byId = new Map(todo.map((a) => [a.dbId, a]))

  let processed = 0
  const queue = [...batches]
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async (_, wi) => {
      const token = TOKENS[wi % TOKENS.length]
      while (queue.length) {
        const batch = queue.shift()
        if (!batch) break
        const items = batch.map((a) => ({
          id: a.dbId,
          name: a.canonical_name,
          category: a.category,
          sub: a.subcategory || undefined,
          style: a.style_tags?.length ? a.style_tags : undefined,
          material: a.material_tags?.length ? a.material_tags : undefined,
          tags: (a.tags ?? []).slice(0, 8),
        }))
        try {
          const { text, usage: u } = await faucetChat(
            cfg,
            [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: `Tulis metadata untuk ${items.length} item:\n${JSON.stringify(items)}` },
            ],
            { maxTokens: 2600, temperature: 0.3, tries: 12, token, thinking: "disabled" },
          )
          usage.calls++
          usage.totalTokens += u.total_tokens ?? 0
          const results = extractJson(text)?.results ?? []
          for (const r of results) {
            if (!byId.has(r.id)) continue
            const kw = Array.isArray(r.kw) ? r.kw.map(String).slice(0, 12).join(" ") : ""
            await pool.query(
              `insert into asset_knowledge (asset_id, description_id, use_case, room_types, keywords, raw, updated_at)
               values ($1,$2,$3,$4,$5,$6,now())
               on conflict (asset_id) do update set description_id=excluded.description_id, use_case=excluded.use_case,
                 room_types=excluded.room_types, keywords=excluded.keywords, raw=excluded.raw, updated_at=now()`,
              [
                r.id,
                String(r.desc ?? "").slice(0, 600),
                String(r.use ?? "").slice(0, 300),
                JSON.stringify(Array.isArray(r.rooms) ? r.rooms.slice(0, 8) : []),
                kw,
                JSON.stringify(r),
              ],
            )
            usage.described++
          }
          processed += batch.length
          if (usage.calls % 10 === 0) {
            writeFileSync(USAGE, JSON.stringify(usage, null, 2))
            console.log(`[describe] ${processed}/${todo.length} | described=${usage.described} | tokens=${usage.totalTokens}`)
          }
        } catch (e) {
          console.error(`[describe] batch failed: ${String(e.message).slice(0, 60)}`)
        }
      }
    }),
  )
  writeFileSync(USAGE, JSON.stringify(usage, null, 2))
  await pool.end()
  console.log(`[describe] done. described=${usage.described} calls=${usage.calls} tokens=${usage.totalTokens}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
