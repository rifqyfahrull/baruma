#!/usr/bin/env node
/**
 * Seed a curated furniture gallery into a user's Asset Library ("My Library").
 * Uploads each GLB to object storage under
 * `asset-library/<user>/furniture/<slug>.glb` (the proxy allowlist already
 * permits this shape) and upserts a `user_assets` row so it shows up browsable
 * and attachable. Idempotent (ON CONFLICT upsert).
 *
 * The GLBs were converted from the local SketchUp asset bank via the Blender
 * pipeline (D:/tmp/blender-skp/gallery) and hand-curated (bbox + thumbnail QA).
 *
 * Env: STORAGE_ENDPOINT/ACCESS_KEY(_ID)/SECRET(_ACCESS)_KEY/BUCKET,
 *      DATABASE_URL, BARUMA_IMPORT_USER_ID (defaults user-1).
 *
 * Usage: node scripts/seed-furniture-gallery.mjs [--dry-run]
 */
import { existsSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { AwsClient } from "aws4fetch"
import pg from "pg"

const { Pool } = pg
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..")
loadEnvFile(path.join(repoRoot, ".env"))
loadEnvFile(path.join(repoRoot, ".env.local"))

const glbDir = process.env.BARUMA_GALLERY_GLB_DIR ?? "D:/tmp/blender-skp/gallery"
const ownerId = process.env.BARUMA_IMPORT_USER_ID ?? "user-1"
const bucket = process.env.STORAGE_BUCKET ?? process.env.RUSTFS_BUCKET ?? "baruma"
const publicBase = process.env.STORAGE_PUBLIC_URL?.replace(/\/$/, "")
const dryRun = process.argv.includes("--dry-run")

// Curated set: [glb basename, display name, category, [widthM, depthM, heightM]].
// category = the app's asset category; "generic" attaches to any slot.
const GALLERY = [
  ["aalto-chair", "Kursi Lounge Aalto", "generic", [0.85, 0.82, 0.65]],
  ["chair-1", "Kursi Makan Kayu", "generic", [0.44, 0.54, 0.75]],
  ["chair-10", "Kursi Metal", "generic", [0.47, 0.52, 0.86]],
  ["cesca-chair", "Kursi Cesca Cantilever", "generic", [0.58, 0.47, 0.81]],
  ["armchair-rev", "Kursi Berlengan", "generic", [0.84, 0.63, 0.9]],
  ["armstrong-lounge", "Lounge Outdoor 2 Dudukan", "sofa", [1.49, 0.8, 0.71]],
  ["bar-stool-modernist", "Kursi Bar Modernis", "generic", [0.49, 0.35, 0.94]],
  ["floor-lamp-scultra", "Lampu Lantai Scultra", "generic", [0.43, 0.43, 1.5]],
]

function loadEnvFile(file) {
  if (!existsSync(file)) return
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith("#")) continue
    const i = t.indexOf("=")
    if (i <= 0) continue
    const k = t.slice(0, i).trim()
    let v = t.slice(i + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    process.env[k] ??= v
  }
}

function storageConfig() {
  const endpoint = process.env.STORAGE_ENDPOINT
  const accessKeyId = process.env.STORAGE_ACCESS_KEY_ID || process.env.STORAGE_ACCESS_KEY
  const secretAccessKey = process.env.STORAGE_SECRET_ACCESS_KEY || process.env.STORAGE_SECRET_KEY
  const missing = Object.entries({ STORAGE_ENDPOINT: endpoint, "STORAGE_ACCESS_KEY(_ID)": accessKeyId, "STORAGE_SECRET(_ACCESS)_KEY": secretAccessKey })
    .filter(([, v]) => !v)
    .map(([k]) => k)
  if (missing.length) throw new Error(`Missing storage env: ${missing.join(", ")}`)
  return {
    client: new AwsClient({ accessKeyId, secretAccessKey, region: process.env.STORAGE_REGION || "auto", service: "s3" }),
    endpoint: endpoint.replace(/\/$/, ""),
  }
}

function storageKey(slug) {
  return `asset-library/${ownerId}/furniture/${slug}.glb`
}
function modelUrl(slug) {
  const key = storageKey(slug)
  return publicBase ? `${publicBase}/${key}` : `/api/v1/assets/file/${key}`
}

async function upload(cfg, slug, body) {
  const url = `${cfg.endpoint}/${bucket}/${storageKey(slug)}`
  const res = await cfg.client.fetch(url, {
    method: "PUT",
    body,
    headers: { "Content-Type": "model/gltf-binary", "x-amz-acl": "private" },
  })
  if (!res.ok) throw new Error(`upload ${slug} failed: HTTP ${res.status}`)
}

async function main() {
  for (const [slug] of GALLERY) {
    const file = path.join(glbDir, `${slug}.glb`)
    if (!existsSync(file)) throw new Error(`GLB missing: ${file}`)
  }

  const cfg = dryRun ? null : storageConfig()
  const pool = dryRun ? null : new Pool({ connectionString: process.env.DATABASE_URL, ssl: false })
  try {
    for (const [slug, name, category, dims] of GALLERY) {
      const file = path.join(glbDir, `${slug}.glb`)
      const size = statSync(file).size
      const [w, d, h] = dims
      if (dryRun) {
        console.log(`DRY ${slug}: ${name} [${category}] ${w}x${d}x${h} ${(size / 1024).toFixed(0)}KB`)
        continue
      }
      await upload(cfg, slug, readFileSync(file))
      await pool.query(
        `INSERT INTO user_assets (
           id, user_id, name, category, source_type, source_name, original_filename,
           model_url, file_size_bytes, width_m, depth_m, height_m, raw_bounding_box_json,
           license_confirmation, license_note, usage_scope, status
         ) VALUES ($1,$2,$3,$4,'asset_bank_import','Baruma-asset',$5,$6,$7,$8,$9,$10,$11,true,$12,'private_project_only','ready')
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name, category = EXCLUDED.category, model_url = EXCLUDED.model_url,
           file_size_bytes = EXCLUDED.file_size_bytes, width_m = EXCLUDED.width_m,
           depth_m = EXCLUDED.depth_m, height_m = EXCLUDED.height_m,
           raw_bounding_box_json = EXCLUDED.raw_bounding_box_json, status = EXCLUDED.status,
           updated_at = now()`,
        [
          `asset-gallery-${slug}`, ownerId, name, category, `${slug}.glb`,
          modelUrl(slug), size, w, d, h, JSON.stringify({ width: w, depth: d, height: h }),
          "Imported from local Baruma-asset bank for internal Baruma testing.",
        ],
      )
      console.log(`seeded ${slug} -> ${name} (${category})`)
    }
  } finally {
    if (pool) await pool.end()
  }
  console.log(`${dryRun ? "Dry run" : "Seeded"} ${GALLERY.length} furniture gallery item(s).`)
}

main().catch((e) => {
  console.error(e.message || e)
  process.exit(1)
})
