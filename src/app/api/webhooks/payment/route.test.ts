// @vitest-environment node
/**
 * Route tests for POST /api/webhooks/payment — Stripe webhook. Provider +
 * repos are mocked; the real Stripe parseWebhook/signature verification is
 * covered by src/lib/billing/providers/stripe.test.ts, not this file.
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
}))

vi.mock("@/lib/server/repo/subscriptions", () => ({
  getSubscriptionByProviderRef: vi.fn(),
  activateSubscription: vi.fn(),
  expireOtherActiveSubscriptions: vi.fn(),
  expireSubscription: vi.fn(),
}))

vi.mock("@/lib/server/repo/credits", () => ({
  grantPeriodCredits: vi.fn(),
}))

import { POST } from "./route"
import { getBillingProvider } from "@/lib/billing/providers"
import {
  markPaymentEventProcessed,
  recordPaymentEvent,
} from "@/lib/server/repo/payment-events"
import { getPlan } from "@/lib/server/repo/plans"
import { setProfilePlan } from "@/lib/server/repo/profiles"
import {
  activateSubscription,
  expireOtherActiveSubscriptions,
  expireSubscription,
  getSubscriptionByProviderRef,
} from "@/lib/server/repo/subscriptions"
import { grantPeriodCredits } from "@/lib/server/repo/credits"
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
    provider: "stripe",
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
    provider: "stripe",
    providerOrderId: "brm-order-1",
    transactionStatusRaw: "paid",
    outcome: "paid",
    ...overrides,
  }
}

function mockProvider(parseResult: ParsedWebhookResult): BillingProvider {
  const provider: BillingProvider = {
    name: "stripe",
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
  })

  it("returns 401 when the token is invalid, without recording an event", async () => {
    mockProvider({
      isValid: false,
      errorMessage: "Invalid Stripe signature",
    })
    const res = await POST(jsonRequest({ any: "thing" }))
    expect(res.status).toBe(401)
    expect(recordPaymentEvent).not.toHaveBeenCalled()
  })

  it("returns 200 with no side effects for an unknown providerOrderId", async () => {
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

  it("no-ops on the 'ignored' outcome (an event type Baruma doesn't act on)", async () => {
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

  describe("CRITICAL regression (C1): payment_events must never gate processing", () => {
    it("an 'ignored' webhook recorded first must not block a later genuine 'paid' webhook for the same order", async () => {
      // (a) First delivery: an "ignored" event for order X.
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
