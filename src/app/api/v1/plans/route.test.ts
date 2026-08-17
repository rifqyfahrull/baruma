// @vitest-environment node
/**
 * Route test for the public `/api/v1/plans` endpoint — no auth, memory mode
 * (no DATABASE_URL), returns the active seeded plans sorted for display.
 */
import { describe, it, expect, beforeAll } from "vitest"

beforeAll(() => {
  // Force the in-memory fallback even if a previous test file in this worker
  // set DATABASE_URL (repos check the env at call time).
  delete process.env.DATABASE_URL
})

import { GET } from "./route"

describe("GET /api/v1/plans", () => {
  it("returns 200 with the active, sorted plans and no auth required", async () => {
    const res = await GET()
    expect(res.status).toBe(200)

    const body = (await res.json()) as { plans: Array<{ id: string; active: boolean }> }
    expect(Array.isArray(body.plans)).toBe(true)
    expect(body.plans.map((p) => p.id)).toEqual(["free", "pro", "studio"])
    expect(body.plans.every((p) => p.active)).toBe(true)
  })
})
