// @vitest-environment node
/**
 * Route tests POST/GET /api/v1/projects/[id]/renders (Fase 5a/5b). Provider
 * & finalize di-mock supaya test murni menguji ORKESTRASI route (gate
 * urutan, idempotensi kredit, cache hit, kegagalan provider) — bukan
 * implementasi provider/postprocess (itu dites terpisah di
 * ai-render/*.test.ts & finalize.test.ts).
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest"

beforeAll(() => {
  process.env.BARUMA_JWT_SECRET = "test-secret-at-least-32-characters-long"
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test"
})

const { afterJobs } = vi.hoisted(() => ({ afterJobs: [] as Promise<unknown>[] }))

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>()
  return {
    ...actual,
    after: (fn: () => unknown) => {
      afterJobs.push(Promise.resolve().then(fn))
    },
  }
})

vi.mock("@/lib/server/db", () => ({ query: vi.fn(), getClient: vi.fn() }))

vi.mock("@/lib/server/repo/projects", () => ({ getOwnedProject: vi.fn() }))

vi.mock("@/lib/server/repo/profiles", () => ({
  getProfileById: vi.fn(),
  getProfileByEmail: vi.fn(),
}))

vi.mock("@/lib/server/repo/renders", () => ({
  createRenderJob: vi.fn(),
  getRenderJob: vi.fn(),
  updateRenderJob: vi.fn(),
  listRenderJobs: vi.fn(),
  findCachedRender: vi.fn(),
}))

vi.mock("@/lib/server/repo/credits", () => ({
  spendCreditsOnce: vi.fn(),
}))

vi.mock("@/lib/server/entitlements", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/entitlements")>()
  return { ...actual, requirePlanFeature: vi.fn(), getEntitlements: vi.fn() }
})

vi.mock("@/lib/server/storage", () => ({
  createSignedGetUrl: vi.fn(),
  assetPublicUrl: vi.fn((key: string) => `/api/v1/assets/file/${key}`),
}))

vi.mock("@/lib/server/ai-render", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/ai-render")>()
  return {
    ...actual,
    aiRenderEnabled: vi.fn(() => true),
    getRenderProvider: vi.fn(),
    usesMockOverride: vi.fn(() => true),
  }
})

vi.mock("@/lib/server/ai-render/finalize", () => ({
  finalizeRenderJob: vi.fn(),
  failRenderJob: vi.fn(),
}))

import { POST, GET } from "./route"
import * as projectsRepo from "@/lib/server/repo/projects"
import * as profilesRepo from "@/lib/server/repo/profiles"
import * as rendersRepo from "@/lib/server/repo/renders"
import * as creditsRepo from "@/lib/server/repo/credits"
import * as entitlementsLib from "@/lib/server/entitlements"
import * as storageLib from "@/lib/server/storage"
import * as aiRenderLib from "@/lib/server/ai-render"
import * as finalizeLib from "@/lib/server/ai-render/finalize"
import { signToken } from "@/lib/server/auth-server"
import { __resetRateLimitStore } from "@/lib/server/rate-limit"
import type { Project } from "@/types"
import type { RenderJob } from "@/lib/server/repo/renders"

const PROJECT_ID = "proj-xyz"
const USER_ID = "user-1"

const ctx = { params: Promise.resolve({ id: PROJECT_ID }) }

const ownedProject = { id: PROJECT_ID, name: "Test" } as Project

function makeJob(overrides: Partial<RenderJob> = {}): RenderJob {
  return {
    id: "rnd-abc12345",
    ownerId: USER_ID,
    projectId: PROJECT_ID,
    status: "queued",
    mode: "cepat",
    preset: "tropis-siang",
    shotId: "iso-siang",
    seed: 42,
    creditsSpent: 1,
    provider: "mock",
    paramsHash: "hash-abc",
    inputKeys: { beauty: `renders/${USER_ID}/${PROJECT_ID}/123-beauty.png` },
    watermarked: true,
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    ...overrides,
  }
}

const validBody = {
  mode: "cepat" as const,
  preset: "tropis-siang",
  shotId: "iso-siang",
  clientRequestId: "creq-abcdef123456",
  inputKeys: { beauty: `renders/${USER_ID}/${PROJECT_ID}/123-beauty.png` },
  paramsHash: "hash-abc",
  sceneMeta: { facadeMaterials: ["batu-alam"], roofType: "pelana", floors: 1 },
}

async function postReq(token: string | null, body: unknown) {
  return new Request(`http://localhost/api/v1/projects/${PROJECT_ID}/renders`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

async function getReq(token: string) {
  return new Request(`http://localhost/api/v1/projects/${PROJECT_ID}/renders`, {
    headers: { authorization: `Bearer ${token}` },
  })
}

const mockProvider = { submit: vi.fn(), checkStatus: vi.fn() }

beforeEach(() => {
  __resetRateLimitStore()
  afterJobs.length = 0
  vi.mocked(projectsRepo.getOwnedProject).mockReset().mockResolvedValue(ownedProject)
  vi.mocked(profilesRepo.getProfileById).mockReset().mockResolvedValue(null) // non-admin
  vi.mocked(rendersRepo.createRenderJob).mockReset()
  vi.mocked(rendersRepo.getRenderJob).mockReset()
  vi.mocked(rendersRepo.updateRenderJob).mockReset()
  vi.mocked(rendersRepo.listRenderJobs).mockReset()
  vi.mocked(rendersRepo.findCachedRender).mockReset().mockResolvedValue(null)
  vi.mocked(creditsRepo.spendCreditsOnce).mockReset()
  vi.mocked(entitlementsLib.requirePlanFeature).mockReset().mockResolvedValue(undefined)
  vi.mocked(entitlementsLib.getEntitlements).mockReset().mockResolvedValue({
    creditsPerPeriod: 10,
    maxProjects: 1,
    exportPdf: false,
    glbUpload: false,
    aiRenderHd: false,
  })
  vi.mocked(aiRenderLib.aiRenderEnabled).mockReset().mockReturnValue(true)
  vi.mocked(aiRenderLib.getRenderProvider).mockReset().mockReturnValue(mockProvider)
  vi.mocked(aiRenderLib.usesMockOverride).mockReset().mockReturnValue(true)
  vi.mocked(finalizeLib.finalizeRenderJob).mockReset()
  vi.mocked(finalizeLib.failRenderJob).mockReset().mockResolvedValue(undefined)
  mockProvider.submit.mockReset()
  mockProvider.checkStatus.mockReset()
  vi.mocked(storageLib.createSignedGetUrl)
    .mockReset()
    .mockResolvedValue("https://signed.example/beauty")
})

describe("POST /api/v1/projects/[id]/renders", () => {
  it("401 tanpa token", async () => {
    const res = await POST(await postReq(null, validBody), ctx)
    expect(res.status).toBe(401)
  })

  it("404 saat proyek bukan milik pemanggil", async () => {
    vi.mocked(projectsRepo.getOwnedProject).mockResolvedValueOnce(null)
    const token = await signToken(USER_ID)
    const res = await POST(await postReq(token, validBody), ctx)
    expect(res.status).toBe(404)
  })

  it("400 saat inputKeys.beauty bukan milik user/proyek ini (anti-SSRF)", async () => {
    const token = await signToken(USER_ID)
    const res = await POST(
      await postReq(token, {
        ...validBody,
        inputKeys: { beauty: "renders/user-lain/proj-lain/x.png" },
      }),
      ctx
    )
    expect(res.status).toBe(400)
  })

  it("200 cache hit — tanpa potong kredit", async () => {
    const token = await signToken(USER_ID)
    const cachedJob = makeJob({ status: "succeeded", outputKey: "renders/x/y/out.webp" })
    vi.mocked(rendersRepo.findCachedRender).mockResolvedValueOnce(cachedJob)

    const res = await POST(await postReq(token, validBody), ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.cached).toBe(true)
    expect(body.job.id).toBe(cachedJob.id)
    expect(vi.mocked(creditsRepo.spendCreditsOnce)).not.toHaveBeenCalled()
  })

  it("402 insufficient_credits — job tak dibuat", async () => {
    const token = await signToken(USER_ID)
    vi.mocked(creditsRepo.spendCreditsOnce).mockResolvedValueOnce("insufficient")

    const res = await POST(await postReq(token, validBody), ctx)
    expect(res.status).toBe(402)
    const body = await res.json()
    expect(body.error).toBe("insufficient_credits")
    expect(vi.mocked(rendersRepo.createRenderJob)).not.toHaveBeenCalled()
  })

  it("403 plan_feature_locked utk mode presisi tanpa aiRenderHd", async () => {
    const token = await signToken(USER_ID)
    vi.mocked(entitlementsLib.requirePlanFeature).mockRejectedValueOnce(
      new entitlementsLib.PlanFeatureLockedError("aiRenderHd")
    )

    const res = await POST(
      await postReq(token, {
        ...validBody,
        mode: "presisi",
        inputKeys: { ...validBody.inputKeys, depth: `renders/${USER_ID}/${PROJECT_ID}/123-depth.png` },
      }),
      ctx
    )
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe("plan_feature_locked")
  })

  it("400 mode presisi tanpa inputKeys.depth", async () => {
    const token = await signToken(USER_ID)
    const res = await POST(await postReq(token, { ...validBody, mode: "presisi" }), ctx)
    expect(res.status).toBe(400)
  })

  it("502 render_failed + refund saat provider tak dikonfigurasi utk mode ini", async () => {
    const token = await signToken(USER_ID)
    vi.mocked(creditsRepo.spendCreditsOnce).mockResolvedValueOnce("ok")
    vi.mocked(rendersRepo.createRenderJob).mockResolvedValueOnce(makeJob())
    vi.mocked(aiRenderLib.getRenderProvider).mockReturnValueOnce(null)

    const res = await POST(await postReq(token, validBody), ctx)
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toBe("render_failed")
    expect(vi.mocked(finalizeLib.failRenderJob)).toHaveBeenCalledTimes(1)
  })

  it("502 render_failed + refund saat submit() mengembalikan null", async () => {
    const token = await signToken(USER_ID)
    vi.mocked(creditsRepo.spendCreditsOnce).mockResolvedValueOnce("ok")
    const job = makeJob()
    vi.mocked(rendersRepo.createRenderJob).mockResolvedValueOnce(job)
    mockProvider.submit.mockResolvedValueOnce(null)

    const res = await POST(await postReq(token, validBody), ctx)
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toBe("render_failed")
    expect(vi.mocked(finalizeLib.failRenderJob)).toHaveBeenCalledWith(job, expect.any(String))
  })

  it("201 happy path — mock provider inline, kredit terpotong sekali, job succeeded", async () => {
    const token = await signToken(USER_ID)
    vi.mocked(creditsRepo.spendCreditsOnce).mockResolvedValueOnce("ok")
    const job = makeJob()
    const finalized = makeJob({ status: "succeeded", outputKey: "renders/u/p/rnd-abc12345-output.webp" })
    vi.mocked(rendersRepo.createRenderJob).mockResolvedValueOnce(job)
    mockProvider.submit.mockResolvedValueOnce({ kind: "done", imageBytes: new Uint8Array([1, 2, 3]) })
    vi.mocked(finalizeLib.finalizeRenderJob).mockResolvedValueOnce(finalized)

    const res = await POST(await postReq(token, validBody), ctx)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.cached).toBe(false)
    expect(body.job.status).toBe("succeeded")
    expect(body.job.outputUrl).toContain("output.webp")

    expect(vi.mocked(creditsRepo.spendCreditsOnce)).toHaveBeenCalledWith(
      USER_ID,
      1,
      "ai_render",
      validBody.clientRequestId
    )
    expect(vi.mocked(rendersRepo.createRenderJob)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(finalizeLib.finalizeRenderJob)).toHaveBeenCalledWith(job, {
      imageBytes: new Uint8Array([1, 2, 3]),
    })
  })

  it("double POST clientRequestId sama (already_spent) -> job existing dikembalikan, tanpa createRenderJob lagi", async () => {
    const token = await signToken(USER_ID)
    vi.mocked(creditsRepo.spendCreditsOnce).mockResolvedValueOnce("already_spent")
    const existing = makeJob({ status: "succeeded", outputKey: "renders/u/p/out.webp" })
    vi.mocked(rendersRepo.getRenderJob).mockResolvedValueOnce(existing)

    const res = await POST(await postReq(token, validBody), ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.job.id).toBe(existing.id)
    expect(vi.mocked(rendersRepo.createRenderJob)).not.toHaveBeenCalled()
  })

  it("mode cepat + provider gemini asli (bukan mock) -> 201 segera, submit+finalize di after()", async () => {
    const token = await signToken(USER_ID)
    vi.mocked(aiRenderLib.usesMockOverride).mockReturnValue(false)
    vi.mocked(creditsRepo.spendCreditsOnce).mockResolvedValueOnce("ok")
    const job = makeJob()
    vi.mocked(rendersRepo.createRenderJob).mockResolvedValueOnce(job)
    mockProvider.submit.mockResolvedValueOnce({ kind: "done", imageBytes: new Uint8Array([9]) })
    vi.mocked(finalizeLib.finalizeRenderJob).mockResolvedValueOnce(makeJob({ status: "succeeded" }))

    const res = await POST(await postReq(token, validBody), ctx)
    expect(res.status).toBe(201)
    const body = await res.json()
    // Respons dibangun dari `job` (status 'queued') SEBELUM after() jalan —
    // submit+finalize baru terjadi di background, lihat afterJobs di bawah.
    expect(body.job.status).toBe("queued")

    await Promise.all(afterJobs)
    expect(vi.mocked(finalizeLib.finalizeRenderJob)).toHaveBeenCalledTimes(1)
  })
})

describe("GET /api/v1/projects/[id]/renders", () => {
  it("401 tanpa token", async () => {
    const res = await GET(new Request(`http://localhost/api/v1/projects/${PROJECT_ID}/renders`), ctx)
    expect(res.status).toBe(401)
  })

  it("200 daftar job dipetakan ke bentuk view", async () => {
    const token = await signToken(USER_ID)
    vi.mocked(rendersRepo.listRenderJobs).mockResolvedValueOnce([
      makeJob({ id: "rnd-1", status: "succeeded", outputKey: "renders/u/p/1.webp" }),
      makeJob({ id: "rnd-2", status: "queued" }),
    ])

    const res = await GET(await getReq(token), ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(2)
    expect(body[0].id).toBe("rnd-1")
    expect(body[0].outputUrl).toContain("1.webp")
    expect(body[1].outputUrl).toBeNull()
  })
})
