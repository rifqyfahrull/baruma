// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

beforeAll(() => {
  process.env.BARUMA_JWT_SECRET = "test-secret-at-least-32-characters-long"
})

vi.mock("@/lib/server/repo/profiles", () => ({
  getProfileById: vi.fn(),
}))

import { POST } from "./route"
import { signToken, verifyToken } from "@/lib/server/auth-server"
import * as profilesRepo from "@/lib/server/repo/profiles"
import type { ProfileRow } from "@/lib/server/repo/profiles"

function fakeProfile(overrides: Partial<ProfileRow> = {}): ProfileRow {
  return {
    id: "admin-1",
    email: "admin@baruma.id",
    name: "Admin",
    plan: "studio",
    role: "admin",
    phone: null,
    credits_used: 0,
    credits_total: 500,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

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

async function requestAs(
  role: "user" | "admin",
  body: unknown
): Promise<Request> {
  registerProfile(fakeProfile({ id: "admin-1", role }))
  const token = await signToken("admin-1")
  return new Request("http://localhost/api/v1/admin/users/phantom-login", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
}

describe("POST /api/v1/admin/users/phantom-login", () => {
  it("returns 401 without auth", async () => {
    const res = await POST(
      new Request("http://localhost/api/v1/admin/users/phantom-login", {
        method: "POST",
        body: JSON.stringify({ profileId: "target-1" }),
      })
    )
    expect(res.status).toBe(401)
  })

  it("returns 403 for a non-admin", async () => {
    const req = await requestAs("user", { profileId: "target-1" })
    const res = await POST(req)
    expect(res.status).toBe(403)
  })

  it("returns 404 when the target profile does not exist", async () => {
    const req = await requestAs("admin", { profileId: "missing" })
    const res = await POST(req)
    expect(res.status).toBe(404)
  })

  it("returns a dashboard URL with a short-lived token for the target user", async () => {
    registerProfile(
      fakeProfile({
        id: "target-1",
        email: "target@baruma.id",
        name: "Target User",
        role: "user",
      })
    )
    const req = await requestAs("admin", { profileId: "target-1" })
    const before = Date.now()
    const res = await POST(req)
    const after = Date.now()

    expect(res.status).toBe(200)
    const body = (await res.json()) as { url: string; expiresAt: string }
    const url = new URL(body.url, "http://localhost")
    expect(url.pathname).toBe("/app/dashboard")
    const hash = new URLSearchParams(url.hash.slice(1))
    expect(hash.get("phantom_profile_id")).toBe("target-1")
    expect(hash.get("phantom_profile_name")).toBe("Target User")
    expect(hash.get("phantom_profile_email")).toBe("target@baruma.id")

    const token = hash.get("phantom_token")
    expect(token).toBeTruthy()
    await expect(verifyToken(token!)).resolves.toEqual({ userId: "target-1" })

    const expiresAt = Date.parse(body.expiresAt)
    expect(expiresAt).toBeGreaterThanOrEqual(before + 14 * 60_000)
    expect(expiresAt).toBeLessThanOrEqual(after + 15 * 60_000 + 1000)
  })
})
