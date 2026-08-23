import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest"
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { toast } from "sonner"

// jsdom tidak mengimplementasikan matchMedia — SidebarTrigger/useFokusMode
// (via useSidebar → useIsMobile) memanggilnya lewat useSyncExternalStore.
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

// jsdom tidak mengimplementasikan ResizeObserver — Radix Popper (Popover/
// DropdownMenu) butuh ini saat konten benar-benar terbuka.
beforeAll(() => {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

let currentPathname = "/app/projects/proj-123/brief"
const pushSpy = vi.fn()
vi.mock("next/navigation", () => ({
  usePathname: () => currentPathname,
  useRouter: () => ({ push: pushSpy }),
}))

const setThemeSpy = vi.fn()
vi.mock("next-themes", () => ({
  useTheme: () => ({ setTheme: setThemeSpy, resolvedTheme: "light" }),
}))

const projectMock = { value: vi.fn() }
const renameMock = { value: vi.fn() }
const shareLinkMock = { value: vi.fn() }
const createShareLinkMock = { value: vi.fn() }
const revokeShareLinkMock = { value: vi.fn() }
vi.mock("@/lib/api/hooks", () => ({
  useProject: (...args: unknown[]) => projectMock.value(...args),
  useRenameProject: (...args: unknown[]) => renameMock.value(...args),
  useShareLink: (...args: unknown[]) => shareLinkMock.value(...args),
  useCreateShareLink: (...args: unknown[]) => createShareLinkMock.value(...args),
  useRevokeShareLink: (...args: unknown[]) => revokeShareLinkMock.value(...args),
}))

const trackMock = { value: vi.fn() }
vi.mock("@/lib/analytics", () => ({
  track: (...args: unknown[]) => trackMock.value(...args),
}))

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}))

import { ProjectBar } from "./project-bar"
import { SidebarProvider } from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useUIStore } from "@/stores/ui-store"
import { useSaveStatusStore } from "@/stores/save-status-store"
import { useProjectAgentUiStore } from "@/stores/project-agent-ui-store"

// Radix `DropdownMenu` buka lewat `onPointerDown` (kontrak Menu Radix, bukan
// `onClick`) — `fireEvent.click` polos tak cukup di jsdom (tak pernah
// memicu urutan pointer event nyata seperti `userEvent`). Helper ini
// menembakkan `pointerdown` lalu `click` (klik sungguhan juga memicu
// keduanya) supaya trigger benar-benar terbuka di test.
function openDropdown(trigger: HTMLElement) {
  fireEvent.pointerDown(trigger, { button: 0, pointerId: 1 })
  fireEvent.click(trigger)
}

function renderBar(projectId = "proj-123") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <SidebarProvider>
        <TooltipProvider>
          <ProjectBar projectId={projectId} />
        </TooltipProvider>
      </SidebarProvider>
    </QueryClientProvider>
  )
}

const PROJECT = {
  id: "proj-123",
  name: "Rumah Qyfa",
  readiness: "concept_ready",
} as const

beforeEach(() => {
  currentPathname = "/app/projects/proj-123/brief"
  projectMock.value.mockReturnValue({ data: PROJECT, isLoading: false })
  renameMock.value.mockReturnValue({ mutate: vi.fn(), isPending: false })
  shareLinkMock.value.mockReturnValue({
    data: { url: "https://baruma.tampil.dev/s/tok123abc" },
    isLoading: false,
  })
  createShareLinkMock.value.mockReturnValue({ mutate: vi.fn(), isPending: false, data: undefined })
  revokeShareLinkMock.value.mockReturnValue({ mutate: vi.fn(), isPending: false })
  useUIStore.setState({ commandOpen: false, fokusMode: false })
  useSaveStatusStore.getState().reset()
  useProjectAgentUiStore.getState().reset()
  try {
    window.localStorage.clear()
  } catch {
    // ignore
  }
})

afterEach(() => {
  cleanup()
  projectMock.value.mockReset()
  trackMock.value.mockReset()
  renameMock.value.mockReset()
  shareLinkMock.value.mockReset()
  createShareLinkMock.value.mockReset()
  revokeShareLinkMock.value.mockReset()
  pushSpy.mockReset()
  setThemeSpy.mockReset()
  vi.mocked(toast.success).mockReset()
  vi.mocked(toast.error).mockReset()
  vi.mocked(toast.info).mockReset()
  vi.stubGlobal("open", vi.fn())
  useUIStore.setState({ commandOpen: false, fokusMode: false })
  useSaveStatusStore.getState().reset()
})

describe("ProjectBar — stage nav active states", () => {
  it("marks Brief pressed on the brief route", () => {
    currentPathname = "/app/projects/proj-123/brief"
    renderBar()
    expect(screen.getByTestId("stage-brief").getAttribute("aria-pressed")).toBe("true")
    expect(screen.getByTestId("stage-alternatif").getAttribute("aria-pressed")).toBe("false")
  })

  it("marks Desain pressed on /editor and /preview-3d", () => {
    currentPathname = "/app/projects/proj-123/editor"
    renderBar()
    expect(screen.getByTestId("stage-desain").getAttribute("aria-pressed")).toBe("true")
    cleanup()

    currentPathname = "/app/projects/proj-123/preview-3d"
    renderBar()
    expect(screen.getByTestId("stage-desain").getAttribute("aria-pressed")).toBe("true")
  })

  it("marks Hasil pressed on its sub-pages (drawings/rab/exports/review)", () => {
    currentPathname = "/app/projects/proj-123/drawings"
    renderBar()
    expect(screen.getByTestId("stage-hasil").getAttribute("aria-pressed")).toBe("true")
  })

  it("Desain pill click navigates to the last-used surface (default editor)", () => {
    currentPathname = "/app/projects/proj-123/brief"
    renderBar()
    fireEvent.click(screen.getByTestId("stage-desain"))
    expect(pushSpy).toHaveBeenCalledWith("/app/projects/proj-123/editor")
  })

  it("Desain pill click remembers preview-3d once that surface was visited", () => {
    currentPathname = "/app/projects/proj-123/preview-3d"
    renderBar()
    cleanup()

    currentPathname = "/app/projects/proj-123/brief"
    renderBar()
    fireEvent.click(screen.getByTestId("stage-desain"))
    expect(pushSpy).toHaveBeenCalledWith("/app/projects/proj-123/preview-3d")
  })
})

describe("ProjectBar — caret submenu navigation targets", () => {
  it("Desain caret lists 2D Editor / 3D Preview / Materials / Furniture with correct hrefs", () => {
    renderBar()
    openDropdown(screen.getByTestId("stage-desain-caret"))
    expect(screen.getByTestId("stage-desain-item-editor").getAttribute("href")).toBe(
      "/app/projects/proj-123/editor"
    )
    expect(screen.getByTestId("stage-desain-item-preview-3d").getAttribute("href")).toBe(
      "/app/projects/proj-123/preview-3d"
    )
    expect(screen.getByTestId("stage-desain-item-materials").getAttribute("href")).toBe(
      "/app/projects/proj-123/materials"
    )
    expect(screen.getByTestId("stage-desain-item-furniture").getAttribute("href")).toBe(
      "/app/projects/proj-123/furniture"
    )
  })

  it("Hasil caret lists Gambar Kerja / RAB-BOQ / Exports / Review with correct hrefs", () => {
    renderBar()
    openDropdown(screen.getByTestId("stage-hasil-caret"))
    expect(screen.getByTestId("stage-hasil-item-drawings").getAttribute("href")).toBe(
      "/app/projects/proj-123/drawings"
    )
    expect(screen.getByTestId("stage-hasil-item-rab").getAttribute("href")).toBe(
      "/app/projects/proj-123/rab"
    )
    expect(screen.getByTestId("stage-hasil-item-exports").getAttribute("href")).toBe(
      "/app/projects/proj-123/exports"
    )
    expect(screen.getByTestId("stage-hasil-item-review").getAttribute("href")).toBe(
      "/app/projects/proj-123/review"
    )
  })

  it("marks the active sub-page with a check indicator", () => {
    currentPathname = "/app/projects/proj-123/furniture"
    renderBar()
    openDropdown(screen.getByTestId("stage-desain-caret"))
    const activeItem = screen.getByTestId("stage-desain-item-furniture")
    expect(within(activeItem).getByText("Furniture")).toBeTruthy()
    // Item aktif render 2 svg (ikon item + ikon Check) — item tak aktif cuma 1.
    expect(activeItem.querySelectorAll("svg").length).toBe(2)
    const inactiveItem = screen.getByTestId("stage-desain-item-editor")
    expect(inactiveItem.querySelectorAll("svg").length).toBe(1)
  })
})

describe("ProjectBar — name dropdown (rename/bagikan/⌘K)", () => {
  it("opens the rename dialog from the name dropdown", async () => {
    renderBar()
    openDropdown(screen.getByTestId("project-name-menu-trigger"))
    fireEvent.click(await screen.findByText("Ganti nama…"))
    expect(await screen.findByText("Ganti nama project")).toBeTruthy()
    expect(screen.getByDisplayValue("Rumah Qyfa")).toBeTruthy()
  })

  it("opens the share dialog with the public /s/[token] link (not the owner-only /review URL)", async () => {
    renderBar()
    openDropdown(screen.getByTestId("project-name-menu-trigger"))
    fireEvent.click(await screen.findByText("Bagikan…"))
    expect(await screen.findByText("Bagikan project")).toBeTruthy()
    expect(screen.getByDisplayValue(/\/s\/tok123abc/)).toBeTruthy()
  })

  it("Cari… opens the command menu via ui-store.commandOpen", async () => {
    renderBar()
    openDropdown(screen.getByTestId("project-name-menu-trigger"))
    fireEvent.click(await screen.findByText(/Cari…/))
    expect(useUIStore.getState().commandOpen).toBe(true)
  })

  it("auto-creates a link when the dialog opens and none exists yet", async () => {
    shareLinkMock.value.mockReturnValue({ data: { url: null }, isLoading: false })
    const createMutate = vi.fn()
    createShareLinkMock.value.mockReturnValue({ mutate: createMutate, isPending: false, data: undefined })
    renderBar()
    openDropdown(screen.getByTestId("project-name-menu-trigger"))
    fireEvent.click(await screen.findByText("Bagikan…"))
    await screen.findByText("Bagikan project")
    expect(createMutate).toHaveBeenCalledTimes(1)
  })

  it("Nonaktifkan tautan revokes the link and closes the dialog", async () => {
    const revokeMutate = vi.fn((_vars, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.())
    revokeShareLinkMock.value.mockReturnValue({ mutate: revokeMutate, isPending: false })
    renderBar()
    openDropdown(screen.getByTestId("project-name-menu-trigger"))
    fireEvent.click(await screen.findByText("Bagikan…"))
    await screen.findByText("Bagikan project")
    fireEvent.click(screen.getByRole("button", { name: "Nonaktifkan tautan" }))
    expect(revokeMutate).toHaveBeenCalledTimes(1)
    expect(toast.success).toHaveBeenCalledWith(
      "Tautan dinonaktifkan. Penerima lama tak bisa lagi membukanya."
    )
  })
})

describe("ProjectBar — save status dot", () => {
  it("shows the saved (green) state and no Simpan sekarang without a registered handler", () => {
    useSaveStatusStore.setState({ status: "saved", dirty: false, saveHandler: null })
    renderBar()
    fireEvent.click(screen.getByTestId("save-status-dot"))
    expect(screen.getByText("Tersimpan otomatis")).toBeTruthy()
    expect(screen.queryByTestId("save-now-button")).toBeNull()
  })

  it("shows the dirty (amber) state with a working Simpan sekarang when a handler is registered", () => {
    const handler = vi.fn()
    useSaveStatusStore.setState({ status: "idle", dirty: true, saveHandler: handler })
    renderBar()
    fireEvent.click(screen.getByTestId("save-status-dot"))
    expect(screen.getByText("Belum tersimpan")).toBeTruthy()
    fireEvent.click(screen.getByTestId("save-now-button"))
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it("shows the error (red) state", () => {
    useSaveStatusStore.setState({ status: "error", dirty: true, saveHandler: null })
    renderBar()
    fireEvent.click(screen.getByTestId("save-status-dot"))
    expect(screen.getByText("Gagal menyimpan otomatis")).toBeTruthy()
  })

  it("shows the conflict (red) state", () => {
    useSaveStatusStore.setState({ status: "conflict", dirty: true, saveHandler: null })
    renderBar()
    fireEvent.click(screen.getByTestId("save-status-dot"))
    expect(screen.getByText("Konflik penyimpanan — pilih tindakan di banner")).toBeTruthy()
  })
})

describe("ProjectBar — fokus pill collapse", () => {
  it("renders the full bar (not the pill) when fokusMode is off", () => {
    renderBar()
    expect(screen.getByTestId("project-bar")).toBeTruthy()
    expect(screen.queryByTestId("project-bar-fokus-pill")).toBeNull()
  })

  it("collapses to a floating pill with the truncated name + exit button when fokusMode is on", () => {
    useUIStore.setState({ fokusMode: true })
    renderBar()
    expect(screen.queryByTestId("project-bar")).toBeNull()
    const pill = screen.getByTestId("project-bar-fokus-pill")
    expect(within(pill).getByText("Rumah Qyfa")).toBeTruthy()
    expect(screen.getByTestId("fokus-exit")).toBeTruthy()
  })

  it("exit button turns fokusMode back off", () => {
    useUIStore.setState({ fokusMode: true })
    renderBar()
    fireEvent.click(screen.getByTestId("fokus-exit"))
    expect(useUIStore.getState().fokusMode).toBe(false)
  })
})

describe("ProjectBar — AI Agent & Export buttons", () => {
  it("renders AI Agent and Export, AI Agent opens the project agent panel", () => {
    renderBar()
    expect(screen.getByRole("button", { name: /AI Agent/ })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /AI Agent/ }))
    expect(useProjectAgentUiStore.getState().open).toBe(true)
  })

  it("Export shows the 'coming soon' toast (same target as the old header)", () => {
    renderBar()
    fireEvent.click(screen.getByRole("button", { name: /Export/ }))
    expect(toast.info).toHaveBeenCalledWith("Export tersedia di milestone berikutnya.")
  })
})

describe("ProjectBar — loading state", () => {
  it("renders skeletons instead of the name menu while the project is loading", () => {
    projectMock.value.mockReturnValue({ data: undefined, isLoading: true })
    renderBar()
    expect(screen.queryByTestId("project-name-menu-trigger")).toBeNull()
  })
})
