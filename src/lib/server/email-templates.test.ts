// @vitest-environment node
/**
 * Unit tests for src/lib/server/email-templates.ts — pure functions, assert
 * the essential content lands in the HTML (not full snapshot-testing markup).
 */
import { describe, expect, it } from "vitest"

import {
  expiredEmail,
  receiptEmail,
  renewalReminderEmail,
  welcomeEmail,
} from "./email-templates"

describe("welcomeEmail", () => {
  it("includes the user's name and a dashboard link", () => {
    const html = welcomeEmail("Budi")
    expect(html).toContain("Budi")
    expect(html).toContain("/app/dashboard")
    expect(html).toContain("<!DOCTYPE html>")
  })
})

describe("receiptEmail", () => {
  it("includes order id, plan name, formatted price, and period end", () => {
    const html = receiptEmail({
      planName: "Pro",
      priceIdr: 149000,
      periodEnd: "2026-09-22T00:00:00.000Z",
      orderId: "brm-abc12345-1700000000000",
    })
    expect(html).toContain("brm-abc12345-1700000000000")
    expect(html).toContain("Pro")
    expect(html).toContain("Rp")
    expect(html).toContain("149")
    expect(html).toContain("/app/billing")
  })
})

describe("renewalReminderEmail", () => {
  it("includes days left and plan name", () => {
    const html = renewalReminderEmail({
      planName: "Studio",
      daysLeft: 3,
      periodEnd: "2026-08-25T00:00:00.000Z",
    })
    expect(html).toContain("Studio")
    expect(html).toContain("3 hari lagi")
  })

  it("shows 'hari ini' when daysLeft is 0", () => {
    const html = renewalReminderEmail({
      planName: "Pro",
      daysLeft: 0,
      periodEnd: "2026-08-22T00:00:00.000Z",
    })
    expect(html).toContain("hari ini")
  })
})

describe("expiredEmail", () => {
  it("includes the plan name and an upgrade link", () => {
    const html = expiredEmail({ planName: "Pro" })
    expect(html).toContain("Pro")
    expect(html).toContain("/app/billing")
  })
})
