#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

const { Pool } = pg

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..")

loadEnvFile(path.join(repoRoot, ".env"))
loadEnvFile(path.join(repoRoot, ".env.local"))

const assetRoot =
  process.env.BARUMA_ASSET_BANK_ROOT ??
  "D:/Ngoding/expr/VibeCoding.id/Baruma-asset/500++-20250623T123410Z-1-001/500++/500++ 3D Desain Rumah Modern dan Masjid"
const blenderRoot = process.env.BARUMA_BLENDER_SKP_ROOT ?? "D:/tmp/blender-skp"
const blenderExe =
  process.env.BLENDER_EXE ??
  path.join(blenderRoot, "blender-3.6.23-windows-x64", "blender.exe")
const converter = process.env.BARUMA_SKP_BATCH_CONVERTER ?? path.join(blenderRoot, "batch_in_process.py")
const rustfsCliDir =
  process.env.RUSTFS_CLI_DIR ??
  "D:/Ngoding/expr/VibeCoding.id/tampil.dev/tools/rustfs-cli"
const rustfsCli = path.join(rustfsCliDir, "rustfs_cli.py")
const outDir = process.env.BARUMA_BUILDING_GLB_DIR ?? path.join(blenderRoot, "building-imports")
const ownerId = process.env.BARUMA_IMPORT_USER_ID ?? "user-1"
const ownerEmail = process.env.BARUMA_IMPORT_USER_EMAIL ?? "asset-library@baruma.local"
const bucket = process.env.STORAGE_BUCKET ?? process.env.RUSTFS_BUCKET ?? "baruma"
const publicBase = process.env.STORAGE_PUBLIC_URL?.replace(/\/$/, "")

const args = new Set(process.argv.slice(2))
const skipConvert = args.has("--skip-convert")
const skipUpload = args.has("--skip-upload")
const dryRun = args.has("--dry-run")
// --only=<slug>[,<slug>...] limits which houses get converted/uploaded/upserted.
const onlyArg = process.argv.slice(2).find((a) => a.startsWith("--only="))
const onlySlugs = onlyArg ? new Set(onlyArg.slice("--only=".length).split(",").filter(Boolean)) : null

const allProjects = [
  {
    slug: "rumah-tipe-36",
    projectId: "proj-asset-rumah-tipe-36",
    assetId: "asset-bank-rumah-tipe-36",
    name: "Asset Bank - Rumah Tipe 36",
    sourceFile: path.join(assetRoot, "Koleksi 3", "rumah+tipe+36.skp"),
    site: { widthM: 6, depthM: 10, city: "Asset Bank", province: "Import" },
    floors: 1,
    style: "minimalis",
    thumbnail: "compact",
    rooms: [
      room("rt36-carport", "Carport", "carport", "f1", 0, 0, 2.7, 4.2, true),
      room("rt36-tamu", "Ruang tamu", "ruang_tamu", "f1", 2.7, 0, 3.3, 3.5, true),
      room("rt36-kamar", "Kamar tidur", "kamar_tidur", "f1", 0, 4.2, 3.1, 3.4, true),
      room("rt36-mandi", "Kamar mandi", "kamar_mandi", "f1", 3.1, 4.2, 1.6, 2.0, false),
      room("rt36-dapur", "Dapur", "dapur", "f1", 4.7, 3.5, 1.3, 3.2, false),
      room("rt36-taman", "Taman belakang", "taman", "f1", 0, 7.6, 6.0, 2.4, true),
    ],
  },
  {
    slug: "rumah-tipe-60",
    projectId: "proj-asset-rumah-tipe-60",
    assetId: "asset-bank-rumah-tipe-60",
    name: "Asset Bank - Rumah Tipe 60",
    sourceFile: path.join(assetRoot, "Koleksi 3", "rumah+tipe+60.skp"),
    site: { widthM: 8, depthM: 12, city: "Asset Bank", province: "Import" },
    floors: 1,
    style: "modern_tropis",
    thumbnail: "family",
    rooms: [
      room("rt60-carport", "Carport", "carport", "f1", 0, 0, 3.0, 5.0, true),
      room("rt60-tamu", "Ruang tamu", "ruang_tamu", "f1", 3.0, 0, 5.0, 3.2, true),
      room("rt60-keluarga", "Ruang keluarga", "ruang_keluarga", "f1", 3.0, 3.2, 5.0, 3.4, true),
      room("rt60-kamar1", "Kamar utama", "kamar_tidur", "f1", 0, 5.0, 3.0, 3.5, true),
      room("rt60-kamar2", "Kamar 2", "kamar_tidur", "f1", 0, 8.5, 3.0, 3.5, true),
      room("rt60-mandi", "Kamar mandi", "kamar_mandi", "f1", 3.0, 6.6, 1.8, 2.2, false),
      room("rt60-dapur", "Dapur", "dapur", "f1", 4.8, 6.6, 3.2, 2.4, true),
      room("rt60-taman", "Taman belakang", "taman", "f1", 3.0, 9.0, 5.0, 3.0, true),
    ],
  },
  {
    slug: "rumah-3-kamar",
    projectId: "proj-asset-rumah-3-kamar",
    assetId: "asset-bank-rumah-3-kamar",
    name: "Asset Bank - Rumah 3 Kamar",
    sourceFile: path.join(assetRoot, "Koleksi 3", "Rumah+3+kamar.skp"),
    site: { widthM: 9, depthM: 15, city: "Asset Bank", province: "Import" },
    floors: 1,
    style: "modern_tropis",
    thumbnail: "courtyard",
    rooms: [
      room("r3k-carport", "Carport", "carport", "f1", 0, 0, 3.2, 5.0, true),
      room("r3k-tamu", "Ruang tamu", "ruang_tamu", "f1", 3.2, 0, 5.8, 3.4, true),
      room("r3k-keluarga", "Ruang keluarga", "ruang_keluarga", "f1", 3.2, 3.4, 5.8, 4.0, true),
      room("r3k-kamar1", "Kamar utama", "kamar_tidur", "f1", 0, 5.0, 3.2, 3.5, true),
      room("r3k-kamar2", "Kamar 2", "kamar_tidur", "f1", 0, 8.5, 3.2, 3.2, true),
      room("r3k-kamar3", "Kamar 3", "kamar_tidur", "f1", 3.2, 7.4, 3.0, 3.2, true),
      room("r3k-mandi", "Kamar mandi", "kamar_mandi", "f1", 6.2, 7.4, 1.6, 2.1, false),
      room("r3k-dapur", "Dapur", "dapur", "f1", 7.8, 7.4, 1.2, 3.0, true),
      room("r3k-taman", "Taman belakang", "taman", "f1", 0, 11.7, 9.0, 3.3, true),
    ],
  },
  {
    slug: "rumah-sederhana",
    projectId: "proj-asset-rumah-sederhana",
    assetId: "asset-bank-rumah-sederhana",
    name: "Asset Bank - Rumah Sederhana",
    sourceFile: path.join(assetRoot, "Koleksi 3", "RUMH+SDRHN.skp"),
    site: { widthM: 8, depthM: 11, city: "Asset Bank", province: "Import" },
    floors: 1,
    style: "modern_tropis",
    thumbnail: "compact",
    rooms: [
      room("rsd-carport", "Carport", "carport", "f1", 0, 0, 2.7, 4.5, true),
      room("rsd-tamu", "Ruang tamu", "ruang_tamu", "f1", 2.7, 0, 5.3, 3.5, true),
      room("rsd-keluarga", "Ruang keluarga", "ruang_keluarga", "f1", 2.7, 3.5, 5.3, 3.0, true),
      room("rsd-kamar1", "Kamar utama", "kamar_tidur", "f1", 0, 4.5, 2.7, 3.4, true),
      room("rsd-kamar2", "Kamar 2", "kamar_tidur", "f1", 0, 7.9, 2.7, 3.1, true),
      room("rsd-mandi", "Kamar mandi", "kamar_mandi", "f1", 2.9, 6.5, 1.8, 2.2, false),
      room("rsd-dapur", "Dapur", "dapur", "f1", 4.7, 6.5, 3.3, 2.4, true),
      room("rsd-taman", "Taman belakang", "taman", "f1", 2.9, 8.9, 5.1, 2.1, true),
    ],
  },
  {
    slug: "rumah-minimalis-modern",
    projectId: "proj-asset-rumah-minimalis-modern",
    assetId: "asset-bank-rumah-minimalis-modern",
    name: "Asset Bank - Rumah Minimalis Modern",
    sourceFile: path.join(assetRoot, "Koleksi 3", "rumah(3).skp"),
    site: { widthM: 9, depthM: 13, city: "Asset Bank", province: "Import" },
    floors: 1,
    style: "modern_tropis",
    thumbnail: "family",
    rooms: [
      room("rmm-carport", "Carport", "carport", "f1", 0, 0, 3.0, 5.0, true),
      room("rmm-tamu", "Ruang tamu", "ruang_tamu", "f1", 3.0, 0, 6.0, 3.5, true),
      room("rmm-keluarga", "Ruang keluarga", "ruang_keluarga", "f1", 3.0, 3.5, 6.0, 3.8, true),
      room("rmm-kamar1", "Kamar utama", "kamar_tidur", "f1", 0, 5.0, 3.0, 3.8, true),
      room("rmm-kamar2", "Kamar 2", "kamar_tidur", "f1", 0, 8.8, 3.0, 3.4, true),
      room("rmm-kamar3", "Kamar 3", "kamar_tidur", "f1", 3.0, 7.3, 3.0, 3.2, true),
      room("rmm-mandi", "Kamar mandi", "kamar_mandi", "f1", 6.0, 7.3, 1.9, 2.4, false),
      room("rmm-dapur", "Dapur", "dapur", "f1", 6.0, 9.7, 3.0, 2.8, true),
      room("rmm-taman", "Taman belakang", "taman", "f1", 3.0, 10.5, 3.0, 2.5, true),
    ],
  },
  {
    slug: "rumah-atap-miring",
    projectId: "proj-asset-rumah-atap-miring",
    assetId: "asset-bank-rumah-atap-miring",
    name: "Asset Bank - Rumah Atap Miring",
    sourceFile: path.join(assetRoot, "Koleksi 4", "home-slope+roof.skp"),
    site: { widthM: 11, depthM: 13, city: "Asset Bank", province: "Import" },
    floors: 1,
    style: "modern_tropis",
    thumbnail: "family",
    rooms: [
      room("ram-carport", "Carport", "carport", "f1", 0, 0, 3, 5, true),
      room("ram-tamu", "Ruang tamu", "ruang_tamu", "f1", 3, 0, 8, 3.5, true),
      room("ram-keluarga", "Ruang keluarga", "ruang_keluarga", "f1", 3, 3.5, 8, 3.5, true),
      room("ram-kamar1", "Kamar utama", "kamar_tidur", "f1", 0, 5, 3, 4, true),
      room("ram-kamar2", "Kamar 2", "kamar_tidur", "f1", 0, 9, 3, 3.5, true),
      room("ram-kamar3", "Kamar 3", "kamar_tidur", "f1", 3, 7, 3.5, 3.3, true),
      room("ram-mandi", "Kamar mandi", "kamar_mandi", "f1", 6.5, 7, 2, 2.5, false),
      room("ram-dapur", "Dapur", "dapur", "f1", 8.5, 7, 2.5, 3, true),
      room("ram-taman", "Taman belakang", "taman", "f1", 3, 10.3, 5.5, 2.7, true),
    ],
  },
  {
    slug: "rumah-farmhouse",
    projectId: "proj-asset-rumah-farmhouse",
    assetId: "asset-bank-rumah-farmhouse",
    name: "Asset Bank - Rumah Gaya Farmhouse",
    sourceFile: path.join(assetRoot, "Koleksi 1", "Farm+House.skp"),
    site: { widthM: 11, depthM: 16, city: "Asset Bank", province: "Import" },
    floors: 1,
    style: "modern_tropis",
    thumbnail: "courtyard",
    rooms: [
      room("rfh-carport", "Carport", "carport", "f1", 0, 0, 3, 5, true),
      room("rfh-tamu", "Ruang tamu", "ruang_tamu", "f1", 3, 0, 8, 3.5, true),
      room("rfh-keluarga", "Ruang keluarga", "ruang_keluarga", "f1", 3, 3.5, 8, 4, true),
      room("rfh-kamar1", "Kamar utama", "kamar_tidur", "f1", 0, 5, 3, 4, true),
      room("rfh-kamar2", "Kamar 2", "kamar_tidur", "f1", 0, 9, 3, 3.8, true),
      room("rfh-kamar3", "Kamar 3", "kamar_tidur", "f1", 3, 7.5, 3.5, 3.5, true),
      room("rfh-makan", "Ruang makan", "ruang_makan", "f1", 6.5, 7.5, 4.5, 3.5, true),
      room("rfh-mandi", "Kamar mandi", "kamar_mandi", "f1", 3, 11, 2, 2.5, false),
      room("rfh-dapur", "Dapur", "dapur", "f1", 5, 11, 3.5, 2.8, true),
      room("rfh-taman", "Taman belakang", "taman", "f1", 0, 14, 11, 2, true),
    ],
  },
  {
    slug: "rumah-mungil",
    projectId: "proj-asset-rumah-mungil",
    assetId: "asset-bank-rumah-mungil",
    name: "Asset Bank - Rumah Mungil",
    sourceFile: path.join(assetRoot, "Koleksi 2", "house.skp"),
    site: { widthM: 6, depthM: 10, city: "Asset Bank", province: "Import" },
    floors: 1,
    style: "modern_tropis",
    thumbnail: "compact",
    rooms: [
      room("rmg-carport", "Carport", "carport", "f1", 0, 0, 2.7, 4.5, true),
      room("rmg-tamu", "Ruang tamu", "ruang_tamu", "f1", 2.7, 0, 3.3, 4.5, true),
      room("rmg-kamar1", "Kamar utama", "kamar_tidur", "f1", 0, 4.5, 3, 3.5, true),
      room("rmg-kamar2", "Kamar 2", "kamar_tidur", "f1", 3, 4.5, 3, 3.5, true),
      room("rmg-mandi", "Kamar mandi", "kamar_mandi", "f1", 0, 8, 1.8, 2, true),
      room("rmg-dapur", "Dapur", "dapur", "f1", 1.8, 8, 2.4, 2, true),
      room("rmg-taman", "Taman belakang", "taman", "f1", 4.2, 8, 1.8, 2, true),
    ],
  },
  {
    slug: "rumah-casa",
    projectId: "proj-asset-rumah-casa",
    assetId: "asset-bank-rumah-casa",
    name: "Asset Bank - Rumah Casa",
    sourceFile: path.join(assetRoot, "Koleksi 4", "Casa+5.skp"),
    site: { widthM: 12, depthM: 15, city: "Asset Bank", province: "Import" },
    floors: 1,
    style: "modern_tropis",
    thumbnail: "courtyard",
    rooms: [
      room("rc-carport", "Carport", "carport", "f1", 0, 0, 3.5, 5.5, true),
      room("rc-tamu", "Ruang tamu", "ruang_tamu", "f1", 3.5, 0, 8.5, 3.8, true),
      room("rc-keluarga", "Ruang keluarga", "ruang_keluarga", "f1", 3.5, 3.8, 5, 4.2, true),
      room("rc-makan", "Ruang makan", "ruang_makan", "f1", 8.5, 3.8, 3.5, 4.2, true),
      room("rc-kamar1", "Kamar utama", "kamar_tidur", "f1", 0, 5.5, 3.5, 4, true),
      room("rc-kamar2", "Kamar 2", "kamar_tidur", "f1", 0, 9.5, 3.5, 3.5, true),
      room("rc-kamar3", "Kamar 3", "kamar_tidur", "f1", 3.5, 8, 3.5, 3.5, true),
      room("rc-mandi1", "Kamar mandi 1", "kamar_mandi", "f1", 7, 8, 2, 2.5, false),
      room("rc-mandi2", "Kamar mandi 2", "kamar_mandi", "f1", 9, 8, 1.8, 2.5, false),
      room("rc-dapur", "Dapur", "dapur", "f1", 9, 10.5, 3, 3, true),
      room("rc-taman", "Taman belakang", "taman", "f1", 3.5, 11.5, 5.5, 2.5, true),
    ],
  },
  {
    slug: "rumah-modern-box",
    projectId: "proj-asset-rumah-modern-box",
    assetId: "asset-bank-rumah-modern-box",
    name: "Asset Bank - Rumah Modern Box (2 Lantai)",
    sourceFile: path.join(assetRoot, "Koleksi 4", "home-box.skp"),
    site: { widthM: 9, depthM: 16, city: "Asset Bank", province: "Import" },
    floors: 2,
    style: "modern_tropis",
    thumbnail: "family",
    rooms: [
      room("rmb-carport", "Carport", "carport", "f1", 0, 0, 3, 5, true),
      room("rmb-tamu", "Ruang tamu", "ruang_tamu", "f1", 3, 0, 6, 3.5, true),
      room("rmb-keluarga", "Ruang keluarga", "ruang_keluarga", "f1", 3, 3.5, 6, 4, true),
      room("rmb-mandi1", "Kamar mandi 1", "kamar_mandi", "f1", 0, 5, 3, 2.5, false),
      room("rmb-makan", "Ruang makan", "ruang_makan", "f1", 3, 7.5, 3, 3, true),
      room("rmb-dapur", "Dapur", "dapur", "f1", 6, 7.5, 3, 3, true),
      room("rmb-taman", "Taman belakang", "taman", "f1", 0, 10.5, 9, 5.5, true),
      room("rmb-kamar1", "Kamar utama", "kamar_tidur", "f2", 0, 0, 4.5, 4.5, true),
      room("rmb-kamar2", "Kamar 2", "kamar_tidur", "f2", 4.5, 0, 4.5, 4.5, true),
      room("rmb-kamar3", "Kamar 3", "kamar_tidur", "f2", 0, 4.5, 4.5, 4, true),
      room("rmb-mandi2", "Kamar mandi 2", "kamar_mandi", "f2", 4.5, 4.5, 2.5, 3, false),
    ],
  },
  {
    slug: "rumah-2-lantai",
    projectId: "proj-asset-rumah-2-lantai",
    assetId: "asset-bank-rumah-2-lantai",
    name: "Asset Bank - Rumah 2 Lantai",
    sourceFile: path.join(assetRoot, "Koleksi 3", "My+House.skp"),
    site: { widthM: 11, depthM: 16, city: "Asset Bank", province: "Import" },
    floors: 2,
    style: "modern_tropis",
    thumbnail: "courtyard",
    rooms: [
      room("r2l-carport", "Carport", "carport", "f1", 0, 0, 3.5, 5.5, true),
      room("r2l-tamu", "Ruang tamu", "ruang_tamu", "f1", 3.5, 0, 7.5, 4, true),
      room("r2l-keluarga", "Ruang keluarga", "ruang_keluarga", "f1", 3.5, 4, 7.5, 4.5, true),
      room("r2l-mandi1", "Kamar mandi 1", "kamar_mandi", "f1", 0, 5.5, 3.5, 3, false),
      room("r2l-makan", "Ruang makan", "ruang_makan", "f1", 3.5, 8.5, 4, 3.5, true),
      room("r2l-dapur", "Dapur", "dapur", "f1", 7.5, 8.5, 3.5, 3.5, true),
      room("r2l-taman", "Taman belakang", "taman", "f1", 0, 12, 11, 4, true),
      room("r2l-kamar1", "Kamar utama", "kamar_tidur", "f2", 0, 0, 4, 5, true),
      room("r2l-kamar2", "Kamar 2", "kamar_tidur", "f2", 4, 0, 3.5, 4.5, true),
      room("r2l-kamar3", "Kamar 3", "kamar_tidur", "f2", 7.5, 0, 3.5, 4.5, true),
      room("r2l-mandi2", "Kamar mandi 2", "kamar_mandi", "f2", 4, 4.5, 3.5, 3, false),
      room("r2l-mandi3", "Kamar mandi 3", "kamar_mandi", "f2", 7.5, 4.5, 3.5, 3, false),
      room("r2l-kamar4", "Kamar 4", "kamar_tidur", "f2", 0, 5, 4, 3.5, true),
    ],
  },
]

const projects = onlySlugs ? allProjects.filter((p) => onlySlugs.has(p.slug)) : allProjects
if (onlySlugs && projects.length !== onlySlugs.size) {
  const known = new Set(allProjects.map((p) => p.slug))
  const unknown = [...onlySlugs].filter((s) => !known.has(s))
  throw new Error(`Unknown --only slug(s): ${unknown.join(", ")} (known: ${[...known].join(", ")})`)
}

function room(id, name, type, floorId, x, y, width, depth, edge) {
  return {
    id,
    name,
    type,
    floorId,
    x,
    y,
    width,
    depth,
    areaM2: round1(width * depth),
    requiresNaturalLight: edge,
    requiresVentilation: edge,
  }
}

function loadEnvFile(file) {
  if (!existsSync(file)) return
  const lines = readFileSync(file, "utf8").split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const idx = trimmed.indexOf("=")
    if (idx <= 0) continue
    const key = trimmed.slice(0, idx).trim()
    let value = trimmed.slice(idx + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    process.env[key] ??= value
  }
}

function round1(value) {
  return Math.round(value * 10) / 10
}

function slugFile(project) {
  return path.join(outDir, `${project.slug}.glb`)
}

function bboxSidecarFile(project) {
  return path.join(outDir, `${project.slug}.bbox.json`)
}

/** Real GLB bounding box (metres), written by convertMissingGlbs() from the
 *  Blender converter's own report — matches the {width,depth,height} shape
 *  `analyzeGlbFile` produces elsewhere, so raw_bounding_box_json is never a
 *  lie. Null when no conversion has ever run for this project (e.g. someone
 *  manually dropped a GLB into outDir without running the converter). */
function readBbox(project) {
  const file = bboxSidecarFile(project)
  if (!existsSync(file)) return null
  return JSON.parse(readFileSync(file, "utf8"))
}

function storageKey(project) {
  return `asset-library/${ownerId}/buildings/${project.slug}.glb`
}

function modelUrlFor(project) {
  const key = storageKey(project)
  return publicBase ? `${publicBase}/${key}` : `/api/v1/assets/file/${key}`
}

function assertFile(file, label) {
  if (!existsSync(file)) throw new Error(`${label} not found: ${file}`)
}

function run(command, cmdArgs, opts = {}) {
  const res = spawnSync(command, cmdArgs, {
    stdio: "inherit",
    shell: false,
    env: process.env,
    ...opts,
  })
  if (res.status !== 0) {
    throw new Error(`${command} failed with exit code ${res.status}`)
  }
}

function ensureRustfsEnv() {
  // Accept both the app's env names (STORAGE_ACCESS_KEY_ID /
  // STORAGE_SECRET_ACCESS_KEY) and the shorter STORAGE_ACCESS_KEY /
  // STORAGE_SECRET_KEY variants people naturally write by hand.
  process.env.RUSTFS_ENDPOINT ??= process.env.STORAGE_ENDPOINT
  process.env.RUSTFS_ACCESS_KEY ??= process.env.STORAGE_ACCESS_KEY_ID ?? process.env.STORAGE_ACCESS_KEY
  process.env.RUSTFS_SECRET_KEY ??= process.env.STORAGE_SECRET_ACCESS_KEY ?? process.env.STORAGE_SECRET_KEY
  for (const key of ["RUSTFS_ENDPOINT", "RUSTFS_ACCESS_KEY", "RUSTFS_SECRET_KEY"]) {
    if (!process.env[key]) throw new Error(`${key} is required for rustfs-cli upload`)
  }
}

function buildBrief(project) {
  return {
    projectId: project.projectId,
    summary: `${project.name} diimpor dari bank asset 500++ sebagai proyek Baruma editable. Model 3D sumber tersimpan di Asset Library untuk referensi visual.`,
    site: {
      widthM: project.site.widthM,
      depthM: project.site.depthM,
      areaM2: round1(project.site.widthM * project.site.depthM),
      city: project.site.city,
      province: project.site.province,
      frontOrientation: "south",
      sidesAttached: 1,
      frontRoadWidthM: 5,
    },
    building: {
      floors: project.floors,
      rooftop: false,
      budget: { minIDR: 250_000_000, maxIDR: 650_000_000 },
      finishingLevel: "menengah",
    },
    priorities: ["terasa_lega", "banyak_cahaya", "ventilasi"],
    spaceProgram: project.rooms
      .filter((r) => r.type !== "taman")
      .map((r, index) => ({
        id: `sp-${project.slug}-${index + 1}`,
        roomType: r.type,
        name: r.name,
        required: true,
        quantity: 1,
        preferredFloor: 1,
      })),
    assumptions: [
      "Denah awal dibuat sebagai template editable dari model referensi asset bank.",
      "Model SKP sumber dipakai sebagai referensi visual, bukan ekstraksi semantik ruang otomatis.",
      "Dimensi lahan dan ruang sudah dinormalisasi agar dapat diedit di Baruma.",
    ],
    constraints: [
      "Model SKP sumber bersifat monolithic mesh sehingga tipe ruang tidak dapat diekstrak otomatis dengan andal.",
      "Perlu review arsitek sebelum dipakai sebagai gambar kerja.",
    ],
    risks: [
      {
        id: `risk-${project.slug}-source`,
        level: "info",
        category: "spatial",
        title: "Import dari model referensi",
        message: "Layout Baruma adalah template turunan yang bisa diedit, sedangkan GLB sumber tersimpan di Asset Library.",
      },
    ],
  }
}

function opening(id, roomId, floorId, side, positionM, widthM, type, kind) {
  return {
    id,
    floorId,
    wallId: `${roomId}:${side}`,
    type,
    kind,
    positionM,
    widthM,
    heightM: type === "door" ? 2.1 : 1.2,
    sillHeightM: type === "door" ? 0 : 0.9,
    headHeightM: type === "door" ? 2.1 : 2.1,
  }
}

/**
 * Clearance minimal kusen ke ujung dinding (m). Cermin dari
 * OPENING_EDGE_MARGIN_M di src/lib/geometry/opening-plan.ts — script .mjs tak
 * bisa mengimpor TS, jadi nilainya diduplikasi di sini. Sumber aturan:
 * domain-knowledge/domain-knowledge-pintu.md §1.
 */
const EDGE_MARGIN_M = 0.15

/**
 * Muat bukaan pada dinding dengan clearance di KEDUA ujung — cermin
 * `fitOpeningToWall()` di src/lib/geometry/fit-opening.ts (lihat test di
 * fit-opening.test.ts untuk perilaku yang dijamin).
 *
 * Menggantikan pola lama `positionM = min(1.2, dim/2)` + `widthM = min(W, dim)`
 * yang, saat dinding lebih sempit dari W, menghasilkan bukaan SELEBAR PENUH
 * dinding dengan sisa 0 di kedua sisi — akar 21 pelanggaran di DB produksi
 * (docs/AUDIT_BUKAAN_2026-08.md). Lebar boleh menyusut; null bila dinding
 * memang tak layak.
 */
function fitOpening(wallLenM, desiredWidthM, preferredPositionM, minWidthM = 0.6) {
  if (!(wallLenM > 0) || !(desiredWidthM > 0)) return null
  const usable = wallLenM - 2 * EDGE_MARGIN_M
  if (usable < minWidthM - 1e-9) return null
  const widthM = Math.round(Math.min(desiredWidthM, usable) * 100) / 100
  if (widthM < minWidthM - 1e-9) return null
  const half = widthM / 2
  const lo = EDGE_MARGIN_M + half
  const hi = wallLenM - EDGE_MARGIN_M - half
  if (hi < lo - 1e-9) return null
  const wanted = preferredPositionM ?? wallLenM / 2
  return {
    positionM: Math.round(Math.min(Math.max(wanted, lo), hi) * 100) / 100,
    widthM,
  }
}

/** opening() yang posisinya dimuat dulu; null bila dinding tak layak. */
function fittedOpening(id, roomId, floorId, side, wallLenM, desiredWidthM, type, kind, preferredPositionM) {
  const fit = fitOpening(wallLenM, desiredWidthM, preferredPositionM)
  if (!fit) return null
  return opening(id, roomId, floorId, side, fit.positionM, fit.widthM, type, kind)
}

function buildOpenings(project) {
  // Side convention (must match src/lib/geometry/index.ts's openingSegment):
  // "n" = room.y edge (top/front), "s" = room.y + room.depth edge (bottom/back).
  const out = []
  const push = (o) => {
    if (o) out.push(o)
  }
  for (const r of project.rooms) {
    if (r.type === "carport") continue
    if (r.y === 0) {
      push(fittedOpening(`op-${r.id}-front`, r.id, r.floorId, "n", r.width, 1.8, "window", "sliding_window"))
    }
    if (r.x + r.width >= project.site.widthM - 0.01) {
      push(fittedOpening(`op-${r.id}-east`, r.id, r.floorId, "e", r.depth, 1.6, "window", "casement_window"))
    }
    if (r.y + r.depth >= project.site.depthM - 0.01) {
      // taman is open-air yard, not an enclosed room — its meaningful
      // opening connects it to the house on its "n" edge (bordering the
      // rooms above it), not the property fence line on its "s" edge.
      // Every other room type's "s" edge here IS the building's true rear
      // exterior wall, so its window belongs on "s".
      const isYard = r.type === "taman"
      push(
        fittedOpening(
          `op-${r.id}-back`, r.id, r.floorId, isYard ? "n" : "s", r.width, 2.4,
          isYard ? "door" : "window", isYard ? "sliding_glass_door" : "awning_window",
        ),
      )
    }
  }
  // Main entry door on Ruang Tamu's "n" (y=0) edge — the wall facing the
  // carport/street, matching every project's actual layout. Dulu positionM
  // 0,5 hardcoded untuk daun 0,9 m → sisa 5 cm, terulang di 12 proyek aset;
  // kini dipusatkan pada dinding dengan clearance yang sah.
  const entryRoom = project.rooms[1]
  push(
    fittedOpening(
      `op-${project.slug}-main-door`, entryRoom.id, "f1", "n", entryRoom.width, 0.9,
      "door", "hinged_door",
    ),
  )
  return out
}

function buildLayout(project) {
  const floorCount = Math.max(1, project.floors || 1)
  return {
    id: `layout-${project.projectId}`,
    projectId: project.projectId,
    versionId: `ver-${project.projectId}-asset-bank`,
    floors: Array.from({ length: floorCount }, (_, i) => ({
      id: `f${i + 1}`,
      level: i + 1,
      name: `Lantai ${i + 1}`,
      heightM: 3.2,
    })),
    rooms: project.rooms,
    walls: [],
    openings: buildOpenings(project),
    stairs: [],
    pools: [],
    interiors: [],
    roof: { type: "pelana", slopeDeg: 25, overhangM: 0.6, material: "genteng_keramik" },
    structural: { soilBearingKPa: 150 },
    sanitation: {},
    validation: { passed: true, issues: [] },
  }
}

async function upsertDatabase() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false })
  try {
    // DO NOTHING, not DO UPDATE: when the owner is a real existing account
    // (BARUMA_IMPORT_USER_ID pointing at the user's own profile), updating
    // here would clobber their login email/name with the synthetic import
    // identity. Only a brand-new synthetic owner ever gets inserted.
    await pool.query(
      `INSERT INTO profiles (id, email, name, plan, credits_used, credits_total)
       VALUES ($1, $2, $3, 'studio', 0, 500)
       ON CONFLICT (id) DO NOTHING`,
      [ownerId, ownerEmail, "Asset Library Import"]
    )

    for (const project of projects) {
      const site = {
        ...project.site,
        areaM2: round1(project.site.widthM * project.site.depthM),
        frontOrientation: "south",
        sidesAttached: 1,
        frontRoadWidthM: 5,
      }
      const versionId = `ver-${project.projectId}-asset-bank`
      const layout = buildLayout(project)
      const brief = buildBrief(project)
      const file = slugFile(project)
      const size = statSync(file).size
      const modelUrl = modelUrlFor(project)

      await pool.query(
        `INSERT INTO projects (
           id, owner_id, name, status, readiness, project_type, location, city, province,
           style, thumbnail, floors, rooftop, site, current_version_id
         ) VALUES ($1,$2,$3,'editing','concept_ready','new',$4,$5,$6,$7,$8,$9,false,$10,$11)
         ON CONFLICT (id) DO UPDATE SET
           owner_id = EXCLUDED.owner_id,
           name = EXCLUDED.name,
           status = EXCLUDED.status,
           readiness = EXCLUDED.readiness,
           project_type = EXCLUDED.project_type,
           location = EXCLUDED.location,
           city = EXCLUDED.city,
           province = EXCLUDED.province,
           style = EXCLUDED.style,
           thumbnail = EXCLUDED.thumbnail,
           floors = EXCLUDED.floors,
           rooftop = EXCLUDED.rooftop,
           site = EXCLUDED.site,
           current_version_id = EXCLUDED.current_version_id,
           updated_at = now()`,
        [
          project.projectId,
          ownerId,
          project.name,
          `${site.city}, ${site.province}`,
          site.city,
          site.province,
          project.style,
          project.thumbnail,
          project.floors,
          JSON.stringify(site),
          versionId,
        ]
      )

      await pool.query(
        `INSERT INTO briefs (project_id, payload)
         VALUES ($1, $2)
         ON CONFLICT (project_id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`,
        [project.projectId, JSON.stringify(brief)]
      )
      await pool.query(
        `INSERT INTO design_layouts (project_id, version_id, payload)
         VALUES ($1, $2, $3)
         ON CONFLICT (project_id) DO UPDATE SET
           version_id = EXCLUDED.version_id,
           payload = EXCLUDED.payload,
           updated_at = now()`,
        [project.projectId, versionId, JSON.stringify(layout)]
      )
      await pool.query(
        `INSERT INTO user_assets (
           id, user_id, name, category, source_type, source_name, source_url,
           original_filename, model_url, file_size_bytes,
           width_m, depth_m, height_m, raw_bounding_box_json,
           style_tags, room_types, license_confirmation, license_note,
           usage_scope, status
         ) VALUES ($1,$2,$3,'building_reference','asset_bank_import',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,true,$15,'private_project_only','ready')
         ON CONFLICT (id) DO UPDATE SET
           user_id = EXCLUDED.user_id,
           name = EXCLUDED.name,
           source_name = EXCLUDED.source_name,
           source_url = EXCLUDED.source_url,
           original_filename = EXCLUDED.original_filename,
           model_url = EXCLUDED.model_url,
           file_size_bytes = EXCLUDED.file_size_bytes,
           width_m = EXCLUDED.width_m,
           depth_m = EXCLUDED.depth_m,
           height_m = EXCLUDED.height_m,
           raw_bounding_box_json = EXCLUDED.raw_bounding_box_json,
           style_tags = EXCLUDED.style_tags,
           room_types = EXCLUDED.room_types,
           status = EXCLUDED.status,
           updated_at = now()`,
        [
          project.assetId,
          ownerId,
          `${project.name} (GLB)`,
          "Baruma-asset 500++",
          project.sourceFile,
          path.basename(file),
          modelUrl,
          size,
          project.site.widthM,
          project.site.depthM,
          round1(project.floors * 3.2),
          JSON.stringify(readBbox(project)),
          JSON.stringify([project.style]),
          JSON.stringify(["ruang_tamu", "kamar_tidur", "dapur", "kamar_mandi"]),
          "Imported from local Baruma-asset bank for internal Baruma testing.",
        ]
      )
      console.log(`DB upserted ${project.projectId} + ${project.assetId}`)
    }
  } finally {
    await pool.end()
  }
}

function convertMissingGlbs() {
  mkdirSync(outDir, { recursive: true })
  const missing = projects.filter((project) => !existsSync(slugFile(project)))
  if (missing.length === 0) return
  if (skipConvert) {
    throw new Error(`Missing GLB files and --skip-convert was used: ${missing.map((p) => slugFile(p)).join(", ")}`)
  }
  assertFile(blenderExe, "Blender executable")
  assertFile(converter, "SKP batch converter")
  for (const project of missing) assertFile(project.sourceFile, "Source SKP")

  // clean_building: strip 2D entourage (people/trees) + far-floating stray
  // fragments, then recenter at the origin — otherwise the GLB bbox lies
  // about the house size (rumah-tipe-36's raw scene spans ~24 m because of a
  // detached door panel 16 m away from the house).
  const candidates = missing.map((project) => ({
    label: project.slug,
    skp: project.sourceFile,
    clean_building: true,
  }))
  const candidatePath = path.join(outDir, "building-candidates.json")
  const reportPath = path.join(outDir, "building-report.jsonl")
  writeFileSync(candidatePath, JSON.stringify(candidates, null, 2))
  console.log(`Converting ${missing.length} SKP file(s) to GLB...`)
  run(blenderExe, ["--background", "--factory-startup", "--python", converter, "--", candidatePath, outDir, reportPath])
  if (existsSync(reportPath)) {
    const reportText = readFileSync(reportPath, "utf8").trim()
    console.log(reportText)
    // Persist each project's real bbox_m ([width, depth, height], the same
    // axis order batch_in_process.py reports for furniture) as a sidecar so
    // raw_bounding_box_json is always the model's actual geometry, even on a
    // later run where this GLB already exists and conversion is skipped.
    for (const line of reportText.split("\n").filter(Boolean)) {
      const entry = JSON.parse(line)
      if (!entry.ok || !entry.bbox_m) continue
      const project = missing.find((p) => p.slug === entry.label)
      if (!project) continue
      const [width, depth, height] = entry.bbox_m
      writeFileSync(bboxSidecarFile(project), JSON.stringify({ width, depth, height }))
    }
  }
  for (const project of missing) assertFile(slugFile(project), "Converted GLB")
}

function uploadGlbs() {
  if (skipUpload) return
  ensureRustfsEnv()
  assertFile(rustfsCli, "rustfs-cli")
  for (const project of projects) {
    const file = slugFile(project)
    assertFile(file, "GLB")
    const remote = `${bucket}/${storageKey(project)}`
    console.log(`Uploading ${path.basename(file)} -> ${remote}`)
    run("python", [rustfsCli, "upload", file, remote, "--content-type", "model/gltf-binary"], {
      cwd: rustfsCliDir,
    })
  }
}

async function main() {
  if (!process.env.DATABASE_URL && !dryRun) throw new Error("DATABASE_URL is required")
  convertMissingGlbs()
  uploadGlbs()
  if (!dryRun) await upsertDatabase()
  if (dryRun) {
    console.log(`Dry run complete: ${projects.length} building GLB file(s) are ready locally.`)
  } else {
    console.log(`Imported ${projects.length} building project(s) into Baruma asset-library.`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
