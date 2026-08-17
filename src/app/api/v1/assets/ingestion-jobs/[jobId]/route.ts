import { requireUser } from "@/lib/server/auth-server"
import { ok, err, handleError } from "@/lib/server/response"
import { getIngestionJob } from "@/lib/server/repo/assets"

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ jobId: string }> }
): Promise<Response> {
  try {
    const { userId } = await requireUser(_request)
    const { jobId } = await ctx.params

    // Discope ke pemilik: job user lain → 404 (cegah IDOR / kebocoran id).
    const job = await getIngestionJob(jobId, userId)
    if (!job) return err(404, "Job not found")

    return ok({
      jobId: job.id,
      assetId: job.asset_id,
      status: job.status,
      progress: job.progress,
      validationResult: job.validation_result_json ?? undefined,
      requiredUserInputs: job.required_user_inputs_json ?? undefined,
    })
  } catch (e) {
    return handleError(e)
  }
}
