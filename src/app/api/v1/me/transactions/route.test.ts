// @vitest-environment node
/**
 * Route tests for GET /api/v1/me/transactions — the user-facing "Riwayat
 * transaksi" listing.
 */
import { describe, it, expect, vi, beforeAll } from "vitest"

beforeAll(() => {
  process.env.BARUMA_JWT_SECRET = "test-secret-at-least-32-characters-long"
})

vi.mock("@/lib/server/repo/subscriptions", () => ({
  listSubscriptionsForProfile: vi.fn(),
}))

import { GET } from "./route"
import { signToken } from "@/lib/server/auth-server"
import * as subscriptionsRepo from "@/lib/server/repo/subscriptions"

describe("GET /api/v1/me/transactions", () => {
  it("returns 401 without a Bearer token", async () => {
    const res = await GET(
      new Request("http://localhost/api/v1/me/transactions")
    )
    expect(res.status).toBe(401)
  })

  it("returns the caller's transaction history, mapped to the client shape", async () => {
    vi.mocked(subscriptionsRepo.listSubscriptionsForProfile).mockResolvedValueOnce([
      {
        id: "sub-1",
        profileId: "user-1",
        planId: "pro",
        status: "active",
        provider: "parent",
        providerRef: "brm-order-1",
        currentPeriodEnd: "2026-09-01T00:00:00.000Z",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
        planName: "Pro",
        priceIdr: 149000,
      },
    ])
    const token = await signToken("user-1")
    const req = new Request("http://localhost/api/v1/me/transactions", {
      headers: { authorization: `Bearer ${token}` },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual([
      {
        id: "sub-1",
        planName: "Pro",
        priceIdr: 149000,
        status: "active",
        createdAt: "2026-08-01T00:00:00.000Z",
        currentPeriodEnd: "2026-09-01T00:00:00.000Z",
        providerOrderId: "brm-order-1",
      },
    ])
    expect(subscriptionsRepo.listSubscriptionsForProfile).toHaveBeenCalledWith(
      "user-1"
    )
  })
})
