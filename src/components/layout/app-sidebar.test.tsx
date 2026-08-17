import { describe, it, expect, vi, beforeAll, afterEach } from "vitest"
import { render, screen, cleanup, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

// jsdom doesn't implement matchMedia — the sidebar's mobile-detection hook
// (src/hooks/use-mobile.ts) calls it unconditionally via useSyncExternalStore.
beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
})

vi.mock("next/navigation", () => ({
  usePathname: () => "/app/dashboard",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

const getCurrentUser = vi.fn()
vi.mock("@/lib/data", () => ({
  data: {
    getCurrentUser: (...args: unknown[]) => getCurrentUser(...args),
  },
}))

import { AppSidebar } from "./app-sidebar"
import { SidebarProvider } from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"

function renderSidebar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <SidebarProvider>
          <AppSidebar />
        </SidebarProvider>
      </TooltipProvider>
    </QueryClientProvider>
  )
}

afterEach(() => {
  cleanup()
  getCurrentUser.mockReset()
})

describe("AppSidebar — Admin nav item (Task 8)", () => {
  it("does not render an Admin link for a non-admin user", async () => {
    getCurrentUser.mockResolvedValue({
      id: "u1",
      name: "User Biasa",
      email: "user@example.com",
      plan: "free",
      creditsUsed: 0,
      creditsTotal: 10,
      role: "user",
    })

    renderSidebar()
    await waitFor(() => expect(getCurrentUser).toHaveBeenCalled())
    // Give the query a tick to settle before asserting absence.
    await screen.findByText("Billing")
    expect(screen.queryByRole("link", { name: /Admin/ })).toBeNull()
  })

  it("renders an enabled Admin link pointing at /app/admin for an admin user", async () => {
    getCurrentUser.mockResolvedValue({
      id: "u2",
      name: "Admin User",
      email: "admin@example.com",
      plan: "free",
      creditsUsed: 0,
      creditsTotal: 10,
      role: "admin",
    })

    renderSidebar()
    const link = await screen.findByRole("link", { name: /Admin/ })
    expect(link.getAttribute("href")).toBe("/app/admin")
  })
})
