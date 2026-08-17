/**
 * Tahap 5 — Download / Import (PRD §14.1) + Technical Validation ringan (§16):
 * unduh GLB tiap aset terpilih dari Objaverse HF, verifikasi magic byte glTF,
 * hitung sha256, simpan ke raw/<category>/<uid>.glb. Paralel, resume (file yang
 * sudah ada & valid dilewati), progress log ke out/download-progress.json.
 *
 * Jalankan: node scripts/asset-harvest/05-download.mjs [--conc=12]
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync, appendFileSync, createReadStream } from "node:fs"
import { createHash } from "node:crypto"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { gunzipSync } from "node:zlib"
import path from "node:path"
import { ensureDirs, fetchWithRetry, HF_BASE, META_DIR, OUT_DIR, RAW_DIR } from "./_shared.mjs"

const SELECTED = path.join(OUT_DIR, "selected.jsonl")
const DOWNLOADED = path.join(OUT_DIR, "downloaded.jsonl")
const PROGRESS = path.join(OUT_DIR, "download-progress.json")

const conc = Number((process.argv.find((a) => a.startsWith("--conc=")) || "").split("=")[1]) || 12
const GLB_MAGIC = Buffer.from("glTF")

function loadDone() {
  const done = new Set()
  if (existsSync(DOWNLOADED)) {
    for (const line of readFileSync(DOWNLOADED, "utf8").split("\n")) {
      if (!line.trim()) continue
      try {
        done.add(JSON.parse(line).uid)
      } catch {
        /* ignore */
      }
    }
  }
  return done
}

async function sha256(file) {
  const hash = createHash("sha256")
  await pipeline(createReadStream(file), hash)
  return hash.digest("hex")
}

function validGlbHeader(file) {
  try {
    const fd = readFileSync(file)
    return fd.length > 20 && fd.subarray(0, 4).equals(GLB_MAGIC)
  } catch {
    return false
  }
}

async function main() {
  ensureDirs()
  const paths = JSON.parse(gunzipSync(readFileSync(path.join(META_DIR, "object-paths.json.gz"))).toString())
  const selected = readFileSync(SELECTED, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
  const done = loadDone()
  const todo = selected.filter((c) => !done.has(c.uid))
  console.log(`[download] ${todo.length} to download (done ${done.size}), conc=${conc}`)

  let ok = done.size
  let fail = 0
  let processed = 0
  const queue = [...todo]
  const startAt = Date.now()

  await Promise.all(
    Array.from({ length: conc }, async () => {
      while (queue.length) {
        const c = queue.shift()
        if (!c) break
        processed++
        const rel = paths[c.uid]
        if (!rel) {
          fail++
          continue
        }
        const destDir = path.join(RAW_DIR, c.category)
        mkdirSync(destDir, { recursive: true })
        const dest = path.join(destDir, `${c.uid}.glb`)
        try {
          if (!(existsSync(dest) && statSync(dest).size > 0 && validGlbHeader(dest))) {
            const res = await fetchWithRetry(`${HF_BASE}/${rel}`)
            await pipeline(Readable.fromWeb(res.body), createWriteStream(dest))
            if (!validGlbHeader(dest)) throw new Error("invalid GLB header after download")
          }
          const size = statSync(dest).size
          const hash = await sha256(dest)
          appendFileSync(
            DOWNLOADED,
            JSON.stringify({
              uid: c.uid,
              category: c.category,
              file: path.relative(RAW_DIR, dest).replace(/\\/g, "/"),
              sizeBytes: size,
              sha256: hash,
            }) + "\n",
          )
          ok++
        } catch (e) {
          fail++
          if (fail % 25 === 0) console.error(`[download] fail #${fail}: ${c.uid} ${e.message}`)
        }
        if (processed % 100 === 0) {
          const rate = processed / ((Date.now() - startAt) / 1000)
          writeFileSync(PROGRESS, JSON.stringify({ ok, fail, processed, total: todo.length, ratePerSec: Number(rate.toFixed(2)) }, null, 2))
          console.log(`[download] ${processed}/${todo.length} ok=${ok} fail=${fail} ${rate.toFixed(1)}/s`)
        }
      }
    }),
  )
  writeFileSync(PROGRESS, JSON.stringify({ ok, fail, processed, total: todo.length, complete: true }, null, 2))
  console.log(`[download] done ok=${ok} fail=${fail}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
