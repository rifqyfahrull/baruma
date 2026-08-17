// @vitest-environment node
/**
 * Route tests for POST /api/v1/auth/register
 */
import { describe, it, expect, vi, beforeAll } from "vitest"

beforeAll(() => {
  process.env.BARUMA_JWT_SECRET = "test-secret-at-least-32-characters-long"
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test"
})

vi.mock("@/lib/server/db", () => ({
  query: vi.fn(),
  getClient: vi.fn(),
}))

vi.mock("@/lib/server/repo/profiles", () => ({
  getProfileByEmail: vi.fn(),
  getProfileById: vi.fn(),
  createProfile: vi.fn(),
}))

import { POST } from "./route"
import * as profilesRepo from "@/lib/server/repo/profiles"
import * as authServer from "@/lib/server/auth-server"

describe("POST /api/v1/auth/register", () => {
  it("returns 400 for invalid body", async () => {
    const req = new Request("http://localhost/api/v1/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "bad", password: "short", name: "" }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it("returns 409 when email already registered", async () => {
    vi.mocked(profilesRepo.getProfileByEmail).mockResolvedValueOnce({
      id: "user-existing",
      email: "existing@example.com",
      name: "Existing",
      plan: "free",
      role: "user",
      phone: null,
      credits_used: 0,
      credits_total: 10,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    const req = new Request("http://localhost/api/v1/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "existing@example.com",
        password: "password123",
        name: "Test",
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(409)
  })

  it("returns 409, same generic message as 'already registered', when the email is in ADMIN_EMAILS", async () => {
    process.env.ADMIN_EMAILS = " Admin@Baruma.id "
    vi.mocked(profilesRepo.getProfileByEmail).mockResolvedValueOnce(null)
    const req = new Request("http://localhost/api/v1/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "admin@baruma.id",
        password: "password123",
        name: "Attacker",
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toBe("Email already registered")
    delete process.env.ADMIN_EMAILS
  })

  it("returns 200 with user and accessToken on success", async () => {
    vi.mocked(profilesRepo.getProfileByEmail).mockResolvedValueOnce(null)
    vi.spyOn(authServer, "hashPassword").mockResolvedValueOnce("hashed-pw")
    vi.mocked(profilesRepo.createProfile).mockResolvedValueOnce({
      id: "usr-new123",
      email: "new@example.com",
      name: "New User",
      plan: "free",
      role: "user",
      phone: null,
      credits_used: 0,
      credits_total: 10,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    vi.spyOn(authServer, "signToken").mockResolvedValueOnce("new-jwt-token")

    const req = new Request("http://localhost/api/v1/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "new@example.com",
        password: "password123",
        name: "New User",
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.accessToken).toBe("new-jwt-token")
    expect(body.user.id).toBe("usr-new123")
    expect(body.user.email).toBe("new@example.com")
  })
})
