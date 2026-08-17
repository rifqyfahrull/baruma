/**
 * Tahap 9 — generate SQL migration insert ke user_assets (PRD §22 catalog →
 * app live). HANYA aset yang sudah terupload (uploaded.jsonl) yang dimasukkan,
 * supaya tidak ada baris katalog yang menunjuk file tak ada.
 *
 * Gabungkan: uploaded (key storage) + catalog (lisensi/atribusi/kategori) +
 * bbox (dimensi) + classified (style/material enrichment, opsional).
 *
 * Output: db/migrations/00XX_seed_objaverse_assets.sql (path via --out).
 * Pola meniru 0011_global_asset_library (is_public=true, owner usr-MPbZPdo6Bj,
 * on conflict do nothing, guard owner ada). Multi-row insert dibatch.
 *
 * Jalankan: node scripts/asset-harvest/09-migration.mjs --out=db/migrations/0022_seed_objaverse_assets.sql
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { OUT_DIR } from "./_shared.mjs"

const OWNER = "usr-MPbZPdo6Bj"
const outArg = (process.argv.find((a) => a.startsWith("--out=")) || "").split("=")[1]
if (!outArg) {
  console.error("usage: node 09-migration.mjs --out=db/migrations/00XX_seed_objaverse_assets.sql")
  process.exit(1)
}

// Map kategori harvest → nilai kategori app. seating/table dipetakan ke nilai
// yang dikenali interior placement (sofa/coffee_table); sisanya biarkan literal
// (kaya + bisa dicari; My Library menampilkan & mencari kolom category).
const CATEGORY_MAP = { seating: "sofa", table: "coffee_table" }

function readJsonl(file) {
  if (!existsSync(file)) return []
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
}

// $j$-quoted literal (Postgres dollar-quote) — konten JSON tak pernah memuat $j$.
function j(s) {
  return `$j$${s ?? ""}$j$`
}
function num(n) {
  return n == null || !Number.isFinite(n) ? "NULL" : String(n)
}
function jsonbLit(obj) {
  return `${j(JSON.stringify(obj))}::jsonb`
}

function main() {
  const uploaded = readJsonl(path.join(OUT_DIR, "uploaded.jsonl"))
  const catalog = new Map(readJsonl(path.join(OUT_DIR, "catalog.jsonl")).map((c) => [c.id, c]))
  const bbox = new Map(readJsonl(path.join(OUT_DIR, "bbox.jsonl")).map((b) => [b.uid, b]))
  const enrich = new Map(readJsonl(path.join(OUT_DIR, "classified.jsonl")).map((e) => [e.uid, e]))

  const rows = []
  const catCounts = {}
  for (const up of uploaded) {
    const c = catalog.get(up.uid)
    if (!c) continue
    const e = enrich.get(up.uid)
    // Kalau enrichment eksplisit menandai irrelevant, lewati (kualitas).
    if (e && e.relevant === false && e.unresolved !== true) continue
    const bb = bbox.get(up.uid)
    const harvestCat = e?.relevant ? e.category : c.category
    const category = CATEGORY_MAP[harvestCat] ?? harvestCat
    const modelUrl = `/api/v1/assets/file/${up.key}`
    // Dimensi: pakai bbox nyata bila TIDAK suspicious; kalau suspicious → NULL
    // (app default 1 m saat placement) supaya tak menaruh objek raksasa 80 m.
    const useDim = bb && !bb.scale_suspicious
    const style = e?.style?.length ? e.style : c.style_tags ?? []
    const material = e?.material?.length ? e.material : c.material_tags ?? []
    rows.push({
      id: `asset-obj-${up.uid.slice(0, 16)}`,
      name: (c.canonical_name || up.uid).slice(0, 160),
      category,
      source_name: "Objaverse (Sketchfab CC)",
      source_url: c.source_url || "",
      original_filename: `${up.uid}.glb`,
      model_url: modelUrl,
      file_size_bytes: up.sizeBytes ?? c.size_bytes ?? 0,
      width_m: useDim ? bb.width_m : null,
      depth_m: useDim ? bb.depth_m : null,
      height_m: useDim ? bb.height_m : null,
      raw_bbox: bb?.bbox ?? null,
      style,
      material,
      license_note: c.attribution_text || "",
    })
    catCounts[category] = (catCounts[category] ?? 0) + 1
  }

  const header = `-- AUTO-GENERATED oleh scripts/asset-harvest/09-migration.mjs — jangan edit tangan.
-- Seed katalog global 3D asset dari Objaverse (mirror Sketchfab CC) — hasil
-- pipeline 3D Asset Research Workflow (PRD). Hanya aset yang SUDAH terupload
-- ke storage (asset-library/objaverse/furniture/<uid>.glb) yang dimasukkan.
--
-- is_public=true → tampil di My Library semua user (read-only pemakaian,
-- owner tetap ${OWNER}). Lisensi CC0/CC-BY; atribusi disimpan di license_note.
-- Dimensi dari bounding-box GLB nyata (world-space); yang skalanya janggal
-- di-NULL-kan (app pakai default 1 m) sampai normalisasi Blender headless.
-- Idempotent: on conflict (id) do nothing; guard owner ada (skip di dev DB).
--
-- Total: ${rows.length} aset. Per kategori: ${JSON.stringify(catCounts)}

`

  const COLS = `(id, user_id, name, category, source_type, source_name, source_url,
   original_filename, model_url, file_size_bytes, width_m, depth_m, height_m,
   raw_bounding_box_json, style_tags, material_tags,
   license_confirmation, license_note, usage_scope, status, is_public)`

  const BATCH = 500
  const parts = [header]
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH)
    const values = chunk
      .map((r) =>
        `  (${j(r.id)}, ${j(OWNER)}, ${j(r.name)}, ${j(r.category)}, ${j("catalog")}, ${j(r.source_name)}, ${j(r.source_url)},
   ${j(r.original_filename)}, ${j(r.model_url)}, ${r.file_size_bytes}, ${num(r.width_m)}, ${num(r.depth_m)}, ${num(r.height_m)},
   ${r.raw_bbox ? jsonbLit(r.raw_bbox) : "NULL"}, ${jsonbLit(r.style)}, ${jsonbLit(r.material)},
   true, ${j(r.license_note)}, ${j("public_catalog")}, ${j("uploaded")}, true)`,
      )
      .join(",\n")
    parts.push(
      `insert into user_assets\n  ${COLS}\nselect v.* from (values\n${values}\n) as v\nwhere exists (select 1 from profiles where id = ${j(OWNER)})\non conflict (id) do nothing;\n`,
    )
  }

  writeFileSync(outArg, parts.join("\n"))
  console.log(`[migration] ${rows.length} assets -> ${outArg}`)
  console.log(`[migration] per-category:`, JSON.stringify(catCounts, null, 0))
  console.log(`[migration] batches of ${BATCH}: ${Math.ceil(rows.length / BATCH)}`)
}

main()
