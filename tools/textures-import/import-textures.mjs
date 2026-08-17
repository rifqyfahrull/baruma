#!/usr/bin/env node
/**
 * One-time import of curated seamless textures from the local Baruma-asset
 * bank (SketchUp Master Design Kit) into object storage.
 *
 *   node tools/textures-import/import-textures.mjs
 *
 * Copies each curated source JPG to public/textures/<id>.jpg (local dev) and
 * uploads it to storage under `asset-library/catalog/textures/<id>.jpg` —
 * storage is the source of truth (same rule as catalog GLBs; the deploy pulls
 * them via scripts/sync-catalog-models.mjs download). Files are used as-is
 * (all curated sources are already seamless and < 700 KB).
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { AwsClient } from "aws4fetch"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..", "..")
const outDir = path.join(repoRoot, "public", "textures")
const KEY_PREFIX = "asset-library/catalog/textures"

const BANK = "D:/Ngoding/expr/VibeCoding.id/Baruma-asset/Sketchup Master Design Kit-20250623T123411Z-1-001/Sketchup Master Design Kit/Sketchup Master Design Kit"

/** id (web filename) ← curated source in the asset bank. */
const CURATED = [
  // dinding — bata
  ["tex-bata-metro-putih", "Bata/22_White metro bricks texture-seamless.jpg"],
  ["tex-bata-putih", "Bata/24_white bricks texture-seamless.jpg"],
  ["tex-bata-warna", "Bata/49_texture colored bricks smooth-seamless.jpg"],
  ["tex-bata-merah", "Dinding/Brick 01.jpg"],
  ["tex-bata-tua", "Dinding/Brick 03.jpg"],
  // dinding — panel kayu
  ["tex-kayu-hetre", "Wood/104_hetre wood medium color texture-seamless.jpg"],
  ["tex-kayu-rosewood", "Wood/107_rosewood fine wood texture-seamless.jpg"],
  // lantai — parket
  ["tex-parket-maple", "Wood Floor/Authentic maple_DIFFUSE.jpg"],
  ["tex-parket-cherry", "Wood Floor/Burled Cherry_DIFFUSE.jpg"],
  ["tex-parket-oak", "Wood Floor/02.jpg"],
  // lantai — karpet
  ["tex-karpet-loop", "Karpet/Finishes.Flooring.Carpet.Loop.1.jpg"],
  ["tex-karpet-loop-gelap", "Karpet/Finishes.Flooring.Carpet.Loop.4.jpg"],
  ["tex-karpet-stripes", "Karpet/Furnishings.Fabrics.Stripes.1.jpg"],
  // atap (dipetakan ke enum RoofMaterial di material-visuals)
  ["tex-atap-kolonial", "Atap/colonial-tiles-in-roof_17272.jpg"],
  ["tex-atap-genteng", "Atap/roofingtiles-texture_21589.jpg"],
  ["tex-atap-metal", "Atap/agbaru.jpg"],
  // ── wave 2 (2026-07-11): marmer, HPL, parket, kayu cladding ──
  ["tex-marmer-carrara", "Marmer/carara marmer 2.jpg"],
  ["tex-marmer-emperador", "Marmer/9187243-embrador-marble-texture.jpg"],
  ["tex-marmer-travertine", "Marmer/5037296_armerwhite-travertine.jpg"],
  ["tex-hpl-winter-maple", "HPL 2021 Collection/TH 100 AA - Winter Maple.jpg"],
  ["tex-hpl-dark-moka", "HPL 2021 Collection/TH 106 AA - Dark Moka.jpg"],
  ["tex-hpl-auburn-oak", "HPL 2021 Collection/TH 118 AA - Auburn Oak.jpg"],
  ["tex-parket-natural", "Parket/Wood-03-tile.jpg"],
  ["tex-parket-gelap", "Parket/Wood-10-tile.jpg"],
  ["tex-kayu-alder", "Wood/126_Alder fine wood texture-seamless.jpg"],
  ["tex-kayu-beech", "Wood/134_Beech fine wood PBR texture-seamless.jpg"],
]

function loadEnvFile(file) {
  if (!existsSync(file)) return
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const idx = trimmed.indexOf("=")
    if (idx <= 0) continue
    const key = trimmed.slice(0, idx).trim()
    let value = trimmed.slice(idx + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    process.env[key] ??= value
  }
}
loadEnvFile(path.join(repoRoot, ".env"))
loadEnvFile(path.join(repoRoot, ".env.local"))

const endpoint = (process.env.STORAGE_ENDPOINT ?? "").replace(/\/$/, "")
const accessKeyId = process.env.STORAGE_ACCESS_KEY_ID || process.env.STORAGE_ACCESS_KEY
const secretAccessKey = process.env.STORAGE_SECRET_ACCESS_KEY || process.env.STORAGE_SECRET_KEY
const bucket = process.env.STORAGE_BUCKET
if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
  console.error("Missing STORAGE_* env")
  process.exit(1)
}
const client = new AwsClient({ accessKeyId, secretAccessKey, region: process.env.STORAGE_REGION || "auto", service: "s3" })

mkdirSync(outDir, { recursive: true })
let ok = 0
for (const [id, rel] of CURATED) {
  const src = path.join(BANK, rel)
  if (!existsSync(src)) {
    console.error(`MISS ${rel}`)
    continue
  }
  const dest = path.join(outDir, `${id}.jpg`)
  copyFileSync(src, dest)
  const body = readFileSync(dest)
  const res = await client.fetch(`${endpoint}/${bucket}/${KEY_PREFIX}/${id}.jpg`, {
    method: "PUT",
    headers: { "content-type": "image/jpeg" },
    body,
  })
  if (!res.ok) {
    console.error(`FAIL upload ${id}: HTTP ${res.status}`)
    continue
  }
  console.log(`OK ${id}.jpg (${Math.round(body.length / 1024)} KB)`)
  ok++
}
console.log(`\nDone: ${ok}/${CURATED.length} textures imported + uploaded`)
