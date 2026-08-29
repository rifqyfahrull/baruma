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
  // Fase B (Task 3) — target render (exterior|interior) & ruang terpilih,
  // lihat komentar `target`/`roomId` di RenderJob (repo/renders.ts).
  target: string
  roomId?: string
  // Spec 2026-08-29 (AI Render × Chat — Style Notes) — "catatan gaya" user
  // tersanitasi, lihat komentar `styleNotes` di RenderJob (repo/renders.ts).
  // Audit/galeri; UI galeri yang menampilkannya di luar cakupan task ini.
  styleNotes?: string
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
    target: job.target,
    roomId: job.roomId,
    styleNotes: job.styleNotes,
  }
}
