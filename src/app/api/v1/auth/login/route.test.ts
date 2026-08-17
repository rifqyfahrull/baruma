// @vitest-environment node
/**
 * Route tests for POST /api/v1/auth/login
 * Mocks the db module and auth-server password/token functions.
 */
import { describe, it, expect, vi, beforeAll } from "vitest"

beforeAll(() => {
  process.env.BARUMA_JWT_SECRET = "test-secret-at-least-32-characters-long"
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test"
})

// Mock the pg db so no real queries are made
vi.mock("@/lib/server/db", () => ({
  query: vi.fn(),
  getClient: vi.fn(),
}))

// Mock repo/profiles
vi.mock("@/lib/server/repo/profiles", () => ({
  getCredentialByEmail: vi.fn(),
  getProfileByEmail: vi.fn(),
  getProfileById: vi.fn(),
  createProfile: vi.fn(),
}))

import { POST } from "./route"
import * as profilesRepo from "@/lib/server/repo/profiles"
import * as authServer from "@/lib/server/auth-server"

describe("POST /api/v1/auth/login", () => {
  it("returns 400 for invalid body", async () => {
    const req = new Request("http://localhost/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "not-an-email", password: "pass" }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it("returns 401 when user not found", async () => {
    vi.mocked(profilesRepo.getCredentialByEmail).mockResolvedValueOnce(null)
    const req = new Request("http://localhost/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "test@example.com", password: "password123" }),
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it("calls verifyPasswordConstantTime on no-user path", async () => {
    vi.mocked(profilesRepo.getCredentialByEmail).mockResolvedValueOnce(null)
    const spy = vi.spyOn(authServer, "verifyPasswordConstantTime").mockResolvedValueOnce(false)

    const req = new Request("http://localhost/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "ghost@example.com", password: "anypassword" }),
    })
    await POST(req)
    expect(spy).toHaveBeenCalledOnce()
    spy.mockRestore()
  })

  it("returns 401 when password is wrong", async () => {
    vi.mocked(profilesRepo.getCredentialByEmail).mockResolvedValueOnce({
      id: "user-1",
      password_hash: "$argon2id$v=19$m=65536,t=3,p=4$fake-hash",
    })
    // verifyPassword returns false
    vi.spyOn(authServer, "verifyPassword").mockResolvedValueOnce(false)

    const req = new Request("http://localhost/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "test@example.com", password: "wrongpassword" }),
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it("returns 200 with user and accessToken on success", async () => {
    vi.mocked(profilesRepo.getCredentialByEmail).mockResolvedValueOnce({
      id: "user-1",
      password_hash: "$argon2id$v=19$m=65536,t=3,p=4$fake-hash",
    })
    vi.mocked(profilesRepo.getProfileByEmail).mockResolvedValueOnce({
      id: "user-1",
      email: "test@example.com",
      name: "Test User",
      plan: "free",
      role: "user",
      phone: null,
      credits_used: 0,
      credits_total: 10,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    vi.spyOn(authServer, "verifyPassword").mockResolvedValueOnce(true)
    vi.spyOn(authServer, "signToken").mockResolvedValueOnce("fake-jwt-token")

    const req = new Request("http://localhost/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "test@example.com", password: "correctpassword" }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.accessToken).toBe("fake-jwt-token")
    expect(body.user.id).toBe("user-1")
    expect(body.user.email).toBe("test@example.com")
    expect(body.user.plan).toBe("free")
  })

  it("response user object does not include password_hash", async () => {
    vi.mocked(profilesRepo.getCredentialByEmail).mockResolvedValueOnce({
      id: "user-1",
      password_hash: "$argon2id$v=19$m=65536,t=3,p=4$fake-hash",
    })
    vi.mocked(profilesRepo.getProfileByEmail).mockResolvedValueOnce({
      id: "user-1",
      email: "test@example.com",
      name: "Test User",
      plan: "free",
      role: "user",
      phone: null,
      credits_used: 0,
      credits_total: 10,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    vi.spyOn(authServer, "verifyPassword").mockResolvedValueOnce(true)
    vi.spyOn(authServer, "signToken").mockResolvedValueOnce("tok")

    const req = new Request("http://localhost/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "test@example.com", password: "correctpassword" }),
    })
    const res = await POST(req)
    const body = await res.json()
    expect(body.user).not.toHaveProperty("password_hash")
  })
})
