/**
 * Tahap 13 — upload preview WebP ke storage + set thumbnail_url di DB.
 * WebP → asset-library/objaverse/thumbnails/<uid>.webp (cocok
 * ASSET_FILE_KEY_RE yang sudah diperluas). thumbnail_url =
 * /api/v1/assets/file/<key> (disajikan proxy dgn content-type image/webp).
 * Resumable: lewati yang thumbnail_url-nya sudah terisi ke key sama.
 *
 * Jalankan: node scripts/asset-harvest/13-upload-previews.mjs [--conc=10] [--limit=N]
 */
import { AwsClient } from "aws4fetch"
import pg from "pg"
import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { loadEnvLocal, OUT_DIR } from "./_shared.mjs"

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"),
  "..",
  "..",
)
loadEnvLocal(repoRoot)

const PREVIEW_DIR = path.join(OUT_DIR, "previews")
const KEY_PREFIX = "asset-library/objaverse/thumbnails"
const conc = Number((process.argv.find((a) => a.startsWith("--conc=")) || "").split("=")[1]) || 10
const limit = Number((process.argv.find((a) => a.startsWith("--limit=")) || "").split("=")[1]) || Infinity

function storage() {
  const endpoint = process.env.STORAGE_ENDPOINT
  const bucket = process.env.STORAGE_BUCKET || "baruma"
  const ak = process.env.STORAGE_ACCESS_KEY_ID || process.env.STORAGE_ACCESS_KEY
  const sk = process.env.STORAGE_SECRET_ACCESS_KEY || process.env.STORAGE_SECRET_KEY
  if (!endpoint || !ak || !sk) throw new Error("storage creds missing")
  return {
    endpoint,
    bucket,
    client: new AwsClient({ accessKeyId: ak, secretAccessKey: sk, region: process.env.STORAGE_REGION || "auto", service: "s3" }),
  }
}

async function put(s, key, body, contentType) {
  const signed = await s.client.sign(
    new Request(`${s.endpoint}/${s.bucket}/${key}`, {
      method: "PUT",
      headers: { "Content-Type": contentType, "x-amz-acl": "private" },
    }),
    { aws: { signQuery: true } },
  )
  const r = await fetch(signed.url, { method: "PUT", headers: { "Content-Type": contentType, "x-amz-acl": "private" }, body })
  if (!r.ok) throw new Error(`PUT ${r.status}`)
}

async function main() {
  const s = storage()
  // Pool (bukan Client tunggal): worker konkuren tak boleh berbagi 1 koneksi
  // untuk query paralel (pg: "already executing a query").
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false, max: conc + 2 })

  // Peta id catalog (asset-obj-<uid16>) → uid file preview. File preview
  // dinamai <catalog.id>.webp (lihat 12-render), jadi langsung.
  const files = readdirSync(PREVIEW_DIR)
    .filter((f) => f.endsWith(".webp"))
    .filter((f) => statSync(path.join(PREVIEW_DIR, f)).size > 0)
  // File preview dinamai FULL uid (catalog.id); DB id = asset-obj-<uid16>
  // (lihat 09-migration). Peta: fullUid → {dbId, key}.
  const dbIdOf = (fullUid) => `asset-obj-${fullUid.slice(0, 16)}`
  // Lewati yang DB-nya sudah punya thumbnail_url.
  const have = new Set(
    (await pool.query(
      `select id from user_assets where source_name = $1 and thumbnail_url is not null`,
      ["Objaverse (Sketchfab CC)"],
    )).rows.map((r) => r.id),
  )
  const todo = files
    .map((f) => f.replace(/\.webp$/, ""))
    .filter((fullUid) => !have.has(dbIdOf(fullUid)))
    .slice(0, Number.isFinite(limit) ? limit : undefined)
  console.log(`[preview-up] ${todo.length} to upload (sudah ${have.size}), conc=${conc}`)

  let ok = 0
  let fail = 0
  let processed = 0
  const queue = [...todo]
  await Promise.all(
    Array.from({ length: conc }, async () => {
      while (queue.length) {
        const fullUid = queue.shift()
        if (!fullUid) break
        processed++
        const key = `${KEY_PREFIX}/${fullUid}.webp`
        const local = path.join(PREVIEW_DIR, `${fullUid}.webp`)
        try {
          await put(s, key, readFileSync(local), "image/webp")
          const res = await pool.query(
            `update user_assets set thumbnail_url = $2, updated_at = now() where id = $1`,
            [dbIdOf(fullUid), `/api/v1/assets/file/${key}`],
          )
          if (res.rowCount === 0) throw new Error(`no DB row for ${dbIdOf(fullUid)}`)
          ok++
        } catch (e) {
          fail++
          if (fail % 20 === 0) console.error(`[preview-up] fail #${fail}: ${id} ${String(e.message).slice(0, 50)}`)
        }
        if (processed % 300 === 0) console.log(`[preview-up] ${processed}/${todo.length} ok=${ok} fail=${fail}`)
      }
    }),
  )
  await pool.end()
  console.log(`[preview-up] done ok=${ok} fail=${fail}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
