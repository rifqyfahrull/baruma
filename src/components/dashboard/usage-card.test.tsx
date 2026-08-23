import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import type { User } from "@/types"

const getCurrentUser = vi.fn()

vi.mock("@/lib/data", () => ({
  data: {
    getCurrentUser: (...args: unknown[]) => getCurrentUser(...args),
  },
}))

import { UsageCard } from "./usage-card"

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <UsageCard />
    </QueryClientProvider>
  )
}

afterEach(() => {
  cleanup()
  getCurrentUser.mockReset()
})

describe("UsageCard", () => {
  it("shows remaining credits and the user's plan label", async () => {
    const user: User = {
      id: "u1",
      name: "Test",
      email: "t@x.com",
      plan: "pro",
      creditsUsed: 3,
      creditsTotal: 10,
    }
    getCurrentUser.mockResolvedValue(user)

    renderCard()

    await waitFor(() => expect(screen.getByTestId("usage-card")).toBeTruthy())
    expect(screen.getByText("Kredit tersisa: 7/10")).toBeTruthy()
    expect(screen.getByText("Pro")).toBeTruthy()
  })

  it("links to /app/billing", async () => {
    getCurrentUser.mockResolvedValue({
      id: "u1",
      name: "Test",
      email: "t@x.com",
      plan: "free",
      creditsUsed: 0,
      creditsTotal: 10,
    } satisfies User)

    renderCard()

    const link = await screen.findByRole("link", { name: "Kelola billing" })
    expect(link.getAttribute("href")).toBe("/app/billing")
  })
})
