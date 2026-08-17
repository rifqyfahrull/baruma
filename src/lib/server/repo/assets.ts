/**
 * Typed queries for user_assets and asset_ingestion_jobs tables.
 */
import { query } from "@/lib/server/db"
import { expandSearchTerms } from "@/lib/assets/search-synonyms"

export type UserAssetRow = {
  id: string
  user_id: string
  name: string
  category: string
  source_type: string
  source_name?: string
  source_url?: string
  original_filename: string
  model_url: string
  thumbnail_url?: string
  file_size_bytes: number
  width_m?: number
  depth_m?: number
  height_m?: number
  /** Harga level aset (Rp) — diwariskan ke penempatan furniture; NULL =
   *  "belum dihargai" (excluded eksplisit di budget/RAB). */
  price_idr?: number | string | null
  raw_bounding_box_json?: unknown
  scale_factor_json?: unknown
  style_tags: string[]
  color_tags: string[]
  material_tags: string[]
  room_types: string[]
  license_confirmation: boolean
  license_note?: string
  usage_scope: string
  material_analysis_json?: unknown
  material_map_json?: unknown
  performance_json?: unknown
  status: string
  /** Aset katalog global — tampil (read-only) di My Library SEMUA user. */
  is_public?: boolean
  created_at: string
  updated_at: string
}

export type IngestionJobRow = {
  id: string
  user_id: string
  asset_id: string
  project_id?: string
  room_id?: string
  slot_id?: string
  expected_category: string
  status: string
  progress: number
  validation_result_json?: unknown
  required_user_inputs_json?: string[]
  error_message?: string
  created_at: string
  updated_at: string
}

export async function createUserAsset(
  id: string,
  userId: string,
  data: {
    name: string
    category: string
    originalFilename: string
    modelUrl: string
    fileSizeBytes: number
    sourceName?: string
    sourceUrl?: string
    rawBoundingBoxJson?: unknown
    performanceJson?: unknown
    materialAnalysisJson?: unknown
    status?: string
  }
): Promise<UserAssetRow> {
  const res = await query<UserAssetRow>(
    `INSERT INTO user_assets (
       id, user_id, name, category, original_filename, model_url,
       file_size_bytes, source_name, source_url,
       raw_bounding_box_json, performance_json, material_analysis_json, status
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [
      id, userId, data.name, data.category, data.originalFilename,
      data.modelUrl, data.fileSizeBytes, data.sourceName ?? null,
      data.sourceUrl ?? null, data.rawBoundingBoxJson ?? null,
      data.performanceJson ?? null, data.materialAnalysisJson ?? null,
      data.status ?? "uploaded",
    ]
  )
  return res.rows[0]
}

export async function updateAssetMetadata(
  assetId: string,
  userId: string,
  patch: Record<string, unknown>
): Promise<UserAssetRow | null> {
  const sets: string[] = []
  const vals: unknown[] = []
  let i = 1

  // `status` SENGAJA TIDAK di sini: transisi status aset hanya boleh lewat
  // pipeline ingestion, bukan PATCH metadata klien (cegah mass-assignment yang
  // melompati validasi). Dimensi divalidasi angka wajar sebelum ditulis.
  const NUMERIC = new Set(["width_m", "depth_m", "height_m"])
  const allowed = [
    "name", "category", "width_m", "depth_m", "height_m",
    "style_tags", "color_tags", "material_tags",
    "license_confirmation", "license_note", "material_map_json",
    "scale_factor_json", "price_idr",
  ]
  for (const key of allowed) {
    if (key in patch) {
      const v = patch[key]
      if (NUMERIC.has(key) && !(typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 100)) {
        continue // dimensi tak wajar diabaikan (bukan error keras)
      }
      if (key === "price_idr") {
        // Harga: angka positif wajar (≤ Rp 100 M per unit) atau null utk
        // menghapus; nilai tak wajar diabaikan seperti dimensi.
        if (v === null) {
          sets.push(`price_idr = $${i}`)
          vals.push(null)
          i++
        } else if (typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 100_000_000_000) {
          sets.push(`price_idr = $${i}`)
          vals.push(Math.round(v))
          i++
        }
        continue
      }
      sets.push(`${key} = $${i}`)
      vals.push(v)
      i++
    }
  }
  if (!sets.length) return null

  vals.push(assetId, userId)
  const res = await query<UserAssetRow>(
    `UPDATE user_assets SET ${sets.join(", ")}
     WHERE id = $${i} AND user_id = $${i + 1}
     RETURNING *`,
    vals
  )
  return res.rows[0] ?? null
}

export async function createIngestionJob(
  id: string,
  userId: string,
  data: {
    assetId: string
    projectId?: string
    roomId?: string
    slotId?: string
    expectedCategory: string
  }
): Promise<IngestionJobRow> {
  const res = await query<IngestionJobRow>(
    `INSERT INTO asset_ingestion_jobs (
       id, user_id, asset_id, project_id, room_id, slot_id,
       expected_category, status
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,'uploaded')
     RETURNING *`,
    [
      id, userId, data.assetId, data.projectId ?? null,
      data.roomId ?? null, data.slotId ?? null, data.expectedCategory,
    ]
  )
  return res.rows[0]
}

/** Satu job ingestion, DISCOPE ke pemiliknya (otorisasi tingkat-objek).
 *  `userId` opsional agar pemakai lama (owner sudah terjamin) tak berubah,
 *  tapi jalur API WAJIB memberikannya untuk mencegah IDOR baca job user lain. */
export async function getIngestionJob(
  jobId: string,
  userId?: string
): Promise<IngestionJobRow | null> {
  const res = userId
    ? await query<IngestionJobRow>(
        `SELECT * FROM asset_ingestion_jobs WHERE id = $1 AND user_id = $2`,
        [jobId, userId]
      )
    : await query<IngestionJobRow>(
        `SELECT * FROM asset_ingestion_jobs WHERE id = $1`,
        [jobId]
      )
  return res.rows[0] ?? null
}

export async function updateIngestionJob(
  jobId: string,
  patch: { status?: string; progress?: number; validationResultJson?: unknown; requiredUserInputsJson?: string[]; errorMessage?: string }
): Promise<IngestionJobRow | null> {
  const sets: string[] = []
  const vals: unknown[] = []
  let i = 1
  if (patch.status !== undefined) { sets.push(`status = $${i}`); vals.push(patch.status); i++ }
  if (patch.progress !== undefined) { sets.push(`progress = $${i}`); vals.push(patch.progress); i++ }
  if (patch.validationResultJson !== undefined) { sets.push(`validation_result_json = $${i}`); vals.push(JSON.stringify(patch.validationResultJson)); i++ }
  if (patch.requiredUserInputsJson !== undefined) { sets.push(`required_user_inputs_json = $${i}`); vals.push(JSON.stringify(patch.requiredUserInputsJson)); i++ }
  if (patch.errorMessage !== undefined) { sets.push(`error_message = $${i}`); vals.push(patch.errorMessage); i++ }
  if (!sets.length) return null

  vals.push(jobId)
  const res = await query<IngestionJobRow>(
    `UPDATE asset_ingestion_jobs SET ${sets.join(", ")} WHERE id = $${i} RETURNING *`,
    vals
  )
  return res.rows[0] ?? null
}

/** A single asset, scoped to its owner (authorization by construction). */
// Aset katalog global (is_public) ikut terbaca: tampil di library semua user
// dan boleh di-attach ke slot/ruang siapa pun. Mutasi (rename/delete) tetap
// milik owner karena jalur tulis memfilter user_id saja.
export async function getUserAsset(userId: string, assetId: string): Promise<UserAssetRow | null> {
  const { rows } = await query<UserAssetRow>(
    `SELECT * FROM user_assets WHERE id = $1 AND (user_id = $2 OR is_public = true)`,
    [assetId, userId]
  )
  return rows[0] ?? null
}

/** Baris ringan utk daftar My Library — hanya kolom skalar yang dipakai
 *  endpoint list (JSONB berat spt material_analysis_json TIDAK ikut ditarik). */
export type UserAssetListRow = Pick<
  UserAssetRow,
  | "id" | "user_id" | "name" | "category" | "source_name" | "source_url"
  | "model_url" | "thumbnail_url" | "file_size_bytes"
  | "width_m" | "depth_m" | "height_m" | "price_idr" | "performance_json"
  | "status" | "is_public" | "created_at"
> & {
  /** Deskripsi Indonesia dari asset_knowledge (enrichment LLM); null bila belum ada. */
  description?: string | null
}

const LIST_COLS =
  "id, user_id, name, category, source_name, source_url, model_url, thumbnail_url, file_size_bytes, width_m, depth_m, height_m, price_idr, performance_json, status, is_public, created_at"

export interface ListUserAssetsOptions {
  category?: string
  search?: string
  limit?: number
  offset?: number
}

export const ASSETS_PAGE_SIZE = 30
const ASSETS_MAX_LIMIT = 100

/**
 * Daftar aset (milik user + katalog global publik) dengan paginasi & search
 * SERVER-SIDE — katalog kini puluhan ribu, jadi tak lagi menarik semua baris.
 * `count(*) over()` memberi total (untuk hitung "punya halaman berikutnya" &
 * angka total) dalam satu query. Search: ILIKE case-insensitive pada
 * name/category/source_name.
 */
export async function listUserAssets(
  userId: string,
  opts: ListUserAssetsOptions = {}
): Promise<{ rows: UserAssetListRow[]; total: number }> {
  const limit = Math.min(Math.max(1, Math.floor(opts.limit ?? ASSETS_PAGE_SIZE)), ASSETS_MAX_LIMIT)
  const offset = Math.max(0, Math.floor(opts.offset ?? 0))

  const where: string[] = ["(ua.user_id = $1 OR ua.is_public = true)"]
  const params: unknown[] = [userId]
  if (opts.category) {
    params.push(opts.category)
    where.push(`ua.category = $${params.length}`)
  }
  if (opts.search && opts.search.trim()) {
    // Ekspansi sinonim ID↔EN (customer ID mencari "pagar" → model "Gate").
    // ILIKE ANY(array of %term%) mencocokkan salah satu istilah hasil ekspansi.
    // Termasuk keywords/description dari asset_knowledge (enrichment LLM) —
    // mis. "gerbang besi hitam" menemukan aset yang deskripsinya menyebut itu.
    const patterns = expandSearchTerms(opts.search).map((t) => `%${t}%`)
    params.push(patterns)
    const p = `$${params.length}`
    where.push(
      `(ua.name ILIKE ANY(${p}) OR ua.category ILIKE ANY(${p}) OR ua.source_name ILIKE ANY(${p})` +
        ` OR ak.keywords ILIKE ANY(${p}) OR ak.description_id ILIKE ANY(${p}))`,
    )
  }
  params.push(limit)
  const limitParam = `$${params.length}`
  params.push(offset)
  const offsetParam = `$${params.length}`

  const cols = LIST_COLS.split(", ").map((c) => `ua.${c}`).join(", ")
  const res = await query<UserAssetListRow & { total_count: string }>(
    `SELECT ${cols}, ak.description_id AS description, count(*) OVER() AS total_count
     FROM user_assets ua
     LEFT JOIN asset_knowledge ak ON ak.asset_id = ua.id
     WHERE ${where.join(" AND ")}
     ORDER BY (ua.user_id = $1) DESC, ua.created_at DESC
     LIMIT ${limitParam} OFFSET ${offsetParam}`,
    params
  )
  const total = res.rows[0] ? Number(res.rows[0].total_count) : 0
  const rows = res.rows.map((row) => {
    const { total_count, ...rest } = row
    void total_count
    return rest as UserAssetListRow
  })
  return { rows, total }
}
