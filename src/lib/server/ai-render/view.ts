/**
 * Bentuk response job render yang dikirim ke klien (POST create, GET list,
 * GET detail — Fase 5) — satu tempat supaya ketiganya konsisten.
 */
import { assetPublicUrl } from "@/lib/server/storage"
import type { RenderJob } from "@/lib/server/repo/renders"

export interface RenderJobView {
  id: string
  status: RenderJob["status"]
  mode: RenderJob["mode"]
  preset: string
  shotId: string
  watermarked: boolean
  outputUrl: string | null
  errorMessage?: string
  createdAt: string
}

export function renderJobView(job: RenderJob): RenderJobView {
  return {
    id: job.id,
    status: job.status,
    mode: job.mode,
    preset: job.preset,
    shotId: job.shotId,
    watermarked: job.watermarked,
    outputUrl: job.outputKey ? assetPublicUrl(job.outputKey) : null,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt,
  }
}
