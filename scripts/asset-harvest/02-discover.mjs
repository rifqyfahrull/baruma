/**
 * Tahap 2 — Candidate Discovery + License/Technical Gate (PRD §12–13, §16):
 * scan 160 chunk metadata, loloskan hanya:
 *   - license cc0/by (NC & ND reject otomatis),
 *   - isDownloadable, punya archives.glb,
 *   - faceCount <= 250k (Web Standard Profile) & size <= 80MB,
 *   - lolos prefilter keyword/kategori arsitektur-interior.
 * Output: out/candidates.jsonl (satu kandidat per baris, membawa bukti
 * lisensi: license, author, viewerUrl — dasar attribution PRD §13.4).
 *
 * Jalankan: node scripts/asset-harvest/02-discover.mjs
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import path from "node:path"
import {
  CATEGORY_HINTS,
  ensureDirs,
  KEYWORDS,
  LICENSE_ALLOW,
  META_DIR,
  OUT_DIR,
} from "./_shared.mjs"

const MAX_FACES = 250_000
const MAX_SIZE = 80 * 1024 * 1024

function textOf(obj) {
  const tagNames = (obj.tags ?? []).map((t) => t.slug || t.name || "").join(" ")
  const catNames = (obj.categories ?? []).map((c) => c.name || "").join(" ")
  return `${obj.name ?? ""} ${tagNames} ${catNames} ${obj.description ?? ""}`.toLowerCase()
}

function passesPrefilter(obj) {
  const cats = (obj.categories ?? []).map((c) => (c.slug || c.name || "").toLowerCase())
  if (cats.some((c) => CATEGORY_HINTS.has(c))) return true
  const text = textOf(obj)
  return KEYWORDS.some((k) => text.includes(k))
}

function main() {
  ensureDirs()
  const chunks = readdirSync(META_DIR).filter((f) => /^000-\d{3}\.json\.gz$/.test(f)).sort()
  if (chunks.length === 0) {
    console.error("[discover] no metadata chunks; run 01-fetch-metadata.mjs first")
    process.exit(1)
  }
  const outPath = path.join(OUT_DIR, "candidates.jsonl")
  const lines = []
  let total = 0
  let licensed = 0
  const licenseCounts = {}
  for (const chunk of chunks) {
    let data
    try {
      data = JSON.parse(gunzipSync(readFileSync(path.join(META_DIR, chunk))).toString())
    } catch (e) {
      console.error(`[discover] bad chunk ${chunk}: ${e.message}`)
      continue
    }
    for (const uid of Object.keys(data)) {
      total++
      const obj = data[uid]
      const lic = (obj.license ?? "").toLowerCase()
      licenseCounts[lic] = (licenseCounts[lic] ?? 0) + 1
      if (!LICENSE_ALLOW.has(lic)) continue
      if (obj.isDownloadable === false) continue
      const glb = obj.archives?.glb
      if (!glb) continue
      if ((glb.faceCount ?? obj.faceCount ?? 0) > MAX_FACES) continue
      if ((glb.size ?? 0) > MAX_SIZE) continue
      if (obj.isAgeRestricted) continue
      licensed++
      if (!passesPrefilter(obj)) continue
      lines.push(
        JSON.stringify({
          uid,
          name: (obj.name ?? "").slice(0, 200),
          license: lic,
          tags: (obj.tags ?? []).map((t) => t.slug || t.name).filter(Boolean).slice(0, 15),
          categories: (obj.categories ?? []).map((c) => c.name).filter(Boolean),
          faceCount: glb.faceCount ?? obj.faceCount ?? null,
          sizeBytes: glb.size ?? null,
          viewerUrl: obj.viewerUrl ?? null,
          author: obj.user?.username ?? null,
          authorUrl: obj.user?.profileUrl ?? null,
          publishedAt: obj.publishedAt ?? null,
        }),
      )
    }
  }
  writeFileSync(outPath, lines.join("\n") + (lines.length ? "\n" : ""))
  console.log(`[discover] scanned ${total} objects across ${chunks.length} chunks`)
  console.log(`[discover] license breakdown:`, JSON.stringify(licenseCounts))
  console.log(`[discover] license+technical pass: ${licensed}`)
  console.log(`[discover] candidates after prefilter: ${lines.length} -> ${outPath}`)
}

main()
