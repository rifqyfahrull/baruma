// @vitest-environment node
/**
 * Route tests for POST /api/v1/projects/[id]/alternatives/generate — the
 * credit gate (Task 6). This route's only LLM call (enrichAlternatives) runs
 * in the BACKGROUND via next/server's `after()`, after the HTTP response has
 * already been sent — so "LLM failure -> refund" is observed by awaiting the
 * scheduled background job, not by asserting on the response.
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
    // Run the background job immediately (still async) and keep a handle so
    // tests can `await Promise.all(afterJobs)` to observe its side effects.
    after: (fn: () => unknown) => {
      afterJobs.push(Promise.resolve().then(fn))
    },
  }
})

vi.mock("@/lib/server/db", () => ({ query: vi.fn(), getClient: vi.fn() }))

vi.mock("@/lib/server/repo/projects", () => ({
  getOwnedProject: vi.fn(),
  updateProject: vi.fn(),
}))

vi.mock("@/lib/server/repo/briefs", () => ({
  getBriefPayload: vi.fn(),
}))

vi.mock("@/lib/server/repo/alternatives", () => ({
  getAlternatives: vi.fn(),
  upsertAlternatives: vi.fn(),
}))

vi.mock("@/lib/server/repo/credits", () => ({
  spendCredits: vi.fn(),
  refundCredits: vi.fn(),
}))

vi.mock("@/lib/server/enrich-alternatives", () => ({
  enrichAlternatives: vi.fn(),
}))

import { POST } from "./route"
import * as projectsRepo from "@/lib/server/repo/projects"
import * as briefsRepo from "@/lib/server/repo/briefs"
import * as alternativesRepo from "@/lib/server/repo/alternatives"
import * as creditsRepo from "@/lib/server/repo/credits"
import * as enrichLib from "@/lib/server/enrich-alternatives"
import { signToken } from "@/lib/server/auth-server"
import { __resetRateLimitStore } from "@/lib/server/rate-limit"
import type { Brief, Project } from "@/types"

const ctx = { params: Promise.resolve({ id: "proj-xyz" }) }

const ownedProject: Project = {
  id: "proj-xyz",
  name: "Test",
  status: "brief",
  readiness: "concept_ready",
  projectType: "new",
  thumbnail: "family",
  floors: 1,
  rooftop: false,
  site: { widthM: 8, depthM: 10, areaM2: 80 },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

const fakeBrief: Brief = {
  projectId: "proj-xyz",
  summary: "Test brief",
  site: { widthM: 8, depthM: 10, areaM2: 80 },
  building: { floors: 1, rooftop: false, budget: { minIDR: 100_000_000, maxIDR: 200_000_000 }, finishingLevel: "menengah" },
  priorities: [],
  spaceProgram: [],
  assumptions: [],
  constraints: [],
  risks: [],
}

function req() {
  return new Request("http://localhost/api/v1/projects/proj-xyz/alternatives/generate", {
    method: "POST",
    headers: { authorization: "" },
  })
}

async function authedReq(token: string) {
  return new Request("http://localhost/api/v1/projects/proj-xyz/alternatives/generate", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  })
}

beforeEach(() => {
  afterJobs.length = 0
  vi.mocked(projectsRepo.getOwnedProject).mockReset()
  vi.mocked(projectsRepo.updateProject).mockReset()
  vi.mocked(briefsRepo.getBriefPayload).mockReset()
  vi.mocked(alternativesRepo.upsertAlternatives).mockReset()
  vi.mocked(creditsRepo.spendCredits).mockReset()
  vi.mocked(creditsRepo.refundCredits).mockReset()
  vi.mocked(enrichLib.enrichAlternatives).mockReset()
  __resetRateLimitStore()
})

describe("POST /api/v1/projects/[id]/alternatives/generate", () => {
  it("returns 401 without token", async () => {
    const res = await POST(req(), ctx)
    expect(res.status).toBe(401)
  })

  it("returns 404 when the project isn't owned by the caller", async () => {
    const token = await signToken("user-1")
    vi.mocked(projectsRepo.getOwnedProject).mockResolvedValueOnce(null)
    const res = await POST(await authedReq(token), ctx)
    expect(res.status).toBe(404)
  })

  it("returns 404 when there's no brief yet", async () => {
    const token = await signToken("user-1")
    vi.mocked(projectsRepo.getOwnedProject).mockResolvedValueOnce(ownedProject)
    vi.mocked(briefsRepo.getBriefPayload).mockResolvedValueOnce(null)
    const res = await POST(await authedReq(token), ctx)
    expect(res.status).toBe(404)
  })

  it("returns 402 insufficient_credits and never builds alternatives when credits are insufficient", async () => {
    const token = await signToken("user-poor")
    vi.mocked(projectsRepo.getOwnedProject).mockResolvedValueOnce(ownedProject)
    vi.mocked(briefsRepo.getBriefPayload).mockResolvedValueOnce(fakeBrief)
    vi.mocked(creditsRepo.spendCredits).mockResolvedValueOnce("insufficient")

    const res = await POST(await authedReq(token), ctx)
    expect(res.status).toBe(402)
    const body = await res.json()
    expect(body.error).toBe("insufficient_credits")
    expect(vi.mocked(alternativesRepo.upsertAlternatives)).not.toHaveBeenCalled()
    expect(vi.mocked(projectsRepo.updateProject)).not.toHaveBeenCalled()
  })

  it("spends 1 credit, returns 200 with alternatives, and never refunds on success", async () => {
    const token = await signToken("user-ok")
    vi.mocked(projectsRepo.getOwnedProject).mockResolvedValueOnce(ownedProject)
    vi.mocked(briefsRepo.getBriefPayload).mockResolvedValueOnce(fakeBrief)
    vi.mocked(creditsRepo.spendCredits).mockResolvedValueOnce("ok")
    // Genuine success: enrichAlternatives' real contract only returns the
    // SAME reference on failure (see the same-reference test below) — real
    // success resolves to a NEW array.
    vi.mocked(enrichLib.enrichAlternatives).mockImplementationOnce(async (base) => [...base])

    const res = await POST(await authedReq(token), ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBe(3)
    expect(vi.mocked(creditsRepo.spendCredits)).toHaveBeenCalledWith(
      "user-ok",
      1,
      "generate_alternatives",
      "proj-xyz"
    )

    await Promise.all(afterJobs)
    expect(vi.mocked(alternativesRepo.upsertAlternatives)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(creditsRepo.refundCredits)).not.toHaveBeenCalled()
  })

  it("refunds the reserved credit when enrichment resolves the same reference (silent LLM failure, not an exception)", async () => {
    const token = await signToken("user-bg-samerf")
    vi.mocked(projectsRepo.getOwnedProject).mockResolvedValueOnce(ownedProject)
    vi.mocked(briefsRepo.getBriefPayload).mockResolvedValueOnce(fakeBrief)
    vi.mocked(creditsRepo.spendCredits).mockResolvedValueOnce("ok")
    // enrichAlternatives' real contract: resolves to the SAME array reference
    // (not a rejection) when the LLM is unavailable/times out/returns
    // malformed JSON — see enrich-alternatives.ts's
    // `if (!out?.items?.length) return alts` fallback.
    vi.mocked(enrichLib.enrichAlternatives).mockImplementationOnce(async (base) => base)

    const res = await POST(await authedReq(token), ctx)
    // The response is already sent (200) before the background job runs — a
    // silent enrichment failure can't change the HTTP response, only trigger
    // the refund.
    expect(res.status).toBe(200)

    await Promise.all(afterJobs)
    expect(vi.mocked(alternativesRepo.upsertAlternatives)).toHaveBeenCalledTimes(1) // only the pre-enrichment upsert
    expect(vi.mocked(creditsRepo.refundCredits)).toHaveBeenCalledWith(
      "user-bg-samerf",
      1,
      "generate_alternatives_refund",
      "proj-xyz"
    )
  })

  it("refunds the reserved credit when the background enrichment throws", async () => {
    const token = await signToken("user-bg-fail")
    vi.mocked(projectsRepo.getOwnedProject).mockResolvedValueOnce(ownedProject)
    vi.mocked(briefsRepo.getBriefPayload).mockResolvedValueOnce(fakeBrief)
    vi.mocked(creditsRepo.spendCredits).mockResolvedValueOnce("ok")
    vi.mocked(enrichLib.enrichAlternatives).mockRejectedValueOnce(new Error("LLM boom"))

    const res = await POST(await authedReq(token), ctx)
    // The response is already sent (200) before the background job runs —
    // its failure can't change the HTTP response, only trigger the refund.
    expect(res.status).toBe(200)

    await Promise.all(afterJobs)
    expect(vi.mocked(creditsRepo.refundCredits)).toHaveBeenCalledWith(
      "user-bg-fail",
      1,
      "generate_alternatives_refund",
      "proj-xyz"
    )
  })

  it("429s the 7th generate attempt from the same user within a minute", async () => {
    const token = await signToken("user-rl")
    vi.mocked(projectsRepo.getOwnedProject).mockResolvedValue(ownedProject)
    vi.mocked(briefsRepo.getBriefPayload).mockResolvedValue(fakeBrief)
    vi.mocked(creditsRepo.spendCredits).mockResolvedValue("ok")
    vi.mocked(enrichLib.enrichAlternatives).mockImplementation(async (base) => [...base])
    for (let i = 0; i < 6; i++) {
      const res = await POST(await authedReq(token), ctx)
      expect(res.status).not.toBe(429)
    }
    const blocked = await POST(await authedReq(token), ctx)
    expect(blocked.status).toBe(429)
    await Promise.all(afterJobs)
  })
})
