// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const sessionsCreate = vi.fn()
const constructEvent = vi.fn()

vi.mock("stripe", () => {
  class MockStripe {
    checkout = { sessions: { create: sessionsCreate } }
    webhooks = { constructEvent }
  }
  return { default: MockStripe }
})

vi.mock("@/lib/server/repo/plans", () => ({
  getPlan: vi.fn(),
}))

import { stripeBillingProvider } from "./stripe"
import { getPlan } from "@/lib/server/repo/plans"

beforeEach(() => {
  vi.clearAllMocks()
  process.env.STRIPE_SECRET_KEY = "sk_test_123"
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_123"
  process.env.NEXT_PUBLIC_APP_URL = "https://baruma.test"
})

afterEach(() => {
  delete process.env.STRIPE_SECRET_KEY
  delete process.env.STRIPE_WEBHOOK_SECRET
  delete process.env.NEXT_PUBLIC_APP_URL
  delete process.env.APP_NAME
})

describe("stripeBillingProvider.createCheckout", () => {
  it("throws when STRIPE_SECRET_KEY is not configured", async () => {
    delete process.env.STRIPE_SECRET_KEY
    await expect(
      stripeBillingProvider.createCheckout({ userId: "u1", plan: "pro" })
    ).rejects.toThrow("STRIPE_SECRET_KEY")
  })

  it("throws for an unknown plan", async () => {
    vi.mocked(getPlan).mockResolvedValueOnce(null as any)
    await expect(
      stripeBillingProvider.createCheckout({ userId: "u1", plan: "ghost" })
    ).rejects.toThrow("Unknown plan")
  })

  it("creates a Stripe Checkout session priced in IDR (zero-decimal — no cents conversion)", async () => {
    vi.mocked(getPlan).mockResolvedValueOnce({ priceIdr: 149000 } as any)
    sessionsCreate.mockResolvedValueOnce({
      id: "cs_test_1",
      url: "https://checkout.stripe.com/cs_test_1",
    })

    const result = await stripeBillingProvider.createCheckout({
      userId: "user-12345678",
      email: "a@b.com",
      fullName: "A B",
      plan: "pro",
    })

    expect(result.provider).toBe("stripe")
    expect(result.amountIdr).toBe(149000)
    expect(result.checkoutUrl).toBe("https://checkout.stripe.com/cs_test_1")
    expect(result.checkoutToken).toBe("cs_test_1")
    expect(result.providerOrderId).toMatch(/^brm-user-123/)

    const [args] = sessionsCreate.mock.calls[0]
    expect(args.mode).toBe("payment")
    expect(args.client_reference_id).toBe(result.providerOrderId)
    expect(args.line_items[0].price_data.currency).toBe("idr")
    expect(args.line_items[0].price_data.unit_amount).toBe(149000)
    expect(args.success_url).toContain("/app/billing")
    expect(args.metadata.plan).toBe("pro")
  })

  it("throws when Stripe returns a session without a URL", async () => {
    vi.mocked(getPlan).mockResolvedValueOnce({ priceIdr: 149000 } as any)
    sessionsCreate.mockResolvedValueOnce({ id: "cs_test_1", url: null })
    await expect(
      stripeBillingProvider.createCheckout({ userId: "u1", plan: "pro" })
    ).rejects.toThrow("missing URL")
  })
})

describe("stripeBillingProvider.parseWebhook", () => {
  it("rejects when webhook secret isn't configured", () => {
    delete process.env.STRIPE_WEBHOOK_SECRET
    const parsed = stripeBillingProvider.parseWebhook({
      payload: {},
      headers: new Headers(),
    })
    expect(parsed.isValid).toBe(false)
  })

  it("rejects when the stripe-signature header or raw body is missing", () => {
    const parsed = stripeBillingProvider.parseWebhook({
      payload: {},
      headers: new Headers(),
    })
    expect(parsed.isValid).toBe(false)
    expect(parsed.errorMessage).toMatch(/signature|raw body/i)
  })

  it("rejects an invalid signature", () => {
    constructEvent.mockImplementationOnce(() => {
      throw new Error("bad sig")
    })
    const parsed = stripeBillingProvider.parseWebhook({
      payload: {},
      headers: new Headers({ "stripe-signature": "t=1,v1=bad" }),
      rawBody: "{}",
    })
    expect(parsed.isValid).toBe(false)
    expect(parsed.errorMessage).toContain("Invalid Stripe signature")
  })

  it("maps checkout.session.completed (paid) to outcome 'paid'", () => {
    constructEvent.mockReturnValueOnce({
      id: "evt_1",
      type: "checkout.session.completed",
      data: {
        object: {
          client_reference_id: "brm-order-1",
          payment_status: "paid",
          amount_total: 149000,
          payment_intent: "pi_1",
        },
      },
    })
    const parsed = stripeBillingProvider.parseWebhook({
      payload: {},
      headers: new Headers({ "stripe-signature": "t=1,v1=ok" }),
      rawBody: "{}",
    })
    expect(parsed.isValid).toBe(true)
    expect(parsed.event).toEqual({
      provider: "stripe",
      providerOrderId: "brm-order-1",
      providerTransactionId: "pi_1",
      amountIdr: 149000,
      transactionStatusRaw: "checkout.session.completed",
      outcome: "paid",
    })
  })

  it("maps checkout.session.expired to outcome 'expired'", () => {
    constructEvent.mockReturnValueOnce({
      id: "evt_2",
      type: "checkout.session.expired",
      data: { object: { client_reference_id: "brm-order-2" } },
    })
    const parsed = stripeBillingProvider.parseWebhook({
      payload: {},
      headers: new Headers({ "stripe-signature": "t=1,v1=ok" }),
      rawBody: "{}",
    })
    expect(parsed.event?.outcome).toBe("expired")
    expect(parsed.event?.providerOrderId).toBe("brm-order-2")
  })

  it("maps checkout.session.async_payment_succeeded (paid) to outcome 'paid' — async methods like bank transfer", () => {
    constructEvent.mockReturnValueOnce({
      id: "evt_4",
      type: "checkout.session.async_payment_succeeded",
      data: {
        object: { client_reference_id: "brm-order-3", payment_status: "paid", amount_total: 149000 },
      },
    })
    const parsed = stripeBillingProvider.parseWebhook({
      payload: {},
      headers: new Headers({ "stripe-signature": "t=1,v1=ok" }),
      rawBody: "{}",
    })
    expect(parsed.event?.outcome).toBe("paid")
    expect(parsed.event?.providerOrderId).toBe("brm-order-3")
  })

  it("ignores checkout.session.completed when payment_status isn't 'paid' yet (async method still pending)", () => {
    constructEvent.mockReturnValueOnce({
      id: "evt_5",
      type: "checkout.session.completed",
      data: { object: { client_reference_id: "brm-order-4", payment_status: "unpaid" } },
    })
    const parsed = stripeBillingProvider.parseWebhook({
      payload: {},
      headers: new Headers({ "stripe-signature": "t=1,v1=ok" }),
      rawBody: "{}",
    })
    expect(parsed.event?.outcome).toBe("ignored")
  })

  it("falls back to the Stripe event id and outcome 'ignored' for an event type Baruma doesn't act on", () => {
    constructEvent.mockReturnValueOnce({
      id: "evt_3",
      type: "customer.created",
      data: { object: {} },
    })
    const parsed = stripeBillingProvider.parseWebhook({
      payload: {},
      headers: new Headers({ "stripe-signature": "t=1,v1=ok" }),
      rawBody: "{}",
    })
    expect(parsed.isValid).toBe(true)
    expect(parsed.event?.outcome).toBe("ignored")
    expect(parsed.event?.providerOrderId).toBe("evt_3")
  })
})
