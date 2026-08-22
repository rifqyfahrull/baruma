/**
 * Finalisasi job render (Fase 5) — satu titik dipakai tiga jalur berbeda yang
 * semuanya "job selesai di provider": submit inline (mock/fal sinkron),
 * `after()` background (gemini), webhook fal, DAN rekonsiliasi lazy di GET
 * detail. Idempoten via `fromStatuses` guard di updateRenderJob — race antara
 * dua jalur (mis. webhook vs rekonsiliasi lazy yang kebetulan jalan bersamaan)
 * membuat yang kalah dapat `null` dari updateRenderJob dan diam-diam no-op,
 * BUKAN refund dobel / overwrite output.
 */
import { updateRenderJob, type RenderJob } from "@/lib/server/repo/renders"
import { refundCreditsOnce } from "@/lib/server/repo/credits"
import { putObject } from "@/lib/server/storage"
import { applyWatermark, toWebp } from "./postprocess"

/** Status asal yang valid utk transisi -> succeeded/failed (guard atomik). */
const IN_FLIGHT_STATUSES = ["queued", "submitted", "processing"]

/** Unduh gambar dari URL provider (fal/gemini signed result), null bila gagal. */
async function downloadImage(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) {
      console.warn(`[ai-render/finalize] unduh hasil provider gagal: HTTP ${res.status}`)
      return null
    }
    const buf = await res.arrayBuffer()
    return new Uint8Array(buf)
  } catch (e) {
    console.warn(
      "[ai-render/finalize] unduh hasil provider gagal:",
      e instanceof Error ? e.message : String(e)
    )
    return null
  }
}

async function failAndRefund(job: RenderJob, message: string): Promise<void> {
  await updateRenderJob(
    job.id,
    { status: "failed", errorMessage: message },
    { fromStatuses: IN_FLIGHT_STATUSES }
  )
  // refundCreditsOnce idempoten by (profileId, reason, refId=jobId) — aman
  // dipanggil ulang bila dua jalur finalize kebetulan sama-sama gagal.
  await refundCreditsOnce(job.ownerId, job.creditsSpent, "ai_render_refund", job.id)
}

/**
 * Selesaikan job: [unduh bila URL] -> [watermark bila job.watermarked] ->
 * konversi WebP -> PUT ke storage -> status succeeded. Kegagalan di titik
 * mana pun -> failed + refund (bukan throw — caller (route/after()/webhook)
 * tak perlu try/catch tambahan di sekelilingnya).
 */
export async function finalizeRenderJob(
  job: RenderJob,
  result: { imageBytes: Uint8Array } | { imageUrl: string }
): Promise<RenderJob | null> {
  try {
    let bytes: Uint8Array
    if ("imageUrl" in result) {
      const downloaded = await downloadImage(result.imageUrl)
      if (!downloaded) {
        await failAndRefund(job, "Gagal mengunduh hasil dari provider")
        return null
      }
      bytes = downloaded
    } else {
      bytes = result.imageBytes
    }

    if (job.watermarked) {
      bytes = await applyWatermark(bytes)
    }
    const webp = await toWebp(bytes)

    const outputKey = `renders/${job.ownerId}/${job.projectId}/${job.id}-output.webp`
    await putObject(outputKey, webp, "image/webp")

    // Guard fromStatuses: kalah race (mis. webhook & rekonsiliasi lazy jalan
    // bersamaan) -> 0 baris -> null, output sudah tersimpan tapi row tak
    // diupdate lagi oleh delivery ini — tak masalah, delivery yang menang
    // sudah/akan menulis output_key yang setara (params sama -> hasil sama
    // secara efektif utk request yang sama).
    return await updateRenderJob(
      job.id,
      { status: "succeeded", outputKey },
      { fromStatuses: IN_FLIGHT_STATUSES }
    )
  } catch (e) {
    console.error(
      "[ai-render/finalize] gagal:",
      e instanceof Error ? e.message : String(e)
    )
    await failAndRefund(
      job,
      e instanceof Error ? e.message : "Gagal memproses hasil render"
    )
    return null
  }
}

/** Tandai job gagal + refund — dipakai saat provider sendiri melaporkan
 *  kegagalan (submit() -> null, webhook status ERROR, checkStatus() ->
 *  "failed", atau job basi tanpa provider_request_id). */
export async function failRenderJob(job: RenderJob, message: string): Promise<void> {
  await failAndRefund(job, message)
}
