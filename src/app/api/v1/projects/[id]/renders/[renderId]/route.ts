import { requireUser } from "@/lib/server/auth-server"
import { getOwnedProject } from "@/lib/server/repo/projects"
import { getRenderJob, updateRenderJob } from "@/lib/server/repo/renders"
import { getRenderProvider } from "@/lib/server/ai-render"
import { finalizeRenderJob, failRenderJob } from "@/lib/server/ai-render/finalize"
import { renderJobView } from "@/lib/server/ai-render/view"
import { ok, err, handleError } from "@/lib/server/response"

/**
 * GET detail job render — dipakai polling klien (Fase 8). Repo eksplisit
 * "tanpa cron": rekonsiliasi berjalan LAZY di sini, dipicu saat klien
 * kebetulan mem-poll job yang basi, bukan job scheduler terpisah.
 *
 * Dua kasus basi yang ditangani (docs/plan-integrasi-ai-renderer-2026-08.md
 * §5b):
 *  1. submitted/processing + provider_request_id ada + updated_at > 3 menit
 *     -> panggil provider.checkStatus() (hanya fal yang mengimplementasikan;
 *     provider lain -> undefined -> dibiarkan apa adanya).
 *  2. queued TANPA provider_request_id + updated_at > 5 menit -> job gemini
 *     yang mati krn restart pm2 sebelum after() sempat submit -> failed +
 *     refund otomatis (risiko residual yang sama dgn alternatives/generate).
 */
const RECONCILE_STALE_MS = 3 * 60 * 1000
const QUEUED_STALE_MS = 5 * 60 * 1000

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string; renderId: string }> }
): Promise<Response> {
  try {
    const { userId } = await requireUser(request)
    const { id: projectId, renderId } = await ctx.params
    const project = await getOwnedProject(projectId, userId)
    if (!project) return err(404, "Project not found")

    let job = await getRenderJob(renderId, userId)
    if (!job || job.projectId !== projectId) return err(404, "Render tidak ditemukan")

    const ageMs = Date.now() - new Date(job.updatedAt).getTime()

    if (
      (job.status === "submitted" || job.status === "processing") &&
      job.providerRequestId &&
      ageMs > RECONCILE_STALE_MS
    ) {
      const provider = getRenderProvider(job.mode)
      const check = await provider?.checkStatus?.(job.providerRequestId)
      if (check && typeof check === "object" && "imageUrl" in check) {
        await finalizeRenderJob(job, { imageUrl: check.imageUrl })
      } else if (check === "failed") {
        await failRenderJob(job, "Render gagal di provider (rekonsiliasi)")
      } else if (check === "processing") {
        // Trigger updated_at (0039_ai_renders.sql set_updated_at) menyentuh
        // kolom itu meski `status` diset ke nilai yang sama — cukup utk
        // "touch" tanpa kolom khusus, sekaligus melakukan transisi
        // submitted->processing pada polling pertama.
        await updateRenderJob(
          job.id,
          { status: "processing" },
          { fromStatuses: ["submitted", "processing"] }
        )
      }
      // check === null / undefined -> provider tak bisa dihubungi/blm siap
      // -> dibiarkan, dicoba lagi di polling berikutnya.
      const fresh = await getRenderJob(renderId, userId)
      if (fresh) job = fresh
    } else if (job.status === "queued" && !job.providerRequestId && ageMs > QUEUED_STALE_MS) {
      await failRenderJob(job, "Render kedaluwarsa — proses latar terhenti")
      const fresh = await getRenderJob(renderId, userId)
      if (fresh) job = fresh
    }

    return ok(renderJobView(job))
  } catch (e) {
    return handleError(e)
  }
}
