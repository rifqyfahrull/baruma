// @vitest-environment node
/**
 * Route tests for /api/v1/admin/plans. Every handler is requireAdmin-gated
 * (DB-fresh role check — see src/lib/server/auth-server.ts): a non-admin
 * Bearer token must get 403, never a silently-filtered response.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest"

beforeAll(() => {
  process.env.BARUMA_JWT_SECRET = "test-secret-at-least-32-characters-long"
})

vi.mock("@/lib/server/repo/profiles", () => ({
  getProfileById: vi.fn(),
}))

vi.mock("@/lib/server/repo/plans", () => ({
  getPlans: vi.fn(),
  upsertPlan: vi.fn(),
}))

import { GET, PUT } from "./route"
import { signToken } from "@/lib/server/auth-server"
import * as profilesRepo from "@/lib/server/repo/profiles"
import * as plansRepo from "@/lib/server/repo/plans"
import type { ProfileRow } from "@/lib/server/repo/profiles"
import type { PlanRow } from "@/types"

function fakeProfile(overrides: Partial<ProfileRow> = {}): ProfileRow {
  return {
    id: "user-1",
    email: "someone@baruma.id",
    name: "Someone",
    plan: "free",
    role: "user",
    phone: null,
    credits_used: 0,
    credits_total: 10,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

function fakePlan(overrides: Partial<PlanRow> = {}): PlanRow {
  return {
    id: "pro",
    name: "Pro",
    priceIdr: 149000,
    period: "month",
    tagline: null,
    featured: true,
    sortOrder: 1,
    active: true,
    features: [],
    limits: [],
    entitlements: {
      creditsPerPeriod: 100,
      maxProjects: 10,
      exportPdf: true,
      glbUpload: true,
      aiRenderHd: true,
    },
    ...overrides,
  }
}

async function requestAs(
  role: "user" | "admin",
  init?: RequestInit
): Promise<Request> {
  vi.mocked(profilesRepo.getProfileById).mockResolvedValueOnce(
    fakeProfile({ role })
  )
  const token = await signToken("user-1")
  return new Request("http://localhost/api/v1/admin/plans", {
    ...init,
    headers: { ...(init?.headers ?? {}), authorization: `Bearer ${token}` },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.ADMIN_EMAILS
})

describe("GET /api/v1/admin/plans", () => {
  it("returns 401 without a Bearer token", async () => {
    const res = await GET(new Request("http://localhost/api/v1/admin/plans"))
    expect(res.status).toBe(401)
  })

  it("returns 403 for an authenticated non-admin", async () => {
    const req = await requestAs("user")
    const res = await GET(req)
    expect(res.status).toBe(403)
    expect(plansRepo.getPlans).not.toHaveBeenCalled()
  })

  it("returns ALL plans (active + inactive) for an admin", async () => {
    vi.mocked(plansRepo.getPlans).mockResolvedValueOnce([
      fakePlan({ id: "pro" }),
      fakePlan({ id: "old", active: false }),
    ])
    const req = await requestAs("admin")
    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(plansRepo.getPlans).toHaveBeenCalledWith(false)
    const body = (await res.json()) as PlanRow[]
    expect(body.map((p) => p.id)).toEqual(["pro", "old"])
  })
})

describe("PUT /api/v1/admin/plans", () => {
  it("returns 403 for a non-admin", async () => {
    const req = await requestAs("user", {
      method: "PUT",
      body: JSON.stringify(fakePlan()),
    })
    const res = await PUT(req)
    expect(res.status).toBe(403)
    expect(plansRepo.upsertPlan).not.toHaveBeenCalled()
  })

  it("returns 400 for a malformed body (missing required fields)", async () => {
    const req = await requestAs("admin", {
      method: "PUT",
      body: JSON.stringify({ id: "pro" }),
    })
    const res = await PUT(req)
    expect(res.status).toBe(400)
    expect(plansRepo.upsertPlan).not.toHaveBeenCalled()
  })

  it("returns 400 when entitlements is missing a required key", async () => {
    const malformed = {
      ...fakePlan(),
      entitlements: { creditsPerPeriod: 100, maxProjects: 10, exportPdf: true },
    }
    const req = await requestAs("admin", {
      method: "PUT",
      body: JSON.stringify(malformed),
    })
    const res = await PUT(req)
    expect(res.status).toBe(400)
  })

  it("returns 400 (not 500, not silently accepted) when entitlements.maxProjects is negative", async () => {
    const malformed = {
      ...fakePlan(),
      entitlements: { ...fakePlan().entitlements, maxProjects: -5 },
    }
    const req = await requestAs("admin", {
      method: "PUT",
      body: JSON.stringify(malformed),
    })
    const res = await PUT(req)
    expect(res.status).toBe(400)
    expect(plansRepo.upsertPlan).not.toHaveBeenCalled()
    const body = await res.json()
    expect(typeof body.error).toBe("string")
  })

  it("returns 400 when entitlements.creditsPerPeriod is negative", async () => {
    const malformed = {
      ...fakePlan(),
      entitlements: { ...fakePlan().entitlements, creditsPerPeriod: -1 },
    }
    const req = await requestAs("admin", {
      method: "PUT",
      body: JSON.stringify(malformed),
    })
    const res = await PUT(req)
    expect(res.status).toBe(400)
    expect(plansRepo.upsertPlan).not.toHaveBeenCalled()
  })

  it("upserts and echoes back the plan for a valid admin request", async () => {
    const plan = fakePlan({ priceIdr: 199000, tagline: "Harga baru" })
    const req = await requestAs("admin", {
      method: "PUT",
      body: JSON.stringify(plan),
    })
    const res = await PUT(req)
    expect(res.status).toBe(200)
    expect(plansRepo.upsertPlan).toHaveBeenCalledWith(plan)
    const body = await res.json()
    expect(body.priceIdr).toBe(199000)
    expect(body.tagline).toBe("Harga baru")
  })
})
