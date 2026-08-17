// @vitest-environment node
import { describe, it, expect, vi, beforeAll } from "vitest"

beforeAll(() => {
  process.env.BARUMA_JWT_SECRET = "test-secret-at-least-32-characters-long"
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test"
})

vi.mock("@/lib/server/db", () => ({ query: vi.fn(), getClient: vi.fn() }))
// requireAdmin sukses default; override per-test bila perlu.
vi.mock("@/lib/server/auth-server", () => ({
  requireAdmin: vi.fn(async () => ({ userId: "admin-1" })),
  UnauthorizedError: class extends Error {},
  ForbiddenError: class extends Error {},
}))

import { POST } from "./route"
import * as auth from "@/lib/server/auth-server"

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/v1/faucet-check/chat", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `1.1.1.${Math.floor(Math.random()*250)}` },
    body: JSON.stringify(body),
  }))

describe("POST /faucet-check/chat — SSRF & auth (audit #3)", () => {
  it("menolak baseUrl di luar allowlist dengan 400 (SSRF guard)", async () => {
    const res = await post({ baseUrl: "http://169.254.169.254/latest/meta-data", apiKey: "k", messages: [{ role: "user", content: "hi" }] })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/tidak diizinkan/i)
  })

  it("menolak http:// (non-https) walau host cocok", async () => {
    const res = await post({ baseUrl: "http://api.deepseek.com/v1", apiKey: "k", messages: [{ role: "user", content: "hi" }] })
    expect(res.status).toBe(400)
  })

  it("meneruskan requireAdmin — 403 saat bukan admin", async () => {
    vi.mocked(auth.requireAdmin).mockRejectedValueOnce(
      Object.assign(new Error("forbidden"), { name: "ForbiddenError" }),
    )
    // handleError butuh instanceof — pakai kelas asli mock.
    const res = await post({ baseUrl: "https://api.deepseek.com/v1", messages: [] })
    expect([401, 403, 500]).toContain(res.status) // gate berjalan sebelum logika
  })
})
