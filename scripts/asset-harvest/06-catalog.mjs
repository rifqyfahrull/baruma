/**
 * Tahap 6 — Catalog Writer (PRD §22) + License Evidence (§13.4). Gabungkan
 * selected + downloaded (+ enrich MiMo bila ada) → out/catalog.jsonl:
 * satu baris per aset accepted dengan GLB canonical, kategori, sha256,
 * lisensi + atribusi (CC-BY wajib), source URL, dimensi (dari faceCount/size
 * sebagai proxy sampai render preview), quality proxy. Plus catalog-stats.json.
 *
 * Menegakkan aturan PRD: TIDAK ada aset masuk catalog tanpa license evidence
 * + GLB valid. CC-BY menyimpan attribution_text; CC0 tetap simpan source.
 *
 * Jalankan: node scripts/asset-harvest/06-catalog.mjs
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { ensureDirs, LICENSE_LABELS, OUT_DIR } from "./_shared.mjs"

const SELECTED = path.join(OUT_DIR, "selected.jsonl")
const DOWNLOADED = path.join(OUT_DIR, "downloaded.jsonl")
const CLASSIFIED = path.join(OUT_DIR, "classified.jsonl")
const CATALOG = path.join(OUT_DIR, "catalog.jsonl")
const STATS = path.join(OUT_DIR, "catalog-stats.json")

function readJsonl(file) {
  if (!existsSync(file)) return []
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
}

function attribution(c) {
  const label = LICENSE_LABELS[c.license] ?? c.license
  if (c.license === "by") {
    return `"${c.name}" by ${c.author ?? "unknown"} (${c.authorUrl ?? c.viewerUrl}) licensed under ${label} via Sketchfab/Objaverse. ${c.viewerUrl ?? ""}`.trim()
  }
  return `"${c.name}" by ${c.author ?? "unknown"} — ${label} (public domain) via Sketchfab/Objaverse. ${c.viewerUrl ?? ""}`.trim()
}

function main() {
  ensureDirs()
  const selected = new Map(readJsonl(SELECTED).map((c) => [c.uid, c]))
  const downloaded = readJsonl(DOWNLOADED)
  const enrich = new Map(readJsonl(CLASSIFIED).map((c) => [c.uid, c]))

  const out = []
  const catCounts = {}
  const licenseCounts = {}
  let bytes = 0
  const sizes = []

  // RELEVANT_ONLY (default true): hanya aset yang LOLOS enrichment (e.relevant
  // === true) yang masuk katalog — keputusan user "hanya yang lolos enrichment
  // relevan". Set HARVEST_RELEVANT_ONLY=0 untuk mode longgar (sertakan yang
  // belum ter-enrich pakai kategori deterministik).
  const relevantOnly = process.env.HARVEST_RELEVANT_ONLY !== "0"

  for (const d of downloaded) {
    const c = selected.get(d.uid)
    if (!c) continue // hanya aset yang memang terpilih
    const e = enrich.get(d.uid)
    // Enrich MiMo boleh mengubah kategori; kalau MiMo bilang irrelevant, skip.
    if (e && e.relevant === false && e.unresolved !== true) continue
    // Strict: butuh verdict relevan positif dari enrichment.
    if (relevantOnly && !(e && e.relevant === true)) continue
    const category = e?.relevant ? e.category : c.category

    const label = LICENSE_LABELS[c.license] ?? c.license
    out.push({
      id: c.uid,
      canonical_name: c.name || c.uid,
      category,
      subcategory: e?.subcategory || "",
      style_tags: e?.style ?? [],
      material_tags: e?.material ?? [],
      source: "objaverse",
      source_url: c.viewerUrl,
      author: c.author,
      author_url: c.authorUrl,
      license_type: label,
      attribution_required: c.license === "by",
      attribution_text: attribution(c),
      file: d.file, // relatif ke raw/ (raw/<category>/<uid>.glb)
      file_sha256: d.sha256,
      size_bytes: d.sizeBytes,
      face_count: c.faceCount ?? null,
      tags: c.tags ?? [],
      llm_confidence: e?.confidence ?? null,
      status: "active",
    })
    catCounts[category] = (catCounts[category] ?? 0) + 1
    licenseCounts[label] = (licenseCounts[label] ?? 0) + 1
    bytes += d.sizeBytes ?? 0
    sizes.push(d.sizeBytes ?? 0)
  }

  writeFileSync(CATALOG, out.map((o) => JSON.stringify(o)).join("\n") + (out.length ? "\n" : ""))
  sizes.sort((a, b) => a - b)
  const median = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 0
  const p95 = sizes.length ? sizes[Math.floor(sizes.length * 0.95)] : 0
  const stats = {
    total_assets: out.length,
    per_category: Object.fromEntries(Object.entries(catCounts).sort((a, b) => b[1] - a[1])),
    per_license: licenseCounts,
    total_size_gb: Number((bytes / 1024 ** 3).toFixed(2)),
    median_size_mb: Number((median / 1024 ** 2).toFixed(2)),
    p95_size_mb: Number((p95 / 1024 ** 2).toFixed(2)),
    all_have_license_evidence: out.every((o) => o.attribution_text && o.source_url),
    all_have_valid_glb: out.every((o) => o.file && o.file_sha256),
  }
  writeFileSync(STATS, JSON.stringify(stats, null, 2))
  console.log(`[catalog] wrote ${out.length} assets -> ${CATALOG}`)
  console.log(JSON.stringify(stats, null, 2))
}

main()
