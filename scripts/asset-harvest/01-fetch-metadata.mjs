/**
 * Tahap 1 — unduh metadata Objaverse: 160 chunk (metadata/000-000..000-159,
 * ±5000 objek/chunk) + object-paths.json.gz (peta uid → path GLB).
 * Idempotent: chunk yang sudah ada & non-kosong dilewati.
 *
 * Jalankan: node scripts/asset-harvest/01-fetch-metadata.mjs
 */
import { createWriteStream, existsSync, statSync } from "node:fs"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import path from "node:path"
import { ensureDirs, fetchWithRetry, HF_BASE, META_DIR } from "./_shared.mjs"

const CHUNKS = Array.from({ length: 160 }, (_, i) => `000-${String(i).padStart(3, "0")}`)
const CONCURRENCY = 6

async function downloadTo(url, dest) {
  if (existsSync(dest) && statSync(dest).size > 0) return "skip"
  const res = await fetchWithRetry(url)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest))
  return "ok"
}

async function main() {
  ensureDirs()
  const jobs = [
    { url: `${HF_BASE}/object-paths.json.gz`, dest: path.join(META_DIR, "object-paths.json.gz") },
    ...CHUNKS.map((c) => ({
      url: `${HF_BASE}/metadata/${c}.json.gz`,
      dest: path.join(META_DIR, `${c}.json.gz`),
    })),
  ]
  let done = 0
  let skipped = 0
  const queue = [...jobs]
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length) {
        const job = queue.shift()
        if (!job) break
        try {
          const r = await downloadTo(job.url, job.dest)
          if (r === "skip") skipped++
          done++
          if (done % 20 === 0) console.log(`[meta] ${done}/${jobs.length} (skip ${skipped})`)
        } catch (e) {
          console.error(`[meta] FAILED ${job.url}: ${e.message}`)
        }
      }
    }),
  )
  console.log(`[meta] done ${done}/${jobs.length}, skipped(existing) ${skipped}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
