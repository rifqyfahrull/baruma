import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cleanup, render, screen, fireEvent } from "@testing-library/react"

import type { FeatureCapabilities } from "@/lib/features"
import type { Project } from "@/types"

const capabilitiesRef: { current: FeatureCapabilities } = {
  current: {
    exterior_elements_v1: true,
    roof_zones_v1: true,
    presentation_mode_v1: true,
  },
}
vi.mock("@/hooks/use-project-capabilities", () => ({
  useProjectCapabilities: () => capabilitiesRef.current,
}))

import { ViewToolbar } from "./view-toolbar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { makeLayout } from "@/test-utils/fixtures"
import { usePreviewStore } from "@/stores/preview-store"

const project = {
  id: "p1",
  name: "Rumah Uji",
  city: "Bandung",
  site: { widthM: 8, depthM: 10, areaM2: 80 },
} as Project

function openViewOptions() {
  render(
    <TooltipProvider>
      <ViewToolbar layout={makeLayout()} project={project} />
    </TooltipProvider>
  )
  fireEvent.click(screen.getByLabelText("Opsi tampilan"))
}

describe("ViewToolbar presentation preset gating (roadmap §21)", () => {
  beforeEach(() => {
    capabilitiesRef.current = {
      exterior_elements_v1: true,
      roof_zones_v1: true,
      presentation_mode_v1: true,
    }
  })
  afterEach(() => cleanup())

  it("shows Edit/Presentasi presets when presentation_mode_v1 is enabled", () => {
    openViewOptions()
    expect(screen.getByTestId("render-mode-presentation")).toBeTruthy()
    expect(screen.getByTestId("render-mode-edit")).toBeTruthy()
  })

  it("hides the render mode presets when presentation_mode_v1 is off", () => {
    capabilitiesRef.current = {
      ...capabilitiesRef.current,
      presentation_mode_v1: false,
    }
    openViewOptions()
    expect(screen.queryByTestId("render-mode-presentation")).toBeNull()
    expect(screen.queryByTestId("render-mode-edit")).toBeNull()
  })
})

describe("ViewToolbar clean-mode 2D link", () => {
  beforeEach(() => {
    usePreviewStore.setState({ cleanMode: false })
  })
  afterEach(() => {
    usePreviewStore.setState({ cleanMode: false })
    cleanup()
  })

  it("hides the 2D link in normal mode (ProjectTabs already provides navigation)", () => {
    render(
      <TooltipProvider>
        <ViewToolbar layout={makeLayout()} project={project} />
      </TooltipProvider>
    )
    expect(screen.queryByTestId("clean-mode-2d-link")).toBeNull()
  })

  it("shows a 2D editor link while clean mode hides the project tabs", () => {
    usePreviewStore.getState().setCleanMode(true)
    render(
      <TooltipProvider>
        <ViewToolbar layout={makeLayout()} project={project} />
      </TooltipProvider>
    )
    const link = screen.getByTestId("clean-mode-2d-link")
    expect(link.getAttribute("href")).toBe("/app/projects/p1/editor")
  })
})

describe("ViewToolbar responsive compact mode (More dropdown)", () => {
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

  it("renders all secondary controls inline on a wide (desktop) viewport (no More)", () => {
    Object.defineProperty(window, "innerWidth", { value: WIDE, configurable: true, writable: true })
    render(
      <TooltipProvider>
        <ViewToolbar layout={makeLayout()} project={project} />
      </TooltipProvider>
    )
    expect(screen.queryByTestId("view-toolbar-more")).toBeNull()
    expect(screen.getByLabelText("Opsi tampilan")).toBeTruthy()
    expect(screen.getByTestId("night-mode-toggle")).toBeTruthy()
  })

  it("collapses secondary controls into the More dropdown on a narrow (tablet) viewport", () => {
    Object.defineProperty(window, "innerWidth", { value: NARROW, configurable: true, writable: true })
    render(
      <TooltipProvider>
        <ViewToolbar layout={makeLayout()} project={project} />
      </TooltipProvider>
    )

    // Sekunder tak lagi inline — hanya tombol More yang tampil.
    const more = screen.getByTestId("view-toolbar-more")
    expect(more).toBeTruthy()
    expect(screen.queryByLabelText("Opsi tampilan")).toBeNull()
    expect(screen.queryByTestId("night-mode-toggle")).toBeNull()

    // Buka More (Radix DropdownMenu menanggapi pointerDown) → kontrol sekunder
    // yang disembunyikan kini bisa diakses.
    fireEvent.pointerDown(more)
    expect(screen.getByLabelText("Opsi tampilan")).toBeTruthy()
    expect(screen.getByTestId("night-mode-toggle")).toBeTruthy()

    // Toggle di dalam dropdown tetap berfungsi.
    const night = screen.getByTestId("night-mode-toggle")
    fireEvent.click(night)
    expect(night.getAttribute("aria-pressed")).toBe("true")
  })
})
