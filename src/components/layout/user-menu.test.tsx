import { describe, it, expect, vi, afterEach, beforeAll } from "vitest"
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

// jsdom doesn't implement matchMedia — `useSidebar` (via `use-mobile.ts`)
// calls it unconditionally through useSyncExternalStore. Same stub as
// app-sidebar.test.tsx.
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
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({
    auth: { signOut: vi.fn() },
  }),
}))

const getCurrentUser = vi.fn()
vi.mock("@/lib/data", () => ({
  data: {
    getCurrentUser: (...args: unknown[]) => getCurrentUser(...args),
  },
}))

import { UserMenu } from "./user-menu"
import { SidebarProvider } from "@/components/ui/sidebar"

function renderMenu() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <SidebarProvider>
        <UserMenu />
      </SidebarProvider>
    </QueryClientProvider>
  )
}

// Radix `DropdownMenu` opens via `onPointerDown` (Radix Menu contract, not
// `onClick`) — see the same helper in project-bar.test.tsx.
function openDropdown(trigger: HTMLElement) {
  fireEvent.pointerDown(trigger, { button: 0, pointerId: 1 })
  fireEvent.click(trigger)
}

afterEach(() => {
  cleanup()
  getCurrentUser.mockReset()
})

describe("UserMenu — entri Bantuan (WS-E §3)", () => {
  it("shows a 'Bantuan' item linking to /app/help once the dropdown opens", async () => {
    getCurrentUser.mockResolvedValue({
      id: "u1",
      name: "Test User",
      email: "test@example.com",
      plan: "free",
      creditsUsed: 0,
      creditsTotal: 10,
    })

    renderMenu()
    const trigger = await screen.findByText("Test User")
    openDropdown(trigger)

    await waitFor(() => expect(screen.getByText("Bantuan")).toBeTruthy())
    const link = screen.getByText("Bantuan").closest("a")
    expect(link?.getAttribute("href")).toBe("/app/help")
  })
})
