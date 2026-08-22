// @vitest-environment node
/**
 * Route test GET /api/v1/projects/[id]/renders/[renderId] (Fase 5b) —
 * rekonsiliasi LAZY: job basi (submitted/processing tanpa update lama, atau
 * queued tanpa provider_request_id yang mati krn restart) diselesaikan saat
 * kebetulan di-poll, tanpa cron terpisah.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest"

beforeAll(() => {
  process.env.BARUMA_JWT_SECRET = "test-secret-at-least-32-characters-long"
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test"
})

vi.mock("@/lib/server/db", () => ({ query: vi.fn(), getClient: vi.fn() }))

vi.mock("@/lib/server/repo/projects", () => ({ getOwnedProject: vi.fn() }))

vi.mock("@/lib/server/repo/renders", () => ({
  getRenderJob: vi.fn(),
  updateRenderJob: vi.fn(),
}))

vi.mock("@/lib/server/ai-render", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/ai-render")>()
  return { ...actual, getRenderProvider: vi.fn() }
})

vi.mock("@/lib/server/ai-render/finalize", () => ({
  finalizeRenderJob: vi.fn(),
  failRenderJob: vi.fn(),
}))

vi.mock("@/lib/server/storage", () => ({
  assetPublicUrl: vi.fn((key: string) => `/api/v1/assets/file/${key}`),
}))

import { GET } from "./route"
import * as projectsRepo from "@/lib/server/repo/projects"
import * as rendersRepo from "@/lib/server/repo/renders"
import * as aiRenderLib from "@/lib/server/ai-render"
import * as finalizeLib from "@/lib/server/ai-render/finalize"
import { signToken } from "@/lib/server/auth-server"
import type { Project } from "@/types"
import type { RenderJob } from "@/lib/server/repo/renders"

const PROJECT_ID = "proj-xyz"
const USER_ID = "user-1"
const RENDER_ID = "rnd-abc12345"

const ctx = { params: Promise.resolve({ id: PROJECT_ID, renderId: RENDER_ID }) }
const ownedProject = { id: PROJECT_ID, name: "Test" } as Project

function makeJob(overrides: Partial<RenderJob> = {}): RenderJob {
  return {
    id: RENDER_ID,
    ownerId: USER_ID,
    projectId: PROJECT_ID,
    status: "queued",
    mode: "presisi",
    preset: "tropis-siang",
    shotId: "iso-siang",
    seed: 42,
    creditsSpent: 2,
    provider: "fal",
    paramsHash: "hash-abc",
    inputKeys: { beauty: `renders/${USER_ID}/${PROJECT_ID}/123-beauty.png` },
    watermarked: true,
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    ...overrides,
  }
}

function minutesAgo(n: number): string {
  return new Date(Date.now() - n * 60 * 1000).toISOString()
}

async function req(token: string) {
  return new Request(
    `http://localhost/api/v1/projects/${PROJECT_ID}/renders/${RENDER_ID}`,
    { headers: { authorization: `Bearer ${token}` } }
  )
}

const mockProvider = { submit: vi.fn(), checkStatus: vi.fn() }

beforeEach(() => {
  vi.mocked(projectsRepo.getOwnedProject).mockReset().mockResolvedValue(ownedProject)
  vi.mocked(rendersRepo.getRenderJob).mockReset()
  vi.mocked(rendersRepo.updateRenderJob).mockReset()
  vi.mocked(aiRenderLib.getRenderProvider).mockReset().mockReturnValue(mockProvider)
  vi.mocked(finalizeLib.finalizeRenderJob).mockReset()
  vi.mocked(finalizeLib.failRenderJob).mockReset().mockResolvedValue(undefined)
  mockProvider.submit.mockReset()
  mockProvider.checkStatus.mockReset()
})

describe("GET /api/v1/projects/[id]/renders/[renderId]", () => {
  it("401 tanpa token", async () => {
    const res = await GET(
      new Request(`http://localhost/api/v1/projects/${PROJECT_ID}/renders/${RENDER_ID}`),
      ctx
    )
    expect(res.status).toBe(401)
  })

  it("404 saat job tak ditemukan / bukan milik proyek ini", async () => {
    const token = await signToken(USER_ID)
    vi.mocked(rendersRepo.getRenderJob).mockResolvedValueOnce(null)
    const res = await GET(await req(token), ctx)
    expect(res.status).toBe(404)
  })

  it("job fresh (belum basi) -> dikembalikan apa adanya, tanpa memanggil provider", async () => {
    const token = await signToken(USER_ID)
    const job = makeJob({ status: "submitted", providerRequestId: "fal-req-1", updatedAt: minutesAgo(1) })
    vi.mocked(rendersRepo.getRenderJob).mockResolvedValueOnce(job)

    const res = await GET(await req(token), ctx)
    expect(res.status).toBe(200)
    expect(mockProvider.checkStatus).not.toHaveBeenCalled()
  })

  it("rekonsiliasi: submitted basi (>3 menit) + checkStatus imageUrl -> finalize dipanggil, hasil succeeded dikembalikan", async () => {
    const token = await signToken(USER_ID)
    const stale = makeJob({ status: "submitted", providerRequestId: "fal-req-1", updatedAt: minutesAgo(5) })
    const finalized = makeJob({ status: "succeeded", outputKey: "renders/u/p/out.webp" })
    vi.mocked(rendersRepo.getRenderJob)
      .mockResolvedValueOnce(stale) // baca awal
      .mockResolvedValueOnce(finalized) // refetch setelah finalize
    mockProvider.checkStatus.mockResolvedValueOnce({ imageUrl: "https://provider.example/result.png" })

    const res = await GET(await req(token), ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe("succeeded")
    expect(vi.mocked(finalizeLib.finalizeRenderJob)).toHaveBeenCalledWith(stale, {
      imageUrl: "https://provider.example/result.png",
    })
  })

  it("rekonsiliasi: checkStatus 'failed' -> failRenderJob dipanggil (refund)", async () => {
    const token = await signToken(USER_ID)
    const stale = makeJob({ status: "submitted", providerRequestId: "fal-req-1", updatedAt: minutesAgo(5) })
    const failed = makeJob({ status: "failed", errorMessage: "Render gagal di provider (rekonsiliasi)" })
    vi.mocked(rendersRepo.getRenderJob).mockResolvedValueOnce(stale).mockResolvedValueOnce(failed)
    mockProvider.checkStatus.mockResolvedValueOnce("failed")

    const res = await GET(await req(token), ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe("failed")
    expect(vi.mocked(finalizeLib.failRenderJob)).toHaveBeenCalledTimes(1)
  })

  it("rekonsiliasi: queued tanpa provider_request_id basi (>5 menit) -> failed + refund", async () => {
    const token = await signToken(USER_ID)
    const stale = makeJob({ status: "queued", providerRequestId: undefined, updatedAt: minutesAgo(6) })
    const failed = makeJob({ status: "failed", errorMessage: "Render kedaluwarsa — proses latar terhenti" })
    vi.mocked(rendersRepo.getRenderJob).mockResolvedValueOnce(stale).mockResolvedValueOnce(failed)

    const res = await GET(await req(token), ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe("failed")
    expect(vi.mocked(finalizeLib.failRenderJob)).toHaveBeenCalledWith(stale, expect.any(String))
    expect(mockProvider.checkStatus).not.toHaveBeenCalled()
  })

  it("queued basi TAPI < 5 menit -> tak disentuh", async () => {
    const token = await signToken(USER_ID)
    const fresh = makeJob({ status: "queued", providerRequestId: undefined, updatedAt: minutesAgo(2) })
    vi.mocked(rendersRepo.getRenderJob).mockResolvedValueOnce(fresh)

    const res = await GET(await req(token), ctx)
    expect(res.status).toBe(200)
    expect(vi.mocked(finalizeLib.failRenderJob)).not.toHaveBeenCalled()
  })
})
