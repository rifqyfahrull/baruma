import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest"
import { cleanup, render, screen, fireEvent, within } from "@testing-library/react"

import type { FeatureCapabilities } from "@/lib/features"

// jsdom tidak mengimplementasikan matchMedia — useFokusMode() (tombol Fokus,
// slot ke-12 sejak Fase 5) memanggil useSidebar() → useIsMobile() lewat
// useSyncExternalStore(window.matchMedia(...)).
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

// Compact di-mock langsung (bukan lewat ResizeObserver/getBoundingClientRect
// stub) — Fase 3 memindahkan sinyal compact ke `useToolbarCompact` (primitif
// Fase 1, sudah ada test sendiri di use-toolbar-compact.test.tsx); di sini
// cukup pastikan EditorToolbar MEREAKSI sinyal itu dengan benar.
const compactRef: { current: boolean } = { current: false }
vi.mock("@/hooks/use-toolbar-compact", () => ({
  useToolbarCompact: () => compactRef.current,
}))

const trackSpy = vi.fn()
vi.mock("@/lib/analytics", () => ({
  track: (...args: unknown[]) => trackSpy(...args),
}))

import { EditorToolbar } from "./editor-toolbar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ConfirmDialogProvider } from "@/components/ui/confirm-dialog"
import { SidebarProvider } from "@/components/ui/sidebar"
import { useEditorStore } from "@/stores/editor-store"
import { useUIStore } from "@/stores/ui-store"
import { makeLayout } from "@/test-utils/fixtures"

function renderToolbar() {
  return render(
    <SidebarProvider>
      <TooltipProvider>
        <ConfirmDialogProvider>
          <EditorToolbar />
        </ConfirmDialogProvider>
      </TooltipProvider>
    </SidebarProvider>
  )
}

// jsdom tidak mengimplementasikan ResizeObserver — Radix Popper (dipakai
// PopoverContent) butuh ini saat popover benar-benar terbuka.
let originalResizeObserver: typeof ResizeObserver | undefined
beforeEach(() => {
  originalResizeObserver = window.ResizeObserver
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver

  // jsdom tidak mengimplementasikan scrollIntoView — cmdk (di dalam palette
  // Ruang/Utilitas/Eksterior) memanggilnya saat item aktif berubah.
  Element.prototype.scrollIntoView = vi.fn()

  capabilitiesRef.current = {
    exterior_elements_v1: true,
    roof_zones_v1: true,
    presentation_mode_v1: true,
    ai_render_v1: true,
  }
  compactRef.current = false
  trackSpy.mockClear()
  useEditorStore.getState().loadLayout(makeLayout(), { widthM: 10, depthM: 10 }, [])
})
afterEach(() => {
  window.ResizeObserver = originalResizeObserver as typeof ResizeObserver
  useUIStore.getState().setFokusMode(false)
  cleanup()
})

describe("EditorToolbar — rail dasar (12 tombol + 2 label grup, Fase 5: +Fokus)", () => {
  it("renders undo/redo, pilih/geser, dan tiap tombol kategori dgn aria-label sendiri", () => {
    renderToolbar()
    expect(screen.getByLabelText("Undo")).toBeTruthy()
    expect(screen.getByLabelText("Redo")).toBeTruthy()
    expect(screen.getByLabelText("Pilih / geser (V)")).toBeTruthy()
    expect(screen.getByLabelText("Geser kanvas (Space)")).toBeTruthy()
    expect(screen.getByLabelText("Tambah ruang")).toBeTruthy()
    expect(screen.getByLabelText("Tambah pintu")).toBeTruthy()
    expect(screen.getByLabelText("Tambah jendela")).toBeTruthy()
    expect(screen.getByLabelText("Tambah tangga")).toBeTruthy()
    expect(screen.getByLabelText("Utilitas (listrik & air)")).toBeTruthy()
    expect(screen.getByLabelText("Eksterior")).toBeTruthy()
    expect(screen.getByLabelText("Tampilan")).toBeTruthy()
    expect(screen.getByLabelText("Mode fokus")).toBeTruthy()
  })

  it("tak ada kontrol dgn native title (semua lewat rich Tooltip)", () => {
    renderToolbar()
    for (const label of ["Tambah ruang", "Eksterior", "Tampilan", "Utilitas (listrik & air)"]) {
      expect(screen.getByLabelText(label).getAttribute("title")).toBeNull()
    }
  })

  it("stair tool button (direct tool, bukan palette) men-set activeTool ke 'stair'", () => {
    renderToolbar()
    fireEvent.click(screen.getByLabelText("Tambah tangga"))
    expect(useEditorStore.getState().activeTool).toBe("stair")
  })

  it("Pilih/Geser exclusive-active mengikuti activeTool", () => {
    renderToolbar()
    const pan = screen.getByLabelText("Geser kanvas (Space)")
    fireEvent.click(pan)
    expect(useEditorStore.getState().activeTool).toBe("pan")
    expect(pan.getAttribute("aria-pressed")).toBe("true")
  })

  it("Hapus TIDAK ada lagi di rail (via Del/inspector/context-menu sekarang)", () => {
    renderToolbar()
    expect(screen.queryByLabelText(/^Hapus/)).toBeNull()
  })

  it("tombol zoom TIDAK ada lagi di rail (dipindah ke cluster bottom-center di halaman editor)", () => {
    renderToolbar()
    expect(screen.queryByLabelText("Perbesar")).toBeNull()
    expect(screen.queryByLabelText("Perkecil")).toBeNull()
    expect(screen.queryByLabelText("Pas ke layar")).toBeNull()
  })
})

describe("EditorToolbar capability gating (roadmap §21) — palette Eksterior", () => {
  it("menyembunyikan tombol Eksterior saat kedua flag mati", () => {
    capabilitiesRef.current = {
      exterior_elements_v1: false,
      roof_zones_v1: false,
      presentation_mode_v1: true,
    }
    renderToolbar()
    expect(screen.queryByLabelText("Eksterior")).toBeNull()
  })

  it("hanya grup Zona atap yang muncul saat roof_zones_v1 on & exterior_elements_v1 off", () => {
    capabilitiesRef.current = {
      exterior_elements_v1: false,
      roof_zones_v1: true,
      presentation_mode_v1: true,
    }
    renderToolbar()
    fireEvent.click(screen.getByLabelText("Eksterior"))
    expect(screen.getByText("Zona atap")).toBeTruthy()
    expect(screen.getByText("Dak datar")).toBeTruthy()
    expect(screen.queryByText("Elemen eksterior")).toBeNull()
    expect(screen.queryByText("Template tampak depan")).toBeNull()
  })

  it("hanya grup elemen + template yang muncul saat exterior_elements_v1 on & roof_zones_v1 off", () => {
    capabilitiesRef.current = {
      exterior_elements_v1: true,
      roof_zones_v1: false,
      presentation_mode_v1: true,
    }
    renderToolbar()
    fireEvent.click(screen.getByLabelText("Eksterior"))
    expect(screen.queryByText("Zona atap")).toBeNull()
    expect(screen.getByText("Dinding & pagar")).toBeTruthy()
    expect(screen.getByText("Tembok batas")).toBeTruthy()
    expect(screen.getByText("Template tampak depan")).toBeTruthy()
  })

  it("Tampilan popover: toggle Area atap/zona tersembunyi hanya muncul saat roof_zones_v1 on", () => {
    capabilitiesRef.current = {
      exterior_elements_v1: true,
      roof_zones_v1: false,
      presentation_mode_v1: true,
    }
    renderToolbar()
    fireEvent.click(screen.getByLabelText("Tampilan"))
    expect(screen.queryByText("Area atap")).toBeNull()
    expect(screen.queryByText("Zona atap tersembunyi")).toBeNull()
  })
})

describe("EditorToolbar responsive compact mode (ToolbarMore)", () => {
  it("tidak menampilkan tombol More saat compact=false — semua kontrol inline", () => {
    compactRef.current = false
    renderToolbar()
    expect(screen.queryByTestId("editor-toolbar-more")).toBeNull()
    expect(screen.getByLabelText("Tambah ruang")).toBeTruthy()
    expect(screen.getByLabelText("Eksterior")).toBeTruthy()
  })

  it("menciutkan fragmen sekunder ke ToolbarMore saat compact=true, kontrol tetap reachable dgn aria-label sama", () => {
    compactRef.current = true
    renderToolbar()

    // Undo/Redo tetap inline (di luar fragmen sekunder — paritas rail 3D).
    expect(screen.getByLabelText("Undo")).toBeTruthy()

    expect(screen.queryByLabelText("Pilih / geser (V)")).toBeNull()
    const more = screen.getByTestId("editor-toolbar-more")
    expect(more).toBeTruthy()

    fireEvent.click(more)
    expect(screen.getByLabelText("Pilih / geser (V)")).toBeTruthy()
    expect(screen.getByLabelText("Tambah ruang")).toBeTruthy()
    expect(screen.getByLabelText("Eksterior")).toBeTruthy()
    expect(screen.getByLabelText("Tampilan")).toBeTruthy()
  })
})

describe("EditorToolbar — palette Ruang (searchable, ui/command)", () => {
  it("cari + pilih tipe ruang men-set pendingPlacement, activeTool, dan menampilkan chip", () => {
    renderToolbar()
    fireEvent.click(screen.getByLabelText("Tambah ruang"))

    fireEvent.change(screen.getByPlaceholderText("Cari tipe ruang…"), {
      target: { value: "Dapur" },
    })
    fireEvent.click(screen.getByText("Dapur"))

    expect(useEditorStore.getState().activeTool).toBe("room")
    expect(useEditorStore.getState().pendingPlacement).toEqual({
      tool: "room",
      variant: "dapur",
    })
    expect(screen.getByText("Dapur")).toBeTruthy() // chip

    // Palette tertutup setelah dipilih.
    expect(screen.queryByPlaceholderText("Cari tipe ruang…")).toBeNull()
  })

  it("chip punya tombol X yang membatalkan pendingPlacement", () => {
    renderToolbar()
    fireEvent.click(screen.getByLabelText("Tambah ruang"))
    fireEvent.click(screen.getByText("Kamar tidur"))
    expect(useEditorStore.getState().pendingPlacement).not.toBeNull()

    fireEvent.click(screen.getByLabelText("Batalkan pilihan penempatan"))
    expect(useEditorStore.getState().pendingPlacement).toBeNull()
  })
})

describe("EditorToolbar — palette Utilitas (Listrik + Air, dua grup)", () => {
  it("menampilkan grup Listrik dan Air di dalam SATU palette", () => {
    renderToolbar()
    fireEvent.click(screen.getByLabelText("Utilitas (listrik & air)"))
    expect(screen.getByText("Listrik")).toBeTruthy()
    expect(screen.getByText("Air")).toBeTruthy()
    expect(screen.getByText("Stopkontak")).toBeTruthy()
    expect(screen.getByText("Kloset")).toBeTruthy()
  })

  it("pilih tipe listrik men-set pendingPlacement {tool:'electrical'}", () => {
    renderToolbar()
    fireEvent.click(screen.getByLabelText("Utilitas (listrik & air)"))
    fireEvent.click(screen.getByText("Saklar Ganda"))
    expect(useEditorStore.getState().activeTool).toBe("electrical")
    expect(useEditorStore.getState().pendingPlacement).toEqual({
      tool: "electrical",
      variant: "saklar_ganda",
    })
  })

  it("pilih tipe air men-set pendingPlacement {tool:'water'}", () => {
    renderToolbar()
    fireEvent.click(screen.getByLabelText("Utilitas (listrik & air)"))
    fireEvent.click(screen.getByText("Shower"))
    expect(useEditorStore.getState().activeTool).toBe("water")
    expect(useEditorStore.getState().pendingPlacement).toEqual({
      tool: "water",
      variant: "shower",
    })
  })
})

describe("EditorToolbar — palette Eksterior (zona atap + elemen + template)", () => {
  it("pilih zona atap men-set pendingPlacement {tool:'roofZone'}", () => {
    renderToolbar()
    fireEvent.click(screen.getByLabelText("Eksterior"))
    fireEvent.click(screen.getByText("Atap pelana"))
    expect(useEditorStore.getState().activeTool).toBe("roofZone")
    expect(useEditorStore.getState().pendingPlacement).toEqual({
      tool: "roofZone",
      variant: "pelana",
    })
  })

  it("pilih elemen eksterior men-set pendingPlacement {tool:'exterior'}", () => {
    renderToolbar()
    fireEvent.click(screen.getByLabelText("Eksterior"))
    fireEvent.click(screen.getByText("Pagar"))
    expect(useEditorStore.getState().activeTool).toBe("exterior")
    expect(useEditorStore.getState().pendingPlacement).toEqual({
      tool: "exterior",
      variant: "fence",
    })
  })

  it("search menyaring lintas grup (mis. 'Portal' menemukan elemen 'Portal')", () => {
    renderToolbar()
    fireEvent.click(screen.getByLabelText("Eksterior"))
    fireEvent.change(screen.getByPlaceholderText("Cari elemen, zona atap, atau template…"), {
      target: { value: "Portal" },
    })
    expect(screen.getByText("Portal")).toBeTruthy()
    expect(screen.queryByText("Dak datar")).toBeNull()
  })
})

describe("EditorToolbar — template tampak depan via useConfirm (bukan window.confirm)", () => {
  it("menerapkan template hanya setelah confirm di-klik — memanggil applyExteriorTemplate + track", async () => {
    const applySpy = vi.fn()
    useEditorStore.setState({ applyExteriorTemplate: applySpy })
    renderToolbar()

    fireEvent.click(screen.getByLabelText("Eksterior"))
    fireEvent.click(screen.getByText("Modern Concrete Vertical"))

    // Dialog konfirmasi (AlertDialog dari useConfirm) muncul — BUKAN window.confirm.
    expect(await screen.findByText("Terapkan Modern Concrete Vertical?")).toBeTruthy()
    expect(applySpy).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText("Lanjutkan"))

    await vi.waitFor(() => {
      expect(applySpy).toHaveBeenCalledWith("modern_concrete_vertical")
    })
    expect(trackSpy).toHaveBeenCalledWith("exterior_template_applied", {
      template_id: "modern_concrete_vertical",
      source: "editor_toolbar",
    })
  })

  it("batal (Batal) TIDAK memanggil applyExteriorTemplate", async () => {
    const applySpy = vi.fn()
    useEditorStore.setState({ applyExteriorTemplate: applySpy })
    renderToolbar()

    fireEvent.click(screen.getByLabelText("Eksterior"))
    fireEvent.click(screen.getByText("Modern Concrete Vertical"))
    expect(await screen.findByText("Terapkan Modern Concrete Vertical?")).toBeTruthy()

    fireEvent.click(screen.getByText("Batal"))
    await vi.waitFor(() => {
      expect(screen.queryByText("Terapkan Modern Concrete Vertical?")).toBeNull()
    })
    expect(applySpy).not.toHaveBeenCalled()
  })
})

describe("EditorToolbar — popover Tampilan (snap, dimensi+satuan, lantai lain, tersembunyi)", () => {
  it("Satuan HANYA muncul saat Dimensi aktif", () => {
    renderToolbar()
    fireEvent.click(screen.getByLabelText("Tampilan"))
    expect(useEditorStore.getState().showDimensions).toBe(false)
    expect(screen.queryByLabelText(/^Satuan dimensi:/)).toBeNull()

    fireEvent.click(screen.getByText("Dimensi"))
    expect(useEditorStore.getState().showDimensions).toBe(true)
    expect(screen.getByLabelText(/^Satuan dimensi:/)).toBeTruthy()
  })

  it("toggle snap grid memutar snapEnabled di store", () => {
    renderToolbar()
    fireEvent.click(screen.getByLabelText("Tampilan"))
    const popover = screen.getByText("Snap grid").closest("label")!
    const toggle = within(popover).getByRole("switch")
    expect(useEditorStore.getState().snapEnabled).toBe(true)
    fireEvent.click(toggle)
    expect(useEditorStore.getState().snapEnabled).toBe(false)
  })

  it("toggle 'Tampilkan lantai lain' menulis showCrossFloorRooms", () => {
    renderToolbar()
    fireEvent.click(screen.getByLabelText("Tampilan"))
    const row = screen.getByText("Tampilkan lantai lain").closest("label")!
    const toggle = within(row).getByRole("switch")
    expect(useEditorStore.getState().showCrossFloorRooms).toBe(true)
    fireEvent.click(toggle)
    expect(useEditorStore.getState().showCrossFloorRooms).toBe(false)
  })

  it("toggle 'Tampilkan tersembunyi' menulis showHiddenExteriorElements", () => {
    renderToolbar()
    fireEvent.click(screen.getByLabelText("Tampilan"))
    const row = screen.getByText("Tampilkan tersembunyi").closest("label")!
    const toggle = within(row).getByRole("switch")
    expect(useEditorStore.getState().showHiddenExteriorElements).toBe(false)
    fireEvent.click(toggle)
    expect(useEditorStore.getState().showHiddenExteriorElements).toBe(true)
  })

  it("toggle 'Area atap' & 'Zona atap tersembunyi' menulis store (roof_zones_v1 on)", () => {
    renderToolbar()
    fireEvent.click(screen.getByLabelText("Tampilan"))

    const roofRow = screen.getByText("Area atap").closest("label")!
    expect(useEditorStore.getState().showRoofZones).toBe(true)
    fireEvent.click(within(roofRow).getByRole("switch"))
    expect(useEditorStore.getState().showRoofZones).toBe(false)

    const hiddenRow = screen.getByText("Zona atap tersembunyi").closest("label")!
    expect(useEditorStore.getState().showHiddenRoofZones).toBe(false)
    fireEvent.click(within(hiddenRow).getByRole("switch"))
    expect(useEditorStore.getState().showHiddenRoofZones).toBe(true)
  })
})

describe("EditorToolbar — Fokus (slot ke-12, Fase 5)", () => {
  afterEach(() => useUIStore.getState().setFokusMode(false))

  it("toggles ui-store.fokusMode via testid clean-mode-toggle (paritas dgn rail 3D)", () => {
    renderToolbar()
    const fokus = screen.getByTestId("clean-mode-toggle")
    expect(fokus.getAttribute("aria-label")).toBe("Mode fokus")
    expect(fokus.getAttribute("aria-pressed")).toBe("false")
    fireEvent.click(fokus)
    expect(useUIStore.getState().fokusMode).toBe(true)
    expect(fokus.getAttribute("aria-pressed")).toBe("true")
  })

  it("Fokus tetap reachable via ToolbarMore saat compact", () => {
    compactRef.current = true
    renderToolbar()
    fireEvent.click(screen.getByTestId("editor-toolbar-more"))
    expect(screen.getByLabelText("Mode fokus")).toBeTruthy()
  })
})
