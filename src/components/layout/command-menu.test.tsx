import { describe, it, expect, vi, afterEach, beforeEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

// jsdom tidak mengimplementasikan ResizeObserver — cmdk (dipakai CommandMenu)
// butuh ini saat command list benar-benar dirender.
let originalResizeObserver: typeof ResizeObserver | undefined
beforeEach(() => {
  originalResizeObserver = window.ResizeObserver
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  // jsdom tidak mengimplementasikan scrollIntoView — cmdk memanggilnya saat
  // item aktif berubah.
  Element.prototype.scrollIntoView = vi.fn()
})

const push = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}))

vi.mock("next-themes", () => ({
  useTheme: () => ({ setTheme: vi.fn(), resolvedTheme: "light" }),
}))

const listProjects = vi.fn()
vi.mock("@/lib/data", () => ({
  data: {
    listProjects: (...args: unknown[]) => listProjects(...args),
  },
}))

import { useUIStore } from "@/stores/ui-store"
import { CommandMenu } from "./command-menu"

function renderMenu() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <CommandMenu />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  listProjects.mockResolvedValue([])
  useUIStore.setState({ commandOpen: true })
})

afterEach(() => {
  cleanup()
  push.mockReset()
  listProjects.mockReset()
  useUIStore.setState({ commandOpen: false })
  window.ResizeObserver = originalResizeObserver as typeof ResizeObserver
})

describe("CommandMenu", () => {
  it("lists a 'Bantuan' entry that navigates to /app/help", async () => {
    renderMenu()

    const item = await screen.findByText("Bantuan")
    item.click()

    expect(push).toHaveBeenCalledWith("/app/help")
  })
})
