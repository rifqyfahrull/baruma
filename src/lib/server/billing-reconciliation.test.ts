// @vitest-environment node
import { describe, expect, it } from "vitest"

import { computePaymentMismatch } from "./billing-reconciliation"

describe("computePaymentMismatch", () => {
  it("flags a processed 'paid' event whose subscription is not active", () => {
    expect(
      computePaymentMismatch({
        kind: "event",
        eventType: "paid",
        processed: true,
        subscriptionStatus: "expired",
      })
    ).toBe(true)
  })

  it("does not flag a processed 'paid' event whose subscription IS active", () => {
    expect(
      computePaymentMismatch({
        kind: "event",
        eventType: "paid",
        processed: true,
        subscriptionStatus: "active",
      })
    ).toBe(false)
  })

  it("does not flag an unprocessed 'paid' event (activation never won the race)", () => {
    expect(
      computePaymentMismatch({
        kind: "event",
        eventType: "paid",
        processed: false,
        subscriptionStatus: "pending",
      })
    ).toBe(false)
  })

  it("does not flag a non-'paid' event", () => {
    expect(
      computePaymentMismatch({
        kind: "event",
        eventType: "failed",
        processed: true,
        subscriptionStatus: "expired",
      })
    ).toBe(false)
  })

  it("does not flag a 'paid' event when there is no matching subscription at all", () => {
    expect(
      computePaymentMismatch({
        kind: "event",
        eventType: "paid",
        processed: true,
        subscriptionStatus: null,
      })
    ).toBe(true) // null !== "active" — an orphaned "processed paid" event is a real mismatch worth surfacing.
  })

  it("always flags a synthetic pending_stale row", () => {
    expect(
      computePaymentMismatch({
        kind: "pending_stale",
        eventType: null,
        processed: false,
        subscriptionStatus: "pending",
      })
    ).toBe(true)
  })
})
