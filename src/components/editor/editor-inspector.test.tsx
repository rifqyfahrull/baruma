import { describe, it, expect, afterEach, beforeEach } from "vitest"
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react"

import { EditorInspector } from "@/components/editor/editor-inspector"
import { openingDefaultsForKind } from "@/lib/constants"
import { makeRoofZone, makeSegmentElement } from "@/lib/exterior/factories"
import { useEditorStore, ROOF_LAYER_ID } from "@/stores/editor-store"
import { makeLayout, sampleSite } from "@/test-utils/fixtures"
import type { DesignLayout } from "@/types"

Element.prototype.scrollIntoView ??= function scrollIntoView() {}
Element.prototype.hasPointerCapture ??= function hasPointerCapture() {
  return false
}
Element.prototype.setPointerCapture ??= function setPointerCapture() {}
Element.prototype.releasePointerCapture ??= function releasePointerCapture() {}
// Radix Slider (section Atap terpadu) butuh ResizeObserver — tak ada di jsdom.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never

/** An 8×8 single-storey layout plus an (empty) rooftop floor. */
function rooftopLayout(): DesignLayout {
  return {
    id: "layout-rt",
    projectId: "proj-test",
    versionId: "v1",
    floors: [
      { id: "floor-1", level: 1, name: "Lantai 1", heightM: 3.2 },
      { id: "floor-rooftop", level: 2, name: "Rooftop", heightM: 0.3 },
    ],
    rooms: [
      { id: "r1", floorId: "floor-1", name: "Ruang", type: "ruang_tamu", x: 0, y: 0, width: 8, depth: 8, areaM2: 64 },
    ],
    walls: [],
    openings: [],
    stairs: [],
    pools: [],
    validation: { passed: true, issues: [] },
  }
}

/** Same 8x8 rooftop layout, plus one boundary_wall segment for exterior-inspector tests. */
function segmentLayout(): DesignLayout {
  return {
    ...rooftopLayout(),
    exteriorElements: [
      makeSegmentElement(
        "boundary_wall",
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { id: "ext-seg-1" },
      ),
    ],
  }
}

afterEach(() => {
  cleanup()
})

describe("EditorInspector — rooftop deck controls", () => {
  it("does NOT show the deck control for a layout without a rooftop floor", () => {
    useEditorStore.getState().loadLayout(makeLayout(), sampleSite, [])
    render(<EditorInspector />)
    expect(screen.queryByText("Deck rooftop")).toBeNull()
    expect(screen.queryByRole("radio", { name: "Deck sebagian" })).toBeNull()
  })

  describe("with a rooftop floor", () => {
    beforeEach(() => {
      useEditorStore.getState().loadLayout(rooftopLayout(), { widthM: 10, depthM: 10 }, [])
    })

    it("shows the deck control, defaulting to 'Deck penuh' (no rooftopArea)", () => {
      render(<EditorInspector />)
      expect(screen.getByText("Deck rooftop")).toBeTruthy()
      expect(screen.getByRole("radio", { name: "Deck penuh" }).getAttribute("aria-checked")).toBe("true")
      expect(screen.getByRole("radio", { name: "Deck sebagian" }).getAttribute("aria-checked")).toBe("false")
      // No inputs while full.
      expect(screen.queryByLabelText("Lebar deck rooftop (meter)")).toBeNull()
    })

    it("selecting 'Deck sebagian' creates a rooftopArea and reveals the 4 inputs + summary", () => {
      render(<EditorInspector />)
      fireEvent.click(screen.getByRole("radio", { name: "Deck sebagian" }))

      const area = useEditorStore.getState().layout!.rooftopArea
      expect(area).toBeDefined()
      // Default = 60% of the 8×8 footprint, centred.
      expect(area).toEqual({ x: 1.6, y: 1.6, width: 4.8, depth: 4.8 })

      expect(screen.getByLabelText("Posisi X deck rooftop (meter)")).toBeTruthy()
      expect(screen.getByLabelText("Posisi Y deck rooftop (meter)")).toBeTruthy()
      expect(screen.getByLabelText("Lebar deck rooftop (meter)")).toBeTruthy()
      expect(screen.getByLabelText("Dalam deck rooftop (meter)")).toBeTruthy()
      // Deck area 4.8×4.8 = 23.04 → 23; roof = 64 - 23 = 41.
      expect(screen.getByText("Deck 23 m²")).toBeTruthy()
      expect(screen.getByText("Atap 41 m²")).toBeTruthy()
    })

    it("editing 'Lebar' and blurring updates the store, re-clamped to the footprint", () => {
      render(<EditorInspector />)
      fireEvent.click(screen.getByRole("radio", { name: "Deck sebagian" }))

      const input = screen.getByLabelText("Lebar deck rooftop (meter)")
      fireEvent.change(input, { target: { value: "999" } })
      fireEvent.blur(input)

      // Clamped to the 8 m footprint width (and x shifted to keep it inside).
      const area = useEditorStore.getState().layout!.rooftopArea!
      expect(area.width).toBe(8)
      expect(area.x + area.width).toBeLessThanOrEqual(8 + 1e-9)
    })

    it("'Deck penuh' clears the rooftopArea and hides the inputs", () => {
      render(<EditorInspector />)
      fireEvent.click(screen.getByRole("radio", { name: "Deck sebagian" }))
      expect(useEditorStore.getState().layout!.rooftopArea).toBeDefined()

      fireEvent.click(screen.getByRole("radio", { name: "Deck penuh" }))
      expect(useEditorStore.getState().layout!.rooftopArea).toBeUndefined()
      expect(screen.queryByLabelText("Lebar deck rooftop (meter)")).toBeNull()
    })
  })
})

describe("EditorInspector — room floor controls", () => {
  it("shows a floor selector for the selected room", () => {
    useEditorStore.getState().loadLayout(rooftopLayout(), { widthM: 10, depthM: 10 }, [])
    useEditorStore.getState().selectObject("r1")

    render(<EditorInspector />)

    expect(screen.getByRole("combobox", { name: "Lantai ruang" })).toBeTruthy()
    expect(screen.getByText("Lantai 1")).toBeTruthy()
  })

  it("moving a room to another floor carries its openings with it", () => {
    const layout: DesignLayout = {
      ...rooftopLayout(),
      openings: [
        {
          id: "op-1",
          floorId: "floor-1",
          wallId: "r1:n",
          type: "window",
          positionM: 1,
          widthM: 1,
          heightM: 1.2,
        },
      ],
    }
    useEditorStore.getState().loadLayout(layout, { widthM: 10, depthM: 10 }, [])

    useEditorStore.getState().updateRoom("r1", { floorId: "floor-rooftop" })

    const state = useEditorStore.getState()
    expect(state.layout?.rooms.find((r) => r.id === "r1")?.floorId).toBe("floor-rooftop")
    expect(state.layout?.openings.find((o) => o.id === "op-1")?.floorId).toBe("floor-rooftop")
  })
})

describe("EditorInspector — cantilever offset controls (CB3)", () => {
  function twoFloorLayout(): DesignLayout {
    return {
      ...rooftopLayout(),
      floors: [
        { id: "floor-1", level: 1, name: "Lantai 1", heightM: 3.2 },
        { id: "floor-2", level: 2, name: "Lantai 2", heightM: 3.2 },
      ],
    }
  }

  it("menampilkan Geser X/Y utk lantai atas + menulis via blur", () => {
    useEditorStore.getState().loadLayout(twoFloorLayout(), sampleSite, [])
    act(() => useEditorStore.getState().setSelectedFloor("floor-2"))
    render(<EditorInspector />)

    const x = screen.getByLabelText("Geser X (m, cantilever)")
    expect(x).toBeTruthy()
    expect(screen.getByLabelText("Geser Y (m, cantilever)")).toBeTruthy()
    // id CB3 sesuai spec.
    expect((x as HTMLInputElement).id).toBe("floor-offset-x-input")

    fireEvent.change(x, { target: { value: "1.2" } })
    fireEvent.blur(x)
    expect(
      useEditorStore.getState().layout!.floors.find((f) => f.id === "floor-2")!
        .offsetM,
    ).toEqual({ dx: 1.2, dy: 0 })
  })

  it("tidak menampilkan Geser X/Y utk lantai terbawah", () => {
    useEditorStore.getState().loadLayout(twoFloorLayout(), sampleSite, [])
    act(() => useEditorStore.getState().setSelectedFloor("floor-1"))
    render(<EditorInspector />)
    expect(screen.queryByLabelText("Geser X (m, cantilever)")).toBeNull()
  })

  it("tidak menampilkan di layer Atap", () => {
    useEditorStore.getState().loadLayout(twoFloorLayout(), sampleSite, [])
    act(() => useEditorStore.getState().setSelectedFloor(ROOF_LAYER_ID))
    render(<EditorInspector />)
    expect(screen.queryByLabelText("Geser X (m, cantilever)")).toBeNull()
  })
})

describe("EditorInspector — roof zone controls", () => {
  it("splits the selected roof zone from the inspector", () => {
    const layout: DesignLayout = {
      ...makeLayout(),
      roofZones: [
        makeRoofZone("pelana", 4, 4, {
          id: "roofz-main",
          widthM: 6,
          depthM: 4,
          materialId: "metal",
        }),
      ],
    }
    useEditorStore.getState().loadLayout(layout, sampleSite, [])
    useEditorStore.getState().selectObject("roofz-main")

    render(<EditorInspector />)
    fireEvent.click(screen.getByRole("button", { name: "Kiri / kanan" }))

    const zones = useEditorStore.getState().layout!.roofZones!
    expect(zones).toHaveLength(2)
    expect(zones.every((z) => z.type === "pelana")).toBe(true)
    expect(zones.every((z) => z.materialId === "metal")).toBe(true)
  })

  it("hides the selected roof zone via the inspector toggle", () => {
    const layout: DesignLayout = {
      ...makeLayout(),
      roofZones: [
        makeRoofZone("pelana", 4, 4, {
          id: "roofz-main",
          widthM: 6,
          depthM: 4,
        }),
      ],
    }
    useEditorStore.getState().loadLayout(layout, sampleSite, [])
    useEditorStore.getState().selectObject("roofz-main")

    render(<EditorInspector />)
    expect(useEditorStore.getState().layout!.roofZones![0].hidden).toBeUndefined()
    fireEvent.click(screen.getByLabelText("Sembunyikan zona"))
    expect(useEditorStore.getState().layout!.roofZones![0].hidden).toBe(true)
  })
})

describe("EditorInspector — exterior costing controls", () => {
  it("shows exterior validation feedback for the selected semantic element", () => {
    const layout: DesignLayout = {
      ...makeLayout(),
      exteriorElements: [
        {
          id: "portal-review",
          kind: "portal_frame",
          structuralRole: "secondary_unverified",
          x: 2,
          y: 2,
          widthM: 3,
          heightM: 3,
          memberSizeM: 0.25,
        },
      ],
    }
    useEditorStore.getState().loadLayout(layout, sampleSite, [])
    useEditorStore.getState().selectObject("portal-review")

    render(<EditorInspector />)

    expect(screen.getByTestId("exterior-validation-feedback").textContent).toContain(
      "perlu review engineer",
    )
  })

  it("shows the catalog RAB policy and active rate for native exterior elements", () => {
    const layout: DesignLayout = {
      ...makeLayout(),
      exteriorElements: [
        {
          id: "drive-1",
          kind: "driveway",
          structuralRole: "non_structural",
          points: [
            { x: 0, y: 0 },
            { x: 3, y: 0 },
            { x: 3, y: 2 },
            { x: 0, y: 2 },
          ],
          thicknessM: 0.12,
        },
      ],
    }
    useEditorStore.getState().loadLayout(layout, sampleSite, [])
    useEditorStore.getState().selectObject("drive-1")

    render(<EditorInspector />)

    expect(screen.getByText("Kebijakan RAB")).toBeTruthy()
    expect(screen.getByTestId("exterior-costing-policy")).toBeTruthy()
    expect(screen.getByText(/Rate aktif: ext-driveway-v1/)).toBeTruthy()
  })

  it("locks custom GLB assets out of automatic RAB pricing", () => {
    const layout: DesignLayout = {
      ...makeLayout(),
      exteriorElements: [
        {
          id: "asset-1",
          kind: "asset",
          label: "Facade custom",
          structuralRole: "non_structural",
          x: 2,
          y: 2,
          widthM: 4,
          depthM: 0.5,
          heightM: 3,
          model: { modelUrl: "/facade.glb", fitMode: "fit_envelope" },
        },
      ],
    }
    useEditorStore.getState().loadLayout(layout, sampleSite, [])
    useEditorStore.getState().selectObject("asset-1")

    render(<EditorInspector />)

    expect(screen.getByText(/Custom GLB belum diberi harga otomatis/)).toBeTruthy()
    expect(screen.getByTestId("exterior-costing-policy").hasAttribute("disabled")).toBe(true)
  })

  it("shows explicit model axis/fit contract and performance warnings for custom GLB assets", () => {
    const layout: DesignLayout = {
      ...makeLayout(),
      exteriorElements: [
        {
          id: "asset-heavy",
          kind: "asset",
          label: "Heavy facade",
          structuralRole: "non_structural",
          x: 2,
          y: 2,
          widthM: 4,
          depthM: 0.5,
          heightM: 3,
          model: {
            modelUrl: "/heavy-facade.glb",
            fitMode: "fit_envelope",
            upAxis: "y",
            frontAxis: "z+",
            performance: {
              triangleCount: 900_000,
              drawCallCount: 420,
            },
          },
        },
      ],
    }
    useEditorStore.getState().loadLayout(layout, sampleSite, [])
    useEditorStore.getState().selectObject("asset-heavy")

    render(<EditorInspector />)

    expect(screen.getByText("Kontrak Model 3D")).toBeTruthy()
    expect(screen.getByTestId("exterior-model-fit")).toBeTruthy()
    expect(screen.getByTestId("exterior-model-up-axis")).toBeTruthy()
    expect(screen.getByTestId("exterior-model-front-axis")).toBeTruthy()
    expect(screen.getByTestId("exterior-model-performance-warning").textContent).toContain("Triangle")
    expect(screen.getByTestId("exterior-model-performance-warning").textContent).toContain("Draw call")
  })
})

describe("EditorInspector — sanitation controls", () => {
  it("allows a selected soakwell/resapan to be removed from the layout", () => {
    const layout: DesignLayout = {
      ...makeLayout(),
      sanitation: {
        soakwell: {
          id: "sw-1",
          x: 1,
          y: 1,
          widthM: 1.2,
          lengthM: 1.2,
          depthM: 2,
        },
      },
    }
    useEditorStore.getState().loadLayout(layout, sampleSite, [])
    useEditorStore.getState().selectObject("sw-1")

    render(<EditorInspector />)
    expect(screen.getByText("Sumur Resapan")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Hapus resapan" }))

    expect(useEditorStore.getState().layout?.sanitation?.soakwell).toBeUndefined()
    expect(useEditorStore.getState().selectedObjectId).toBeNull()
  })
})

describe("EditorInspector — opening detail controls", () => {
  it("maps modern opening kinds to architectural metadata", () => {
    expect(openingDefaultsForKind("curtain_wall")).toMatchObject({
      kind: "curtain_wall",
      type: "window",
      purpose: "vision",
      operation: "fixed",
      frameMaterial: "frameless",
      privacyLevel: "low",
      widthM: 2.4,
      heightM: 2.7,
      sillHeightM: 0,
      headHeightM: 2.7,
    })
  })

  it("renders opening detail controls and writes scalar settings", () => {
    const layout: DesignLayout = {
      ...makeLayout(),
      openings: [
        {
          id: "op-1",
          floorId: "floor-1",
          wallId: "r1:n",
          type: "window",
          kind: "sliding_window",
          purpose: "ventilation",
          operation: "sliding",
          frameMaterial: "aluminium",
          privacyLevel: "medium",
          shading: "overhang",
          positionM: 0.8,
          widthM: 1.2,
          heightM: 1.2,
          sillHeightM: 0.8,
          headHeightM: 2,
        },
      ],
    }
    useEditorStore.getState().loadLayout(layout, sampleSite, [])
    useEditorStore.getState().selectObject("op-1")

    render(<EditorInspector />)

    // Inspector terpadu (registry) — label kini SAMA persis dgn panel 3D.
    expect(screen.getByText("Sliding window")).toBeTruthy()
    expect(screen.getByLabelText("Tipe bukaan")).toBeTruthy()
    expect(screen.getByLabelText("Cara buka")).toBeTruthy()
    expect(screen.getByLabelText("Material frame")).toBeTruthy()
    // Field superset dari sisi 3D kini hadir di 2D juga.
    expect(screen.getByLabelText("Warna kusen custom")).toBeTruthy()
    expect(screen.getByTestId("opening-pick-model")).toBeTruthy()

    const width = screen.getByLabelText("Lebar (m)")
    fireEvent.change(width, { target: { value: "1.8" } })
    fireEvent.blur(width)

    const note = screen.getByLabelText("Catatan bukaan")
    fireEvent.change(note, { target: { value: "Bukaan menghadap taman belakang" } })
    fireEvent.blur(note)

    const opening = useEditorStore.getState().layout?.openings[0]
    expect(opening?.widthM).toBe(1.8)
    expect(opening?.notes).toBe("Bukaan menghadap taman belakang")
  })
})

describe("EditorInspector — stair riser control + SNI comfort", () => {
  it("ruang tangga: input riser + peringatan kenyamanan SNI tampil", () => {
    // layout dengan room tangga 2.5×0.7 (lebar 0.7 → danger lebar) terseleksi
    const layout = makeLayout()
    const stair = {
      ...layout.rooms[0],
      id: "room-stair",
      name: "Tangga",
      type: "tangga" as const,
      width: 2.5,
      depth: 0.7,
    }
    useEditorStore.setState({
      layout: { ...layout, rooms: [...layout.rooms, stair] },
    })
    // Seleksi lewat jalur resmi supaya `selected` (EntityRef) ikut ter-set —
    // setState mentah meninggalkan ref basi dari test sebelumnya.
    useEditorStore.getState().selectObject("room-stair")
    render(<EditorInspector />)
    expect(screen.getByLabelText(/Tinggi tanjakan/i)).toBeTruthy()
    expect(screen.getByText(/minimal 80 cm/i)).toBeTruthy()
  })
})

describe("stair shape controls (Gelombang 2)", () => {
  it("ruang tangga: pilihan bentuk Lurus/L/U dan arah belok memanggil updateRoom", () => {
    const layout = makeLayout()
    const stair = { ...layout.rooms[0], id: "room-stair", name: "Tangga",
      type: "tangga" as const, width: 3, depth: 2.5 }
    useEditorStore.setState({
      layout: { ...layout, rooms: [...layout.rooms, stair] },
    })
    // Seleksi lewat jalur resmi supaya `selected` (EntityRef) ikut ter-set —
    // setState mentah meninggalkan ref basi dari test sebelumnya.
    useEditorStore.getState().selectObject("room-stair")
    render(<EditorInspector />)
    fireEvent.click(screen.getByRole("button", { name: "Bentuk L" }))
    expect(
      useEditorStore.getState().layout!.rooms.find((r) => r.id === "room-stair")!.stairShape
    ).toBe("L")
    fireEvent.click(screen.getByRole("button", { name: "Belok kiri" }))
    expect(
      useEditorStore.getState().layout!.rooms.find((r) => r.id === "room-stair")!.stairTurn
    ).toBe("kiri")
  })
})

describe("EditorInspector — exterior segment fields", () => {
  beforeEach(() => {
    useEditorStore.getState().loadLayout(segmentLayout(), { widthM: 10, depthM: 10 }, [])
    useEditorStore.getState().selectObject("ext-seg-1")
  })

  it("shows a Panjang (m) field pre-filled with the segment's current length", () => {
    render(<EditorInspector />)
    const input = screen.getByLabelText("Panjang (m)") as HTMLInputElement
    expect(input.value).toBe("3.00")
  })

  it("committing a new length extends the segment along its existing direction, keeping start fixed", () => {
    render(<EditorInspector />)
    const input = screen.getByLabelText("Panjang (m)")
    fireEvent.change(input, { target: { value: "5" } })
    fireEvent.blur(input)

    const segment = useEditorStore
      .getState()
      .layout!.exteriorElements!.find((el) => el.id === "ext-seg-1") as {
      start: { x: number; y: number }
      end: { x: number; y: number }
    }
    expect(segment.start).toEqual({ x: 0, y: 0 })
    expect(segment.end).toEqual({ x: 5, y: 0 })
  })

  it("ignores an invalid (zero) length and leaves the segment unchanged", () => {
    render(<EditorInspector />)
    const input = screen.getByLabelText("Panjang (m)")
    fireEvent.change(input, { target: { value: "0" } })
    fireEvent.blur(input)

    const segment = useEditorStore
      .getState()
      .layout!.exteriorElements!.find((el) => el.id === "ext-seg-1") as {
      start: { x: number; y: number }
      end: { x: number; y: number }
    }
    expect(segment.start).toEqual({ x: 0, y: 0 })
    expect(segment.end).toEqual({ x: 3, y: 0 })
  })

  it("does not silently revert the segment after its geometry changes externally (e.g. a canvas drag)", () => {
    render(<EditorInspector />)

    act(() => {
      useEditorStore.getState().updateExteriorElement("ext-seg-1", { end: { x: 6, y: 0 } })
    })

    const input = screen.getByLabelText("Panjang (m)") as HTMLInputElement
    expect(input.value).toBe("6.00")

    // Blur without changing anything — must NOT revert the now-6m segment.
    fireEvent.blur(input)

    const segment = useEditorStore
      .getState()
      .layout!.exteriorElements!.find((el) => el.id === "ext-seg-1") as {
      start: { x: number; y: number }
      end: { x: number; y: number }
    }
    expect(segment.end).toEqual({ x: 6, y: 0 })
  })

  it("repairs a pre-existing zero-length (legacy) segment by extending it in the +x direction", () => {
    useEditorStore.getState().loadLayout(
      {
        ...rooftopLayout(),
        exteriorElements: [
          makeSegmentElement("boundary_wall", { x: 2, y: 2 }, { x: 2, y: 2 }, { id: "ext-seg-degenerate" }),
        ],
      },
      { widthM: 10, depthM: 10 },
      [],
    )
    useEditorStore.getState().selectObject("ext-seg-degenerate")
    render(<EditorInspector />)

    const input = screen.getByLabelText("Panjang (m)")
    fireEvent.change(input, { target: { value: "4" } })
    fireEvent.blur(input)

    const segment = useEditorStore
      .getState()
      .layout!.exteriorElements!.find((el) => el.id === "ext-seg-degenerate") as {
      start: { x: number; y: number }
      end: { x: number; y: number }
    }
    expect(segment.start).toEqual({ x: 2, y: 2 })
    expect(segment.end).toEqual({ x: 6, y: 2 })
  })
})

describe("EditorInspector — daftar Elemen eksterior (BUG 2: jalan keluar selalu bekerja)", () => {
  it("tak tampil sama sekali saat tak ada elemen eksterior di layout", () => {
    useEditorStore.getState().loadLayout(makeLayout(), sampleSite, [])
    render(<EditorInspector />)
    expect(screen.queryByTestId("exterior-elements-section")).toBeNull()
  })

  it("mendaftar elemen sangat tipis/diagonal yang gagal di-hit-test di kanvas, dan bisa memilihnya", () => {
    useEditorStore.getState().loadLayout(
      {
        ...rooftopLayout(),
        exteriorElements: [
          makeSegmentElement(
            "fence",
            { x: 0, y: 0 },
            { x: 3, y: 2.1 },
            { id: "ext-tipis", thicknessM: 0.05 },
          ),
        ],
      },
      { widthM: 10, depthM: 10 },
      [],
    )
    render(<EditorInspector />)

    const section = screen.getByTestId("exterior-elements-section")
    expect(section.textContent).toContain("Pagar")

    fireEvent.click(screen.getByText("Pagar"))
    expect(useEditorStore.getState().selected).toEqual({ kind: "exterior", id: "ext-tipis" })
  })

  it("menghapus elemen langsung dari daftar tanpa perlu menyeleksinya lebih dulu — elemen tak lagi jadi sampah permanen", () => {
    useEditorStore.getState().loadLayout(
      {
        ...rooftopLayout(),
        exteriorElements: [
          makeSegmentElement(
            "fence",
            { x: 0, y: 0 },
            { x: 0.03, y: 0.04 },
            { id: "ext-nyaris-nol" },
          ),
        ],
      },
      { widthM: 10, depthM: 10 },
      [],
    )
    render(<EditorInspector />)

    fireEvent.click(screen.getByLabelText(/Hapus/))
    expect(useEditorStore.getState().layout!.exteriorElements).toBeUndefined()
    expect(screen.queryByTestId("exterior-elements-section")).toBeNull()
  })
})

describe("EditorInspector — tinggi lantai aktif (Fase D5)", () => {
  it("NumField tinggi lantai menulis updateFloor; tak tampil di layer Atap", () => {
    useEditorStore.getState().loadLayout(rooftopLayout(), { widthM: 10, depthM: 10 }, [])
    useEditorStore.getState().setSelectedFloor("floor-1")
    const { unmount } = render(<EditorInspector />)
    const input = screen.getByLabelText(/Tinggi lantai/)
    fireEvent.change(input, { target: { value: "3.4" } })
    fireEvent.blur(input)
    expect(useEditorStore.getState().layout!.floors[0].heightM).toBe(3.4)
    unmount()

    useEditorStore.getState().setSelectedFloor(ROOF_LAYER_ID)
    render(<EditorInspector />)
    expect(screen.queryByLabelText(/Tinggi lantai/)).toBeNull()
  })
})
