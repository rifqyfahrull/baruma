#!/usr/bin/env node
/**
 * Backup harian database Postgres produksi → object storage S3-compatible
 * (RustFS/R2/MinIO — bucket yang sama dipakai untuk upload aset, lihat
 * src/lib/server/storage.ts). Dipanggil oleh cron di droplet (dipasang oleh
 * deploy.yml, lihat komentar di sana) — 19:00 UTC setiap malam.
 *
 * Usage:
 *   DATABASE_URL=... STORAGE_ENDPOINT=... STORAGE_ACCESS_KEY_ID=... \
 *   STORAGE_SECRET_ACCESS_KEY=... STORAGE_BUCKET=... \
 *     node scripts/backup-db.mjs
 *
 * Langkah:
 *   1. pg_dump --format=custom (via child_process, sama seperti CLI dump
 *      manual) ke file sementara.
 *   2. Gzip file itu (sesuai penamaan target `backups/db/<date>.dump.gz` —
 *      custom-format pg_dump sudah terkompresi zlib secara internal, gzip
 *      tambahan ini kecil overhead-nya tapi menjaga penamaan/ekspektasi
 *      konsisten dengan yang diminta operasional).
 *   3. Upload ke S3 di bawah key `backups/db/<YYYY-MM-DD>.dump.gz` (helper
 *      murni di backup-db-lib.mjs, diuji terpisah — lihat
 *      src/lib/server/backup-db-lib.test.ts).
 *   4. List objek di bawah prefix itu, hapus yang lebih tua dari 14 hari
 *      (retensi) — juga lewat helper murni yang sama.
 *
 * TIDAK memakai AWS CLI (belum tentu terpasang di droplet) — hanya aws4fetch
 * (dependency app yang sudah ada) untuk signing S3 SigV4, sama seperti
 * scripts/sync-catalog-models.mjs.
 */
import { spawn } from "node:child_process"
import { createReadStream, createWriteStream, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { createGzip } from "node:zlib"
import { tmpdir } from "node:os"
import path from "node:path"
import { pipeline } from "node:stream/promises"
import { fileURLToPath } from "node:url"

import { AwsClient } from "aws4fetch"

import { backupKeyFor, BACKUP_KEY_PREFIX, keysToDelete } from "./backup-db-lib.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..")
const RETENTION_DAYS = 14

loadEnvFile(path.join(repoRoot, ".env"))
loadEnvFile(path.join(repoRoot, ".env.local"))

function loadEnvFile(file) {
  if (!existsSync(file)) return
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const idx = trimmed.indexOf("=")
    if (idx <= 0) continue
    const key = trimmed.slice(0, idx).trim()
    let value = trimmed.slice(idx + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    process.env[key] ??= value
  }
}

function storageConfig() {
  const endpoint = process.env.STORAGE_ENDPOINT
  const accessKeyId = process.env.STORAGE_ACCESS_KEY_ID || process.env.STORAGE_ACCESS_KEY
  const secretAccessKey = process.env.STORAGE_SECRET_ACCESS_KEY || process.env.STORAGE_SECRET_KEY
  const bucket = process.env.STORAGE_BUCKET
  const missing = Object.entries({
    STORAGE_ENDPOINT: endpoint,
    "STORAGE_ACCESS_KEY(_ID)": accessKeyId,
    "STORAGE_SECRET(_ACCESS)_KEY": secretAccessKey,
    STORAGE_BUCKET: bucket,
  })
    .filter(([, v]) => !v)
    .map(([k]) => k)
  if (missing.length) throw new Error(`Missing storage env: ${missing.join(", ")}`)
  const client = new AwsClient({ accessKeyId, secretAccessKey, region: process.env.STORAGE_REGION || "auto", service: "s3" })
  return { client, endpoint: endpoint.replace(/\/$/, ""), bucket }
}

function objectUrl(cfg, key) {
  return `${cfg.endpoint}/${cfg.bucket}/${key}`
}

/** pg_dump --format=custom ke `outFile`. Pesan jelas bila binary tak ada di PATH. */
async function pgDumpToFile(databaseUrl, outFile) {
  await new Promise((resolve, reject) => {
    const child = spawn("pg_dump", ["--format=custom", "--file", outFile, databaseUrl], {
      stdio: ["ignore", "inherit", "pipe"],
    })
    let stderr = ""
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString()
      process.stderr.write(chunk)
    })
    child.on("error", (err) => {
      if (err.code === "ENOENT") {
        reject(
          new Error(
            "pg_dump tidak ditemukan di PATH. Install postgresql-client di droplet " +
              "(mis. `apt-get install -y postgresql-client`) sebelum backup bisa jalan."
          )
        )
        return
      }
      reject(err)
    })
    child.on("close", (code) => {
      if (code === 0) resolve()
      else reject(new Error(`pg_dump keluar dengan kode ${code}: ${stderr.slice(0, 500)}`))
    })
  })
}

async function gzipFile(inFile, outFile) {
  await pipeline(createReadStream(inFile), createGzip(), createWriteStream(outFile))
}

/** ListObjectsV2 di bawah prefix, kembalikan `{key, lastModified}[]` (parsing XML minimal). */
async function listBackupObjects(cfg) {
  const url = new URL(`${cfg.endpoint}/${cfg.bucket}`)
  url.searchParams.set("list-type", "2")
  url.searchParams.set("prefix", `${BACKUP_KEY_PREFIX}/`)
  const res = await cfg.client.fetch(url.toString(), { method: "GET" })
  if (!res.ok) {
    throw new Error(`ListObjectsV2 gagal: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`)
  }
  const xml = await res.text()
  const objects = []
  // Parsing XML minimal (tanpa dependency tambahan) — cukup untuk struktur
  // ListObjectsV2 standar S3 (<Contents><Key>..</Key><LastModified>..</LastModified></Contents>).
  for (const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const block = match[1]
    const key = /<Key>([\s\S]*?)<\/Key>/.exec(block)?.[1]
    const lastModified = /<LastModified>([\s\S]*?)<\/LastModified>/.exec(block)?.[1]
    if (key && lastModified) {
      objects.push({ key: decodeXmlEntities(key), lastModified: new Date(lastModified) })
    }
  }
  return objects
}

function decodeXmlEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

async function deleteObject(cfg, key) {
  const res = await cfg.client.fetch(objectUrl(cfg, key), { method: "DELETE" })
  // S3 DELETE is idempotent and typically returns 204 even if the key is
  // already gone — only treat genuine 4xx/5xx (other than 404) as failure.
  if (!res.ok && res.status !== 404) {
    throw new Error(`Delete ${key} gagal: HTTP ${res.status}`)
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    console.error("[backup-db] DATABASE_URL tidak diset")
    process.exit(1)
  }

  const cfg = storageConfig()
  const now = new Date()
  const key = backupKeyFor(now)

  const tmpDir = mkdtempSync(path.join(tmpdir(), "baruma-backup-"))
  const dumpFile = path.join(tmpDir, "db.dump")
  const gzFile = path.join(tmpDir, "db.dump.gz")

  try {
    console.log(`[backup-db] pg_dump -> ${dumpFile}`)
    await pgDumpToFile(databaseUrl, dumpFile)

    console.log(`[backup-db] gzip -> ${gzFile}`)
    await gzipFile(dumpFile, gzFile)

    const body = readFileSync(gzFile)
    console.log(`[backup-db] upload ${(body.length / 1024 / 1024).toFixed(2)} MB -> ${key}`)
    const putRes = await cfg.client.fetch(objectUrl(cfg, key), {
      method: "PUT",
      body,
      headers: { "Content-Type": "application/gzip", "x-amz-acl": "private" },
    })
    if (!putRes.ok) {
      throw new Error(`Upload backup gagal: HTTP ${putRes.status} ${(await putRes.text()).slice(0, 300)}`)
    }
    console.log(`[backup-db] uploaded ${key}`)

    console.log(`[backup-db] retention: hapus backup > ${RETENTION_DAYS} hari`)
    const objects = await listBackupObjects(cfg)
    const stale = keysToDelete(objects, now, RETENTION_DAYS)
    for (const staleKey of stale) {
      await deleteObject(cfg, staleKey)
      console.log(`[backup-db] deleted stale backup ${staleKey}`)
    }
    console.log(`[backup-db] done — ${stale.length} backup lama dihapus, ${objects.length - stale.length} dipertahankan`)
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

main().catch((e) => {
  console.error("[backup-db] error:", e?.message ?? e)
  process.exit(1)
})
