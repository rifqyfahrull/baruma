/**
 * Tahap 8 — upload GLB accepted ke object storage (RustFS/S3), langsung ke
 * prefix katalog global `asset-library/objaverse/furniture/<uid>.glb`
 * (bukan lewat proxy app yang menolak tulis ke asset-library). Signed PUT via
 * aws4fetch. Resumable: HEAD dulu, lewati yang sudah ada berukuran sama.
 *
 * Kunci HARUS cocok ASSET_FILE_KEY_RE app:
 *   asset-library/<word>/(buildings|furniture)/<name>.glb
 * → dipakai `asset-library/objaverse/furniture/<uid>.glb` (uid = hex).
 *
 * Env (dari .env.local / environment):
 *   STORAGE_ENDPOINT, STORAGE_BUCKET (default "baruma"),
 *   STORAGE_ACCESS_KEY_ID | STORAGE_ACCESS_KEY,
 *   STORAGE_SECRET_ACCESS_KEY | STORAGE_SECRET_KEY
 *
 * Jalankan: node scripts/asset-harvest/08-upload.mjs [--conc=8] [--limit=N]
 */
import { AwsClient } from "aws4fetch"
import { appendFileSync, existsSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { ensureDirs, loadEnvLocal, OUT_DIR, RAW_DIR } from "./_shared.mjs"

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"),
  "..",
  "..",
)
loadEnvLocal(repoRoot)

const DOWNLOADED = path.join(OUT_DIR, "downloaded.jsonl")
const CATALOG = path.join(OUT_DIR, "catalog.jsonl")
const UPLOADED = path.join(OUT_DIR, "uploaded.jsonl")
const KEY_PREFIX = "asset-library/objaverse/furniture"

const conc = Number((process.argv.find((a) => a.startsWith("--conc=")) || "").split("=")[1]) || 8
const limit = Number((process.argv.find((a) => a.startsWith("--limit=")) || "").split("=")[1]) || Infinity
// Default: upload HANYA aset yang ada di catalog.jsonl (set final accepted —
// 06-catalog sudah memangkas yang enrichment-irrelevant). --all = semua yang
// terunduh, abaikan catalog.
const uploadAll = process.argv.includes("--all")

function storage() {
  const endpoint = process.env.STORAGE_ENDPOINT
  const bucket = process.env.STORAGE_BUCKET || "baruma"
  const ak = process.env.STORAGE_ACCESS_KEY_ID || process.env.STORAGE_ACCESS_KEY
  const sk = process.env.STORAGE_SECRET_ACCESS_KEY || process.env.STORAGE_SECRET_KEY
  if (!endpoint || !ak || !sk) throw new Error("storage creds missing (STORAGE_ENDPOINT / *_ACCESS_KEY / *_SECRET_KEY)")
  return {
    endpoint,
    bucket,
    client: new AwsClient({ accessKeyId: ak, secretAccessKey: sk, region: process.env.STORAGE_REGION || "auto", service: "s3" }),
  }
}

function loadDone() {
  const done = new Set()
  if (existsSync(UPLOADED)) {
    for (const l of readFileSync(UPLOADED, "utf8").split("\n")) {
      if (!l.trim()) continue
      try {
        done.add(JSON.parse(l).uid)
      } catch {
        /* ignore */
      }
    }
  }
  return done
}

async function headSize(s, key) {
  try {
    const signed = await s.client.sign(new Request(`${s.endpoint}/${s.bucket}/${key}`, { method: "HEAD" }), { aws: { signQuery: true } })
    const r = await fetch(signed.url, { method: "HEAD" })
    if (r.ok) return Number(r.headers.get("content-length") || "0")
  } catch {
    /* ignore */
  }
  return -1
}

async function put(s, key, body) {
  const signed = await s.client.sign(
    new Request(`${s.endpoint}/${s.bucket}/${key}`, {
      method: "PUT",
      headers: { "Content-Type": "model/gltf-binary", "x-amz-acl": "private" },
    }),
    { aws: { signQuery: true } },
  )
  const r = await fetch(signed.url, { method: "PUT", headers: { "Content-Type": "model/gltf-binary", "x-amz-acl": "private" }, body })
  if (!r.ok) throw new Error(`PUT ${r.status}`)
}

async function main() {
  ensureDirs()
  const s = storage()
  const done = loadDone()
  const rows = readFileSync(DOWNLOADED, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
  // Scope ke set accepted (catalog) kecuali --all. catalog.id === uid.
  let allow = null
  if (!uploadAll && existsSync(CATALOG)) {
    allow = new Set(readFileSync(CATALOG, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).id))
    console.log(`[upload] scope ke catalog (accepted/relevant): ${allow.size} aset`)
  } else {
    console.log(`[upload] scope: SEMUA terunduh (${rows.length})`)
  }
  const todo = rows
    .filter((r) => !done.has(r.uid) && (!allow || allow.has(r.uid)))
    .slice(0, Number.isFinite(limit) ? limit : undefined)
  console.log(`[upload] ${todo.length} to upload (done ${done.size}), bucket=${s.bucket}, conc=${conc}`)

  let ok = done.size
  let skip = 0
  let fail = 0
  let processed = 0
  const queue = [...todo]
  await Promise.all(
    Array.from({ length: conc }, async () => {
      while (queue.length) {
        const r = queue.shift()
        if (!r) break
        processed++
        const local = path.join(RAW_DIR, r.file)
        const key = `${KEY_PREFIX}/${r.uid}.glb`
        try {
          const localSize = statSync(local).size
          const remoteSize = await headSize(s, key)
          if (remoteSize === localSize) {
            skip++
          } else {
            await put(s, key, readFileSync(local))
          }
          appendFileSync(UPLOADED, JSON.stringify({ uid: r.uid, key, sizeBytes: localSize }) + "\n")
          ok++
        } catch (e) {
          fail++
          if (fail % 20 === 0) console.error(`[upload] fail #${fail}: ${r.uid} ${e.message}`)
        }
        if (processed % 200 === 0) console.log(`[upload] ${processed}/${todo.length} ok=${ok} skip=${skip} fail=${fail}`)
      }
    }),
  )
  console.log(`[upload] done ok=${ok} skip(existing)=${skip} fail=${fail}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
