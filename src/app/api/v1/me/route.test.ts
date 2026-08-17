// @vitest-environment node
/**
 * Route tests for GET /api/v1/me
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest"

beforeAll(() => {
  process.env.BARUMA_JWT_SECRET = "test-secret-at-least-32-characters-long"
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test"
})

beforeEach(() => {
  vi.clearAllMocks()
})

vi.mock("@/lib/server/db", () => ({
  query: vi.fn(),
  getClient: vi.fn(),
}))

vi.mock("@/lib/server/repo/profiles", () => ({
  getProfileById: vi.fn(),
  getProfileByEmail: vi.fn(),
  createProfile: vi.fn(),
  setProfilePlan: vi.fn(),
  setProfileName: vi.fn(),
}))

vi.mock("@/lib/server/repo/plans", () => ({
  getPlan: vi.fn(),
}))

vi.mock("@/lib/server/repo/subscriptions", () => ({
  getActiveSubscription: vi.fn(),
  expireSubscription: vi.fn(),
}))

vi.mock("@/lib/server/repo/credits", () => ({
  grantPeriodCredits: vi.fn(),
}))

import { GET, PATCH } from "./route"
import * as profilesRepo from "@/lib/server/repo/profiles"
import * as plansRepo from "@/lib/server/repo/plans"
import * as subscriptionsRepo from "@/lib/server/repo/subscriptions"
import * as creditsRepo from "@/lib/server/repo/credits"
import { signToken } from "@/lib/server/auth-server"

const fakePlan = {
  id: "pro",
  name: "Pro",
  priceIdr: 149000,
  period: "month" as const,
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
  },
}

describe("GET /api/v1/me", () => {
  it("returns 401 when no token provided", async () => {
    const req = new Request("http://localhost/api/v1/me")
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it("returns 401 for an invalid token", async () => {
    const req = new Request("http://localhost/api/v1/me", {
      headers: { authorization: "Bearer invalid-token" },
    })
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it("returns 200 with user data for a valid token", async () => {
    const token = await signToken("user-me-test")
    vi.mocked(profilesRepo.getProfileById).mockResolvedValueOnce({
      id: "user-me-test",
      email: "me@example.com",
      name: "Me User",
      plan: "pro",
      role: "user",
      phone: "081234567890",
      credits_used: 3,
      credits_total: 10,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    vi.mocked(plansRepo.getPlan).mockResolvedValueOnce(fakePlan)
    vi.mocked(subscriptionsRepo.getActiveSubscription).mockResolvedValueOnce(
      null
    )

    const req = new Request("http://localhost/api/v1/me", {
      headers: { authorization: `Bearer ${token}` },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe("user-me-test")
    expect(body.email).toBe("me@example.com")
    expect(body.plan).toBe("pro")
    expect(body.creditsUsed).toBe(3)
    expect(body.creditsTotal).toBe(10)
    expect(body.role).toBe("user")
    expect(body.phone).toBe("081234567890")
    expect(body.entitlements).toEqual(fakePlan.entitlements)
    // No active subscription → null, not omitted.
    expect(body.subscription).toBeNull()
  })

  it("includes subscription status + currentPeriodEnd when an active subscription exists", async () => {
    const token = await signToken("user-with-sub")
    vi.mocked(profilesRepo.getProfileById).mockResolvedValueOnce({
      id: "user-with-sub",
      email: "sub@example.com",
      name: "Sub User",
      plan: "pro",
      role: "user",
      phone: null,
      credits_used: 0,
      credits_total: 100,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    vi.mocked(plansRepo.getPlan).mockResolvedValueOnce(fakePlan)
    vi.mocked(subscriptionsRepo.getActiveSubscription).mockResolvedValueOnce({
      id: "sub-1",
      profileId: "user-with-sub",
      planId: "pro",
      status: "active",
      provider: "mayar",
      providerRef: "brm-abc123-1",
      currentPeriodEnd: "2099-01-01T00:00:00.000Z",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    const req = new Request("http://localhost/api/v1/me", {
      headers: { authorization: `Bearer ${token}` },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.subscription).toEqual({
      status: "active",
      currentPeriodEnd: "2099-01-01T00:00:00.000Z",
    })
  })

  it("returns entitlements null (no crash) when the profile's plan has no matching PlanRow", async () => {
    const token = await signToken("user-orphan-plan")
    vi.mocked(profilesRepo.getProfileById).mockResolvedValueOnce({
      id: "user-orphan-plan",
      email: "orphan@example.com",
      name: "Orphan Plan User",
      plan: "free",
      role: "user",
      phone: null,
      credits_used: 0,
      credits_total: 10,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    vi.mocked(plansRepo.getPlan).mockResolvedValueOnce(null)
    vi.mocked(subscriptionsRepo.getActiveSubscription).mockResolvedValueOnce(
      null
    )

    const req = new Request("http://localhost/api/v1/me", {
      headers: { authorization: `Bearer ${token}` },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.entitlements).toBeNull()
    expect(body.subscription).toBeNull()
  })
})

describe("GET /api/v1/me — lazy subscription expiry", () => {
  it("does not downgrade when currentPeriodEnd is still in the future", async () => {
    const token = await signToken("user-future-sub")
    vi.mocked(profilesRepo.getProfileById).mockResolvedValueOnce({
      id: "user-future-sub",
      email: "future@example.com",
      name: "Future User",
      plan: "pro",
      role: "user",
      phone: null,
      credits_used: 5,
      credits_total: 100,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    vi.mocked(plansRepo.getPlan).mockResolvedValueOnce(fakePlan)
    vi.mocked(subscriptionsRepo.getActiveSubscription).mockResolvedValueOnce({
      id: "sub-future",
      profileId: "user-future-sub",
      planId: "pro",
      status: "active",
      provider: "mayar",
      providerRef: "brm-future-1",
      currentPeriodEnd: "2099-01-01T00:00:00.000Z",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    const req = new Request("http://localhost/api/v1/me", {
      headers: { authorization: `Bearer ${token}` },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.plan).toBe("pro")
    expect(body.subscription).toEqual({
      status: "active",
      currentPeriodEnd: "2099-01-01T00:00:00.000Z",
    })
    expect(subscriptionsRepo.expireSubscription).not.toHaveBeenCalled()
    expect(profilesRepo.setProfilePlan).not.toHaveBeenCalled()
    expect(creditsRepo.grantPeriodCredits).not.toHaveBeenCalled()
    // getProfileById is only called once — no re-fetch when there's no downgrade.
    expect(profilesRepo.getProfileById).toHaveBeenCalledTimes(1)
  })

  it("downgrades to free when currentPeriodEnd is in the past, and reflects it in the response", async () => {
    const token = await signToken("user-expired-sub")
    vi.mocked(profilesRepo.getProfileById)
      .mockResolvedValueOnce({
        id: "user-expired-sub",
        email: "expired@example.com",
        name: "Expired User",
        plan: "pro",
        role: "user",
        phone: null,
        credits_used: 50,
        credits_total: 100,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .mockResolvedValueOnce({
        id: "user-expired-sub",
        email: "expired@example.com",
        name: "Expired User",
        plan: "free",
        role: "user",
        phone: null,
        credits_used: 0,
        credits_total: 10,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
    vi.mocked(subscriptionsRepo.getActiveSubscription).mockResolvedValueOnce({
      id: "sub-expired",
      profileId: "user-expired-sub",
      planId: "pro",
      status: "active",
      provider: "mayar",
      providerRef: "brm-expired-1",
      currentPeriodEnd: "2020-01-01T00:00:00.000Z",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    const freePlan = {
      id: "free",
      name: "Free",
      priceIdr: 0,
      period: "month" as const,
      tagline: null,
      featured: false,
      sortOrder: 0,
      active: true,
      features: [],
      limits: [],
      entitlements: {
        creditsPerPeriod: 10,
        maxProjects: 1,
        exportPdf: false,
        glbUpload: false,
      },
    }
    // Called twice: once inside the downgrade branch (getPlan("free") for the
    // credit grant), once after re-fetching the profile (getPlan(profile.plan)
    // to build the response entitlements) — both resolve the same free plan.
    vi.mocked(plansRepo.getPlan).mockResolvedValue(freePlan)
    // This request is the one that actually flips active → expired.
    vi.mocked(subscriptionsRepo.expireSubscription).mockResolvedValueOnce(true)

    const req = new Request("http://localhost/api/v1/me", {
      headers: { authorization: `Bearer ${token}` },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)

    expect(subscriptionsRepo.expireSubscription).toHaveBeenCalledWith(
      "sub-expired"
    )
    expect(profilesRepo.setProfilePlan).toHaveBeenCalledWith(
      "user-expired-sub",
      "free"
    )
    expect(creditsRepo.grantPeriodCredits).toHaveBeenCalledWith(
      "user-expired-sub",
      10,
      "downgrade"
    )
    expect(profilesRepo.getProfileById).toHaveBeenCalledTimes(2)

    const body = await res.json()
    expect(body.plan).toBe("free")
    expect(body.creditsTotal).toBe(10)
    expect(body.creditsUsed).toBe(0)
    expect(body.entitlements).toEqual(freePlan.entitlements)
    expect(body.subscription).toBeNull()
  })

  // Task 5 CRITICAL-fix follow-on: TOCTOU between the read in
  // getActiveSubscription and the write in expireSubscription. Two
  // concurrent requests for the same just-lapsed subscription both reach
  // the downgrade branch; expireSubscription's atomic `WHERE status =
  // 'active'` guard (subscriptions.ts) means only one of them reports
  // `true`. This test simulates the LOSING request — it must not re-grant
  // free credits (which would duplicate the credits_ledger "downgrade" audit
  // row) nor re-fetch the profile as if it had just downgraded it.
  it("does not double-grant downgrade credits when expireSubscription reports a concurrent request already expired it", async () => {
    const token = await signToken("user-concurrent-expiry")
    vi.mocked(profilesRepo.getProfileById).mockResolvedValueOnce({
      id: "user-concurrent-expiry",
      email: "concurrent@example.com",
      name: "Concurrent User",
      plan: "pro",
      role: "user",
      phone: null,
      credits_used: 20,
      credits_total: 100,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    vi.mocked(plansRepo.getPlan).mockResolvedValueOnce(fakePlan)
    vi.mocked(subscriptionsRepo.getActiveSubscription).mockResolvedValueOnce({
      id: "sub-concurrent",
      profileId: "user-concurrent-expiry",
      planId: "pro",
      status: "active",
      provider: "mayar",
      providerRef: "brm-concurrent-1",
      currentPeriodEnd: "2020-01-01T00:00:00.000Z",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    // Simulate: a concurrent request already flipped this row to 'expired'
    // between our getActiveSubscription read and our expireSubscription call.
    vi.mocked(subscriptionsRepo.expireSubscription).mockResolvedValueOnce(false)

    const req = new Request("http://localhost/api/v1/me", {
      headers: { authorization: `Bearer ${token}` },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)

    expect(subscriptionsRepo.expireSubscription).toHaveBeenCalledWith(
      "sub-concurrent"
    )
    expect(profilesRepo.setProfilePlan).not.toHaveBeenCalled()
    expect(creditsRepo.grantPeriodCredits).not.toHaveBeenCalled()
    // No re-fetch when expireSubscription did nothing — getProfileById is
    // only called once, at the top of the handler.
    expect(profilesRepo.getProfileById).toHaveBeenCalledTimes(1)

    // Still treated as "no active subscription" from this response's POV.
    const body = await res.json()
    expect(body.subscription).toBeNull()
  })
})

describe("PATCH /api/v1/me", () => {
  function patchRequest(token: string | null, body: unknown) {
    return new Request("http://localhost/api/v1/me", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    })
  }

  it("returns 401 when no token provided", async () => {
    const res = await PATCH(patchRequest(null, { name: "Nama Baru" }))
    expect(res.status).toBe(401)
  })

  it("returns 400 when name is missing", async () => {
    const token = await signToken("user-patch-missing-name")
    const res = await PATCH(patchRequest(token, {}))
    expect(res.status).toBe(400)
    expect(profilesRepo.setProfileName).not.toHaveBeenCalled()
  })

  it("returns 400 when name is shorter than 2 characters", async () => {
    const token = await signToken("user-patch-short-name")
    const res = await PATCH(patchRequest(token, { name: "A" }))
    expect(res.status).toBe(400)
    expect(profilesRepo.setProfileName).not.toHaveBeenCalled()
  })

  it("updates the profile name and returns the refreshed user", async () => {
    const token = await signToken("user-patch-ok")
    vi.mocked(profilesRepo.setProfileName).mockResolvedValueOnce(undefined)
    vi.mocked(profilesRepo.getProfileById).mockResolvedValueOnce({
      id: "user-patch-ok",
      email: "patch@example.com",
      name: "Nama Baru",
      plan: "free",
      role: "user",
      phone: null,
      credits_used: 0,
      credits_total: 10,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    vi.mocked(plansRepo.getPlan).mockResolvedValueOnce(fakePlan)
    vi.mocked(subscriptionsRepo.getActiveSubscription).mockResolvedValueOnce(
      null
    )

    const res = await PATCH(patchRequest(token, { name: "  Nama Baru  " }))
    expect(res.status).toBe(200)
    expect(profilesRepo.setProfileName).toHaveBeenCalledWith(
      "user-patch-ok",
      "Nama Baru"
    )
    const body = await res.json()
    expect(body.name).toBe("Nama Baru")
  })
})
