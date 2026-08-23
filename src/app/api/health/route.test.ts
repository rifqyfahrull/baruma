// @vitest-environment node
/**
 * Route tests for GET /api/health — smoke-test target for deploy.yml dan
 * pemantau uptime eksternal. Tanpa auth, jadi hanya perlu memastikan bentuk
 * respons & kode status benar untuk tiap kombinasi dependensi.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/server/db", () => ({ query: vi.fn() }))
vi.mock("@/lib/server/storage", () => ({ storageEnabled: vi.fn() }))
vi.mock("@/lib/billing/providers/parent", () => ({
  isParentBillingConfigured: vi.fn(),
}))

import { GET } from "./route"
import { query } from "@/lib/server/db"
import { storageEnabled } from "@/lib/server/storage"
import { isParentBillingConfigured } from "@/lib/billing/providers/parent"

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.mocked(query).mockReset()
    vi.mocked(storageEnabled).mockReset()
    vi.mocked(isParentBillingConfigured).mockReset()
    delete process.env.GIT_SHA
  })

  it("returns 200 ok:true when db succeeds, regardless of storage/billing", async () => {
    vi.mocked(query).mockResolvedValue({ rows: [{ "?column?": 1 }] } as never)
    vi.mocked(storageEnabled).mockReturnValue(false)
    vi.mocked(isParentBillingConfigured).mockReturnValue(false)

    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.checks).toEqual({ db: true, storage: false, billing: false })
    expect(body.version).toBe("dev")
    expect(typeof body.uptime).toBe("number")
  })

  it("returns 503 ok:false when the db query throws", async () => {
    vi.mocked(query).mockRejectedValue(new Error("connection refused"))
    vi.mocked(storageEnabled).mockReturnValue(true)
    vi.mocked(isParentBillingConfigured).mockReturnValue(true)

    const res = await GET()
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.checks.db).toBe(false)
    // Non-fatal checks still reported even when db is down.
    expect(body.checks.storage).toBe(true)
    expect(body.checks.billing).toBe(true)
  })

  it("reports storage:true and billing:true when both are configured", async () => {
    vi.mocked(query).mockResolvedValue({ rows: [] } as never)
    vi.mocked(storageEnabled).mockReturnValue(true)
    vi.mocked(isParentBillingConfigured).mockReturnValue(true)

    const res = await GET()
    const body = await res.json()
    expect(body.checks).toEqual({ db: true, storage: true, billing: true })
  })

  it("reflects GIT_SHA env into version when set", async () => {
    process.env.GIT_SHA = "abc1234"
    vi.mocked(query).mockResolvedValue({ rows: [] } as never)
    vi.mocked(storageEnabled).mockReturnValue(false)
    vi.mocked(isParentBillingConfigured).mockReturnValue(false)

    const res = await GET()
    const body = await res.json()
    expect(body.version).toBe("abc1234")
  })
})
