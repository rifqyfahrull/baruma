import { describe, expect, it } from "vitest"

// Smoke test proxy lazy mock: TANPA vi.mock("@/lib/data") — sengaja memakai
// jalur produksi agar dynamic import("./mock-source") benar-benar dieksekusi.
import { data } from "@/lib/data"

describe("lazy mock data source", () => {
  it("resolves methods through the lazy proxy", async () => {
    const plans = await data.getPlans()
    expect(Array.isArray(plans)).toBe(true)
    expect(plans.length).toBeGreaterThan(0)

    const user = await data.getCurrentUser()
    expect(user).toBeTruthy()
    expect(typeof user.id).toBe("string")

    const projects = await data.listProjects()
    expect(Array.isArray(projects)).toBe(true)
  })
})
