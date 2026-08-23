// @vitest-environment node
/**
 * Route tests for POST /api/v1/auth/register
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest"

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

vi.mock("@/lib/server/email", () => ({
  sendEmail: vi.fn(),
}))

// The welcome email is fired via next/server's `after()`, which needs a real
// Next.js request-scope to run — outside one it throws. Run the background
// job immediately (still async) and keep a handle so tests can await it —
// same pattern as alternatives/generate/route.test.ts.
const { afterJobs } = vi.hoisted(() => ({ afterJobs: [] as Promise<unknown>[] }))
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>()
  return {
    ...actual,
    after: (fn: () => unknown) => {
      afterJobs.push(Promise.resolve().then(fn))
    },
  }
})

import { POST } from "./route"
import * as profilesRepo from "@/lib/server/repo/profiles"
import * as authServer from "@/lib/server/auth-server"
import { sendEmail } from "@/lib/server/email"

beforeEach(() => {
  vi.clearAllMocks()
  afterJobs.length = 0
})

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

    // Welcome email fires in the BACKGROUND (after the response) — await the
    // scheduled job to observe it, same pattern as alternatives/generate.
    await Promise.all(afterJobs)
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "new@example.com",
        subject: expect.stringContaining("Baruma"),
      })
    )
  })

  it("does not block or fail registration when the welcome email send fails", async () => {
    vi.mocked(profilesRepo.getProfileByEmail).mockResolvedValueOnce(null)
    vi.spyOn(authServer, "hashPassword").mockResolvedValueOnce("hashed-pw")
    vi.mocked(profilesRepo.createProfile).mockResolvedValueOnce({
      id: "usr-new456",
      email: "resilient@example.com",
      name: "Resilient User",
      plan: "free",
      role: "user",
      phone: null,
      credits_used: 0,
      credits_total: 10,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    vi.spyOn(authServer, "signToken").mockResolvedValueOnce("new-jwt-token-2")
    vi.mocked(sendEmail).mockResolvedValueOnce(false)

    const req = new Request("http://localhost/api/v1/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "resilient@example.com",
        password: "password123",
        name: "Resilient User",
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    await Promise.all(afterJobs)
  })
})
