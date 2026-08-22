import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest"
import { cleanup, render, screen, fireEvent } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import type { FeatureCapabilities } from "@/lib/features"
import type { Project } from "@/types"

// jsdom tidak mengimplementasikan matchMedia — useFokusMode() (dipakai
// tombol Fokus rail ini) memanggil useSidebar(), yang memanggil
// useIsMobile() lewat useSyncExternalStore(window.matchMedia(...)).
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

const capabilitiesRef: { current: FeatureCapabilities } = {
  current: {
    exterior_elements_v1: true,
    roof_zones_v1: true,
    presentation_mode_v1: true,
    ai_render_v1: true,
  },
}
vi.mock("@/hooks/use-project-capabilities", () => ({
  useProjectCapabilities: () => capabilitiesRef.current,
}))

// ViewToolbar kini merender AiRenderDialog (Fase 8), yang query
// useCurrentUser/useProjectRenders lewat `@/lib/data` — mock minimal supaya
// query resolve tanpa menyentuh jaringan/mock-source asli (yang lazy-import
// ~570KB & async, tak relevan utk tes toolbar ini).
vi.mock("@/lib/data", () => ({
  data: {
    getCurrentUser: () =>
      Promise.resolve({
        id: "u1",
        name: "Uji",
        email: "uji@example.com",
        plan: "free",
        creditsUsed: 2,
        creditsTotal: 10,
        entitlements: {
          creditsPerPeriod: 10,
          maxProjects: 1,
          exportPdf: false,
          glbUpload: false,
          aiRenderHd: false,
        },
      }),
    listRenders: () => Promise.resolve([]),
  },
}))

// Reset capabilitiesRef sebelum SETIAP test di file ini — beberapa test
// (mis. "hides the render mode presets") sengaja mematikan
// presentation_mode_v1; tanpa reset global ini, mutasi objek modul-level itu
// bocor ke test-test lain yang berjalan setelahnya (urutan eksekusi file).
beforeEach(() => {
  capabilitiesRef.current = {
    exterior_elements_v1: true,
    roof_zones_v1: true,
    presentation_mode_v1: true,
    ai_render_v1: true,
  }
})

// jsdom tidak mengimplementasikan ResizeObserver — Radix Popper (Tooltip/
// Popover) butuh ini saat konten benar-benar terbuka; use-toolbar-overflow
// juga memakainya untuk mengukur rail.
let originalResizeObserver: typeof ResizeObserver | undefined
beforeEach(() => {
  originalResizeObserver = window.ResizeObserver
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})
afterEach(() => {
  window.ResizeObserver = originalResizeObserver as typeof ResizeObserver
})

import { ViewToolbar } from "./view-toolbar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { SidebarProvider } from "@/components/ui/sidebar"
import { makeLayout } from "@/test-utils/fixtures"
import { usePreviewStore } from "@/stores/preview-store"
import { useUIStore } from "@/stores/ui-store"

const project = {
  id: "p1",
  name: "Rumah Uji",
  city: "Bandung",
  site: { widthM: 8, depthM: 10, areaM2: 80 },
} as Project

function renderToolbar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <SidebarProvider>
        <TooltipProvider>
          <ViewToolbar layout={makeLayout()} project={project} />
        </TooltipProvider>
      </SidebarProvider>
    </QueryClientProvider>
  )
}

function openTampilan() {
  renderToolbar()
  fireEvent.click(screen.getByLabelText("Opsi tampilan"))
}

describe("ViewToolbar presentation preset gating (roadmap §21)", () => {
  beforeEach(() => {
    capabilitiesRef.current = {
      exterior_elements_v1: true,
      roof_zones_v1: true,
      presentation_mode_v1: true,
      ai_render_v1: true,
    }
  })
  afterEach(() => cleanup())

  it("shows Tampilan Kerja/Presentasi presets when presentation_mode_v1 is enabled", () => {
    openTampilan()
    expect(screen.getByTestId("render-mode-presentation")).toBeTruthy()
    expect(screen.getByTestId("render-mode-edit")).toBeTruthy()
    expect(screen.getByText("Tampilan Kerja")).toBeTruthy()
    expect(screen.getByText("Presentasi")).toBeTruthy()
  })

  it("hides the render mode presets when presentation_mode_v1 is off", () => {
    capabilitiesRef.current = {
      ...capabilitiesRef.current,
      presentation_mode_v1: false,
    }
    openTampilan()
    expect(screen.queryByTestId("render-mode-presentation")).toBeNull()
    expect(screen.queryByTestId("render-mode-edit")).toBeNull()
  })
})

describe("ViewToolbar — clean-mode-2d-link REMOVED (Fase 5)", () => {
  // SurfaceSwitcher [2D|3D] di floor-toggle-bar.tsx (Fase 2) sekarang satu-
  // satunya jalan navigasi 2D↔3D — link bespoke lama tak lagi ada, dalam
  // mode fokus ataupun tidak.
  afterEach(() => cleanup())

  it("never renders clean-mode-2d-link, in or out of fokus mode", () => {
    renderToolbar()
    expect(screen.queryByTestId("clean-mode-2d-link")).toBeNull()
    cleanup()

    useUIStore.getState().setFokusMode(true)
    renderToolbar()
    expect(screen.queryByTestId("clean-mode-2d-link")).toBeNull()
    useUIStore.getState().setFokusMode(false)
  })
})

describe("ViewToolbar rail — undo/redo, view presets, Fokus", () => {
  afterEach(() => {
    useUIStore.getState().setFokusMode(false)
    cleanup()
  })

  it("renders Undo/Redo at the top of the rail, disabled when there is no history", () => {
    renderToolbar()
    expect(screen.getByLabelText("Undo")).toHaveProperty("disabled", true)
    expect(screen.getByLabelText("Redo")).toHaveProperty("disabled", true)
  })

  it("renders the 4 view presets with the current preset marked pressed", () => {
    renderToolbar()
    const iso = screen.getByLabelText("Sudut pandang Isometrik")
    expect(iso.getAttribute("aria-pressed")).toBe("true")
    expect(screen.getByLabelText("Sudut pandang Depan").getAttribute("aria-pressed")).toBe("false")
    expect(screen.getByLabelText("Sudut pandang Atas")).toBeTruthy()
    expect(screen.getByLabelText("Sudut pandang Rooftop")).toBeTruthy()
  })

  it("toggles fokusMode via testid clean-mode-toggle (Fase 5 — state pindah ke ui-store)", () => {
    renderToolbar()
    const fokus = screen.getByTestId("clean-mode-toggle")
    expect(fokus.getAttribute("aria-label")).toBe("Mode fokus")
    expect(fokus.getAttribute("aria-pressed")).toBe("false")
    fireEvent.click(fokus)
    expect(useUIStore.getState().fokusMode).toBe(true)
  })
})

describe("ViewToolbar Kamera flyout", () => {
  afterEach(() => cleanup())

  it("contains a Screenshot row and the Paket Foto Presentasi dialog trigger", () => {
    renderToolbar()
    expect(screen.queryByText("Screenshot")).toBeNull()
    fireEvent.click(screen.getByLabelText("Kamera"))
    expect(screen.getByRole("button", { name: "Screenshot" })).toBeTruthy()
    expect(screen.getByTestId("photo-package-open")).toBeTruthy()
  })
})

describe("ViewToolbar Cahaya popover (night mode moved inside)", () => {
  afterEach(() => cleanup())

  it("has no standalone night-mode-toggle in the rail — only inside the Cahaya popover", () => {
    renderToolbar()
    expect(screen.queryByTestId("night-mode-toggle")).toBeNull()
    fireEvent.click(screen.getByLabelText("Cahaya"))
    expect(screen.getByTestId("night-mode-toggle")).toBeTruthy()
  })

  it("toggles night mode via the switch found inside the popover", () => {
    renderToolbar()
    fireEvent.click(screen.getByLabelText("Cahaya"))
    const night = screen.getByTestId("night-mode-toggle")
    expect(night.getAttribute("aria-checked")).toBe("false")
    fireEvent.click(night)
    expect(usePreviewStore.getState().nightMode).toBe(true)
    usePreviewStore.getState().setNightMode(false)
  })

  it("still shows the sun-study section and manual sliders inside Cahaya", () => {
    renderToolbar()
    fireEvent.click(screen.getByLabelText("Cahaya"))
    expect(screen.getByTestId("sun-study")).toBeTruthy()
    expect(screen.getByText(/Azimuth matahari/)).toBeTruthy()
  })
})

describe("ViewToolbar Tampilan popover — scene stats footer row (dev only)", () => {
  afterEach(() => cleanup())

  it("has no standalone scene-stats-button in the rail — only inside the Tampilan popover", () => {
    renderToolbar()
    expect(screen.queryByTestId("scene-stats-button")).toBeNull()
    fireEvent.click(screen.getByLabelText("Opsi tampilan"))
    expect(screen.getByTestId("scene-stats-button")).toBeTruthy()
  })

  it("opens the scene stats details nested popover without closing Tampilan", () => {
    renderToolbar()
    fireEvent.click(screen.getByLabelText("Opsi tampilan"))
    fireEvent.click(screen.getByTestId("scene-stats-button"))
    // "Scene stats · dev only" muncul dua kali (label tombol trigger + judul
    // isi popover bersarang) — pakai getAllByText.
    expect(screen.getAllByText("Scene stats · dev only").length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText("Draw calls")).toBeTruthy()
    // Tampilan tetap terbuka — preset render mode masih terlihat.
    expect(screen.getByTestId("render-mode-edit")).toBeTruthy()
  })
})

describe("ViewToolbar responsive compact mode (ToolbarMore popover)", () => {
  // 1024px = breakpoint lg: desktop lebar (≥ 1024) inline, tablet/sempit (< 1024) compact.
  const WIDE = 1280
  const NARROW = 800

  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", {
      value: WIDE,
      configurable: true,
      writable: true,
    })
  })
  afterEach(() => {
    Object.defineProperty(window, "innerWidth", {
      value: WIDE,
      configurable: true,
      writable: true,
    })
    cleanup()
  })

  it("renders the secondary group inline on a wide (desktop) viewport (no More)", () => {
    Object.defineProperty(window, "innerWidth", { value: WIDE, configurable: true, writable: true })
    renderToolbar()
    expect(screen.queryByTestId("view-toolbar-more")).toBeNull()
    expect(screen.getByLabelText("Opsi tampilan")).toBeTruthy()
    expect(screen.getByLabelText("Cahaya")).toBeTruthy()
    expect(screen.getByLabelText("Kamera")).toBeTruthy()
    expect(screen.getByTestId("clean-mode-toggle")).toBeTruthy()
  })

  it("collapses the secondary group into ToolbarMore on a narrow (tablet) viewport — reachable via a popover, not a menu", () => {
    Object.defineProperty(window, "innerWidth", { value: NARROW, configurable: true, writable: true })
    renderToolbar()

    // Sekunder tak lagi inline — hanya tombol More yang tampil. Undo/Redo &
    // sudut pandang tetap inline (bukan bagian grup sekunder).
    const more = screen.getByTestId("view-toolbar-more")
    expect(more).toBeTruthy()
    expect(screen.queryByLabelText("Opsi tampilan")).toBeNull()
    expect(screen.queryByLabelText("Cahaya")).toBeNull()
    expect(screen.queryByLabelText("Kamera")).toBeNull()
    expect(screen.getByLabelText("Undo")).toBeTruthy()
    expect(screen.getByLabelText("Sudut pandang Isometrik")).toBeTruthy()

    // Buka More (Popover — bukan role="menu") → kontrol sekunder yang
    // disembunyikan kini bisa diakses.
    fireEvent.click(more)
    expect(more.closest('[role="menu"]')).toBeNull()
    expect(screen.getByLabelText("Opsi tampilan")).toBeTruthy()
    expect(screen.getByLabelText("Cahaya")).toBeTruthy()
    expect(screen.getByLabelText("Kamera")).toBeTruthy()
    expect(screen.getByTestId("clean-mode-toggle")).toBeTruthy()

    // Popover bersarang (Cahaya → di dalam More) tetap berfungsi.
    fireEvent.click(screen.getByLabelText("Cahaya"))
    const night = screen.getByTestId("night-mode-toggle")
    fireEvent.click(night)
    expect(night.getAttribute("aria-checked")).toBe("true")
    usePreviewStore.getState().setNightMode(false)
  })
})
