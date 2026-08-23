// @vitest-environment node
/**
 * Route tests for POST /api/internal/maintenance — the daily cron target.
 * Repos + email mocked (same pattern as webhook/payment route tests).
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/server/repo/subscriptions", () => ({
  listExpiredActiveSubscriptions: vi.fn(),
  listSubscriptionsNeedingReminder: vi.fn(),
  markReminderSent: vi.fn(),
  getActiveSubscription: vi.fn(),
  expireSubscription: vi.fn(),
}))
vi.mock("@/lib/server/repo/profiles", () => ({
  setProfilePlan: vi.fn(),
}))
vi.mock("@/lib/server/repo/plans", () => ({
  getPlan: vi.fn(),
}))
vi.mock("@/lib/server/repo/credits", () => ({
  grantPeriodCredits: vi.fn(),
}))
vi.mock("@/lib/server/email", () => ({
  sendEmail: vi.fn(),
}))
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }))

import { POST } from "./route"
import {
  listExpiredActiveSubscriptions,
  listSubscriptionsNeedingReminder,
  markReminderSent,
  getActiveSubscription,
  expireSubscription,
} from "@/lib/server/repo/subscriptions"
import { setProfilePlan } from "@/lib/server/repo/profiles"
import { getPlan } from "@/lib/server/repo/plans"
import { grantPeriodCredits } from "@/lib/server/repo/credits"
import { sendEmail } from "@/lib/server/email"
import type { SubRow } from "@/lib/server/repo/subscriptions"

function fakeSub(overrides: Partial<SubRow> = {}): SubRow {
  const now = new Date().toISOString()
  return {
    id: "sub-1",
    profileId: "profile-1",
    planId: "pro",
    status: "active",
    provider: "parent",
    providerRef: "brm-order-1",
    currentPeriodEnd: "2020-01-01T00:00:00.000Z",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

const freePlan = {
  id: "free",
  name: "Free",
  priceIdr: 0,
  period: "month" as const,
  tagline: null,
  featured: false,
  sortOrder: 0,
  active: true,
  features: [],
  limits: [],
  entitlements: { creditsPerPeriod: 10, maxProjects: 1, exportPdf: false, glbUpload: false },
}

function request(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/internal/maintenance", {
    method: "POST",
    headers,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.MAINTENANCE_SECRET = "test-maintenance-secret"
  vi.mocked(listExpiredActiveSubscriptions).mockResolvedValue([])
  vi.mocked(listSubscriptionsNeedingReminder).mockResolvedValue([])
})

describe("POST /api/internal/maintenance — auth", () => {
  it("401s with no secret header", async () => {
    const res = await POST(request())
    expect(res.status).toBe(401)
  })

  it("401s with a wrong secret", async () => {
    const res = await POST(request({ "x-maintenance-secret": "wrong" }))
    expect(res.status).toBe(401)
  })

  it("401s (fail-closed) when MAINTENANCE_SECRET itself is unset", async () => {
    delete process.env.MAINTENANCE_SECRET
    const res = await POST(request({ "x-maintenance-secret": "anything" }))
    expect(res.status).toBe(401)
  })

  it("200s with the correct secret", async () => {
    const res = await POST(
      request({ "x-maintenance-secret": "test-maintenance-secret" })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true, expiredCount: 0, reminderCount: 0 })
  })

  it("accepts the secret via a Bearer authorization header too", async () => {
    const res = await POST(
      request({ authorization: "Bearer test-maintenance-secret" })
    )
    expect(res.status).toBe(200)
  })
})

describe("POST /api/internal/maintenance — expiry sweep", () => {
  it("expires + downgrades each candidate and sends expiredEmail", async () => {
    vi.mocked(listExpiredActiveSubscriptions).mockResolvedValueOnce([
      { ...fakeSub(), email: "lapsed@example.com", planName: "Pro" },
    ])
    vi.mocked(getActiveSubscription).mockResolvedValueOnce(fakeSub())
    vi.mocked(expireSubscription).mockResolvedValueOnce(true)
    vi.mocked(getPlan).mockResolvedValueOnce(freePlan)
    vi.mocked(sendEmail).mockResolvedValueOnce(true)

    const res = await POST(
      request({ "x-maintenance-secret": "test-maintenance-secret" })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.expiredCount).toBe(1)
    expect(setProfilePlan).toHaveBeenCalledWith("profile-1", "free")
    expect(grantPeriodCredits).toHaveBeenCalledWith("profile-1", 10, "downgrade")
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "lapsed@example.com" })
    )
  })

  it("is idempotent — a candidate already expired by a concurrent caller isn't double-counted or double-emailed", async () => {
    vi.mocked(listExpiredActiveSubscriptions).mockResolvedValueOnce([
      { ...fakeSub(), email: "lapsed@example.com", planName: "Pro" },
    ])
    // expireIfLapsed's internal getActiveSubscription finds it already gone.
    vi.mocked(getActiveSubscription).mockResolvedValueOnce(null)

    const res = await POST(
      request({ "x-maintenance-secret": "test-maintenance-secret" })
    )
    const body = await res.json()
    expect(body.expiredCount).toBe(0)
    expect(sendEmail).not.toHaveBeenCalled()
    expect(expireSubscription).not.toHaveBeenCalled()
  })
})

describe("POST /api/internal/maintenance — renewal reminders", () => {
  it("stamps reminder_sent_at and sends renewalReminderEmail exactly once per candidate", async () => {
    vi.mocked(listSubscriptionsNeedingReminder).mockResolvedValueOnce([
      {
        ...fakeSub({
          currentPeriodEnd: new Date(Date.now() + 3 * 86_400_000).toISOString(),
        }),
        email: "soon@example.com",
        planName: "Studio",
      },
    ])
    vi.mocked(markReminderSent).mockResolvedValueOnce(true)
    vi.mocked(sendEmail).mockResolvedValueOnce(true)

    const res = await POST(
      request({ "x-maintenance-secret": "test-maintenance-secret" })
    )
    const body = await res.json()
    expect(body.reminderCount).toBe(1)
    expect(markReminderSent).toHaveBeenCalledWith("sub-1")
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "soon@example.com" })
    )
  })

  it("does not send a second reminder when markReminderSent reports it was already stamped", async () => {
    vi.mocked(listSubscriptionsNeedingReminder).mockResolvedValueOnce([
      { ...fakeSub(), email: "soon@example.com", planName: "Studio" },
    ])
    vi.mocked(markReminderSent).mockResolvedValueOnce(false)

    const res = await POST(
      request({ "x-maintenance-secret": "test-maintenance-secret" })
    )
    const body = await res.json()
    expect(body.reminderCount).toBe(0)
    expect(sendEmail).not.toHaveBeenCalled()
  })
})
