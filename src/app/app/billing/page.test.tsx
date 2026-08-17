import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { DEFAULT_PLANS } from "@/lib/server/repo/plan-defaults"
import type { User } from "@/types"

const getCurrentUser = vi.fn()
const getPlans = vi.fn()

// BillingPage's hooks (useCurrentUser/usePlans) wrap data.* in useQuery —
// mocking the data-source boundary exercises the real hooks + component,
// mirroring the pattern in src/hooks/use-layout-autosave.test.tsx.
vi.mock("@/lib/data", () => ({
  data: {
    getCurrentUser: (...args: unknown[]) => getCurrentUser(...args),
    getPlans: (...args: unknown[]) => getPlans(...args),
  },
}))

import BillingPage from "./page"

const user: User = {
  id: "u1",
  name: "Test User",
  email: "test@example.com",
  plan: "free",
  creditsUsed: 2,
  creditsTotal: 10,
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <BillingPage />
    </QueryClientProvider>
  )
}

afterEach(() => {
  cleanup()
  getCurrentUser.mockReset()
  getPlans.mockReset()
})

describe("BillingPage", () => {
  it("renders loading skeletons while plans are still fetching", async () => {
    getCurrentUser.mockResolvedValue(user)
    getPlans.mockReturnValue(new Promise(() => {})) // never resolves during this test

    renderPage()
    await waitFor(() => expect(getPlans).toHaveBeenCalled())

    // No plan card content should be rendered yet — only skeleton placeholders.
    expect(screen.queryByText("Pro")).toBeNull()
    expect(screen.queryByText("Studio")).toBeNull()
    expect(screen.queryByText("Rp 149rb")).toBeNull()
  })

  it("renders the 3 plan cards once loaded, with the current plan marked", async () => {
    getCurrentUser.mockResolvedValue(user)
    getPlans.mockResolvedValue(DEFAULT_PLANS)

    renderPage()

    await waitFor(() => expect(screen.getByText("Pro")).toBeTruthy())
    expect(screen.getByText("Studio")).toBeTruthy()
    expect(screen.getByText("Populer")).toBeTruthy()
    expect(screen.getByText("Rp 149rb")).toBeTruthy()
    expect(screen.getByText("Rp 499rb")).toBeTruthy()

    // Free is the user's current plan → its card shows the disabled "Paket aktif" button
    // ("Paket aktif" is also the static section label above the plan name, hence the role scope).
    expect(screen.getByRole("button", { name: "Paket aktif" })).toBeTruthy()
    // Pro/Studio are upgrades → their buttons read the plan-specific CTA copy.
    expect(screen.getByRole("button", { name: /Pilih Pro/ })).toBeTruthy()
    expect(screen.getByRole("button", { name: /Pilih Studio/ })).toBeTruthy()
  })

  it("does not show a renewal banner when there is no active subscription", async () => {
    getCurrentUser.mockResolvedValue(user) // no `subscription` field
    getPlans.mockResolvedValue(DEFAULT_PLANS)

    renderPage()

    await waitFor(() => expect(screen.getByText("Pro")).toBeTruthy())
    expect(screen.queryByText(/Langganan berakhir dalam/)).toBeNull()
  })

  it("shows a renewal banner + Perpanjang button when the active period ends within 7 days", async () => {
    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString()
    getCurrentUser.mockResolvedValue({
      ...user,
      plan: "pro",
      subscription: { status: "active", currentPeriodEnd: soon },
    } satisfies User)
    getPlans.mockResolvedValue(DEFAULT_PLANS)

    renderPage()

    await waitFor(() =>
      expect(screen.getByText(/Langganan berakhir dalam 3 hari/)).toBeTruthy()
    )
    expect(
      screen.getByRole("button", { name: "Perpanjang langganan sekarang" })
    ).toBeTruthy()
  })

  it("does not show a renewal banner when the active period ends far in the future", async () => {
    const farOut = new Date(Date.now() + 60 * 86_400_000).toISOString()
    getCurrentUser.mockResolvedValue({
      ...user,
      plan: "pro",
      subscription: { status: "active", currentPeriodEnd: farOut },
    } satisfies User)
    getPlans.mockResolvedValue(DEFAULT_PLANS)

    renderPage()

    // "Pro" is ambiguous here (current-plan label AND the Pro plan card
    // heading both read "Pro") — wait on "Studio" instead, which stays
    // unique, to know the plan cards have finished loading.
    await waitFor(() => expect(screen.getByText("Studio")).toBeTruthy())
    expect(screen.queryByText(/Langganan berakhir dalam/)).toBeNull()
  })
})
