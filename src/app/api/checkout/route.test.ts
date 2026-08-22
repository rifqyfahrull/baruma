// @vitest-environment node
/**
 * Route tests for POST /api/checkout — auth-guarded via `requireUser()`, the
 * same helper every `/api/v1/*` route uses (it accepts the shared Supabase
 * session cookie or a Bearer JWT). The parent-billing provider + repos are
 * mocked here — the real parent HTTP call is covered by
 * src/lib/billing/providers/parent.test.ts, not this file.
 *
 * Baruma is a child app: checkout delegates to the tampil.dev parent, so the
 * "payment configured" gate is PARENT_BILLING_URL + PARENT_BILLING_SECRET and
 * the recorded subscription provider is "parent".
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
  return { name: "parent", createCheckout, parseWebhook: vi.fn() }
}

function jsonRequest(body: unknown = { planId: "pro" }): Request {
  return new Request("http://localhost/api/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const ENV_KEYS = [
  "PARENT_BILLING_URL",
  "PARENT_BILLING_SECRET",
  "NEXT_PUBLIC_APP_URL",
] as const
const ORIGINAL_ENV = Object.fromEntries(
  ENV_KEYS.map((k) => [k, process.env[k]])
) as Record<(typeof ENV_KEYS)[number], string | undefined>

describe("POST /api/checkout", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.PARENT_BILLING_URL = "https://tampil.dev"
    process.env.PARENT_BILLING_SECRET = "test-secret"
    process.env.NEXT_PUBLIC_APP_URL = "https://app.test"
  })

  afterAll(() => {
    for (const k of ENV_KEYS) {
      if (ORIGINAL_ENV[k] === undefined) delete process.env[k]
      else process.env[k] = ORIGINAL_ENV[k]
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

  it("returns 503 when the parent-billing bridge is not configured", async () => {
    delete process.env.PARENT_BILLING_URL
    delete process.env.PARENT_BILLING_SECRET
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
          new Error("Parent billing checkout failed (502): boom")
        )
      )
    )
    const res = await POST(jsonRequest({ planId: "pro" }))
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toBe("checkout_failed")
    expect(body.message).toContain("Parent billing checkout failed")
  })

  it("returns 200 + redirectUrl and records a pending subscription on success", async () => {
    vi.mocked(requireUser).mockResolvedValueOnce({
      userId: "user-checkout-test",
    })
    vi.mocked(getPlan).mockResolvedValueOnce(fakePlan())
    vi.mocked(getProfileById).mockResolvedValueOnce(fakeProfile())
    const createCheckout = vi.fn<() => Promise<CreateCheckoutResult>>().mockResolvedValueOnce({
      provider: "parent",
      providerOrderId: "brm-user-che-123",
      amountIdr: 149000,
      checkoutUrl: "https://myr.id/pay/brm-user-che-123",
    })
    vi.mocked(getBillingProvider).mockReturnValueOnce(fakeProvider(createCheckout))

    const res = await POST(jsonRequest({ planId: "pro" }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.redirectUrl).toBe("https://myr.id/pay/brm-user-che-123")

    // Baruma is the source of truth for its plan price/name and passes the
    // billing-return URL through to the parent.
    expect(createCheckout).toHaveBeenCalledWith({
      userId: "user-checkout-test",
      email: "checkout@example.com",
      fullName: "Checkout User",
      plan: "pro",
      mobile: "081200000000",
      amountIdr: 149000,
      planName: "Pro",
      period: "month",
      redirectUrl: "https://app.test/app/billing",
    })
    expect(createPendingSubscription).toHaveBeenCalledWith({
      profileId: "user-checkout-test",
      planId: "pro",
      provider: "parent",
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
      provider: "parent",
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
