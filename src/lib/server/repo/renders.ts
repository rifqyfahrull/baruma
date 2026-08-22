/**
 * Typed queries for render_jobs — job AI Image Renderer (Fase 1: skema DB +
 * repo). Meniru pola asset_ingestion_jobs (createIngestionJob/getIngestionJob/
 * updateIngestionJob di assets.ts) utk bentuk query, dan dynamic SET builder
 * updateProject (projects.ts) utk update parsial + guard transisi status.
 */
import { query } from "@/lib/server/db"

/** Baris tabel render_jobs, snake_case sesuai db/migrations/0038_ai_renders.sql. */
interface RenderJobRow {
  id: string
  owner_id: string
  project_id: string
  status: string
  mode: string
  preset: string
  shot_id: string
  seed: number
  credits_spent: number
  provider: string
  provider_request_id: string | null
  params_hash: string
  input_keys: unknown
  output_key: string | null
  watermarked: boolean
  error_message: string | null
  created_at: string
  updated_at: string
}

export type RenderJobStatus = "queued" | "submitted" | "processing" | "succeeded" | "failed"
export type RenderJobMode = "cepat" | "presisi"

/** Domain (camelCase) — dipakai API routes & test, mirip Project (projects.ts). */
export interface RenderJob {
  id: string
  ownerId: string
  projectId: string
  status: RenderJobStatus
  mode: RenderJobMode
  preset: string
  shotId: string
  seed: number
  creditsSpent: number
  provider: string
  providerRequestId?: string
  paramsHash: string
  inputKeys: unknown
  outputKey?: string
  watermarked: boolean
  errorMessage?: string
  createdAt: string
  updatedAt: string
}

// Kolom eksplisit (gaya assets.ts/projects.ts) — hindari `SELECT *` biar kolom
// baru di masa depan tak diam-diam ikut terbaca tanpa disadari mapper-nya.
const COLS =
  "id, owner_id, project_id, status, mode, preset, shot_id, seed, credits_spent, " +
  "provider, provider_request_id, params_hash, input_keys, output_key, watermarked, " +
  "error_message, created_at, updated_at"

function rowToRenderJob(row: RenderJobRow): RenderJob {
  return {
    id: row.id,
    ownerId: row.owner_id,
    projectId: row.project_id,
    status: row.status as RenderJobStatus,
    mode: row.mode as RenderJobMode,
    preset: row.preset,
    shotId: row.shot_id,
    seed: row.seed,
    creditsSpent: row.credits_spent,
    provider: row.provider,
    providerRequestId: row.provider_request_id ?? undefined,
    paramsHash: row.params_hash,
    inputKeys: row.input_keys,
    outputKey: row.output_key ?? undefined,
    watermarked: row.watermarked,
    errorMessage: row.error_message ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function createRenderJob(
  id: string,
  ownerId: string,
  opts: {
    projectId: string
    mode: RenderJobMode
    preset: string
    shotId: string
    seed: number
    creditsSpent: number
    provider: string
    paramsHash: string
    inputKeys: unknown
    status?: RenderJobStatus // default 'queued' (lihat DEFAULT kolom di migration)
    // default false (lihat DEFAULT kolom di migration) — true utk plan free
    // (route POST .../renders menghitungnya dari getEntitlements().aiRenderHd
    // SEBELUM insert, supaya finalizeRenderJob tinggal baca job.watermarked
    // tanpa query entitlements ulang).
    watermarked?: boolean
  }
): Promise<RenderJob> {
  const res = await query<RenderJobRow>(
    `INSERT INTO render_jobs (
       id, owner_id, project_id, status, mode, preset, shot_id, seed,
       credits_spent, provider, params_hash, input_keys, watermarked
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING ${COLS}`,
    [
      id,
      ownerId,
      opts.projectId,
      opts.status ?? "queued",
      opts.mode,
      opts.preset,
      opts.shotId,
      opts.seed,
      opts.creditsSpent,
      opts.provider,
      opts.paramsHash,
      JSON.stringify(opts.inputKeys),
      opts.watermarked ?? false,
    ]
  )
  return rowToRenderJob(res.rows[0])
}

/** Satu job render, SELALU discope ke pemiliknya (otorisasi tingkat-objek —
 *  anti-IDOR: job milik user lain harus terlihat seperti tak ada / 404, bukan
 *  403, sama seperti getIngestionJob di assets.ts). */
export async function getRenderJob(id: string, ownerId: string): Promise<RenderJob | null> {
  const res = await query<RenderJobRow>(
    `SELECT ${COLS} FROM render_jobs WHERE id = $1 AND owner_id = $2`,
    [id, ownerId]
  )
  return res.rows[0] ? rowToRenderJob(res.rows[0]) : null
}

/**
 * Variant TANPA owner-scoping — HANYA utk konteks yang sudah tervalidasi
 * lewat jalur otorisasi lain (webhook `POST /api/webhooks/ai-render`, yang
 * digerbangi token rahasia `AI_RENDER_WEBHOOK_SECRET` via timingSafeEqual,
 * bukan sesi user). Webhook provider tak pernah membawa identitas user
 * Baruma (fal hanya tahu `request_id` miliknya sendiri) sehingga tak ada
 * `ownerId` utk discope — token itu sendirilah gerbang otorisasinya.
 * JANGAN dipakai dari route yang menerima request user biasa (pakai
 * `getRenderJob` yang owner-scoped di sana, anti-IDOR).
 */
export async function getRenderJobById(id: string): Promise<RenderJob | null> {
  const res = await query<RenderJobRow>(`SELECT ${COLS} FROM render_jobs WHERE id = $1`, [id])
  return res.rows[0] ? rowToRenderJob(res.rows[0]) : null
}

export interface UpdateRenderJobPatch {
  status?: RenderJobStatus
  providerRequestId?: string
  outputKey?: string
  watermarked?: boolean
  errorMessage?: string
}

/**
 * Dynamic SET builder (gaya updateProject/projects.ts). Bila `fromStatuses`
 * diberikan, tambahkan guard `AND status = ANY($..)` — transisi status jadi
 * atomik dan hanya berlaku dari status yang diharapkan. Dipakai webhook fal
 * & rekonsiliasi lazy di GET detail supaya idempoten: yang kalah race
 * (row sudah pindah status sebelum UPDATE ini nyampai) dapat 0 baris ->
 * null, bukan overwrite ganda / refund dobel.
 */
export async function updateRenderJob(
  id: string,
  patch: UpdateRenderJobPatch,
  opts?: { fromStatuses?: string[] }
): Promise<RenderJob | null> {
  const sets: string[] = []
  const vals: unknown[] = []
  let i = 1

  if (patch.status !== undefined) {
    sets.push(`status = $${i}`)
    vals.push(patch.status)
    i++
  }
  if (patch.providerRequestId !== undefined) {
    sets.push(`provider_request_id = $${i}`)
    vals.push(patch.providerRequestId)
    i++
  }
  if (patch.outputKey !== undefined) {
    sets.push(`output_key = $${i}`)
    vals.push(patch.outputKey)
    i++
  }
  if (patch.watermarked !== undefined) {
    sets.push(`watermarked = $${i}`)
    vals.push(patch.watermarked)
    i++
  }
  if (patch.errorMessage !== undefined) {
    sets.push(`error_message = $${i}`)
    vals.push(patch.errorMessage)
    i++
  }
  if (!sets.length) return null

  vals.push(id)
  let where = `WHERE id = $${i}`
  i++
  if (opts?.fromStatuses?.length) {
    vals.push(opts.fromStatuses)
    where += ` AND status = ANY($${i})`
    i++
  }

  const res = await query<RenderJobRow>(
    `UPDATE render_jobs SET ${sets.join(", ")} ${where} RETURNING ${COLS}`,
    vals
  )
  return res.rows[0] ? rowToRenderJob(res.rows[0]) : null
}

/** Galeri render per proyek, terbaru dulu (dipakai tab galeri Fase 8). */
export async function listRenderJobs(
  projectId: string,
  ownerId: string,
  limit = 50
): Promise<RenderJob[]> {
  const res = await query<RenderJobRow>(
    `SELECT ${COLS} FROM render_jobs
     WHERE project_id = $1 AND owner_id = $2
     ORDER BY created_at DESC
     LIMIT $3`,
    [projectId, ownerId, limit]
  )
  return res.rows.map(rowToRenderJob)
}

/** Cache hit: render SUKSES terbaru dgn params_hash sama milik user ini ->
 *  dipakai ulang, tak render lagi & tak potong kredit lagi (lihat
 *  render_jobs_cache_idx parsial di migration). */
export async function findCachedRender(
  ownerId: string,
  paramsHash: string
): Promise<RenderJob | null> {
  const res = await query<RenderJobRow>(
    `SELECT ${COLS} FROM render_jobs
     WHERE owner_id = $1 AND params_hash = $2 AND status = 'succeeded'
     ORDER BY created_at DESC
     LIMIT 1`,
    [ownerId, paramsHash]
  )
  return res.rows[0] ? rowToRenderJob(res.rows[0]) : null
}
