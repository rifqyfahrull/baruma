// @vitest-environment node
/**
 * Unit tests for src/lib/server/entitlements.ts — plan entitlement
 * resolution + the glbUpload/exportPdf feature gate.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/server/repo/plans", () => ({
  getPlan: vi.fn(),
}))
vi.mock("@/lib/server/repo/profiles", () => ({
  getProfileById: vi.fn(),
}))

import { getEntitlements, requirePlanFeature, PlanFeatureLockedError } from "./entitlements"
import { getPlan } from "@/lib/server/repo/plans"
import { getProfileById } from "@/lib/server/repo/profiles"
import type { PlanRow } from "@/types"
import type { ProfileRow } from "@/lib/server/repo/profiles"

function fakeProfile(overrides: Partial<ProfileRow> = {}): ProfileRow {
  return {
    id: "user-1",
    email: "a@b.com",
    name: "A",
    plan: "pro",
    role: "user",
    phone: null,
    credits_used: 0,
    credits_total: 100,
    created_at: "2024-01-01",
    updated_at: "2024-01-01",
    ...overrides,
  }
}

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
    entitlements: { creditsPerPeriod: 100, maxProjects: 10, exportPdf: true, glbUpload: true, aiRenderHd: true },
    ...overrides,
  }
}

beforeEach(() => {
  vi.mocked(getPlan).mockReset()
  vi.mocked(getProfileById).mockReset()
})

describe("getEntitlements", () => {
  it("returns the entitlements of the profile's plan", async () => {
    vi.mocked(getProfileById).mockResolvedValueOnce(fakeProfile({ plan: "pro" }))
    vi.mocked(getPlan).mockResolvedValueOnce(fakePlan())
    const ent = await getEntitlements("user-1")
    expect(ent).toEqual({ creditsPerPeriod: 100, maxProjects: 10, exportPdf: true, glbUpload: true, aiRenderHd: true })
    expect(getPlan).toHaveBeenCalledWith("pro")
  })

  it("falls back to the free-tier defaults when the profile is missing", async () => {
    vi.mocked(getProfileById).mockResolvedValueOnce(null)
    const ent = await getEntitlements("ghost")
    expect(ent).toEqual({ creditsPerPeriod: 10, maxProjects: 1, exportPdf: false, glbUpload: false, aiRenderHd: false })
    expect(getPlan).not.toHaveBeenCalled()
  })

  it("falls back to the free-tier defaults when the plan row is missing", async () => {
    vi.mocked(getProfileById).mockResolvedValueOnce(fakeProfile({ plan: "pro" }))
    vi.mocked(getPlan).mockResolvedValueOnce(null)
    const ent = await getEntitlements("user-1")
    expect(ent).toEqual({ creditsPerPeriod: 10, maxProjects: 1, exportPdf: false, glbUpload: false, aiRenderHd: false })
  })
})

describe("requirePlanFeature", () => {
  it("throws PlanFeatureLockedError when the flag is false", async () => {
    vi.mocked(getProfileById).mockResolvedValueOnce(fakeProfile({ plan: "free" }))
    vi.mocked(getPlan).mockResolvedValueOnce(
      fakePlan({ id: "free", entitlements: { creditsPerPeriod: 10, maxProjects: 1, exportPdf: false, glbUpload: false, aiRenderHd: false } })
    )
    await expect(requirePlanFeature("user-1", "glbUpload")).rejects.toBeInstanceOf(
      PlanFeatureLockedError
    )
  })

  it("resolves without throwing when the flag is true", async () => {
    vi.mocked(getProfileById).mockResolvedValueOnce(fakeProfile({ plan: "pro" }))
    vi.mocked(getPlan).mockResolvedValueOnce(fakePlan())
    await expect(requirePlanFeature("user-1", "glbUpload")).resolves.toBeUndefined()
  })

  it("PlanFeatureLockedError carries the feature name and an Indonesian message", async () => {
    vi.mocked(getProfileById).mockResolvedValueOnce(fakeProfile({ plan: "free" }))
    vi.mocked(getPlan).mockResolvedValueOnce(
      fakePlan({ entitlements: { creditsPerPeriod: 10, maxProjects: 1, exportPdf: false, glbUpload: false, aiRenderHd: false } })
    )
    try {
      await requirePlanFeature("user-1", "exportPdf")
      expect.unreachable("should have thrown")
    } catch (e) {
      expect(e).toBeInstanceOf(PlanFeatureLockedError)
      expect((e as PlanFeatureLockedError).feature).toBe("exportPdf")
      expect((e as Error).message).toContain("exportPdf")
    }
  })
})
