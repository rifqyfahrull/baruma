import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cleanup, render, screen, fireEvent } from "@testing-library/react"

import { FloorSwitcher } from "./floor-switcher"
import { useEditorStore, ROOF_LAYER_ID } from "@/stores/editor-store"
import { sampleSite } from "@/test-utils/fixtures"
import type { DesignLayout } from "@/types"

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

describe("FloorSwitcher — Samakan footprint", () => {
  beforeEach(() => {
    vi.spyOn(window, "alert").mockImplementation(() => {})
    useEditorStore.getState().loadLayout(twoFloorLayout(), sampleSite, [])
    useEditorStore.getState().setSelectedFloor("f2")
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("renders a Samakan control only when more than one floor exists", () => {
    render(<FloorSwitcher />)
    expect(screen.getByLabelText("Samakan footprint")).toBeTruthy()
  })

  it("aligns the active floor to the selected reference floor via the dropdown", () => {
    render(<FloorSwitcher />)
    fireEvent.pointerDown(screen.getByLabelText("Samakan footprint"))
    fireEvent.click(screen.getByText("Samakan dengan Lantai 1"))
    const b1 = useEditorStore.getState().layout!.rooms.find((rr) => rr.id === "b1")!
    expect(b1.width).toBe(6)
  })

  it("tab Atap berpindah ke layer denah atap dan menyembunyikan kontrol lantai", () => {
    render(<FloorSwitcher />)
    fireEvent.click(screen.getByTestId("floor-tab-atap"))
    expect(useEditorStore.getState().selectedFloorId).toBe(ROOF_LAYER_ID)
    cleanup()
    render(<FloorSwitcher />)
    // Samakan footprint & hapus lantai tidak relevan utk layer Atap.
    expect(screen.queryByLabelText("Samakan footprint")).toBeNull()
    expect(screen.queryByLabelText("Hapus lantai aktif")).toBeNull()
  })
})

describe("FloorSwitcher — tombol + Mezzanine (E7)", () => {
  beforeEach(() => {
    vi.spyOn(window, "alert").mockImplementation(() => {})
    useEditorStore.getState().loadLayout(twoFloorLayout(), sampleSite, [])
    useEditorStore.getState().setSelectedFloor("f1")
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("tampil di lantai reguler dan menambah mezzanine saat diklik", () => {
    render(<FloorSwitcher />)
    fireEvent.click(screen.getByTestId("add-mezzanine"))
    const floors = useEditorStore.getState().layout!.floors
    expect(floors[1].kind).toBe("mezzanine")
    expect(useEditorStore.getState().selectedFloorId).toBe(floors[1].id)
  })

  it("sembunyi bila lantai aktif sudah ber-mezzanine / mezzanine / layer Atap", () => {
    const mezzId = useEditorStore.getState().addMezzanine("f1")!
    // Induk yang sudah ber-mezzanine → tombol hilang.
    useEditorStore.getState().setSelectedFloor("f1")
    render(<FloorSwitcher />)
    expect(screen.queryByTestId("add-mezzanine")).toBeNull()
    cleanup()
    // Lantai mezzanine aktif → hilang.
    useEditorStore.getState().setSelectedFloor(mezzId)
    render(<FloorSwitcher />)
    expect(screen.queryByTestId("add-mezzanine")).toBeNull()
    cleanup()
    // Layer Atap → hilang.
    useEditorStore.getState().setSelectedFloor(ROOF_LAYER_ID)
    render(<FloorSwitcher />)
    expect(screen.queryByTestId("add-mezzanine")).toBeNull()
    cleanup()
    // Lantai reguler lain tanpa mezzanine → tetap tampil.
    useEditorStore.getState().setSelectedFloor("f2")
    render(<FloorSwitcher />)
    expect(screen.getByTestId("add-mezzanine")).toBeTruthy()
  })

  it("kontrak lama utuh: tab Atap + kontrol aria lama tetap ada", () => {
    render(<FloorSwitcher />)
    expect(screen.getByTestId("floor-tab-atap")).toBeTruthy()
    expect(screen.getByLabelText("Tambah lantai")).toBeTruthy()
    expect(screen.getByLabelText("Hapus lantai aktif")).toBeTruthy()
    expect(screen.getByLabelText("Samakan footprint")).toBeTruthy()
  })
})
