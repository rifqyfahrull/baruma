// @vitest-environment node
/**
 * Subscriptions repo — memory-fallback lifecycle (no DATABASE_URL):
 * pending → activate (by provider ref) → active lookup → expire.
 */
import { describe, it, expect, beforeAll } from "vitest"

import {
  activateSubscription,
  createPendingSubscription,
  expireOtherActiveSubscriptions,
  expireSubscription,
  getActiveSubscription,
  getSubscriptionByProviderRef,
  listSubscriptionsAdmin,
} from "./subscriptions"

beforeAll(() => {
  delete process.env.DATABASE_URL
})

const PERIOD_END = "2026-08-05T00:00:00.000Z"

describe("subscription lifecycle (memory fallback)", () => {
  it("creates a pending subscription retrievable by provider ref", async () => {
    const { id } = await createPendingSubscription({
      profileId: "u1",
      planId: "pro",
      provider: "mayar",
      providerRef: "inv-1",
    })
    expect(id).toBeTruthy()
    const row = await getSubscriptionByProviderRef("inv-1")
    expect(row?.id).toBe(id)
    expect(row?.status).toBe("pending")
    expect(row?.planId).toBe("pro")
    expect(row?.provider).toBe("mayar")
    expect(row?.currentPeriodEnd).toBeNull()
  })

  it("is not active before the webhook activates it", async () => {
    expect(await getActiveSubscription("u1")).toBeNull()
  })

  it("activateSubscription sets status active + the period end", async () => {
    const row = await activateSubscription({
      providerRef: "inv-1",
      currentPeriodEnd: PERIOD_END,
    })
    expect(row?.status).toBe("active")
    expect(row?.currentPeriodEnd).toBe(PERIOD_END)
  })

  it("returns null when activating an unknown provider ref", async () => {
    expect(
      await activateSubscription({
        providerRef: "inv-ghost",
        currentPeriodEnd: PERIOD_END,
      })
    ).toBeNull()
  })

  it("getActiveSubscription finds the activated row", async () => {
    const row = await getActiveSubscription("u1")
    expect(row?.providerRef).toBe("inv-1")
    expect(row?.status).toBe("active")
  })

  it("returns the LATEST active subscription when several exist", async () => {
    await createPendingSubscription({
      profileId: "u1",
      planId: "studio",
      provider: "mayar",
      providerRef: "inv-2",
    })
    await activateSubscription({
      providerRef: "inv-2",
      currentPeriodEnd: PERIOD_END,
    })
    const row = await getActiveSubscription("u1")
    expect(row?.providerRef).toBe("inv-2")
    expect(row?.planId).toBe("studio")
  })

  it("expireSubscription retires the row", async () => {
    const latest = await getSubscriptionByProviderRef("inv-2")
    await expireSubscription(latest!.id)
    expect((await getSubscriptionByProviderRef("inv-2"))?.status).toBe("expired")
    // inv-1 is still active, so u1 falls back to it.
    expect((await getActiveSubscription("u1"))?.providerRef).toBe("inv-1")
    const first = await getSubscriptionByProviderRef("inv-1")
    await expireSubscription(first!.id)
    expect(await getActiveSubscription("u1")).toBeNull()
  })

  it("listSubscriptionsAdmin joins the plan name (memory join)", async () => {
    const rows = await listSubscriptionsAdmin()
    expect(rows.length).toBeGreaterThanOrEqual(2)
    const pro = rows.find((r) => r.providerRef === "inv-1")
    expect(pro?.planName).toBe("Pro")
    expect(pro?.email).toBeTruthy()
    const studio = rows.find((r) => r.providerRef === "inv-2")
    expect(studio?.planName).toBe("Studio")
  })
})

// ── Task 5 CRITICAL fix: atomic idempotency guards ──────────────────────────
// Separate profiles/provider-refs from the suite above so these don't
// interact with its sequential end-state (both inv-1/inv-2 end up expired).

describe("activateSubscription — atomic idempotency guard", () => {
  it("activates a pending subscription, returning the activated row", async () => {
    await createPendingSubscription({
      profileId: "u2",
      planId: "pro",
      provider: "mayar",
      providerRef: "inv-10",
    })
    const row = await activateSubscription({
      providerRef: "inv-10",
      currentPeriodEnd: PERIOD_END,
    })
    expect(row?.status).toBe("active")
    expect(row?.currentPeriodEnd).toBe(PERIOD_END)
  })

  it("returns null (and does not overwrite currentPeriodEnd) when the subscription is already active", async () => {
    const row = await activateSubscription({
      providerRef: "inv-10",
      currentPeriodEnd: "2099-01-01T00:00:00.000Z",
    })
    expect(row).toBeNull()
    // The already-active row's period end must be untouched by the replay —
    // this is the exact guard that stops a second "paid" delivery (or a
    // delivery that lost the race after an "ignored" one) from clobbering
    // an already-processed subscription.
    const stillThere = await getSubscriptionByProviderRef("inv-10")
    expect(stillThere?.status).toBe("active")
    expect(stillThere?.currentPeriodEnd).toBe(PERIOD_END)
  })

  it("returns null for an already-expired subscription without reviving it", async () => {
    const active = await getSubscriptionByProviderRef("inv-10")
    await expireSubscription(active!.id)
    const row = await activateSubscription({
      providerRef: "inv-10",
      currentPeriodEnd: "2099-01-01T00:00:00.000Z",
    })
    expect(row).toBeNull()
    expect((await getSubscriptionByProviderRef("inv-10"))?.status).toBe(
      "expired"
    )
  })
})

describe("expireOtherActiveSubscriptions", () => {
  it("expires a different active subscription for the same profile but leaves the given one alone", async () => {
    await createPendingSubscription({
      profileId: "u3",
      planId: "pro",
      provider: "mayar",
      providerRef: "inv-11",
    })
    const subA = await activateSubscription({
      providerRef: "inv-11",
      currentPeriodEnd: PERIOD_END,
    })
    await createPendingSubscription({
      profileId: "u3",
      planId: "studio",
      provider: "mayar",
      providerRef: "inv-12",
    })
    const subB = await activateSubscription({
      providerRef: "inv-12",
      currentPeriodEnd: PERIOD_END,
    })
    expect(subA?.status).toBe("active")
    expect(subB?.status).toBe("active")

    await expireOtherActiveSubscriptions("u3", subB!.id)

    expect((await getSubscriptionByProviderRef("inv-11"))?.status).toBe(
      "expired"
    )
    expect((await getSubscriptionByProviderRef("inv-12"))?.status).toBe(
      "active"
    )
    expect((await getActiveSubscription("u3"))?.providerRef).toBe("inv-12")
  })

  it("is a no-op when the profile has no other active subscription", async () => {
    await createPendingSubscription({
      profileId: "u5",
      planId: "pro",
      provider: "mayar",
      providerRef: "inv-14",
    })
    const only = await activateSubscription({
      providerRef: "inv-14",
      currentPeriodEnd: PERIOD_END,
    })
    await expireOtherActiveSubscriptions("u5", only!.id)
    expect((await getSubscriptionByProviderRef("inv-14"))?.status).toBe(
      "active"
    )
  })
})

describe("expireSubscription — atomic idempotency guard", () => {
  it("is a no-op on a pending subscription (reports false, leaves status untouched)", async () => {
    const { id } = await createPendingSubscription({
      profileId: "u4",
      planId: "pro",
      provider: "mayar",
      providerRef: "inv-13",
    })
    const didExpire = await expireSubscription(id)
    expect(didExpire).toBe(false)
    expect((await getSubscriptionByProviderRef("inv-13"))?.status).toBe(
      "pending"
    )
  })

  it("flips an active subscription to expired, reporting true", async () => {
    await activateSubscription({
      providerRef: "inv-13",
      currentPeriodEnd: PERIOD_END,
    })
    const active = await getSubscriptionByProviderRef("inv-13")
    expect(active?.status).toBe("active")
    const didExpire = await expireSubscription(active!.id)
    expect(didExpire).toBe(true)
    expect((await getSubscriptionByProviderRef("inv-13"))?.status).toBe(
      "expired"
    )
  })

  it("is a no-op on an already-expired subscription (reports false)", async () => {
    const already = await getSubscriptionByProviderRef("inv-13")
    expect(already?.status).toBe("expired")
    const didExpire = await expireSubscription(already!.id)
    expect(didExpire).toBe(false)
    expect((await getSubscriptionByProviderRef("inv-13"))?.status).toBe(
      "expired"
    )
  })
})
