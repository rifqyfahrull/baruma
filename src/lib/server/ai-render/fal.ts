/**
 * Provider Mode Presisi — FLUX.1 [dev] Control LoRA Depth via fal.ai queue
 * API. Async: `submit()` memasukkan job ke antrean fal dan mengembalikan
 * `providerRequestId`, hasil datang lewat webhook ATAU rekonsiliasi lazy
 * (`checkStatus`) — sesuai Fase 5b/5c di plan.
 *
 * Model id dikonfirmasi via dokumentasi publik fal.ai (Agustus 2026):
 * `fal-ai/flux-control-lora-depth/image-to-image` — varian image-to-image
 * dari FLUX Control LoRA Depth, menerima `image_url` (warna, dari beauty
 * pass) + `control_lora_image_url` (depth map, dari depth pass) sekaligus,
 * cocok dengan pipeline capture kita (beauty+depth).
 *
 * Queue API (fal.ai/docs/model-endpoints/queue):
 * - Submit: POST https://queue.fal.run/{model} , header
 *   `Authorization: Key $FAL_KEY`, webhook via query `?fal_webhook=...`.
 * - Status: GET https://queue.fal.run/{model}/requests/{id}/status →
 *   {status: "IN_QUEUE"|"IN_PROGRESS"|"COMPLETED", ...}.
 * - Hasil: GET https://queue.fal.run/{model}/requests/{id} (setelah
 *   COMPLETED) → payload output model, gambar di `images[0].url`.
 *
 * Kontrak "tidak pernah throw" (mengikuti openai-client.ts): semua kegagalan
 * (network, non-200, bentuk respons tak terduga) → console.warn + null.
 */
import type { RenderProvider, RenderProviderInput, SubmitResult } from "./types"

/** Model id di satu tempat — gampang diganti begitu fal merilis endpoint baru. */
export const FAL_DEPTH_MODEL = "fal-ai/flux-control-lora-depth/image-to-image"

const FAL_QUEUE_BASE = "https://queue.fal.run"
const TIMEOUT_MS = 30_000 // hanya submit/poll — render sesungguhnya jalan async di fal

function getEnv(name: string): string | undefined {
  const value = process.env[name]
  if (!value) return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export function falProviderEnabled(): boolean {
  return !!getEnv("FAL_KEY")
}

interface FalSubmitResponse {
  request_id?: string
}

async function submit(input: RenderProviderInput): Promise<SubmitResult> {
  const apiKey = getEnv("FAL_KEY")
  if (!apiKey) return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const url = new URL(`${FAL_QUEUE_BASE}/${FAL_DEPTH_MODEL}`)
    if (input.webhookUrl) {
      url.searchParams.set("fal_webhook", input.webhookUrl)
    }

    const res = await fetch(url.toString(), {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Key ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: input.prompt,
        seed: input.seed,
        image_url: input.beautyUrl,
        control_lora_image_url: input.depthUrl,
      }),
    })

    if (!res.ok) {
      console.warn(`[ai-render/fal] submit HTTP ${res.status}`)
      return null
    }

    const json = (await res.json()) as FalSubmitResponse
    if (!json.request_id) {
      console.warn("[ai-render/fal] respons submit tidak mengandung request_id")
      return null
    }

    return { kind: "async", providerRequestId: json.request_id }
  } catch (e) {
    console.warn(
      "[ai-render/fal] submit gagal:",
      e instanceof Error ? e.message : String(e)
    )
    return null
  } finally {
    clearTimeout(timer)
  }
}

interface FalStatusResponse {
  status?: string
}
interface FalResultResponse {
  images?: Array<{ url?: string }>
}

async function checkStatus(
  providerRequestId: string
): Promise<"processing" | { imageUrl: string } | "failed" | null> {
  const apiKey = getEnv("FAL_KEY")
  if (!apiKey) return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const statusRes = await fetch(
      `${FAL_QUEUE_BASE}/${FAL_DEPTH_MODEL}/requests/${providerRequestId}/status`,
      {
        signal: controller.signal,
        headers: { Authorization: `Key ${apiKey}` },
      }
    )
    if (!statusRes.ok) {
      console.warn(`[ai-render/fal] checkStatus HTTP ${statusRes.status}`)
      return null
    }

    const status = ((await statusRes.json()) as FalStatusResponse).status
    if (status === "IN_QUEUE" || status === "IN_PROGRESS") return "processing"
    if (status !== "COMPLETED") return "failed"

    const resultRes = await fetch(
      `${FAL_QUEUE_BASE}/${FAL_DEPTH_MODEL}/requests/${providerRequestId}`,
      {
        signal: controller.signal,
        headers: { Authorization: `Key ${apiKey}` },
      }
    )
    if (!resultRes.ok) {
      console.warn(`[ai-render/fal] fetch hasil HTTP ${resultRes.status}`)
      return null
    }

    const result = (await resultRes.json()) as FalResultResponse
    const imageUrl = result.images?.[0]?.url
    if (!imageUrl) {
      console.warn("[ai-render/fal] hasil COMPLETED tanpa images[0].url")
      return "failed"
    }

    return { imageUrl }
  } catch (e) {
    console.warn(
      "[ai-render/fal] checkStatus gagal:",
      e instanceof Error ? e.message : String(e)
    )
    return null
  } finally {
    clearTimeout(timer)
  }
}

export const falRenderProvider: RenderProvider = { submit, checkStatus }
