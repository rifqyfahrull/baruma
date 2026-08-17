// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/server/repo/profiles", () => ({
  getProfileBySupabaseUid: vi.fn(),
  getProfileByEmail: vi.fn(),
  linkSupabaseUid: vi.fn(),
  createSupabaseProfile: vi.fn(),
}))

import * as repo from "@/lib/server/repo/profiles"
import { displayName, resolveBarumaProfile } from "./supabase-profile"

const P = (over: Partial<repo.ProfileRow> = {}): repo.ProfileRow => ({
  id: "usr-x", email: "a@b.com", name: "A", plan: "free", role: "user", phone: null,
  credits_used: 0, credits_total: 10, created_at: "", updated_at: "", ...over,
})

beforeEach(() => vi.clearAllMocks())

describe("displayName", () => {
  it("prefers the Supabase name, else derives from the email local-part", () => {
    expect(displayName({ id: "u", email: "x@y.com", name: "Budi Santoso" })).toBe("Budi Santoso")
    expect(displayName({ id: "u", email: "rafi@y.com" })).toBe("Rafi")
    expect(displayName({ id: "u", email: "rafi@y.com", name: "   " })).toBe("Rafi")
  })
})

describe("resolveBarumaProfile", () => {
  it("1) returns the already-linked profile by supabase_uid (no link/create)", async () => {
    vi.mocked(repo.getProfileBySupabaseUid).mockResolvedValue(P({ id: "usr-linked" }))
    const out = await resolveBarumaProfile({ id: "uid-1", email: "a@b.com" })
    expect(out.id).toBe("usr-linked")
    expect(repo.getProfileByEmail).not.toHaveBeenCalled()
    expect(repo.createSupabaseProfile).not.toHaveBeenCalled()
  })

  it("2) links a pre-SSO profile found by email (preserves existing data)", async () => {
    vi.mocked(repo.getProfileBySupabaseUid).mockResolvedValue(null)
    vi.mocked(repo.getProfileByEmail).mockResolvedValue(P({ id: "usr-existing", email: "a@b.com" }))
    const out = await resolveBarumaProfile({ id: "uid-2", email: "a@b.com" })
    expect(out.id).toBe("usr-existing")
    expect(repo.linkSupabaseUid).toHaveBeenCalledWith("usr-existing", "uid-2")
    expect(repo.createSupabaseProfile).not.toHaveBeenCalled()
  })

  it("3) creates a fresh profile when neither uid nor email matches", async () => {
    vi.mocked(repo.getProfileBySupabaseUid).mockResolvedValue(null)
    vi.mocked(repo.getProfileByEmail).mockResolvedValue(null)
    vi.mocked(repo.createSupabaseProfile).mockResolvedValue(P({ id: "usr-new" }))
    const out = await resolveBarumaProfile({ id: "uid-3", email: "new@b.com", name: "New User" })
    expect(out.id).toBe("usr-new")
    expect(repo.createSupabaseProfile).toHaveBeenCalledWith(
      expect.objectContaining({ email: "new@b.com", name: "New User", supabaseUid: "uid-3" }),
    )
  })
})
