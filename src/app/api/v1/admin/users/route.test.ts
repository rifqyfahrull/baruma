// @vitest-environment node
/**
 * Route tests for /api/v1/admin/users (GET list, PATCH role/plan).
 * Credit adjustment lives in ./credits/route.test.ts.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest"

beforeAll(() => {
  process.env.BARUMA_JWT_SECRET = "test-secret-at-least-32-characters-long"
})

vi.mock("@/lib/server/repo/profiles", () => ({
  getProfileById: vi.fn(),
  listProfiles: vi.fn(),
  setProfileRole: vi.fn(),
  setProfilePlan: vi.fn(),
  countAdmins: vi.fn(),
}))

import { GET, PATCH } from "./route"
import { signToken } from "@/lib/server/auth-server"
import * as profilesRepo from "@/lib/server/repo/profiles"
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

/**
 * In-memory profile registry backing the `getProfileById` mock. `requireAdmin`
 * looks up the acting caller (id "user-1") and, since I1/M2, the PATCH
 * handler also looks up the target `profileId` — a single queued
 * `mockResolvedValueOnce` per test can't tell those two calls apart once both
 * happen in the same request, so instead `getProfileById` resolves by
 * looking the id up here.
 */
let profileRegistry: Record<string, ProfileRow>

function registerProfile(profile: ProfileRow): void {
  profileRegistry[profile.id] = profile
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.ADMIN_EMAILS
  profileRegistry = {}
  vi.mocked(profilesRepo.getProfileById).mockImplementation(
    async (id: string) => profileRegistry[id] ?? null
  )
})

/** Registers the acting caller ("user-1") with the given role and returns a signed request. */
async function requestAs(
  role: "user" | "admin",
  init?: RequestInit
): Promise<Request> {
  registerProfile(fakeProfile({ id: "user-1", role }))
  const token = await signToken("user-1")
  return new Request("http://localhost/api/v1/admin/users", {
    ...init,
    headers: { ...(init?.headers ?? {}), authorization: `Bearer ${token}` },
  })
}

describe("GET /api/v1/admin/users", () => {
  it("returns 401 without a Bearer token", async () => {
    const res = await GET(new Request("http://localhost/api/v1/admin/users"))
    expect(res.status).toBe(401)
  })

  it("returns 403 for a non-admin", async () => {
    const req = await requestAs("user")
    const res = await GET(req)
    expect(res.status).toBe(403)
    expect(profilesRepo.listProfiles).not.toHaveBeenCalled()
  })

  it("maps profiles to the safe client shape (no password_hash-like fields)", async () => {
    vi.mocked(profilesRepo.listProfiles).mockResolvedValueOnce([
      fakeProfile({
        id: "u2",
        email: "target@example.com",
        name: "Target",
        plan: "pro",
        role: "user",
        credits_used: 5,
        credits_total: 100,
      }),
    ])
    const req = await requestAs("admin")
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual([
      {
        id: "u2",
        name: "Target",
        email: "target@example.com",
        plan: "pro",
        role: "user",
        creditsUsed: 5,
        creditsTotal: 100,
      },
    ])
    expect(body[0]).not.toHaveProperty("password_hash")
    expect(body[0]).not.toHaveProperty("phone")
  })
})

describe("PATCH /api/v1/admin/users", () => {
  it("returns 403 for a non-admin", async () => {
    const req = await requestAs("user", {
      method: "PATCH",
      body: JSON.stringify({ profileId: "u2", role: "admin" }),
    })
    const res = await PATCH(req)
    expect(res.status).toBe(403)
  })

  it("returns 400 when neither role nor plan is provided", async () => {
    const req = await requestAs("admin", {
      method: "PATCH",
      body: JSON.stringify({ profileId: "u2" }),
    })
    const res = await PATCH(req)
    expect(res.status).toBe(400)
    expect(profilesRepo.setProfileRole).not.toHaveBeenCalled()
    expect(profilesRepo.setProfilePlan).not.toHaveBeenCalled()
  })

  it("returns 400 for an invalid plan value", async () => {
    const req = await requestAs("admin", {
      method: "PATCH",
      body: JSON.stringify({ profileId: "u2", plan: "enterprise" }),
    })
    const res = await PATCH(req)
    expect(res.status).toBe(400)
  })

  it("updates only the role when only role is provided", async () => {
    registerProfile(fakeProfile({ id: "u2", role: "user" }))
    const req = await requestAs("admin", {
      method: "PATCH",
      body: JSON.stringify({ profileId: "u2", role: "admin" }),
    })
    const res = await PATCH(req)
    expect(res.status).toBe(200)
    expect(profilesRepo.setProfileRole).toHaveBeenCalledWith("u2", "admin")
    expect(profilesRepo.setProfilePlan).not.toHaveBeenCalled()
    expect(await res.json()).toEqual({ success: true })
  })

  it("updates only the plan when only plan is provided", async () => {
    registerProfile(fakeProfile({ id: "u2", role: "user" }))
    const req = await requestAs("admin", {
      method: "PATCH",
      body: JSON.stringify({ profileId: "u2", plan: "studio" }),
    })
    const res = await PATCH(req)
    expect(res.status).toBe(200)
    expect(profilesRepo.setProfilePlan).toHaveBeenCalledWith("u2", "studio")
    expect(profilesRepo.setProfileRole).not.toHaveBeenCalled()
  })

  it("updates both role and plan when both are provided", async () => {
    registerProfile(fakeProfile({ id: "u2", role: "user" }))
    const req = await requestAs("admin", {
      method: "PATCH",
      body: JSON.stringify({ profileId: "u2", role: "admin", plan: "studio" }),
    })
    const res = await PATCH(req)
    expect(res.status).toBe(200)
    expect(profilesRepo.setProfileRole).toHaveBeenCalledWith("u2", "admin")
    expect(profilesRepo.setProfilePlan).toHaveBeenCalledWith("u2", "studio")
  })

  it("returns 404 when profileId does not match any profile", async () => {
    // "ghost" intentionally never registered.
    const req = await requestAs("admin", {
      method: "PATCH",
      body: JSON.stringify({ profileId: "ghost", role: "admin" }),
    })
    const res = await PATCH(req)
    expect(res.status).toBe(404)
    expect(profilesRepo.setProfileRole).not.toHaveBeenCalled()
  })

  describe("self-demotion guard (I1)", () => {
    it("returns 400 cannot_demote_self when an admin tries to demote themselves", async () => {
      const req = await requestAs("admin", {
        method: "PATCH",
        body: JSON.stringify({ profileId: "user-1", role: "user" }),
      })
      const res = await PATCH(req)
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toBe("cannot_demote_self")
      expect(profilesRepo.setProfileRole).not.toHaveBeenCalled()
      // No DB round-trip needed to reject this — it's a same-id comparison.
      expect(profilesRepo.countAdmins).not.toHaveBeenCalled()
    })

    it("allows an admin to change their own plan (only role==='user' self-changes are blocked)", async () => {
      const req = await requestAs("admin", {
        method: "PATCH",
        body: JSON.stringify({ profileId: "user-1", plan: "studio" }),
      })
      const res = await PATCH(req)
      expect(res.status).toBe(200)
      expect(profilesRepo.setProfilePlan).toHaveBeenCalledWith(
        "user-1",
        "studio"
      )
    })
  })

  describe("last-admin guard (I1)", () => {
    it("returns 400 last_admin when demoting the sole remaining admin", async () => {
      registerProfile(fakeProfile({ id: "u2", role: "admin" }))
      vi.mocked(profilesRepo.countAdmins).mockResolvedValueOnce(1)
      const req = await requestAs("admin", {
        method: "PATCH",
        body: JSON.stringify({ profileId: "u2", role: "user" }),
      })
      const res = await PATCH(req)
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toBe("last_admin")
      expect(profilesRepo.setProfileRole).not.toHaveBeenCalled()
    })

    it("demotes an admin successfully when 2+ admins exist", async () => {
      registerProfile(fakeProfile({ id: "u2", role: "admin" }))
      vi.mocked(profilesRepo.countAdmins).mockResolvedValueOnce(2)
      const req = await requestAs("admin", {
        method: "PATCH",
        body: JSON.stringify({ profileId: "u2", role: "user" }),
      })
      const res = await PATCH(req)
      expect(res.status).toBe(200)
      expect(profilesRepo.setProfileRole).toHaveBeenCalledWith("u2", "user")
    })

    it("does not call countAdmins when demoting a profile that is already a non-admin", async () => {
      registerProfile(fakeProfile({ id: "u2", role: "user" }))
      const req = await requestAs("admin", {
        method: "PATCH",
        body: JSON.stringify({ profileId: "u2", role: "user" }),
      })
      const res = await PATCH(req)
      expect(res.status).toBe(200)
      expect(profilesRepo.countAdmins).not.toHaveBeenCalled()
    })

    it("does not call countAdmins when only the plan changes", async () => {
      registerProfile(fakeProfile({ id: "u2", role: "admin" }))
      const req = await requestAs("admin", {
        method: "PATCH",
        body: JSON.stringify({ profileId: "u2", plan: "free" }),
      })
      const res = await PATCH(req)
      expect(res.status).toBe(200)
      expect(profilesRepo.countAdmins).not.toHaveBeenCalled()
    })
  })
})
