// @vitest-environment node
/**
 * Route tests for POST /api/webhooks/payment — Mayar webhook, ported from
 * the parent tampil.dev pattern (Task 5). Provider + repos are mocked; the
 * real Mayar parseWebhook/token verification is covered by
 * src/lib/billing/providers/mayar.test.ts, not this file.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/billing/providers", () => ({
  getBillingProvider: vi.fn(),
}))

vi.mock("@/lib/server/repo/payment-events", () => ({
  recordPaymentEvent: vi.fn(),
  markPaymentEventProcessed: vi.fn(),
}))

vi.mock("@/lib/server/repo/plans", () => ({
  getPlan: vi.fn(),
}))

vi.mock("@/lib/server/repo/profiles", () => ({
  setProfilePlan: vi.fn(),
  getProfileById: vi.fn(),
}))

vi.mock("@/lib/server/email", () => ({
  sendEmail: vi.fn(),
}))

// Receipt email fires via next/server's `after()` — same immediate-but-
// awaitable pattern as alternatives/generate/route.test.ts, so tests can
// `await Promise.all(afterJobs)` to observe it.
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

vi.mock("@/lib/server/repo/subscriptions", () => ({
  getSubscriptionByProviderRef: vi.fn(),
  activateSubscription: vi.fn(),
  expireOtherActiveSubscriptions: vi.fn(),
  expireSubscription: vi.fn(),
}))

vi.mock("@/lib/server/repo/credits", () => ({
  grantPeriodCredits: vi.fn(),
}))

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}))

import { POST } from "./route"
import { getBillingProvider } from "@/lib/billing/providers"
import {
  markPaymentEventProcessed,
  recordPaymentEvent,
} from "@/lib/server/repo/payment-events"
import { getPlan } from "@/lib/server/repo/plans"
import { getProfileById, setProfilePlan } from "@/lib/server/repo/profiles"
import {
  activateSubscription,
  expireOtherActiveSubscriptions,
  expireSubscription,
  getSubscriptionByProviderRef,
} from "@/lib/server/repo/subscriptions"
import { grantPeriodCredits } from "@/lib/server/repo/credits"
import { sendEmail } from "@/lib/server/email"
import { __resetRateLimitStore } from "@/lib/server/rate-limit"
import * as Sentry from "@sentry/nextjs"
import type {
  BillingProvider,
  NormalizedWebhookEvent,
  ParsedWebhookResult,
  PaymentOutcome,
} from "@/lib/billing/providers/types"
import type { PlanRow } from "@/types"
import type { SubRow } from "@/lib/server/repo/subscriptions"

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

function fakeSub(overrides: Partial<SubRow> = {}): SubRow {
  const now = new Date().toISOString()
  return {
    id: "sub-1",
    profileId: "profile-1",
    planId: "pro",
    status: "pending",
    provider: "mayar",
    providerRef: "brm-order-1",
    currentPeriodEnd: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function fakeEvent(
  overrides: Partial<NormalizedWebhookEvent> = {}
): NormalizedWebhookEvent {
  return {
    provider: "mayar",
    providerOrderId: "brm-order-1",
    transactionStatusRaw: "paid",
    outcome: "paid",
    ...overrides,
  }
}

function mockProvider(parseResult: ParsedWebhookResult): BillingProvider {
  const provider: BillingProvider = {
    name: "mayar",
    createCheckout: vi.fn(),
    parseWebhook: vi.fn().mockReturnValue(parseResult),
  }
  vi.mocked(getBillingProvider).mockReturnValue(provider)
  return provider
}

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/webhooks/payment", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/webhooks/payment", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetRateLimitStore()
    afterJobs.length = 0
  })

  it("429s the 61st delivery from the same IP within a minute (generous — never blocks a normal retry storm)", async () => {
    mockProvider({
      isValid: true,
      event: fakeEvent(),
    })
    vi.mocked(getSubscriptionByProviderRef).mockResolvedValue(null)
    for (let i = 0; i < 60; i++) {
      const res = await POST(jsonRequest({ any: "thing" }))
      expect(res.status).not.toBe(429)
    }
    const blocked = await POST(jsonRequest({ any: "thing" }))
    expect(blocked.status).toBe(429)
  })

  it("returns 401 when the token is invalid, without recording an event", async () => {
    mockProvider({
      isValid: false,
      errorMessage: "Invalid Mayar webhook token",
    })
    const res = await POST(jsonRequest({ any: "thing" }))
    expect(res.status).toBe(401)
    expect(recordPaymentEvent).not.toHaveBeenCalled()
  })

  it("returns 200 with no side effects for an unknown providerOrderId (shared merchant account)", async () => {
    mockProvider({ isValid: true, event: fakeEvent() })
    vi.mocked(recordPaymentEvent).mockResolvedValueOnce("inserted")
    vi.mocked(getSubscriptionByProviderRef).mockResolvedValueOnce(null)

    const res = await POST(
      jsonRequest({ external_id: "brm-order-1", status: "paid" })
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(activateSubscription).not.toHaveBeenCalled()
    expect(setProfilePlan).not.toHaveBeenCalled()
    expect(grantPeriodCredits).not.toHaveBeenCalled()
  })

  it("still looks up and (re)processes the subscription when recordPaymentEvent reports a duplicate audit row — the audit log is not the idempotency gate", async () => {
    mockProvider({ isValid: true, event: fakeEvent({ outcome: "paid" }) })
    vi.mocked(recordPaymentEvent).mockResolvedValueOnce("duplicate")
    vi.mocked(getSubscriptionByProviderRef).mockResolvedValueOnce(fakeSub())
    vi.mocked(activateSubscription).mockResolvedValueOnce(
      fakeSub({
        status: "active",
        currentPeriodEnd: "2026-08-04T00:00:00.000Z",
      })
    )
    vi.mocked(getPlan).mockResolvedValueOnce(fakePlan())

    const res = await POST(
      jsonRequest({ external_id: "brm-order-1", status: "paid" })
    )
    expect(res.status).toBe(200)
    expect(getSubscriptionByProviderRef).toHaveBeenCalledWith("brm-order-1")
    expect(activateSubscription).toHaveBeenCalledTimes(1)
    expect(setProfilePlan).toHaveBeenCalledWith("profile-1", "pro")
    expect(grantPeriodCredits).toHaveBeenCalledWith(
      "profile-1",
      100,
      "period_grant"
    )
  })

  it("activates a pending subscription on a paid outcome (month plan → ~30 days out)", async () => {
    mockProvider({ isValid: true, event: fakeEvent({ outcome: "paid" }) })
    vi.mocked(recordPaymentEvent).mockResolvedValueOnce("inserted")
    vi.mocked(getSubscriptionByProviderRef).mockResolvedValueOnce(fakeSub())
    vi.mocked(getPlan).mockResolvedValueOnce(fakePlan({ period: "month" }))
    vi.mocked(activateSubscription).mockResolvedValueOnce(
      fakeSub({ status: "active" })
    )

    const before = Date.now()
    const res = await POST(
      jsonRequest({ external_id: "brm-order-1", status: "paid" })
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })

    expect(activateSubscription).toHaveBeenCalledTimes(1)
    const call = vi.mocked(activateSubscription).mock.calls[0][0]
    expect(call.providerRef).toBe("brm-order-1")
    const days =
      (new Date(call.currentPeriodEnd).getTime() - before) /
      (24 * 60 * 60 * 1000)
    expect(days).toBeGreaterThan(29)
    expect(days).toBeLessThan(31)

    expect(expireOtherActiveSubscriptions).toHaveBeenCalledWith(
      "profile-1",
      "sub-1"
    )
    expect(setProfilePlan).toHaveBeenCalledWith("profile-1", "pro")
    expect(grantPeriodCredits).toHaveBeenCalledWith(
      "profile-1",
      100,
      "period_grant"
    )
    expect(markPaymentEventProcessed).toHaveBeenCalledWith("brm-order-1:paid")
  })

  it("sends a receipt email in the background after a winning activation", async () => {
    mockProvider({ isValid: true, event: fakeEvent({ outcome: "paid" }) })
    vi.mocked(recordPaymentEvent).mockResolvedValueOnce("inserted")
    vi.mocked(getSubscriptionByProviderRef).mockResolvedValueOnce(fakeSub())
    vi.mocked(getPlan).mockResolvedValueOnce(fakePlan())
    vi.mocked(activateSubscription).mockResolvedValueOnce(
      fakeSub({ status: "active", currentPeriodEnd: "2026-08-04T00:00:00.000Z" })
    )
    vi.mocked(getProfileById).mockResolvedValueOnce({
      id: "profile-1",
      email: "buyer@example.com",
      name: "Buyer",
      plan: "pro",
      role: "user",
      phone: null,
      credits_used: 0,
      credits_total: 100,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })

    const res = await POST(
      jsonRequest({ external_id: "brm-order-1", status: "paid" })
    )
    expect(res.status).toBe(200)

    // Receipt email fires in the BACKGROUND (after the response) — await the
    // scheduled job to observe it.
    await Promise.all(afterJobs)
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "buyer@example.com",
        subject: expect.stringContaining("kuitansi"),
      })
    )
  })

  it("does not send a receipt email when activateSubscription reports no row affected (no winning activation)", async () => {
    mockProvider({ isValid: true, event: fakeEvent({ outcome: "paid" }) })
    vi.mocked(recordPaymentEvent).mockResolvedValueOnce("inserted")
    vi.mocked(getSubscriptionByProviderRef).mockResolvedValueOnce(
      fakeSub({ status: "active" })
    )
    vi.mocked(getPlan).mockResolvedValueOnce(fakePlan())
    vi.mocked(activateSubscription).mockResolvedValueOnce(null)

    const res = await POST(
      jsonRequest({ external_id: "brm-order-1", status: "paid" })
    )
    expect(res.status).toBe(200)
    await Promise.all(afterJobs)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("activates a pending subscription on a paid outcome (year plan → ~365 days out)", async () => {
    mockProvider({ isValid: true, event: fakeEvent({ outcome: "paid" }) })
    vi.mocked(recordPaymentEvent).mockResolvedValueOnce("inserted")
    vi.mocked(getSubscriptionByProviderRef).mockResolvedValueOnce(
      fakeSub({ planId: "studio" })
    )
    vi.mocked(getPlan).mockResolvedValueOnce(
      fakePlan({
        id: "studio",
        period: "year",
        entitlements: {
          creditsPerPeriod: 500,
          maxProjects: 50,
          exportPdf: true,
          glbUpload: true,
          aiRenderHd: true,
        },
      })
    )
    vi.mocked(activateSubscription).mockResolvedValueOnce(
      fakeSub({ planId: "studio", status: "active" })
    )

    const before = Date.now()
    const res = await POST(
      jsonRequest({ external_id: "brm-order-1", status: "paid" })
    )
    expect(res.status).toBe(200)

    const call = vi.mocked(activateSubscription).mock.calls[0][0]
    const days =
      (new Date(call.currentPeriodEnd).getTime() - before) /
      (24 * 60 * 60 * 1000)
    expect(days).toBeGreaterThan(364)
    expect(days).toBeLessThan(366)

    expect(setProfilePlan).toHaveBeenCalledWith("profile-1", "studio")
    expect(grantPeriodCredits).toHaveBeenCalledWith(
      "profile-1",
      500,
      "period_grant"
    )
  })

  it.each(["failed", "expired", "cancelled"] as const)(
    "marks the subscription expired on a %s outcome, without touching plan/credits",
    async (outcome: PaymentOutcome) => {
      mockProvider({
        isValid: true,
        event: fakeEvent({ outcome, transactionStatusRaw: outcome }),
      })
      vi.mocked(recordPaymentEvent).mockResolvedValueOnce("inserted")
      vi.mocked(getSubscriptionByProviderRef).mockResolvedValueOnce(fakeSub())

      const res = await POST(
        jsonRequest({ external_id: "brm-order-1", status: outcome })
      )
      expect(res.status).toBe(200)
      expect(expireSubscription).toHaveBeenCalledWith("sub-1")
      expect(markPaymentEventProcessed).toHaveBeenCalledWith(
        `brm-order-1:${outcome}`
      )
      expect(setProfilePlan).not.toHaveBeenCalled()
      expect(grantPeriodCredits).not.toHaveBeenCalled()
    }
  )

  it("no-ops on the 'ignored' outcome (Mayar testing event)", async () => {
    mockProvider({ isValid: true, event: fakeEvent({ outcome: "ignored" }) })
    vi.mocked(recordPaymentEvent).mockResolvedValueOnce("inserted")
    vi.mocked(getSubscriptionByProviderRef).mockResolvedValueOnce(fakeSub())

    const res = await POST(
      jsonRequest({ external_id: "brm-order-1", status: "testing" })
    )
    expect(res.status).toBe(200)
    expect(activateSubscription).not.toHaveBeenCalled()
    expect(expireSubscription).not.toHaveBeenCalled()
    expect(markPaymentEventProcessed).not.toHaveBeenCalled()
  })

  it("does not grant plan/credits again when activateSubscription reports no row affected (already active)", async () => {
    mockProvider({ isValid: true, event: fakeEvent({ outcome: "paid" }) })
    vi.mocked(recordPaymentEvent).mockResolvedValueOnce("inserted")
    vi.mocked(getSubscriptionByProviderRef).mockResolvedValueOnce(
      fakeSub({
        status: "active",
        currentPeriodEnd: "2026-08-01T00:00:00.000Z",
      })
    )
    vi.mocked(getPlan).mockResolvedValueOnce(fakePlan())
    // The atomic `WHERE status = 'pending'` guard affects 0 rows because the
    // subscription is already active — this IS the idempotency guard,
    // there's no separate route-level status check anymore.
    vi.mocked(activateSubscription).mockResolvedValueOnce(null)

    const res = await POST(
      jsonRequest({ external_id: "brm-order-1", status: "paid" })
    )
    expect(res.status).toBe(200)
    expect(activateSubscription).toHaveBeenCalledTimes(1)
    expect(expireOtherActiveSubscriptions).not.toHaveBeenCalled()
    expect(setProfilePlan).not.toHaveBeenCalled()
    expect(grantPeriodCredits).not.toHaveBeenCalled()
  })

  it("returns 200 without throwing on a malformed JSON body", async () => {
    const req = new Request("http://localhost/api/webhooks/payment", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not-json!!",
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(getBillingProvider).not.toHaveBeenCalled()
    expect(recordPaymentEvent).not.toHaveBeenCalled()
  })

  it("sends the unhandled error to Sentry (route + orderId tags) instead of swallowing it silently, still returning 200 to avoid a retry storm", async () => {
    mockProvider({ isValid: true, event: fakeEvent({ providerOrderId: "brm-sentry-1" }) })
    vi.mocked(getSubscriptionByProviderRef).mockRejectedValueOnce(new Error("db down"))

    const res = await POST(jsonRequest({ any: "thing" }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: expect.objectContaining({ route: "webhook-payment", orderId: "brm-sentry-1" }),
      })
    )
  })

  describe("CRITICAL regression (C1): payment_events must never gate processing", () => {
    it("an 'ignored' webhook recorded first must not block a later genuine 'paid' webhook for the same order", async () => {
      // (a) First delivery: Mayar's own "testing" ping for order X.
      mockProvider({
        isValid: true,
        event: fakeEvent({
          outcome: "ignored",
          transactionStatusRaw: "testing",
        }),
      })
      vi.mocked(recordPaymentEvent).mockResolvedValueOnce("inserted")
      vi.mocked(getSubscriptionByProviderRef).mockResolvedValueOnce(
        fakeSub({ status: "pending" })
      )

      const first = await POST(
        jsonRequest({ external_id: "brm-order-1", status: "testing" })
      )
      expect(first.status).toBe(200)
      expect(activateSubscription).not.toHaveBeenCalled()
      expect(setProfilePlan).not.toHaveBeenCalled()
      expect(grantPeriodCredits).not.toHaveBeenCalled()

      // (b) Second delivery, SAME order X: the genuine "paid" event. Under
      // the pre-fix code, recordPaymentEvent was keyed by providerOrderId
      // ALONE, so this call would find the id already inserted by (a) and
      // report "duplicate" — and the route short-circuited to 200 on that
      // result BEFORE ever looking up the subscription. Simulate that exact
      // collision explicitly (mock "duplicate" here too) to prove the route
      // no longer gates on it: activation must still happen.
      mockProvider({ isValid: true, event: fakeEvent({ outcome: "paid" }) })
      vi.mocked(recordPaymentEvent).mockResolvedValueOnce("duplicate")
      vi.mocked(getSubscriptionByProviderRef).mockResolvedValueOnce(
        fakeSub({ status: "pending" })
      )
      vi.mocked(activateSubscription).mockResolvedValueOnce(
        fakeSub({
          status: "active",
          currentPeriodEnd: "2026-08-04T00:00:00.000Z",
        })
      )
      vi.mocked(getPlan).mockResolvedValueOnce(fakePlan())

      const second = await POST(
        jsonRequest({ external_id: "brm-order-1", status: "paid" })
      )
      expect(second.status).toBe(200)
      expect(activateSubscription).toHaveBeenCalledTimes(1)
      expect(setProfilePlan).toHaveBeenCalledWith("profile-1", "pro")
      expect(grantPeriodCredits).toHaveBeenCalledWith(
        "profile-1",
        100,
        "period_grant"
      )
    })

    it("a genuine 'paid' webhook delivered twice only grants the plan/credits once", async () => {
      mockProvider({ isValid: true, event: fakeEvent({ outcome: "paid" }) })
      vi.mocked(getPlan).mockResolvedValue(fakePlan())

      // First delivery: subscription is pending → activateSubscription flips
      // it to active and the grant runs.
      vi.mocked(recordPaymentEvent).mockResolvedValueOnce("inserted")
      vi.mocked(getSubscriptionByProviderRef).mockResolvedValueOnce(
        fakeSub({ status: "pending" })
      )
      vi.mocked(activateSubscription).mockResolvedValueOnce(
        fakeSub({
          status: "active",
          currentPeriodEnd: "2026-08-04T00:00:00.000Z",
        })
      )
      const first = await POST(
        jsonRequest({ external_id: "brm-order-1", status: "paid" })
      )
      expect(first.status).toBe(200)

      // Second delivery, identical event: in reality the row is now active,
      // so the atomic `WHERE status = 'pending'` guard affects 0 rows.
      vi.mocked(recordPaymentEvent).mockResolvedValueOnce("duplicate")
      vi.mocked(getSubscriptionByProviderRef).mockResolvedValueOnce(
        fakeSub({
          status: "active",
          currentPeriodEnd: "2026-08-04T00:00:00.000Z",
        })
      )
      vi.mocked(activateSubscription).mockResolvedValueOnce(null)
      const second = await POST(
        jsonRequest({ external_id: "brm-order-1", status: "paid" })
      )
      expect(second.status).toBe(200)

      expect(activateSubscription).toHaveBeenCalledTimes(2)
      expect(setProfilePlan).toHaveBeenCalledTimes(1)
      expect(grantPeriodCredits).toHaveBeenCalledTimes(1)
    })

    it("expires other active subscriptions for the profile after a successful activation", async () => {
      mockProvider({ isValid: true, event: fakeEvent({ outcome: "paid" }) })
      vi.mocked(recordPaymentEvent).mockResolvedValueOnce("inserted")
      vi.mocked(getSubscriptionByProviderRef).mockResolvedValueOnce(
        fakeSub({ status: "pending" })
      )
      vi.mocked(activateSubscription).mockResolvedValueOnce(
        fakeSub({
          id: "sub-new",
          status: "active",
          currentPeriodEnd: "2026-08-04T00:00:00.000Z",
        })
      )
      vi.mocked(getPlan).mockResolvedValueOnce(fakePlan())

      const res = await POST(
        jsonRequest({ external_id: "brm-order-1", status: "paid" })
      )
      expect(res.status).toBe(200)
      expect(expireOtherActiveSubscriptions).toHaveBeenCalledWith(
        "profile-1",
        "sub-new"
      )
    })
  })
})
