// @vitest-environment node
/**
 * Route tests for POST /api/v1/projects/[id]/brief/assistant — the credit
 * gate (Task 6).
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest"

beforeAll(() => {
  process.env.BARUMA_JWT_SECRET = "test-secret-at-least-32-characters-long"
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test"
})

vi.mock("@/lib/server/db", () => ({ query: vi.fn(), getClient: vi.fn() }))

vi.mock("@/lib/server/repo/projects", () => ({
  getOwnedProject: vi.fn(),
}))

vi.mock("@/lib/server/repo/briefs", () => ({
  getBriefPayload: vi.fn(),
}))

vi.mock("@/lib/server/repo/credits", () => ({
  spendCredits: vi.fn(),
  refundCredits: vi.fn(),
}))

vi.mock("@/lib/server/llm", () => ({
  askAssistant: vi.fn(),
}))

import { POST } from "./route"
import * as projectsRepo from "@/lib/server/repo/projects"
import * as briefsRepo from "@/lib/server/repo/briefs"
import * as creditsRepo from "@/lib/server/repo/credits"
import * as llm from "@/lib/server/llm"
import { signToken } from "@/lib/server/auth-server"
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

function bodyReq(token: string | null, body: unknown) {
  return new Request("http://localhost/api/v1/projects/proj-xyz/brief/assistant", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

const validBody = { question: "Apakah kolam realistis di tanah ini?" }

// Mirrors the (unexported) FALLBACK constant in route.ts, for assertions below.
const FALLBACK = "Maaf, asisten AI sedang sibuk. Coba lagi sebentar ya."

beforeEach(() => {
  vi.mocked(projectsRepo.getOwnedProject).mockReset()
  vi.mocked(briefsRepo.getBriefPayload).mockReset()
  vi.mocked(creditsRepo.spendCredits).mockReset()
  vi.mocked(creditsRepo.refundCredits).mockReset()
  vi.mocked(llm.askAssistant).mockReset()

  vi.mocked(projectsRepo.getOwnedProject).mockResolvedValue(ownedProject)
  vi.mocked(briefsRepo.getBriefPayload).mockResolvedValue(fakeBrief)
})

describe("POST /api/v1/projects/[id]/brief/assistant", () => {
  it("returns 401 without token", async () => {
    const res = await POST(bodyReq(null, validBody), ctx)
    expect(res.status).toBe(401)
  })

  it("returns 404 when the project isn't owned by the caller", async () => {
    const token = await signToken("user-1")
    vi.mocked(projectsRepo.getOwnedProject).mockResolvedValueOnce(null)
    const res = await POST(bodyReq(token, validBody), ctx)
    expect(res.status).toBe(404)
  })

  it("returns 404 when there's no brief yet", async () => {
    const token = await signToken("user-1")
    vi.mocked(briefsRepo.getBriefPayload).mockResolvedValueOnce(null)
    const res = await POST(bodyReq(token, validBody), ctx)
    expect(res.status).toBe(404)
  })

  it("returns 400 for an invalid body", async () => {
    const token = await signToken("user-1")
    const res = await POST(bodyReq(token, { question: "" }), ctx)
    expect(res.status).toBe(400)
  })

  it("returns 402 insufficient_credits and never calls the LLM", async () => {
    const token = await signToken("user-poor")
    vi.mocked(creditsRepo.spendCredits).mockResolvedValueOnce("insufficient")

    const res = await POST(bodyReq(token, validBody), ctx)
    expect(res.status).toBe(402)
    const body = await res.json()
    expect(body.error).toBe("insufficient_credits")
    expect(vi.mocked(llm.askAssistant)).not.toHaveBeenCalled()
  })

  it("spends 1 credit and returns 200 on success; no refund", async () => {
    const token = await signToken("user-ok")
    vi.mocked(creditsRepo.spendCredits).mockResolvedValueOnce("ok")
    vi.mocked(llm.askAssistant).mockResolvedValueOnce("Ya, cukup realistis.")

    const res = await POST(bodyReq(token, validBody), ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.answer).toBe("Ya, cukup realistis.")
    expect(vi.mocked(creditsRepo.spendCredits)).toHaveBeenCalledWith(
      "user-ok",
      1,
      "brief_assistant",
      "proj-xyz"
    )
    expect(vi.mocked(creditsRepo.refundCredits)).not.toHaveBeenCalled()
  })

  it("refunds when chatText resolves null (the realistic LLM failure mode) but still returns 200 with the FALLBACK answer", async () => {
    const token = await signToken("user-null")
    vi.mocked(creditsRepo.spendCredits).mockResolvedValueOnce("ok")
    vi.mocked(llm.askAssistant).mockResolvedValueOnce(null)

    const res = await POST(bodyReq(token, validBody), ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.answer).toBe(FALLBACK)
    expect(vi.mocked(creditsRepo.refundCredits)).toHaveBeenCalledWith(
      "user-null",
      1,
      "brief_assistant_refund",
      "proj-xyz"
    )
  })

  it("refunds and re-throws (surfacing the original error) when the LLM call throws", async () => {
    const token = await signToken("user-fail")
    vi.mocked(creditsRepo.spendCredits).mockResolvedValueOnce("ok")
    vi.mocked(llm.askAssistant).mockRejectedValueOnce(new Error("LLM boom"))

    const res = await POST(bodyReq(token, validBody), ctx)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toContain("LLM boom")
    expect(vi.mocked(creditsRepo.refundCredits)).toHaveBeenCalledWith(
      "user-fail",
      1,
      "brief_assistant_refund",
      "proj-xyz"
    )
  })
})
