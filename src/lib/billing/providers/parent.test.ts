// @vitest-environment node
/**
 * Unit tests for the parent-billing provider — Baruma's only provider. It
 * delegates payment to the tampil.dev parent (Baruma → tampil.dev → Mayar):
 * `createCheckout` POSTs to the parent's child-billing endpoint with a shared
 * secret, and `parseWebhook` verifies the parent's relay signature.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  getParentBillingConfig,
  isParentBillingConfigured,
  parentBillingProvider,
} from "./parent"
import type { CreateCheckoutInput } from "./types"

const ENV_KEYS = [
  "PARENT_BILLING_URL",
  "PARENT_BILLING_SECRET",
  "PARENT_BILLING_APP",
] as const
const ORIGINAL = Object.fromEntries(
  ENV_KEYS.map((k) => [k, process.env[k]])
) as Record<(typeof ENV_KEYS)[number], string | undefined>

function baseInput(overrides: Partial<CreateCheckoutInput> = {}): CreateCheckoutInput {
  return {
    userId: "profile-abcdef12-3456",
    email: "u@example.com",
    fullName: "U Ser",
    plan: "pro",
    mobile: "081200000000",
    amountIdr: 149000,
    planName: "Pro",
    period: "month",
    redirectUrl: "https://app.test/app/billing",
    webhookUrl: "https://app.test/api/webhooks/payment",
    ...overrides,
  }
}

beforeEach(() => {
  process.env.PARENT_BILLING_URL = "https://tampil.dev"
  process.env.PARENT_BILLING_SECRET = "s3cr3t-shared"
  process.env.PARENT_BILLING_APP = "baruma"
})

afterEach(() => {
  vi.restoreAllMocks()
  for (const k of ENV_KEYS) {
    if (ORIGINAL[k] === undefined) delete process.env[k]
    else process.env[k] = ORIGINAL[k]
  }
})

describe("config", () => {
  it("isParentBillingConfigured reflects env presence", () => {
    expect(isParentBillingConfigured()).toBe(true)
    delete process.env.PARENT_BILLING_SECRET
    expect(isParentBillingConfigured()).toBe(false)
    expect(getParentBillingConfig()).toBeNull()
  })

  it("defaults the app id to 'baruma'", () => {
    delete process.env.PARENT_BILLING_APP
    expect(getParentBillingConfig()?.app).toBe("baruma")
  })
})

describe("createCheckout", () => {
  it("POSTs to the parent child-billing endpoint with the shared secret + child app headers", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({ data: { checkoutUrl: "https://myr.id/pay/xyz" } }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )

    const result = await parentBillingProvider.createCheckout(baseInput())

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://tampil.dev/api/billing/child/checkout")
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers["x-child-app"]).toBe("baruma")
    expect(headers["x-child-key"]).toBe("s3cr3t-shared")

    const sent = JSON.parse((init as RequestInit).body as string)
    expect(sent).toMatchObject({
      app: "baruma",
      userId: "profile-abcdef12-3456",
      plan: "pro",
      planName: "Pro",
      amountIdr: 149000,
      period: "month",
      redirectUrl: "https://app.test/app/billing",
      webhookUrl: "https://app.test/api/webhooks/payment",
    })
    // Baruma owns the order-id namespace (brm- prefix from the first 8 chars
    // of the user id) so the relay maps back to the pending subscription.
    expect(sent.orderId).toMatch(/^brm-profile--\d+$/)

    expect(result.provider).toBe("parent")
    expect(result.checkoutUrl).toBe("https://myr.id/pay/xyz")
    expect(result.amountIdr).toBe(149000)
    // providerOrderId echoes the Baruma-generated order id.
    expect(result.providerOrderId).toBe(sent.orderId)
  })

  it("accepts a flat (non-nested) checkoutUrl in the response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ checkoutUrl: "https://myr.id/pay/flat" }), {
        status: 200,
      })
    )
    const result = await parentBillingProvider.createCheckout(baseInput())
    expect(result.checkoutUrl).toBe("https://myr.id/pay/flat")
  })

  it("throws when not configured", async () => {
    delete process.env.PARENT_BILLING_URL
    await expect(
      parentBillingProvider.createCheckout(baseInput())
    ).rejects.toThrow(/not configured/i)
  })

  it("throws with the parent status + error body on a non-OK response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "invalid_app" }), { status: 403 })
    )
    await expect(
      parentBillingProvider.createCheckout(baseInput())
    ).rejects.toThrow(/Parent billing checkout failed \(403\): invalid_app/)
  })

  it("throws when the parent response has no checkoutUrl", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: {} }), { status: 200 })
    )
    await expect(
      parentBillingProvider.createCheckout(baseInput())
    ).rejects.toThrow(/missing checkoutUrl/i)
  })
})

describe("parseWebhook", () => {
  function headers(secret?: string): Headers {
    const h = new Headers()
    if (secret !== undefined) h.set("x-parent-signature", secret)
    return h
  }

  it("rejects when not configured", () => {
    delete process.env.PARENT_BILLING_SECRET
    const res = parentBillingProvider.parseWebhook({
      payload: { orderId: "brm-1", outcome: "paid" },
      headers: headers("whatever"),
    })
    expect(res.isValid).toBe(false)
  })

  it("rejects a missing or wrong signature", () => {
    expect(
      parentBillingProvider.parseWebhook({
        payload: { orderId: "brm-1", outcome: "paid" },
        headers: headers(),
      }).isValid
    ).toBe(false)
    expect(
      parentBillingProvider.parseWebhook({
        payload: { orderId: "brm-1", outcome: "paid" },
        headers: headers("wrong-secret"),
      }).isValid
    ).toBe(false)
  })

  it("accepts a valid signature and normalizes a paid relay", () => {
    const res = parentBillingProvider.parseWebhook({
      payload: {
        app: "baruma",
        orderId: "brm-order-1",
        outcome: "paid",
        amountIdr: 149000,
        providerTransactionId: "mayar-tx-9",
        transactionStatusRaw: "SETTLEMENT",
      },
      headers: headers("s3cr3t-shared"),
    })
    expect(res.isValid).toBe(true)
    expect(res.event).toMatchObject({
      provider: "parent",
      providerOrderId: "brm-order-1",
      providerTransactionId: "mayar-tx-9",
      amountIdr: 149000,
      outcome: "paid",
    })
  })

  it("accepts the shared secret via the Authorization: Bearer header too", () => {
    const h = new Headers()
    h.set("authorization", "Bearer s3cr3t-shared")
    const res = parentBillingProvider.parseWebhook({
      payload: { orderId: "brm-2", outcome: "failed" },
      headers: h,
    })
    expect(res.isValid).toBe(true)
    expect(res.event?.outcome).toBe("failed")
  })

  it("reads a nested {event:{…}} relay body", () => {
    const res = parentBillingProvider.parseWebhook({
      payload: { event: { orderId: "brm-3", outcome: "expired" } },
      headers: headers("s3cr3t-shared"),
    })
    expect(res.isValid).toBe(true)
    expect(res.event?.providerOrderId).toBe("brm-3")
    expect(res.event?.outcome).toBe("expired")
  })

  it("coerces an unknown outcome to 'ignored'", () => {
    const res = parentBillingProvider.parseWebhook({
      payload: { orderId: "brm-4", outcome: "banana" },
      headers: headers("s3cr3t-shared"),
    })
    expect(res.event?.outcome).toBe("ignored")
  })

  it("rejects a relay with no orderId", () => {
    const res = parentBillingProvider.parseWebhook({
      payload: { outcome: "paid" },
      headers: headers("s3cr3t-shared"),
    })
    expect(res.isValid).toBe(false)
  })
})
