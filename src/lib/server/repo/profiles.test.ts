// @vitest-environment node
/**
 * Unit tests for profiles repo queries.
 */
import { describe, it, expect, vi, beforeAll } from "vitest"

beforeAll(() => {
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test"
})

vi.mock("@/lib/server/db", () => ({
  query: vi.fn(),
  getClient: vi.fn(),
}))

import {
  getProfileById,
  getProfileByEmail,
  getCredentialByEmail,
  createProfile,
  setProfileRole,
  setProfilePlan,
  setProfilePhone,
  listProfiles,
} from "./profiles"
import * as db from "@/lib/server/db"

describe("getProfileById", () => {
  it("returns null when no rows found", async () => {
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)
    const result = await getProfileById("nonexistent")
    expect(result).toBeNull()
  })

  it("returns profile without password_hash", async () => {
    const fakeRow = {
      id: "u1",
      email: "a@b.com",
      name: "A",
      plan: "free",
      credits_used: 0,
      credits_total: 10,
      created_at: "2024-01-01",
      updated_at: "2024-01-01",
    }
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [fakeRow], rowCount: 1 } as never)
    const result = await getProfileById("u1")
    expect(result).not.toBeNull()
    expect(result).not.toHaveProperty("password_hash")
    expect(result?.id).toBe("u1")
  })
})

describe("getProfileByEmail", () => {
  it("returns profile without password_hash", async () => {
    const fakeRow = {
      id: "u2",
      email: "test@example.com",
      name: "Test",
      plan: "pro",
      credits_used: 1,
      credits_total: 10,
      created_at: "2024-01-01",
      updated_at: "2024-01-01",
    }
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [fakeRow], rowCount: 1 } as never)
    const result = await getProfileByEmail("test@example.com")
    expect(result).not.toBeNull()
    expect(result).not.toHaveProperty("password_hash")
  })
})

describe("getCredentialByEmail", () => {
  it("returns id and password_hash for a known email", async () => {
    vi.mocked(db.query).mockResolvedValueOnce({
      rows: [{ id: "u3", password_hash: "$argon2id$v=19$m=65536$somehash" }],
      rowCount: 1,
    } as never)
    const result = await getCredentialByEmail("cred@example.com")
    expect(result).not.toBeNull()
    expect(result?.id).toBe("u3")
    expect(result?.password_hash).toBe("$argon2id$v=19$m=65536$somehash")
  })

  it("returns null when email is not found", async () => {
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)
    const result = await getCredentialByEmail("ghost@example.com")
    expect(result).toBeNull()
  })

  it("selects only id and password_hash columns", async () => {
    vi.mocked(db.query).mockClear()
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)
    await getCredentialByEmail("any@example.com")
    const calls = vi.mocked(db.query).mock.calls
    const [sqlQuery] = calls[calls.length - 1] as [string, unknown[]]
    expect(sqlQuery.toLowerCase()).toContain("select id, password_hash")
    expect(sqlQuery.toLowerCase()).not.toContain("credits_used")
  })
})

describe("createProfile", () => {
  it("returns profile without password_hash in return type", async () => {
    const fakeRow = {
      id: "u4",
      email: "new@example.com",
      name: "New",
      plan: "free",
      credits_used: 0,
      credits_total: 10,
      created_at: "2024-01-01",
      updated_at: "2024-01-01",
    }
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [fakeRow], rowCount: 1 } as never)
    const result = await createProfile({
      id: "u4",
      email: "new@example.com",
      name: "New",
      passwordHash: "$argon2id$hash",
    })
    expect(result).not.toHaveProperty("password_hash")
    expect(result.id).toBe("u4")
  })

  it("inserts with the default role 'user'", async () => {
    vi.mocked(db.query).mockClear()
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [{}], rowCount: 1 } as never)
    await createProfile({
      id: "u5",
      email: "r@example.com",
      name: "R",
      passwordHash: "$argon2id$hash",
    })
    const [sqlQuery] = vi.mocked(db.query).mock.calls[0] as [string]
    expect(sqlQuery).toContain("role, phone")
    expect(sqlQuery).toContain("'user'")
  })
})

describe("role & phone columns", () => {
  it("getProfileById and getProfileByEmail select role and phone", async () => {
    vi.mocked(db.query).mockClear()
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 0 } as never)
    await getProfileById("any")
    await getProfileByEmail("any@example.com")
    for (const call of vi.mocked(db.query).mock.calls) {
      const [sqlQuery] = call as [string]
      expect(sqlQuery.toLowerCase()).toContain("role, phone")
    }
    vi.mocked(db.query).mockReset()
  })

  it("setProfileRole updates the role column", async () => {
    vi.mocked(db.query).mockClear()
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 } as never)
    await setProfileRole("u9", "admin")
    const [sqlQuery, params] = vi.mocked(db.query).mock.calls[0] as [string, unknown[]]
    expect(sqlQuery).toContain("UPDATE profiles SET role")
    expect(params).toEqual(["u9", "admin"])
  })

  it("setProfilePlan updates the plan column", async () => {
    vi.mocked(db.query).mockClear()
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 } as never)
    await setProfilePlan("u9", "pro")
    const [sqlQuery, params] = vi.mocked(db.query).mock.calls[0] as [string, unknown[]]
    expect(sqlQuery).toContain("UPDATE profiles SET plan")
    expect(params).toEqual(["u9", "pro"])
  })

  it("setProfilePhone updates the phone column (nullable)", async () => {
    vi.mocked(db.query).mockClear()
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 } as never)
    await setProfilePhone("u9", "+6281234567890")
    const [sqlQuery, params] = vi.mocked(db.query).mock.calls[0] as [string, unknown[]]
    expect(sqlQuery).toContain("UPDATE profiles SET phone")
    expect(params).toEqual(["u9", "+6281234567890"])
  })
})

describe("listProfiles (Task 8 admin backoffice)", () => {
  it("returns [] when DATABASE_URL is absent, without touching query()", async () => {
    const original = process.env.DATABASE_URL
    delete process.env.DATABASE_URL
    vi.mocked(db.query).mockClear()
    const result = await listProfiles()
    expect(result).toEqual([])
    expect(db.query).not.toHaveBeenCalled()
    process.env.DATABASE_URL = original
  })

  it("returns all profiles ordered by created_at desc (DB mode)", async () => {
    process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test"
    vi.mocked(db.query).mockClear()
    const fakeRows = [
      {
        id: "u1",
        email: "newest@example.com",
        name: "Newest",
        plan: "free",
        role: "user",
        phone: null,
        credits_used: 0,
        credits_total: 10,
        created_at: "2024-01-02",
        updated_at: "2024-01-02",
      },
      {
        id: "u2",
        email: "oldest@example.com",
        name: "Oldest",
        plan: "pro",
        role: "admin",
        phone: null,
        credits_used: 1,
        credits_total: 100,
        created_at: "2024-01-01",
        updated_at: "2024-01-01",
      },
    ]
    vi.mocked(db.query).mockResolvedValueOnce({ rows: fakeRows, rowCount: 2 } as never)
    const result = await listProfiles()
    expect(result).toEqual(fakeRows)
    const [sqlQuery] = vi.mocked(db.query).mock.calls[0] as [string]
    expect(sqlQuery).toContain("ORDER BY created_at DESC")
    expect(sqlQuery.toLowerCase()).toContain("role, phone")
    expect(sqlQuery.toLowerCase()).not.toContain("password_hash")
  })
})
