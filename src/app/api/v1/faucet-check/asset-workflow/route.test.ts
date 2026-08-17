// @vitest-environment node
import { describe, it, expect, vi, beforeAll } from "vitest"

beforeAll(() => {
  process.env.BARUMA_JWT_SECRET = "test-secret-at-least-32-characters-long"
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test"
  process.env.ASSET_PIPELINE_DB_URL = "postgres://u:p@secret-host.internal:5432/prod_catalog"
})

vi.mock("@/lib/server/db", () => ({ query: vi.fn(), getClient: vi.fn() }))
vi.mock("@/lib/server/auth-server", () => ({
  requireAdmin: vi.fn(async () => ({ userId: "admin-1" })),
  UnauthorizedError: class extends Error {},
  ForbiddenError: class extends Error {},
}))

import { POST } from "./route"

describe("POST /faucet-check/asset-workflow — disclosure (audit #4)", () => {
  it("TIDAK membocorkan host/nama DB pada respons (admin sekalipun)", async () => {
    const res = await POST(new Request("http://localhost/api/v1/faucet-check/asset-workflow", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "2.2.2.2" },
      body: JSON.stringify({ category: "window" }),
    }))
    expect(res.status).toBe(200)
    const text = JSON.stringify(await res.json())
    expect(text).not.toContain("secret-host.internal")
    expect(text).not.toContain("prod_catalog")
    // Tetap melaporkan status konfigurasi.
    expect(text).toContain("configured")
  })
})
