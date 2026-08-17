// @vitest-environment node
/**
 * Route tests for POST /api/v1/admin/users/credits.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest"

beforeAll(() => {
  process.env.BARUMA_JWT_SECRET = "test-secret-at-least-32-characters-long"
})

vi.mock("@/lib/server/repo/profiles", () => ({
  getProfileById: vi.fn(),
}))

vi.mock("@/lib/server/repo/credits", () => ({
  adjustCredits: vi.fn(),
}))

import { POST } from "./route"
import { signToken } from "@/lib/server/auth-server"
import * as profilesRepo from "@/lib/server/repo/profiles"
import * as creditsRepo from "@/lib/server/repo/credits"
import type { ProfileRow } from "@/lib/server/repo/profiles"

function fakeProfile(overrides: Partial<ProfileRow> = {}): ProfileRow {
  return {
    id: "user-1",
    email: "someone@baruma.id",
    name: "Someone",
    plan: "free",
    role: "user",
    phone: null,
    credits_used: 0,
    credits_total: 10,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

async function requestAs(
  role: "user" | "admin",
  body: unknown
): Promise<Request> {
  vi.mocked(profilesRepo.getProfileById).mockResolvedValueOnce(
    fakeProfile({ role })
  )
  const token = await signToken("user-1")
  return new Request("http://localhost/api/v1/admin/users/credits", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.ADMIN_EMAILS
})

describe("POST /api/v1/admin/users/credits", () => {
  it("returns 401 without a Bearer token", async () => {
    const res = await POST(
      new Request("http://localhost/api/v1/admin/users/credits", {
        method: "POST",
        body: JSON.stringify({ profileId: "u2", deltaTotal: 10, reason: "x" }),
      })
    )
    expect(res.status).toBe(401)
  })

  it("returns 403 for a non-admin", async () => {
    const req = await requestAs("user", {
      profileId: "u2",
      deltaTotal: 10,
      reason: "Bonus",
    })
    const res = await POST(req)
    expect(res.status).toBe(403)
    expect(creditsRepo.adjustCredits).not.toHaveBeenCalled()
  })

  it("returns 400 when reason is empty", async () => {
    const req = await requestAs("admin", {
      profileId: "u2",
      deltaTotal: 10,
      reason: "",
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    expect(creditsRepo.adjustCredits).not.toHaveBeenCalled()
  })

  it("returns 400 when reason is missing", async () => {
    const req = await requestAs("admin", { profileId: "u2", deltaTotal: 10 })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it("adjusts credits (delta can be negative) for a valid admin request", async () => {
    const req = await requestAs("admin", {
      profileId: "u2",
      deltaTotal: -25,
      reason: "Koreksi kesalahan input",
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(creditsRepo.adjustCredits).toHaveBeenCalledWith(
      "u2",
      -25,
      "admin_adjust",
      "Koreksi kesalahan input"
    )
    expect(await res.json()).toEqual({ success: true })
  })

  it("always tags the ledger reason as admin_adjust and threads the admin's free-text note through as ref (I3)", async () => {
    const req = await requestAs("admin", {
      profileId: "u2",
      deltaTotal: 50,
      reason: "Bonus promo Lebaran",
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(creditsRepo.adjustCredits).toHaveBeenCalledWith(
      "u2",
      50,
      "admin_adjust",
      "Bonus promo Lebaran"
    )
  })
})
