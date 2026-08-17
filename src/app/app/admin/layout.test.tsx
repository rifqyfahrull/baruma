// @vitest-environment node
/**
 * AdminLayout is an async server component with no client rendering — we
 * call it directly (mirrors how route handlers are tested in this
 * codebase) and assert the redirect for a non-admin/absent session vs.
 * pass-through for an admin session. There's no existing precedent in this
 * codebase for testing a server-component layout with a heavier harness, so
 * this stays consistent with the route-handler-test style used everywhere
 * else (see e.g. src/app/api/v1/projects/[id]/route.test.ts).
 *
 * This exercises the REAL `isAdminEmail()` DB-fresh check (auth-server.ts)
 * via a mocked `getProfileByEmail`, rather than a fabricated session role.
 * The Supabase session carries no role claim at all, so authorization can
 * only come from the DB — this test proves that gate.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseUser: vi.fn(),
  // Configured (prod-like) by default so the gate logic runs; the unconfigured
  // mock/e2e pass-through path is exercised separately below.
  supabaseConfigured: vi.fn(() => true),
}))
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT")
  }),
}))
vi.mock("@/lib/server/repo/profiles", () => ({
  getProfileByEmail: vi.fn(),
}))

import AdminLayout from "./layout"
import { getSupabaseUser, supabaseConfigured } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { getProfileByEmail } from "@/lib/server/repo/profiles"
import type { ProfileRow } from "@/lib/server/repo/profiles"

type SupaUser = { id: string; email?: string }
function fakeUser(email?: string): SupaUser {
  return { id: "uuid-1", ...(email ? { email } : {}) }
}

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

beforeEach(() => {
  delete process.env.ADMIN_EMAILS
})

afterEach(() => {
  vi.clearAllMocks()
})

describe("AdminLayout", () => {
  it("passes through (mock/e2e) when Supabase is unconfigured", async () => {
    vi.mocked(supabaseConfigured).mockReturnValueOnce(false)
    const result = await AdminLayout({ children: <div>Admin content</div> })
    expect(result).toBeTruthy()
    expect(redirect).not.toHaveBeenCalled()
    expect(getSupabaseUser).not.toHaveBeenCalled()
  })

  it("redirects to /app/dashboard when there is no session", async () => {
    vi.mocked(getSupabaseUser).mockResolvedValueOnce(null)
    await expect(
      AdminLayout({ children: <div>Admin</div> })
    ).rejects.toThrow("NEXT_REDIRECT")
    expect(redirect).toHaveBeenCalledWith("/app/dashboard")
    expect(getProfileByEmail).not.toHaveBeenCalled()
  })

  it("redirects when the Supabase user has no email", async () => {
    vi.mocked(getSupabaseUser).mockResolvedValueOnce(fakeUser() as never)
    await expect(
      AdminLayout({ children: <div>Admin</div> })
    ).rejects.toThrow("NEXT_REDIRECT")
    expect(redirect).toHaveBeenCalledWith("/app/dashboard")
    expect(getProfileByEmail).not.toHaveBeenCalled()
  })

  it("redirects when neither the profile role nor the email is admin", async () => {
    vi.mocked(getSupabaseUser).mockResolvedValueOnce(
      fakeUser("user@baruma.id") as never
    )
    vi.mocked(getProfileByEmail).mockResolvedValueOnce(
      fakeProfile({ email: "user@baruma.id", role: "user" })
    )
    await expect(
      AdminLayout({ children: <div>Admin</div> })
    ).rejects.toThrow("NEXT_REDIRECT")
    expect(redirect).toHaveBeenCalledWith("/app/dashboard")
  })

  it("renders children through when profile.role === 'admin'", async () => {
    // The Supabase user carries no role — the DB-fresh profile lookup is the
    // only thing that gates access; this proves the gate depends on the DB.
    vi.mocked(getSupabaseUser).mockResolvedValueOnce(
      fakeUser("admin@baruma.id") as never
    )
    vi.mocked(getProfileByEmail).mockResolvedValueOnce(
      fakeProfile({ email: "admin@baruma.id", role: "admin" })
    )
    const result = await AdminLayout({ children: <div>Admin content</div> })
    expect(result).toBeTruthy()
    expect(redirect).not.toHaveBeenCalled()
  })

  it("renders children through for an ADMIN_EMAILS-listed bootstrap admin even when profile.role is 'user'", async () => {
    process.env.ADMIN_EMAILS = "boss@baruma.id, other@x.com"
    vi.mocked(getSupabaseUser).mockResolvedValueOnce(
      fakeUser("boss@baruma.id") as never
    )
    vi.mocked(getProfileByEmail).mockResolvedValueOnce(
      fakeProfile({ email: "boss@baruma.id", role: "user" })
    )
    const result = await AdminLayout({ children: <div>Admin content</div> })
    expect(result).toBeTruthy()
    expect(redirect).not.toHaveBeenCalled()
  })
})
