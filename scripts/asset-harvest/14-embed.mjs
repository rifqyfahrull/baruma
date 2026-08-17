/**
 * Tahap 14 — generate embedding semantik tiap aset & simpan ke DB (PRD:
 * semantic asset search). Model LOKAL multilingual (Xenova/multilingual-e5-
 * small, 384-dim) supaya "pagar" (ID) ↔ "gate" (EN) berdekatan di ruang
 * vektor — tanpa API flaky, gratis, deterministik.
 *
 * Storage: tabel asset_embeddings (embedding real[]) — TANPA pgvector
 * (baruma_app bukan superuser; extension diblok). Nearest-neighbor dilakukan
 * brute-force di app (10k×384 ≈ beberapa ms). Migrasi pgvector disiapkan
 * terpisah untuk skala besar nanti.
 *
 * Resumable: lewati aset yang embeddingnya sudah ada utk model sama.
 * Jalankan: node scripts/asset-harvest/14-embed.mjs [--limit=N]
 */
import pg from "pg"
import { readFileSync } from "node:fs"
import path from "node:path"
import { pipeline } from "@huggingface/transformers"
import { loadEnvLocal } from "./_shared.mjs"

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"),
  "..",
  "..",
)
loadEnvLocal(repoRoot)

export const EMBED_MODEL = "Xenova/multilingual-e5-small"
export const EMBED_DIM = 384
const limit = Number((process.argv.find((a) => a.startsWith("--limit=")) || "").split("=")[1]) || Infinity

/** Teks yang di-embed untuk sebuah aset (konvensi e5: prefix "passage:"). */
export function assetEmbedText(a) {
  const parts = [
    a.name,
    a.category,
    a.subcategory,
    a.style_tags?.length ? `style ${a.style_tags.join(" ")}` : "",
    a.material_tags?.length ? `material ${a.material_tags.join(" ")}` : "",
    (a.tags ?? []).slice(0, 10).join(" "),
  ].filter(Boolean)
  return `passage: ${parts.join(". ")}`
}

async function ensureTable(pool) {
  await pool.query(`
    create table if not exists asset_embeddings (
      asset_id   text primary key references user_assets(id) on delete cascade,
      model      text not null,
      embedding  real[] not null,
      updated_at timestamptz not null default now()
    )
  `)
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false, max: 4 })
  await ensureTable(pool)

  const catalog = readFileSync(
    path.join(process.env.HARVEST_DIR || "D:/tmp/glb-harvest", "out", "catalog.jsonl"),
    "utf8",
  )
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
  // catalog.id = full uid; DB id = asset-obj-<uid16>
  const dbId = (uid) => `asset-obj-${uid.slice(0, 16)}`

  const have = new Set(
    (await pool.query(`select asset_id from asset_embeddings where model = $1`, [EMBED_MODEL])).rows.map(
      (r) => r.asset_id,
    ),
  )
  const todo = catalog
    .map((a) => ({ ...a, dbId: dbId(a.id) }))
    .filter((a) => !have.has(a.dbId))
    .slice(0, Number.isFinite(limit) ? limit : undefined)
  console.log(`[embed] ${todo.length} to embed (sudah ${have.size}), model ${EMBED_MODEL}`)
  if (todo.length === 0) {
    await pool.end()
    return
  }

  console.log("[embed] loading model (first run unduh ~110MB)…")
  const extractor = await pipeline("feature-extraction", EMBED_MODEL)

  const BATCH = 32
  let done = 0
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH)
    const texts = batch.map(assetEmbedText)
    const out = await extractor(texts, { pooling: "mean", normalize: true })
    // out.data = Float32Array [batch*dim]; slice per item
    for (let b = 0; b < batch.length; b++) {
      const vec = Array.from(out.data.slice(b * EMBED_DIM, (b + 1) * EMBED_DIM))
      await pool.query(
        `insert into asset_embeddings (asset_id, model, embedding, updated_at)
         values ($1, $2, $3, now())
         on conflict (asset_id) do update set model = excluded.model, embedding = excluded.embedding, updated_at = now()`,
        [batch[b].dbId, EMBED_MODEL, vec],
      )
    }
    done += batch.length
    if (done % 320 === 0 || done === todo.length) console.log(`[embed] ${done}/${todo.length}`)
  }
  await pool.end()
  console.log(`[embed] done ${done}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
