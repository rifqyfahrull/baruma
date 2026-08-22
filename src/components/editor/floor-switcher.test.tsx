import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react"

vi.mock("next/navigation", () => ({
  usePathname: () => "/app/projects/p1/editor",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useParams: () => ({ projectId: "p1" }),
}))

const toast = vi.hoisted(() => ({
  info: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}))
vi.mock("sonner", () => ({ toast }))

import { FloorSwitcher } from "./floor-switcher"
import { useEditorStore, ROOF_LAYER_ID } from "@/stores/editor-store"
import { sampleSite } from "@/test-utils/fixtures"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ConfirmDialogProvider } from "@/components/ui/confirm-dialog"
import type { DesignLayout } from "@/types"

// jsdom tidak mengimplementasikan ResizeObserver — Radix Popper (dipakai
// DropdownMenuContent/SubContent & Tooltip) butuh ini saat konten terbuka.
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

function twoFloorLayout(): DesignLayout {
  return {
    id: "l", projectId: "p", versionId: "v",
    floors: [
      { id: "f1", level: 1, name: "Lantai 1", heightM: 3 },
      { id: "f2", level: 2, name: "Lantai 2", heightM: 3 },
    ],
    rooms: [
      { id: "a1", floorId: "f1", name: "A1", type: "ruang_tamu", x: 0, y: 0, width: 6, depth: 4, areaM2: 24 },
      { id: "b1", floorId: "f2", name: "B1", type: "kamar_tidur", x: 0, y: 0, width: 3, depth: 4, areaM2: 12 },
    ],
    walls: [], openings: [], stairs: [], pools: [],
    validation: { passed: true, issues: [] },
  }
}

function renderSwitcher() {
  return render(
    <TooltipProvider>
      <ConfirmDialogProvider>
        <FloorSwitcher />
      </ConfirmDialogProvider>
    </TooltipProvider>
  )
}

/** Buka menu "Aksi lantai" (⋯) — trigger dropdown Radix butuh pointerdown. */
function openActionsMenu() {
  fireEvent.pointerDown(screen.getByLabelText("Aksi lantai"), { button: 0, pointerId: 1 })
}

describe("FloorSwitcher — SurfaceSwitcher", () => {
  beforeEach(() => {
    useEditorStore.getState().loadLayout(twoFloorLayout(), sampleSite, [])
    useEditorStore.getState().setSelectedFloor("f1")
  })
  afterEach(() => cleanup())

  it("prepends the [2D|3D] surface switcher to the bar", () => {
    renderSwitcher()
    expect(screen.getByTestId("surface-switcher")).toBeTruthy()
    expect(screen.getByTestId("surface-switcher-2d")).toBeTruthy()
    expect(screen.getByTestId("surface-switcher-3d")).toBeTruthy()
  })
})

describe("FloorSwitcher — Samakan footprint (⋯ menu)", () => {
  beforeEach(() => {
    useEditorStore.getState().loadLayout(twoFloorLayout(), sampleSite, [])
    useEditorStore.getState().setSelectedFloor("f2")
    toast.info.mockClear()
    toast.success.mockClear()
  })
  afterEach(() => cleanup())

  it("renders the ⋯ actions menu only when more than one floor exists", () => {
    renderSwitcher()
    expect(screen.getByLabelText("Aksi lantai")).toBeTruthy()
  })

  it("aligns the active floor to the selected reference floor via the submenu, and toasts a summary", async () => {
    renderSwitcher()
    openActionsMenu()
    const subTrigger = await screen.findByText("Samakan footprint")
    fireEvent.click(subTrigger)
    const item = await screen.findByText("Samakan dengan Lantai 1")
    fireEvent.click(item)

    const b1 = useEditorStore.getState().layout!.rooms.find((rr) => rr.id === "b1")!
    expect(b1.width).toBe(6)
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1))
    expect(toast.success.mock.calls[0][0]).toContain("Samakan footprint ke Lantai 1")
  })

  it("tab Atap berpindah ke layer denah atap dan menyembunyikan aksi lantai", () => {
    renderSwitcher()
    fireEvent.click(screen.getByTestId("floor-tab-atap"))
    expect(useEditorStore.getState().selectedFloorId).toBe(ROOF_LAYER_ID)
    cleanup()
    renderSwitcher()
    expect(screen.queryByLabelText("Aksi lantai")).toBeNull()
  })
})

describe("FloorSwitcher — tombol + Mezzanine (E7, via ⋯ menu)", () => {
  beforeEach(() => {
    useEditorStore.getState().loadLayout(twoFloorLayout(), sampleSite, [])
    useEditorStore.getState().setSelectedFloor("f1")
  })
  afterEach(() => cleanup())

  it("menambah mezzanine saat item menu diklik", async () => {
    renderSwitcher()
    openActionsMenu()
    const item = await screen.findByTestId("add-mezzanine")
    fireEvent.click(item)
    const floors = useEditorStore.getState().layout!.floors
    expect(floors[1].kind).toBe("mezzanine")
    expect(useEditorStore.getState().selectedFloorId).toBe(floors[1].id)
  })

  it("sembunyi bila lantai aktif sudah ber-mezzanine / mezzanine / layer Atap", async () => {
    const mezzId = useEditorStore.getState().addMezzanine("f1")!
    useEditorStore.getState().setSelectedFloor("f1")
    renderSwitcher()
    openActionsMenu()
    expect(screen.queryByTestId("add-mezzanine")).toBeNull()
    cleanup()

    useEditorStore.getState().setSelectedFloor(mezzId)
    renderSwitcher()
    openActionsMenu()
    expect(screen.queryByTestId("add-mezzanine")).toBeNull()
    cleanup()

    useEditorStore.getState().setSelectedFloor(ROOF_LAYER_ID)
    renderSwitcher()
    expect(screen.queryByLabelText("Aksi lantai")).toBeNull()
    cleanup()

    useEditorStore.getState().setSelectedFloor("f2")
    renderSwitcher()
    openActionsMenu()
    expect(await screen.findByTestId("add-mezzanine")).toBeTruthy()
  })

  it("kontrak lama utuh: tab Atap tetap ada", () => {
    renderSwitcher()
    expect(screen.getByTestId("floor-tab-atap")).toBeTruthy()
  })
})

describe("FloorSwitcher — hapus lantai via useConfirm (bukan window.confirm)", () => {
  beforeEach(() => {
    useEditorStore.getState().loadLayout(twoFloorLayout(), sampleSite, [])
    useEditorStore.getState().setSelectedFloor("f2")
  })
  afterEach(() => cleanup())

  it("membuka AlertDialog dan TIDAK menghapus lantai saat Batal diklik", async () => {
    renderSwitcher()
    openActionsMenu()
    const removeItem = await screen.findByText("Hapus lantai aktif")
    fireEvent.click(removeItem)

    expect(await screen.findByText("Hapus Lantai 2?")).toBeTruthy()
    fireEvent.click(screen.getByText("Batal"))

    await waitFor(() =>
      expect(screen.queryByText("Hapus Lantai 2?")).toBeNull()
    )
    expect(
      useEditorStore.getState().layout!.floors.some((f) => f.id === "f2")
    ).toBe(true)
  })

  it("menghapus lantai HANYA setelah tombol konfirmasi (destructive) diklik", async () => {
    renderSwitcher()
    openActionsMenu()
    const removeItem = await screen.findByText("Hapus lantai aktif")
    fireEvent.click(removeItem)

    const confirmBtn = await screen.findByText("Hapus")
    expect(
      useEditorStore.getState().layout!.floors.some((f) => f.id === "f2")
    ).toBe(true)
    fireEvent.click(confirmBtn)

    await waitFor(() =>
      expect(
        useEditorStore.getState().layout!.floors.some((f) => f.id === "f2")
      ).toBe(false)
    )
  })
})
