import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"

// PricingPage is an async server component that reads the plans repo
// directly (no fetch) — mock the repo boundary and await the component
// function itself to get its resolved JSX, then render that with RTL.
vi.mock("@/lib/server/repo/plans", async () => {
  const { DEFAULT_PLANS } = await import("@/lib/server/repo/plan-defaults")
  return { getPlans: vi.fn(async () => DEFAULT_PLANS) }
})

import PricingPage from "./page"
import { getPlans } from "@/lib/server/repo/plans"

afterEach(cleanup)

describe("PricingPage (server component, mocked getPlans)", () => {
  it("renders all 3 default plans from the plans repo", async () => {
    const ui = await PricingPage()
    render(ui)

    expect(getPlans).toHaveBeenCalledWith(true)
    expect(screen.getByText("Free")).toBeTruthy()
    expect(screen.getByText("Pro")).toBeTruthy()
    expect(screen.getByText("Studio")).toBeTruthy()
    expect(screen.getByText("Populer")).toBeTruthy()
    expect(screen.getByText("Gratis")).toBeTruthy()
    expect(screen.getByText("Rp 149rb")).toBeTruthy()
    expect(screen.getByText("Rp 499rb")).toBeTruthy()
    expect(
      screen.getByRole("heading", { name: "Pilih paket yang sesuai tahapmu" })
    ).toBeTruthy()
  })
})
