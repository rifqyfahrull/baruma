#!/usr/bin/env node
/**
 * Sync the catalog furniture GLBs between `public/models/` and object storage.
 *
 * GLB binaries are NOT committed to git (see .gitignore `public/models/*.glb`)
 * — object storage is their source of truth. This script is the bridge:
 *
 *   node scripts/sync-catalog-models.mjs upload    # dev machine → storage
 *   node scripts/sync-catalog-models.mjs download  # storage → public/models (deploy)
 *   node scripts/sync-catalog-models.mjs check     # verify local set == registry
 *
 * The file list is the single source of truth — every `/models/<name>.glb`
 * referenced by FURNITURE_MODEL_REGISTRY in
 * src/lib/three/furniture-models.ts. Storage keys:
 * `asset-library/catalog/furniture/<name>.glb`.
 *
 * Self-contained (aws4fetch, already an app dep) so the deploy server can run
 * `download` with only the STORAGE_* secrets it already has — no python /
 * rustfs-cli checkout needed. Same env-var names as src/lib/server/storage.ts.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { AwsClient } from "aws4fetch"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..")
const modelsDir = path.join(repoRoot, "public", "models")
const texturesDir = path.join(repoRoot, "public", "textures")
const registryFile = path.join(repoRoot, "src", "lib", "three", "furniture-models.ts")
const textureRegistryFile = path.join(repoRoot, "src", "lib", "three", "material-visuals.ts")
const KEY_PREFIX = "asset-library/catalog/furniture"
const TEXTURE_KEY_PREFIX = "asset-library/catalog/textures"

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

/** Every distinct `<name>.glb` referenced as `/models/<name>.glb` in the registry. */
function catalogModelFiles() {
  const src = readFileSync(registryFile, "utf8")
  const names = new Set()
  for (const m of src.matchAll(/["'`]\/models\/([\w.-]+\.glb)["'`]/g)) names.add(m[1])
  return [...names].sort()
}

/** Every distinct `<name>.jpg` referenced as `/textures/<name>.jpg` in material-visuals. */
function catalogTextureFiles() {
  const src = readFileSync(textureRegistryFile, "utf8")
  const names = new Set()
  for (const m of src.matchAll(/["'`]\/textures\/([\w.-]+\.jpg)["'`]/g)) names.add(m[1])
  return [...names].sort()
}

function storageConfig() {
  const endpoint = process.env.STORAGE_ENDPOINT
  const accessKeyId = process.env.STORAGE_ACCESS_KEY_ID || process.env.STORAGE_ACCESS_KEY
  const secretAccessKey = process.env.STORAGE_SECRET_ACCESS_KEY || process.env.STORAGE_SECRET_KEY
  const bucket = process.env.STORAGE_BUCKET
  const missing = Object.entries({ STORAGE_ENDPOINT: endpoint, "STORAGE_ACCESS_KEY(_ID)": accessKeyId, "STORAGE_SECRET(_ACCESS)_KEY": secretAccessKey, STORAGE_BUCKET: bucket })
    .filter(([, v]) => !v)
    .map(([k]) => k)
  if (missing.length) throw new Error(`Missing storage env: ${missing.join(", ")}`)
  const client = new AwsClient({ accessKeyId, secretAccessKey, region: process.env.STORAGE_REGION || "auto", service: "s3" })
  return { client, endpoint: endpoint.replace(/\/$/, ""), bucket }
}

function objectUrl(cfg, name) {
  return `${cfg.endpoint}/${cfg.bucket}/${KEY_PREFIX}/${name}`
}

function textureUrl(cfg, name) {
  return `${cfg.endpoint}/${cfg.bucket}/${TEXTURE_KEY_PREFIX}/${name}`
}

async function upload() {
  const cfg = storageConfig()
  const files = catalogModelFiles()
  for (const name of files) {
    const local = path.join(modelsDir, name)
    if (!existsSync(local)) throw new Error(`Local model missing: ${local} (add it before uploading)`)
    const body = readFileSync(local)
    const res = await cfg.client.fetch(objectUrl(cfg, name), {
      method: "PUT",
      body,
      headers: { "Content-Type": "model/gltf-binary", "x-amz-acl": "private" },
    })
    if (!res.ok) throw new Error(`Upload ${name} failed: HTTP ${res.status}`)
    console.log(`uploaded ${name} (${(body.length / 1024).toFixed(1)} KB) -> ${KEY_PREFIX}/${name}`)
  }
  for (const name of catalogTextureFiles()) {
    const local = path.join(texturesDir, name)
    if (!existsSync(local)) throw new Error(`Local texture missing: ${local} (run tools/textures-import first)`)
    const body = readFileSync(local)
    const res = await cfg.client.fetch(textureUrl(cfg, name), {
      method: "PUT",
      body,
      headers: { "Content-Type": "image/jpeg", "x-amz-acl": "private" },
    })
    if (!res.ok) throw new Error(`Upload texture ${name} failed: HTTP ${res.status}`)
    console.log(`uploaded ${name} -> ${TEXTURE_KEY_PREFIX}/${name}`)
  }
  console.log(`Done: ${files.length} catalog model(s) uploaded.`)
}

async function download() {
  const cfg = storageConfig()
  const files = catalogModelFiles()
  mkdirSync(modelsDir, { recursive: true })
  let fetched = 0
  for (const name of files) {
    const local = path.join(modelsDir, name)
    // Idempotent: a deploy re-run shouldn't re-pull files already present.
    if (existsSync(local) && statSync(local).size > 0) continue
    const res = await cfg.client.fetch(objectUrl(cfg, name), { method: "GET" })
    if (!res.ok) throw new Error(`Download ${name} failed: HTTP ${res.status}`)
    writeFileSync(local, Buffer.from(await res.arrayBuffer()))
    fetched++
    console.log(`downloaded ${name}`)
  }
  const textures = catalogTextureFiles()
  mkdirSync(texturesDir, { recursive: true })
  for (const name of textures) {
    const local = path.join(texturesDir, name)
    if (existsSync(local) && statSync(local).size > 0) continue
    const res = await cfg.client.fetch(textureUrl(cfg, name), { method: "GET" })
    if (!res.ok) throw new Error(`Download texture ${name} failed: HTTP ${res.status}`)
    writeFileSync(local, Buffer.from(await res.arrayBuffer()))
    fetched++
    console.log(`downloaded textures/${name}`)
  }
  console.log(`Done: ${fetched} fetched (models + textures).`)
}

function check() {
  const files = catalogModelFiles()
  const missingTex = catalogTextureFiles().filter((name) => !existsSync(path.join(texturesDir, name)))
  if (missingTex.length) {
    console.error(`Missing textures locally: ${missingTex.join(", ")}`)
    process.exit(1)
  }
  const missing = files.filter((name) => !existsSync(path.join(modelsDir, name)))
  console.log(`Registry references ${files.length} catalog model(s).`)
  if (missing.length) {
    console.error(`Missing locally: ${missing.join(", ")}`)
    process.exit(1)
  }
  console.log("All present locally.")
}

const cmd = process.argv[2]
const run = { upload, download, check }[cmd]
if (!run) {
  console.error("Usage: sync-catalog-models.mjs <upload|download|check>")
  process.exit(2)
}
Promise.resolve()
  .then(run)
  .catch((e) => {
    console.error(e.message || e)
    process.exit(1)
  })
