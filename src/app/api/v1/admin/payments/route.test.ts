// @vitest-environment node
/**
 * Route tests for GET /api/v1/admin/payments.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest"

beforeAll(() => {
  process.env.BARUMA_JWT_SECRET = "test-secret-at-least-32-characters-long"
})

vi.mock("@/lib/server/repo/profiles", () => ({
  getProfileById: vi.fn(),
}))

vi.mock("@/lib/server/repo/payment-events", () => ({
  listPaymentReconciliation: vi.fn(),
}))

import { GET } from "./route"
import { signToken } from "@/lib/server/auth-server"
import * as profilesRepo from "@/lib/server/repo/profiles"
import * as paymentEventsRepo from "@/lib/server/repo/payment-events"
import type { ProfileRow } from "@/lib/server/repo/profiles"

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

async function requestAs(role: "user" | "admin"): Promise<Request> {
  vi.mocked(profilesRepo.getProfileById).mockResolvedValueOnce(
    fakeProfile({ role })
  )
  const token = await signToken("user-1")
  return new Request("http://localhost/api/v1/admin/payments", {
    headers: { authorization: `Bearer ${token}` },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.ADMIN_EMAILS
})

describe("GET /api/v1/admin/payments", () => {
  it("returns 401 without a Bearer token", async () => {
    const res = await GET(new Request("http://localhost/api/v1/admin/payments"))
    expect(res.status).toBe(401)
  })

  it("returns 403 for a non-admin", async () => {
    const req = await requestAs("user")
    const res = await GET(req)
    expect(res.status).toBe(403)
    expect(paymentEventsRepo.listPaymentReconciliation).not.toHaveBeenCalled()
  })

  it("returns the reconciliation listing for an admin", async () => {
    vi.mocked(paymentEventsRepo.listPaymentReconciliation).mockResolvedValueOnce([
      {
        id: "brm-order-1:paid",
        provider: "parent",
        eventType: "paid",
        processed: true,
        createdAt: "2026-08-01T00:00:00.000Z",
        email: "pelanggan@contoh.id",
        planName: "Pro",
        subscriptionStatus: "expired",
        providerOrderId: "brm-order-1",
        mismatch: true,
      },
    ])
    const req = await requestAs("admin")
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(1)
    expect(body[0].mismatch).toBe(true)
    expect(body[0].email).toBe("pelanggan@contoh.id")
  })
})
