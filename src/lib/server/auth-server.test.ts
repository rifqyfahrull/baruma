// @vitest-environment node
/**
 * Unit tests for auth-server: argon2 hash/verify, jose JWT sign/verify,
 * requireUser middleware, and timing-safe helpers.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest"

vi.mock("@/lib/server/repo/profiles", () => ({
  getProfileById: vi.fn(),
  getProfileByEmail: vi.fn(),
}))

vi.mock("@/lib/supabase/server", () => ({ getSupabaseUser: vi.fn() }))
vi.mock("@/lib/server/supabase-profile", () => ({ resolveBarumaProfile: vi.fn() }))

import {
  hashPassword,
  verifyPassword,
  verifyPasswordConstantTime,
  signToken,
  verifyToken,
  requireUser,
  requireAdmin,
  isAdminEmail,
  UnauthorizedError,
  ForbiddenError,
} from "./auth-server"
import * as profilesRepo from "@/lib/server/repo/profiles"
import * as supabaseServer from "@/lib/supabase/server"
import * as supabaseProfile from "@/lib/server/supabase-profile"
import type { ProfileRow } from "./repo/profiles"

// Set JWT secret for tests
beforeAll(() => {
  process.env.BARUMA_JWT_SECRET = "test-secret-at-least-32-characters-long"
})

function fakeProfile(overrides: Partial<ProfileRow> = {}): ProfileRow {
  return {
    id: "user-admin-test",
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

/* ---- argon2 ---- */

describe("hashPassword / verifyPassword", () => {
  it("hashes a password and verifies it correctly", async () => {
    const hash = await hashPassword("mysecretpassword")
    expect(hash).toBeTruthy()
    expect(hash).not.toBe("mysecretpassword")
    const valid = await verifyPassword(hash, "mysecretpassword")
    expect(valid).toBe(true)
  })

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("correctpassword")
    const valid = await verifyPassword(hash, "wrongpassword")
    expect(valid).toBe(false)
  })

  it("returns false for malformed hash", async () => {
    const valid = await verifyPassword("not-a-valid-hash", "anypassword")
    expect(valid).toBe(false)
  })
})

/* ---- JWT sign/verify ---- */

describe("signToken / verifyToken", () => {
  it("signs a token and verifies it back", async () => {
    const token = await signToken("user-abc-123")
    expect(typeof token).toBe("string")
    const { userId } = await verifyToken(token)
    expect(userId).toBe("user-abc-123")
  })

  it("rejects a tampered token", async () => {
    const token = await signToken("user-xyz")
    // Tamper the signature portion
    const parts = token.split(".")
    parts[2] = parts[2].split("").reverse().join("")
    const tampered = parts.join(".")
    await expect(verifyToken(tampered)).rejects.toThrow()
  })

  it("rejects a token signed with a different secret", async () => {
    // Sign with a different secret by temporarily swapping env
    const originalSecret = process.env.BARUMA_JWT_SECRET
    process.env.BARUMA_JWT_SECRET = "different-secret-that-is-long-enough"
    const otherToken = await signToken("user-zzz")
    process.env.BARUMA_JWT_SECRET = originalSecret

    await expect(verifyToken(otherToken)).rejects.toThrow()
  })

  it("rejects an expired token", async () => {
    // Use jose directly to create an expired token
    const { SignJWT } = await import("jose")
    const secret = new TextEncoder().encode(process.env.BARUMA_JWT_SECRET!)
    const expiredToken = await new SignJWT({ sub: "user-expired" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600) // issued 1 hour ago
      .setExpirationTime(Math.floor(Date.now() / 1000) - 1800) // expired 30 min ago
      .sign(secret)
    await expect(verifyToken(expiredToken)).rejects.toThrow()
  })
})

/* ---- verifyPasswordConstantTime ---- */

describe("verifyPasswordConstantTime", () => {
  it("always returns false regardless of the candidate password", async () => {
    const result = await verifyPasswordConstantTime("any-password")
    expect(result).toBe(false)
  })

  it("returns false for an empty string", async () => {
    const result = await verifyPasswordConstantTime("")
    expect(result).toBe(false)
  })
})

/* ---- requireUser ---- */

describe("requireUser", () => {
  beforeEach(() => {
    vi.mocked(supabaseServer.getSupabaseUser).mockReset()
    vi.mocked(supabaseProfile.resolveBarumaProfile).mockReset()
  })

  it("returns userId from a valid Bearer token", async () => {
    const token = await signToken("user-req-test")
    const request = new Request("http://localhost/api/v1/me", {
      headers: { authorization: `Bearer ${token}` },
    })
    const { userId } = await requireUser(request)
    expect(userId).toBe("user-req-test")
  })

  it("accepts lowercase bearer scheme", async () => {
    const token = await signToken("user-lower-bearer")
    const request = new Request("http://localhost/api/v1/me", {
      headers: { authorization: `bearer ${token}` },
    })
    const { userId } = await requireUser(request)
    expect(userId).toBe("user-lower-bearer")
  })

  it("accepts mixed-case BEARER scheme", async () => {
    const token = await signToken("user-mixed-bearer")
    const request = new Request("http://localhost/api/v1/me", {
      headers: { authorization: `BEARER ${token}` },
    })
    const { userId } = await requireUser(request)
    expect(userId).toBe("user-mixed-bearer")
  })

  it("throws UnauthorizedError when Authorization header is missing", async () => {
    const request = new Request("http://localhost/api/v1/me")
    await expect(requireUser(request)).rejects.toThrow(UnauthorizedError)
  })

  it("throws UnauthorizedError when token is malformed", async () => {
    const request = new Request("http://localhost/api/v1/me", {
      headers: { authorization: "Bearer not-a-jwt" },
    })
    await expect(requireUser(request)).rejects.toThrow(UnauthorizedError)
  })

  it("throws UnauthorizedError when Authorization is not Bearer", async () => {
    const request = new Request("http://localhost/api/v1/me", {
      headers: { authorization: "Basic dXNlcjpwYXNz" },
    })
    await expect(requireUser(request)).rejects.toThrow(UnauthorizedError)
  })

  it("falls back to the Supabase session cookie when there is no Bearer header", async () => {
    vi.mocked(supabaseServer.getSupabaseUser).mockResolvedValueOnce({
      id: "sb-uid-1",
      email: "user@example.com",
      user_metadata: { full_name: "User Satu" },
    } as never)
    vi.mocked(supabaseProfile.resolveBarumaProfile).mockResolvedValueOnce(fakeProfile({ id: "usr-mapped" }))

    const request = new Request("http://localhost/api/v1/me")
    const { userId } = await requireUser(request)
    expect(userId).toBe("usr-mapped")
    expect(supabaseProfile.resolveBarumaProfile).toHaveBeenCalledWith(
      expect.objectContaining({ id: "sb-uid-1", email: "user@example.com", name: "User Satu" }),
    )
  })

  it("throws UnauthorizedError when neither Bearer nor a Supabase session is present", async () => {
    vi.mocked(supabaseServer.getSupabaseUser).mockResolvedValueOnce(null)
    const request = new Request("http://localhost/api/v1/me")
    await expect(requireUser(request)).rejects.toThrow(UnauthorizedError)
  })

  it("prefers Bearer over the Supabase session (Bearer never touches cookies)", async () => {
    const token = await signToken("usr-bearer-wins")
    vi.mocked(supabaseServer.getSupabaseUser).mockResolvedValue({ id: "x", email: "y@z.com" } as never)
    const request = new Request("http://localhost/api/v1/me", { headers: { authorization: `Bearer ${token}` } })
    const { userId } = await requireUser(request)
    expect(userId).toBe("usr-bearer-wins")
    expect(supabaseServer.getSupabaseUser).not.toHaveBeenCalled()
  })
})

/* ---- requireAdmin ---- */

describe("requireAdmin", () => {
  beforeEach(() => {
    delete process.env.ADMIN_EMAILS
  })

  async function requestWithToken(userId: string): Promise<Request> {
    const token = await signToken(userId)
    return new Request("http://localhost/api/v1/admin/plans", {
      headers: { authorization: `Bearer ${token}` },
    })
  }

  it("passes when the profile role is 'admin'", async () => {
    vi.mocked(profilesRepo.getProfileById).mockResolvedValueOnce(
      fakeProfile({ role: "admin" })
    )
    const request = await requestWithToken("user-admin-test")
    const { userId } = await requireAdmin(request)
    expect(userId).toBe("user-admin-test")
  })

  it("throws ForbiddenError when role is 'user' and the email is NOT in ADMIN_EMAILS", async () => {
    process.env.ADMIN_EMAILS = "other@baruma.id"
    vi.mocked(profilesRepo.getProfileById).mockResolvedValueOnce(
      fakeProfile({ role: "user", email: "someone@baruma.id", supabase_uid: "sso-uid-1" })
    )
    const request = await requestWithToken("user-admin-test")
    await expect(requireAdmin(request)).rejects.toThrow(ForbiddenError)
  })

  it("passes when role is 'user', supabase_uid is set, and the email is in ADMIN_EMAILS (case-insensitive, trimmed)", async () => {
    process.env.ADMIN_EMAILS = " Someone@Baruma.id , other@baruma.id "
    vi.mocked(profilesRepo.getProfileById).mockResolvedValueOnce(
      fakeProfile({ role: "user", email: "someone@baruma.id", supabase_uid: "sso-uid-1" })
    )
    const request = await requestWithToken("user-admin-test")
    const { userId } = await requireAdmin(request)
    expect(userId).toBe("user-admin-test")
  })

  it("throws ForbiddenError when role is 'user', the email is in ADMIN_EMAILS, but supabase_uid is null (self-registered account, not SSO-linked)", async () => {
    process.env.ADMIN_EMAILS = "someone@baruma.id"
    vi.mocked(profilesRepo.getProfileById).mockResolvedValueOnce(
      fakeProfile({ role: "user", email: "someone@baruma.id", supabase_uid: null })
    )
    const request = await requestWithToken("user-admin-test")
    await expect(requireAdmin(request)).rejects.toThrow(ForbiddenError)
  })

  it("passes when role is 'admin' even without supabase_uid and with an email NOT in ADMIN_EMAILS (DB-granted role always wins)", async () => {
    process.env.ADMIN_EMAILS = "other@baruma.id"
    vi.mocked(profilesRepo.getProfileById).mockResolvedValueOnce(
      fakeProfile({ role: "admin", email: "someone@baruma.id", supabase_uid: null })
    )
    const request = await requestWithToken("user-admin-test")
    const { userId } = await requireAdmin(request)
    expect(userId).toBe("user-admin-test")
  })

  it("throws ForbiddenError when no profile is found", async () => {
    vi.mocked(profilesRepo.getProfileById).mockResolvedValueOnce(null)
    const request = await requestWithToken("user-admin-test")
    await expect(requireAdmin(request)).rejects.toThrow(ForbiddenError)
  })

  it("throws UnauthorizedError (not ForbiddenError) when the Bearer token itself is invalid", async () => {
    const request = new Request("http://localhost/api/v1/admin/plans", {
      headers: { authorization: "Bearer not-a-jwt" },
    })
    await expect(requireAdmin(request)).rejects.toThrow(UnauthorizedError)
  })
})

/* ---- isAdminEmail ---- */

describe("isAdminEmail", () => {
  beforeEach(() => {
    delete process.env.ADMIN_EMAILS
    vi.mocked(profilesRepo.getProfileByEmail).mockClear()
  })

  it("returns true for an ADMIN_EMAILS-listed email WITHOUT calling getProfileByEmail (short-circuit)", async () => {
    process.env.ADMIN_EMAILS = "boss@baruma.id, other@x.com"
    await expect(isAdminEmail("boss@baruma.id")).resolves.toBe(true)
    expect(profilesRepo.getProfileByEmail).not.toHaveBeenCalled()
  })

  it("matches the allowlist case-insensitively and trimmed, still without touching the DB", async () => {
    process.env.ADMIN_EMAILS = " Boss@Baruma.id "
    await expect(isAdminEmail("boss@baruma.id")).resolves.toBe(true)
    expect(profilesRepo.getProfileByEmail).not.toHaveBeenCalled()
  })

  it("returns false (not throw) when not allowlisted and getProfileByEmail throws (no DB configured)", async () => {
    vi.mocked(profilesRepo.getProfileByEmail).mockRejectedValueOnce(
      new Error("DATABASE_URL is not set")
    )
    await expect(isAdminEmail("someone@baruma.id")).resolves.toBe(false)
  })

  it("returns true when not allowlisted but the DB profile role is 'admin' (fallback path)", async () => {
    vi.mocked(profilesRepo.getProfileByEmail).mockResolvedValueOnce(
      fakeProfile({ email: "someone@baruma.id", role: "admin" })
    )
    await expect(isAdminEmail("someone@baruma.id")).resolves.toBe(true)
  })

  it("returns false when not allowlisted and the DB profile role is 'user' (fallback path)", async () => {
    vi.mocked(profilesRepo.getProfileByEmail).mockResolvedValueOnce(
      fakeProfile({ email: "someone@baruma.id", role: "user" })
    )
    await expect(isAdminEmail("someone@baruma.id")).resolves.toBe(false)
  })

  it("returns false for a null/undefined email without calling getProfileByEmail", async () => {
    await expect(isAdminEmail(null)).resolves.toBe(false)
    await expect(isAdminEmail(undefined)).resolves.toBe(false)
    expect(profilesRepo.getProfileByEmail).not.toHaveBeenCalled()
  })
})
