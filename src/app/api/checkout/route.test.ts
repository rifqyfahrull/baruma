// @vitest-environment node
/**
 * Route tests for POST /api/checkout — auth-guarded via `requireUser()`, the
 * same helper every `/api/v1/*` route uses (it accepts the shared Supabase
 * session cookie or a Bearer JWT). The Stripe provider + repos are mocked
 * here — the real Stripe SDK call is covered by
 * src/lib/billing/providers/stripe.test.ts, not this file.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/server/auth-server", () => ({
  requireUser: vi.fn(),
}))

vi.mock("@/lib/billing/providers", () => ({
  getBillingProvider: vi.fn(),
}))

vi.mock("@/lib/server/repo/plans", () => ({
  getPlan: vi.fn(),
}))

vi.mock("@/lib/server/repo/profiles", () => ({
  getProfileById: vi.fn(),
}))

vi.mock("@/lib/server/repo/subscriptions", () => ({
  createPendingSubscription: vi.fn(),
}))

import { POST } from "./route"
import { requireUser } from "@/lib/server/auth-server"
import { getBillingProvider } from "@/lib/billing/providers"
import { getPlan } from "@/lib/server/repo/plans"
import { getProfileById } from "@/lib/server/repo/profiles"
import { createPendingSubscription } from "@/lib/server/repo/subscriptions"
import type { BillingProvider, CreateCheckoutResult } from "@/lib/billing/providers/types"
import type { PlanRow } from "@/types"
import type { ProfileRow } from "@/lib/server/repo/profiles"

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
    },
    ...overrides,
  }
}

function fakeProfile(overrides: Partial<ProfileRow> = {}): ProfileRow {
  return {
    id: "user-checkout-test",
    email: "checkout@example.com",
    name: "Checkout User",
    plan: "free",
    role: "user",
    phone: "081200000000",
    credits_used: 0,
    credits_total: 10,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

function fakeProvider(createCheckout: BillingProvider["createCheckout"]): BillingProvider {
  return { name: "stripe", createCheckout, parseWebhook: vi.fn() }
}

function jsonRequest(body: unknown = { planId: "pro" }): Request {
  return new Request("http://localhost/api/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const ORIGINAL_STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY

describe("POST /api/checkout", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.STRIPE_SECRET_KEY = "test-key"
  })

  afterAll(() => {
    if (ORIGINAL_STRIPE_SECRET_KEY === undefined) {
      delete process.env.STRIPE_SECRET_KEY
    } else {
      process.env.STRIPE_SECRET_KEY = ORIGINAL_STRIPE_SECRET_KEY
    }
  })

  it("returns 401 when unauthenticated (requireUser throws)", async () => {
    vi.mocked(requireUser).mockRejectedValueOnce(new Error("unauthorized"))
    const res = await POST(jsonRequest())
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: "unauthorized" })
  })

  it("returns 400 when planId is missing", async () => {
    vi.mocked(requireUser).mockResolvedValueOnce({
      userId: "user-checkout-test",
    })
    const res = await POST(jsonRequest({}))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "invalid_plan" })
  })

  it("returns 400 when the plan does not exist", async () => {
    vi.mocked(requireUser).mockResolvedValueOnce({
      userId: "user-checkout-test",
    })
    vi.mocked(getPlan).mockResolvedValueOnce(null)
    const res = await POST(jsonRequest({ planId: "ghost" }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "invalid_plan" })
  })

  it("returns 400 for the free plan (priceIdr <= 0)", async () => {
    vi.mocked(requireUser).mockResolvedValueOnce({
      userId: "user-checkout-test",
    })
    vi.mocked(getPlan).mockResolvedValueOnce(
      fakePlan({ id: "free", priceIdr: 0 })
    )
    const res = await POST(jsonRequest({ planId: "free" }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "invalid_plan" })
  })

  it("returns 400 when the plan is inactive", async () => {
    vi.mocked(requireUser).mockResolvedValueOnce({
      userId: "user-checkout-test",
    })
    vi.mocked(getPlan).mockResolvedValueOnce(fakePlan({ active: false }))
    const res = await POST(jsonRequest({ planId: "pro" }))
    expect(res.status).toBe(400)
  })

  it("returns 503 when STRIPE_SECRET_KEY is not configured", async () => {
    delete process.env.STRIPE_SECRET_KEY
    vi.mocked(requireUser).mockResolvedValueOnce({
      userId: "user-checkout-test",
    })
    vi.mocked(getPlan).mockResolvedValueOnce(fakePlan())
    const res = await POST(jsonRequest({ planId: "pro" }))
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toBe("payment_not_configured")
    expect(body.message).toBeTruthy()
  })

  it("returns 404 when the profile is not found", async () => {
    vi.mocked(requireUser).mockResolvedValueOnce({
      userId: "user-checkout-test",
    })
    vi.mocked(getPlan).mockResolvedValueOnce(fakePlan())
    vi.mocked(getProfileById).mockResolvedValueOnce(null)
    const res = await POST(jsonRequest({ planId: "pro" }))
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe("profile_not_found")
  })

  it("returns 502 when the provider throws", async () => {
    vi.mocked(requireUser).mockResolvedValueOnce({
      userId: "user-checkout-test",
    })
    vi.mocked(getPlan).mockResolvedValueOnce(fakePlan())
    vi.mocked(getProfileById).mockResolvedValueOnce(fakeProfile())
    vi.mocked(getBillingProvider).mockReturnValueOnce(
      fakeProvider(
        vi.fn().mockRejectedValueOnce(
          new Error("Mayar create invoice failed: boom")
        )
      )
    )
    const res = await POST(jsonRequest({ planId: "pro" }))
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toBe("checkout_failed")
    expect(body.message).toContain("Mayar create invoice failed")
  })

  it("returns 200 + redirectUrl and records a pending subscription on success", async () => {
    vi.mocked(requireUser).mockResolvedValueOnce({
      userId: "user-checkout-test",
    })
    vi.mocked(getPlan).mockResolvedValueOnce(fakePlan())
    vi.mocked(getProfileById).mockResolvedValueOnce(fakeProfile())
    const createCheckout = vi.fn<() => Promise<CreateCheckoutResult>>().mockResolvedValueOnce({
      provider: "stripe",
      providerOrderId: "brm-user-che-123",
      amountIdr: 149000,
      checkoutUrl: "https://myr.id/pay/brm-user-che-123",
    })
    vi.mocked(getBillingProvider).mockReturnValueOnce(fakeProvider(createCheckout))

    const res = await POST(jsonRequest({ planId: "pro" }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.redirectUrl).toBe("https://myr.id/pay/brm-user-che-123")

    expect(createCheckout).toHaveBeenCalledWith({
      userId: "user-checkout-test",
      email: "checkout@example.com",
      fullName: "Checkout User",
      plan: "pro",
      mobile: "081200000000",
    })
    expect(createPendingSubscription).toHaveBeenCalledWith({
      profileId: "user-checkout-test",
      planId: "pro",
      provider: "stripe",
      providerRef: "brm-user-che-123",
    })
  })

  it("passes mobile: undefined when the profile has no phone", async () => {
    vi.mocked(requireUser).mockResolvedValueOnce({
      userId: "user-checkout-test",
    })
    vi.mocked(getPlan).mockResolvedValueOnce(fakePlan())
    vi.mocked(getProfileById).mockResolvedValueOnce(
      fakeProfile({ phone: null })
    )
    const createCheckout = vi.fn<() => Promise<CreateCheckoutResult>>().mockResolvedValueOnce({
      provider: "stripe",
      providerOrderId: "brm-x",
      amountIdr: 149000,
      checkoutUrl: "https://myr.id/pay/x",
    })
    vi.mocked(getBillingProvider).mockReturnValueOnce(fakeProvider(createCheckout))

    await POST(jsonRequest({ planId: "pro" }))
    expect(createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ mobile: undefined })
    )
  })
})
