// @vitest-environment node
/**
 * Unit test finalize.ts (Fase 5) — orkestrasi finalisasi job murni diuji dgn
 * repo/storage/postprocess di-mock (postprocess butuh binary sharp asli,
 * tak relevan diuji ulang di sini — sudah dites postprocess.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/server/repo/renders", () => ({ updateRenderJob: vi.fn() }))
vi.mock("@/lib/server/repo/credits", () => ({ refundCreditsOnce: vi.fn() }))
vi.mock("@/lib/server/storage", () => ({ putObject: vi.fn() }))
vi.mock("./postprocess", () => ({
  applyWatermark: vi.fn(async (b: Uint8Array) => b),
  toWebp: vi.fn(async (b: Uint8Array) => b),
}))

import { finalizeRenderJob, failRenderJob } from "./finalize"
import * as rendersRepo from "@/lib/server/repo/renders"
import * as creditsRepo from "@/lib/server/repo/credits"
import * as storageLib from "@/lib/server/storage"
import * as postprocessLib from "./postprocess"
import type { RenderJob } from "@/lib/server/repo/renders"

function makeJob(overrides: Partial<RenderJob> = {}): RenderJob {
  return {
    id: "rnd-abc12345",
    ownerId: "user-1",
    projectId: "proj-xyz",
    status: "submitted",
    mode: "cepat",
    preset: "tropis-siang",
    shotId: "iso-siang",
    seed: 42,
    creditsSpent: 1,
    provider: "mock",
    paramsHash: "hash-abc",
    inputKeys: { beauty: "renders/user-1/proj-xyz/123-beauty.png" },
    watermarked: false,
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    ...overrides,
  }
}

beforeEach(() => {
  vi.mocked(rendersRepo.updateRenderJob).mockReset()
  vi.mocked(creditsRepo.refundCreditsOnce).mockReset().mockResolvedValue("ok")
  vi.mocked(storageLib.putObject).mockReset().mockResolvedValue(undefined)
  vi.mocked(postprocessLib.applyWatermark).mockClear()
  vi.mocked(postprocessLib.toWebp).mockClear()
  vi.stubGlobal("fetch", vi.fn())
})

describe("finalizeRenderJob — dari imageBytes (mock/gemini sinkron)", () => {
  it("watermarked=false -> tak memanggil applyWatermark, tetap toWebp + putObject + succeeded", async () => {
    const job = makeJob({ watermarked: false })
    vi.mocked(rendersRepo.updateRenderJob).mockResolvedValueOnce(
      makeJob({ status: "succeeded", outputKey: "renders/user-1/proj-xyz/rnd-abc12345-output.webp" })
    )

    const result = await finalizeRenderJob(job, { imageBytes: new Uint8Array([1, 2, 3]) })

    expect(postprocessLib.applyWatermark).not.toHaveBeenCalled()
    expect(postprocessLib.toWebp).toHaveBeenCalledTimes(1)
    expect(storageLib.putObject).toHaveBeenCalledWith(
      "renders/user-1/proj-xyz/rnd-abc12345-output.webp",
      expect.any(Uint8Array),
      "image/webp"
    )
    expect(rendersRepo.updateRenderJob).toHaveBeenCalledWith(
      job.id,
      { status: "succeeded", outputKey: "renders/user-1/proj-xyz/rnd-abc12345-output.webp" },
      { fromStatuses: ["queued", "submitted", "processing"] }
    )
    expect(result?.status).toBe("succeeded")
  })

  it("watermarked=true -> applyWatermark dipanggil sebelum toWebp", async () => {
    const job = makeJob({ watermarked: true })
    vi.mocked(rendersRepo.updateRenderJob).mockResolvedValueOnce(makeJob({ status: "succeeded" }))

    await finalizeRenderJob(job, { imageBytes: new Uint8Array([1, 2, 3]) })

    expect(postprocessLib.applyWatermark).toHaveBeenCalledTimes(1)
    expect(postprocessLib.toWebp).toHaveBeenCalledTimes(1)
  })

  it("putObject gagal -> failed + refund, bukan throw", async () => {
    const job = makeJob()
    vi.mocked(storageLib.putObject).mockRejectedValueOnce(new Error("storage down"))
    vi.mocked(rendersRepo.updateRenderJob).mockResolvedValueOnce(makeJob({ status: "failed" }))

    const result = await finalizeRenderJob(job, { imageBytes: new Uint8Array([1]) })

    expect(result).toBeNull()
    expect(rendersRepo.updateRenderJob).toHaveBeenCalledWith(
      job.id,
      { status: "failed", errorMessage: "storage down" },
      { fromStatuses: ["queued", "submitted", "processing"] }
    )
    expect(creditsRepo.refundCreditsOnce).toHaveBeenCalledWith(
      job.ownerId,
      job.creditsSpent,
      "ai_render_refund",
      job.id
    )
  })

  it("fromStatuses guard kalah race -> updateRenderJob null -> finalize kembalikan null tanpa refund ganda", async () => {
    const job = makeJob()
    vi.mocked(rendersRepo.updateRenderJob).mockResolvedValueOnce(null)

    const result = await finalizeRenderJob(job, { imageBytes: new Uint8Array([1]) })

    expect(result).toBeNull()
    expect(creditsRepo.refundCreditsOnce).not.toHaveBeenCalled()
  })
})

describe("finalizeRenderJob — dari imageUrl (fal/webhook)", () => {
  it("unduh sukses -> lanjut proses & succeeded", async () => {
    const job = makeJob()
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => new Uint8Array([9, 9]).buffer,
    } as Response)
    vi.mocked(rendersRepo.updateRenderJob).mockResolvedValueOnce(makeJob({ status: "succeeded" }))

    const result = await finalizeRenderJob(job, { imageUrl: "https://fal.example/x.png" })
    expect(result?.status).toBe("succeeded")
  })

  it("unduh gagal (HTTP non-200) -> failed + refund", async () => {
    const job = makeJob()
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 404 } as Response)
    vi.mocked(rendersRepo.updateRenderJob).mockResolvedValueOnce(makeJob({ status: "failed" }))

    const result = await finalizeRenderJob(job, { imageUrl: "https://fal.example/gone.png" })
    expect(result).toBeNull()
    expect(creditsRepo.refundCreditsOnce).toHaveBeenCalledTimes(1)
    expect(postprocessLib.toWebp).not.toHaveBeenCalled()
  })

  it("fetch reject (network error) -> failed + refund, bukan throw", async () => {
    const job = makeJob()
    vi.mocked(fetch).mockRejectedValueOnce(new Error("network down"))
    vi.mocked(rendersRepo.updateRenderJob).mockResolvedValueOnce(makeJob({ status: "failed" }))

    const result = await finalizeRenderJob(job, { imageUrl: "https://fal.example/x.png" })
    expect(result).toBeNull()
    expect(creditsRepo.refundCreditsOnce).toHaveBeenCalledTimes(1)
  })
})

describe("failRenderJob", () => {
  it("update status failed + refund idempoten", async () => {
    const job = makeJob()
    vi.mocked(rendersRepo.updateRenderJob).mockResolvedValueOnce(makeJob({ status: "failed" }))

    await failRenderJob(job, "provider bilang gagal")

    expect(rendersRepo.updateRenderJob).toHaveBeenCalledWith(
      job.id,
      { status: "failed", errorMessage: "provider bilang gagal" },
      { fromStatuses: ["queued", "submitted", "processing"] }
    )
    expect(creditsRepo.refundCreditsOnce).toHaveBeenCalledWith(
      job.ownerId,
      job.creditsSpent,
      "ai_render_refund",
      job.id
    )
  })
})
