// @vitest-environment node
/**
 * Unit tests for src/lib/server/billing-lifecycle.ts's expireIfLapsed — the
 * function shared by GET /api/v1/me's lazy-expiry check and the daily
 * maintenance cron. Repos mocked (same pattern as me/route.test.ts).
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/server/repo/subscriptions", () => ({
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

import { expireIfLapsed } from "./billing-lifecycle"
import * as subscriptionsRepo from "@/lib/server/repo/subscriptions"
import * as profilesRepo from "@/lib/server/repo/profiles"
import * as plansRepo from "@/lib/server/repo/plans"
import * as creditsRepo from "@/lib/server/repo/credits"
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
    currentPeriodEnd: "2099-01-01T00:00:00.000Z",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("expireIfLapsed", () => {
  it("returns false when there is no active subscription", async () => {
    vi.mocked(subscriptionsRepo.getActiveSubscription).mockResolvedValueOnce(null)
    const result = await expireIfLapsed("profile-1")
    expect(result).toBe(false)
    expect(subscriptionsRepo.expireSubscription).not.toHaveBeenCalled()
  })

  it("returns false when the active subscription hasn't lapsed yet", async () => {
    vi.mocked(subscriptionsRepo.getActiveSubscription).mockResolvedValueOnce(
      fakeSub({ currentPeriodEnd: "2099-01-01T00:00:00.000Z" })
    )
    const result = await expireIfLapsed("profile-1")
    expect(result).toBe(false)
    expect(subscriptionsRepo.expireSubscription).not.toHaveBeenCalled()
  })

  it("expires + downgrades + grants free credits when lapsed", async () => {
    vi.mocked(subscriptionsRepo.getActiveSubscription).mockResolvedValueOnce(
      fakeSub({ id: "sub-lapsed", currentPeriodEnd: "2020-01-01T00:00:00.000Z" })
    )
    vi.mocked(subscriptionsRepo.expireSubscription).mockResolvedValueOnce(true)
    vi.mocked(plansRepo.getPlan).mockResolvedValueOnce({
      id: "free",
      name: "Free",
      priceIdr: 0,
      period: "month",
      tagline: null,
      featured: false,
      sortOrder: 0,
      active: true,
      features: [],
      limits: [],
      entitlements: { creditsPerPeriod: 10, maxProjects: 1, exportPdf: false, glbUpload: false },
    })

    const result = await expireIfLapsed("profile-1")
    expect(result).toBe(true)
    expect(subscriptionsRepo.expireSubscription).toHaveBeenCalledWith("sub-lapsed")
    expect(profilesRepo.setProfilePlan).toHaveBeenCalledWith("profile-1", "free")
    expect(creditsRepo.grantPeriodCredits).toHaveBeenCalledWith(
      "profile-1",
      10,
      "downgrade"
    )
  })

  it("returns false without downgrading when a concurrent caller already flipped the row", async () => {
    vi.mocked(subscriptionsRepo.getActiveSubscription).mockResolvedValueOnce(
      fakeSub({ id: "sub-race", currentPeriodEnd: "2020-01-01T00:00:00.000Z" })
    )
    vi.mocked(subscriptionsRepo.expireSubscription).mockResolvedValueOnce(false)

    const result = await expireIfLapsed("profile-1")
    expect(result).toBe(false)
    expect(profilesRepo.setProfilePlan).not.toHaveBeenCalled()
    expect(creditsRepo.grantPeriodCredits).not.toHaveBeenCalled()
  })

  it("is idempotent when called twice for an already-lapsed-and-expired subscription", async () => {
    vi.mocked(subscriptionsRepo.getActiveSubscription)
      .mockResolvedValueOnce(fakeSub({ id: "sub-x", currentPeriodEnd: "2020-01-01T00:00:00.000Z" }))
      .mockResolvedValueOnce(null) // second call: already expired, no longer "active"
    vi.mocked(subscriptionsRepo.expireSubscription).mockResolvedValueOnce(true)
    vi.mocked(plansRepo.getPlan).mockResolvedValue({
      id: "free",
      name: "Free",
      priceIdr: 0,
      period: "month",
      tagline: null,
      featured: false,
      sortOrder: 0,
      active: true,
      features: [],
      limits: [],
      entitlements: { creditsPerPeriod: 10, maxProjects: 1, exportPdf: false, glbUpload: false },
    })

    const first = await expireIfLapsed("profile-1")
    expect(first).toBe(true)

    const second = await expireIfLapsed("profile-1")
    expect(second).toBe(false)
    expect(subscriptionsRepo.expireSubscription).toHaveBeenCalledTimes(1)
    expect(creditsRepo.grantPeriodCredits).toHaveBeenCalledTimes(1)
  })
})
