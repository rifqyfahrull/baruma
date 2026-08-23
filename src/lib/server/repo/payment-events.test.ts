// @vitest-environment node
/**
 * Payment-events repo — memory-fallback idempotency guard (no DATABASE_URL).
 * This is the dedup layer the webhook route (Task 5) relies on: a replayed
 * delivery for the same provider order id must return "duplicate", never
 * throw.
 */
import { describe, it, expect, beforeAll } from "vitest"

import {
  listPaymentReconciliation,
  markPaymentEventProcessed,
  recordPaymentEvent,
} from "./payment-events"

beforeAll(() => {
  delete process.env.DATABASE_URL
})

describe("recordPaymentEvent (memory fallback)", () => {
  it("inserts a new event", async () => {
    const result = await recordPaymentEvent({
      id: "brm-evt-1",
      provider: "mayar",
      eventType: "paid",
      signatureOk: true,
      payload: { hello: "world" },
    })
    expect(result).toBe("inserted")
  })

  it("returns duplicate (not a throw) when the same id is recorded again", async () => {
    await recordPaymentEvent({
      id: "brm-evt-2",
      provider: "mayar",
      eventType: "paid",
      signatureOk: true,
      payload: { a: 1 },
    })
    const second = await recordPaymentEvent({
      id: "brm-evt-2",
      provider: "mayar",
      eventType: "paid",
      signatureOk: true,
      payload: { a: 1 },
    })
    expect(second).toBe("duplicate")
  })

  it("keeps returning duplicate on further repeated calls, without crashing", async () => {
    await recordPaymentEvent({
      id: "brm-evt-3",
      provider: "mayar",
      eventType: "failed",
      signatureOk: true,
      payload: {},
    })
    for (let i = 0; i < 3; i++) {
      await expect(
        recordPaymentEvent({
          id: "brm-evt-3",
          provider: "mayar",
          eventType: "failed",
          signatureOk: true,
          payload: {},
        })
      ).resolves.toBe("duplicate")
    }
  })

  it("does not let a duplicate insert clobber the originally recorded payload semantics", async () => {
    await recordPaymentEvent({
      id: "brm-evt-4",
      provider: "mayar",
      eventType: "paid",
      signatureOk: true,
      payload: { original: true },
    })
    const dup = await recordPaymentEvent({
      id: "brm-evt-4",
      provider: "mayar",
      eventType: "paid",
      signatureOk: true,
      payload: { original: false },
    })
    expect(dup).toBe("duplicate")
  })
})

describe("recordPaymentEvent — composite `${providerOrderId}:${outcome}` key (Task 5 CRITICAL fix)", () => {
  // The webhook route no longer passes a raw providerOrderId as `id` — it
  // passes `${providerOrderId}:${outcome}` precisely so that an "ignored"
  // event recorded first for an order can never collide with (and thereby
  // block) a later genuine "paid" event for that SAME order. These tests
  // exercise recordPaymentEvent directly at that granularity.

  it("does not collide when two DIFFERENT outcomes are recorded for the same providerOrderId", async () => {
    const ignored = await recordPaymentEvent({
      id: "brm-order-9:ignored",
      provider: "mayar",
      eventType: "ignored",
      signatureOk: true,
      payload: {},
    })
    expect(ignored).toBe("inserted")

    const paid = await recordPaymentEvent({
      id: "brm-order-9:paid",
      provider: "mayar",
      eventType: "paid",
      signatureOk: true,
      payload: {},
    })
    expect(paid).toBe("inserted")
  })

  it("still reports duplicate when the SAME outcome for the same order is recorded twice", async () => {
    const first = await recordPaymentEvent({
      id: "brm-order-10:paid",
      provider: "mayar",
      eventType: "paid",
      signatureOk: true,
      payload: {},
    })
    expect(first).toBe("inserted")

    const second = await recordPaymentEvent({
      id: "brm-order-10:paid",
      provider: "mayar",
      eventType: "paid",
      signatureOk: true,
      payload: {},
    })
    expect(second).toBe("duplicate")
  })
})

describe("markPaymentEventProcessed (memory fallback)", () => {
  it("does not throw for a known id", async () => {
    await recordPaymentEvent({
      id: "brm-evt-5",
      provider: "mayar",
      eventType: "paid",
      signatureOk: true,
      payload: {},
    })
    await expect(markPaymentEventProcessed("brm-evt-5")).resolves.toBeUndefined()
  })

  it("does not throw for an unknown id (defensive no-op)", async () => {
    await expect(
      markPaymentEventProcessed("brm-evt-ghost")
    ).resolves.toBeUndefined()
  })
})

describe("listPaymentReconciliation (memory fallback)", () => {
  it("returns an empty array — profiles.ts has no memory-fallback join, honest empty state (like listProfiles)", async () => {
    expect(await listPaymentReconciliation()).toEqual([])
  })
})
