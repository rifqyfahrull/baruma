import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cleanup, render, screen, fireEvent } from "@testing-library/react"

import type { FeatureCapabilities } from "@/lib/features"

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

import { EditorToolbar } from "./editor-toolbar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useEditorStore } from "@/stores/editor-store"
import { makeLayout } from "@/test-utils/fixtures"

function renderToolbar() {
  return render(
    <TooltipProvider>
      <EditorToolbar />
    </TooltipProvider>
  )
}

describe("EditorToolbar capability gating (roadmap §21)", () => {
  beforeEach(() => {
    capabilitiesRef.current = {
      exterior_elements_v1: true,
      roof_zones_v1: true,
      presentation_mode_v1: true,
    ai_render_v1: true,
    }
    useEditorStore.setState({ layout: makeLayout() })
  })
  afterEach(() => cleanup())

  it("shows exterior + roof zone creation tools when flags are enabled", () => {
    renderToolbar()
    expect(screen.getByLabelText("Tambah zona atap")).toBeTruthy()
    expect(screen.getByLabelText("Tambah elemen eksterior")).toBeTruthy()
    expect(screen.getByLabelText("Pilih template tampak depan")).toBeTruthy()
  })

  it("hides roof zone creation when roof_zones_v1 is off", () => {
    capabilitiesRef.current = {
      ...capabilitiesRef.current,
      roof_zones_v1: false,
    }
    renderToolbar()
    expect(screen.queryByLabelText("Tambah zona atap")).toBeNull()
    // Flag lain tidak ikut mati.
    expect(screen.getByLabelText("Tambah elemen eksterior")).toBeTruthy()
  })

  it("hides exterior creation and facade templates when exterior_elements_v1 is off", () => {
    capabilitiesRef.current = {
      ...capabilitiesRef.current,
      exterior_elements_v1: false,
    }
    renderToolbar()
    expect(screen.queryByLabelText("Tambah elemen eksterior")).toBeNull()
    expect(screen.queryByLabelText("Pilih template tampak depan")).toBeNull()
    expect(screen.getByLabelText("Tambah zona atap")).toBeTruthy()
  })

  it("lists surface elements (driveway/walkway/teras/taman) in 'Tambah elemen eksterior' — Bug 2", async () => {
    renderToolbar()
    const trigger = screen.getByLabelText("Tambah elemen eksterior")
    // Radix's DropdownMenuTrigger opens on pointerdown, not plain click —
    // a bare fireEvent.click() leaves it closed in jsdom.
    fireEvent.pointerDown(trigger, { pointerId: 1, button: 0 })
    fireEvent.pointerUp(trigger, { pointerId: 1, button: 0 })
    fireEvent.click(trigger)

    for (const label of ["Driveway", "Walkway", "Teras", "Taman / planting bed"]) {
      expect(await screen.findByText(label)).toBeTruthy()
    }
  })

  it("relies on the rich Tooltip (not native title) for the atap/eksterior/template group", () => {
    renderToolbar()
    // Native `title` gives a slow, OS-controlled hover delay — the whole
    // point of this fix is that these three buttons use the same
    // TooltipTrigger/TooltipContent pattern as every other tool button
    // instead, so none of them should carry a plain `title` attribute.
    for (const label of [
      "Tambah zona atap",
      "Tambah elemen eksterior",
      "Pilih template tampak depan",
    ]) {
      expect(screen.getByLabelText(label).getAttribute("title")).toBeNull()
    }
  })

  it("cross-floor rooms toggle is present and toggles showCrossFloorRooms", () => {
    renderToolbar()
    // The Eye toggle carries a state suffix in its aria-label ("...: aktif"),
    // so match by prefix like the other toolbar toggles.
    const toggle = screen.getByLabelText(/^Tampilkan lantai lain:/)
    expect(toggle).toBeTruthy()
    expect(useEditorStore.getState().showCrossFloorRooms).toBe(true)
    fireEvent.click(toggle)
    expect(useEditorStore.getState().showCrossFloorRooms).toBe(false)
    fireEvent.click(toggle)
    expect(useEditorStore.getState().showCrossFloorRooms).toBe(true)
  })

  it("visually separates the atap/eksterior/template group from the basic tools above it", () => {
    const { container } = renderToolbar()
    const roofButton = screen.getByLabelText("Tambah zona atap")
    const separators = container.querySelectorAll('[data-slot="separator"]')
    expect(separators.length).toBeGreaterThan(0)
    // At least one separator must precede the roof-zone button in DOM order,
    // so the group reads as visually distinct from the select/pan/door/window
    // and titik-listrik/titik-air tools above it.
    const hasSeparatorBefore = Array.from(separators).some(
      (sep) =>
        sep.compareDocumentPosition(roofButton) &
        Node.DOCUMENT_POSITION_FOLLOWING
    )
    expect(hasSeparatorBefore).toBe(true)
  })

  it("stair tool button sets activeTool to 'stair'", () => {
    renderToolbar()
    const btn = screen.getByLabelText("Tambah tangga")
    expect(btn).toBeTruthy()
    fireEvent.click(btn)
    expect(useEditorStore.getState().activeTool).toBe("stair")
  })
})

describe("EditorToolbar responsive compact mode (More dropdown)", () => {
  // 1024px = breakpoint lg: desktop lebar (≥ 1024) inline, tablet/sempit (< 1024) compact.
  const WIDE = 1280
  const NARROW = 800

  beforeEach(() => {
    capabilitiesRef.current = {
      exterior_elements_v1: true,
      roof_zones_v1: true,
      presentation_mode_v1: true,
    ai_render_v1: true,
    }
    Object.defineProperty(window, "innerWidth", {
      value: WIDE,
      configurable: true,
      writable: true,
    })
    useEditorStore.setState({ layout: makeLayout() })
  })
  afterEach(() => {
    Object.defineProperty(window, "innerWidth", {
      value: WIDE,
      configurable: true,
      writable: true,
    })
    cleanup()
  })

  it("renders secondary tools inline on a wide (desktop) viewport (no More)", () => {
    Object.defineProperty(window, "innerWidth", { value: WIDE, configurable: true, writable: true })
    renderToolbar()
    expect(screen.queryByTestId("editor-toolbar-more")).toBeNull()
    expect(screen.getByLabelText("Tambah zona atap")).toBeTruthy()
    expect(screen.getByLabelText("Tambah elemen eksterior")).toBeTruthy()
  })

  it("toggles the global roof-zone visibility and reveal via toolbar buttons", () => {
    Object.defineProperty(window, "innerWidth", { value: WIDE, configurable: true, writable: true })
    renderToolbar()

    expect(useEditorStore.getState().showRoofZones).toBe(true)
    fireEvent.click(screen.getByLabelText("Tampilkan area atap: aktif"))
    expect(useEditorStore.getState().showRoofZones).toBe(false)

    expect(useEditorStore.getState().showHiddenRoofZones).toBe(false)
    fireEvent.click(screen.getByLabelText("Tampilkan zona atap tersembunyi: mati"))
    expect(useEditorStore.getState().showHiddenRoofZones).toBe(true)
  })

  it("reveals hidden exterior elements via the Eye toggle (dead-end escape hatch)", () => {
    Object.defineProperty(window, "innerWidth", { value: WIDE, configurable: true, writable: true })
    useEditorStore.getState().setShowHiddenExteriorElements(false)
    renderToolbar()

    fireEvent.click(screen.getByLabelText("Tampilkan tersembunyi: mati"))
    expect(useEditorStore.getState().showHiddenExteriorElements).toBe(true)

    fireEvent.click(screen.getByLabelText("Tampilkan tersembunyi: aktif"))
    expect(useEditorStore.getState().showHiddenExteriorElements).toBe(false)
  })

  it("collapses secondary tools into the More dropdown on a narrow (tablet) viewport", () => {
    Object.defineProperty(window, "innerWidth", { value: NARROW, configurable: true, writable: true })
    renderToolbar()

    // Sekunder tak lagi inline — hanya tombol More yang tampil.
    const more = screen.getByTestId("editor-toolbar-more")
    expect(more).toBeTruthy()
    expect(screen.queryByLabelText("Tambah zona atap")).toBeNull()

    // Buka More (Radix merespons pointerDown) → submenu atap/eksterior muncul.
    fireEvent.pointerDown(more)
    expect(screen.getByText("Tambah zona atap")).toBeTruthy()
    expect(screen.getByText("Tambah elemen eksterior")).toBeTruthy()
  })

  it("lets a toggle inside the More dropdown update the store", () => {
    Object.defineProperty(window, "innerWidth", { value: NARROW, configurable: true, writable: true })
    renderToolbar()
    fireEvent.pointerDown(screen.getByTestId("editor-toolbar-more"))

    expect(useEditorStore.getState().showDimensions).toBe(false)
    fireEvent.click(screen.getByText(/^Dimensi mati$/))
    expect(useEditorStore.getState().showDimensions).toBe(true)
  })
})

describe("EditorToolbar responsive compact mode (height overflow)", () => {
  // Bug: toolbar yang lebih tinggi dari viewport tidak menciut ke More di
  // desktop LEBAR — compact lama hanya dipicu oleh lebar sempit (<1024px),
  // bukan oleh tinggi konten yang sebenarnya melebihi window pendek.
  const WIDE = 1280
  let originalResizeObserver: typeof ResizeObserver | undefined
  let originalRectFn: typeof HTMLElement.prototype.getBoundingClientRect

  beforeEach(() => {
    capabilitiesRef.current = {
      exterior_elements_v1: true,
      roof_zones_v1: true,
      presentation_mode_v1: true,
    ai_render_v1: true,
    }
    Object.defineProperty(window, "innerWidth", { value: WIDE, configurable: true, writable: true })
    Object.defineProperty(window, "innerHeight", { value: 500, configurable: true, writable: true })
    useEditorStore.setState({ layout: makeLayout() })

    originalResizeObserver = window.ResizeObserver
    // jsdom tidak mengimplementasikan ResizeObserver — stub no-op cukup karena
    // pengukuran awal (di dalam useLayoutEffect, bukan callback observer)
    // sudah memicu compact lewat scrollHeight/getBoundingClientRect di bawah.
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver

    originalRectFn = HTMLElement.prototype.getBoundingClientRect
    // Toolbar "dirender" pada top=0 dengan tinggi (scrollHeight) yang jauh
    // melebihi innerHeight=500 → available space << konten sebenarnya.
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {} }
    }
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        return 900
      },
    })
  })

  afterEach(() => {
    Object.defineProperty(window, "innerWidth", { value: WIDE, configurable: true, writable: true })
    Object.defineProperty(window, "innerHeight", { value: 768, configurable: true, writable: true })
    window.ResizeObserver = originalResizeObserver as typeof ResizeObserver
    HTMLElement.prototype.getBoundingClientRect = originalRectFn
    Reflect.deleteProperty(HTMLElement.prototype, "scrollHeight")
    cleanup()
  })

  it("collapses to the More dropdown on a WIDE viewport when toolbar content is taller than the window", () => {
    renderToolbar()
    expect(screen.getByTestId("editor-toolbar-more")).toBeTruthy()
    expect(screen.queryByLabelText("Tambah zona atap")).toBeNull()
  })
})
