// @vitest-environment node
/**
 * Route test POST /api/webhooks/ai-render (Fase 5c). Struktur meniru
 * webhooks/payment/route.test.ts: HANYA kegagalan token yang 401, sisanya
 * ditelan ke 200 (hindari retry storm provider).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/server/repo/renders", () => ({ getRenderJobById: vi.fn() }))
vi.mock("@/lib/server/ai-render/finalize", () => ({
  finalizeRenderJob: vi.fn(),
  failRenderJob: vi.fn(),
}))

import { POST } from "./route"
import * as rendersRepo from "@/lib/server/repo/renders"
import * as finalizeLib from "@/lib/server/ai-render/finalize"
import type { RenderJob } from "@/lib/server/repo/renders"

const SECRET = "test-webhook-secret-value"
const JOB_ID = "rnd-abc12345"

function makeJob(overrides: Partial<RenderJob> = {}): RenderJob {
  return {
    id: JOB_ID,
    ownerId: "user-1",
    projectId: "proj-xyz",
    status: "submitted",
    mode: "presisi",
    preset: "tropis-siang",
    shotId: "iso-siang",
    seed: 42,
    creditsSpent: 2,
    provider: "fal",
    providerRequestId: "fal-req-1",
    paramsHash: "hash-abc",
    inputKeys: { beauty: "renders/user-1/proj-xyz/123-beauty.png" },
    watermarked: true,
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    ...overrides,
  }
}

function webhookReq(opts: { token?: string; jobId?: string; body?: unknown }) {
  const url = new URL("http://localhost/api/webhooks/ai-render")
  if (opts.token !== undefined) url.searchParams.set("token", opts.token)
  if (opts.jobId !== undefined) url.searchParams.set("jobId", opts.jobId)
  return new Request(url.toString(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(opts.body ?? {}),
  })
}

beforeEach(() => {
  vi.mocked(rendersRepo.getRenderJobById).mockReset()
  vi.mocked(finalizeLib.finalizeRenderJob).mockReset()
  vi.mocked(finalizeLib.failRenderJob).mockReset().mockResolvedValue(undefined)
  delete process.env.AI_RENDER_WEBHOOK_SECRET
})

describe("POST /api/webhooks/ai-render", () => {
  it("401 saat AI_RENDER_WEBHOOK_SECRET belum diset (fail-closed)", async () => {
    const res = await POST(webhookReq({ token: "anything", jobId: JOB_ID }))
    expect(res.status).toBe(401)
    expect(vi.mocked(rendersRepo.getRenderJobById)).not.toHaveBeenCalled()
  })

  it("401 saat token salah", async () => {
    process.env.AI_RENDER_WEBHOOK_SECRET = SECRET
    const res = await POST(webhookReq({ token: "token-salah", jobId: JOB_ID }))
    expect(res.status).toBe(401)
  })

  it("401 tanpa token sama sekali", async () => {
    process.env.AI_RENDER_WEBHOOK_SECRET = SECRET
    const res = await POST(webhookReq({ jobId: JOB_ID }))
    expect(res.status).toBe(401)
  })

  it("200 no-op saat jobId hilang (token benar)", async () => {
    process.env.AI_RENDER_WEBHOOK_SECRET = SECRET
    const res = await POST(webhookReq({ token: SECRET }))
    expect(res.status).toBe(200)
    expect(vi.mocked(rendersRepo.getRenderJobById)).not.toHaveBeenCalled()
  })

  it("200 no-op saat job tak ditemukan", async () => {
    process.env.AI_RENDER_WEBHOOK_SECRET = SECRET
    vi.mocked(rendersRepo.getRenderJobById).mockResolvedValueOnce(null)
    const res = await POST(
      webhookReq({ token: SECRET, jobId: JOB_ID, body: { request_id: "fal-req-1", status: "OK" } })
    )
    expect(res.status).toBe(200)
    expect(vi.mocked(finalizeLib.finalizeRenderJob)).not.toHaveBeenCalled()
  })

  it("200 no-op saat payload.request_id tak cocok dgn job.providerRequestId", async () => {
    process.env.AI_RENDER_WEBHOOK_SECRET = SECRET
    vi.mocked(rendersRepo.getRenderJobById).mockResolvedValueOnce(makeJob())
    const res = await POST(
      webhookReq({
        token: SECRET,
        jobId: JOB_ID,
        body: { request_id: "fal-req-BERBEDA", status: "OK", payload: { images: [{ url: "x" }] } },
      })
    )
    expect(res.status).toBe(200)
    expect(vi.mocked(finalizeLib.finalizeRenderJob)).not.toHaveBeenCalled()
  })

  it("status OK + request_id cocok -> finalizeRenderJob dipanggil dgn imageUrl", async () => {
    process.env.AI_RENDER_WEBHOOK_SECRET = SECRET
    const job = makeJob()
    vi.mocked(rendersRepo.getRenderJobById).mockResolvedValueOnce(job)

    const res = await POST(
      webhookReq({
        token: SECRET,
        jobId: JOB_ID,
        body: {
          request_id: "fal-req-1",
          status: "OK",
          payload: { images: [{ url: "https://fal.example/result.png" }] },
        },
      })
    )
    expect(res.status).toBe(200)
    expect(vi.mocked(finalizeLib.finalizeRenderJob)).toHaveBeenCalledWith(job, {
      imageUrl: "https://fal.example/result.png",
    })
  })

  it("status ERROR -> failRenderJob dipanggil (refund)", async () => {
    process.env.AI_RENDER_WEBHOOK_SECRET = SECRET
    const job = makeJob()
    vi.mocked(rendersRepo.getRenderJobById).mockResolvedValueOnce(job)

    const res = await POST(
      webhookReq({
        token: SECRET,
        jobId: JOB_ID,
        body: { request_id: "fal-req-1", status: "ERROR", error: "provider gagal" },
      })
    )
    expect(res.status).toBe(200)
    expect(vi.mocked(finalizeLib.failRenderJob)).toHaveBeenCalledWith(job, "provider gagal")
  })

  it("replay setelah sukses -> tetap 200 (idempotensi ditegakkan di finalizeRenderJob/updateRenderJob's fromStatuses guard, bukan di route)", async () => {
    process.env.AI_RENDER_WEBHOOK_SECRET = SECRET
    vi.mocked(rendersRepo.getRenderJobById).mockResolvedValue(makeJob({ status: "succeeded" }))
    vi.mocked(finalizeLib.finalizeRenderJob).mockResolvedValue(null) // guard fromStatuses kalah race -> null

    const res1 = await POST(
      webhookReq({
        token: SECRET,
        jobId: JOB_ID,
        body: { request_id: "fal-req-1", status: "OK", payload: { images: [{ url: "https://fal.example/x.png" }] } },
      })
    )
    const res2 = await POST(
      webhookReq({
        token: SECRET,
        jobId: JOB_ID,
        body: { request_id: "fal-req-1", status: "OK", payload: { images: [{ url: "https://fal.example/x.png" }] } },
      })
    )
    expect(res1.status).toBe(200)
    expect(res2.status).toBe(200)
  })
})
