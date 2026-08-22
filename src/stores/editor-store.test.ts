// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest"

import { useEditorStore, DEFAULT_ROOF, SOIL_DEFAULT_KPA, ROOF_LAYER_ID } from "@/stores/editor-store"
import { makeLayout, sampleSite } from "@/test-utils/fixtures"
import { designLayoutSchema } from "@/lib/schemas/layout"
import type { DesignLayout } from "@/types"

function room(id: string) {
  return useEditorStore.getState().layout!.rooms.find((r) => r.id === id)
}

describe("editor store", () => {
  beforeEach(() => {
    useEditorStore.getState().loadLayout(makeLayout(), sampleSite, [])
  })

  it("recomputes area when a room is resized", () => {
    useEditorStore.getState().updateRoom("r1", { width: 4, depth: 4 })
    expect(room("r1")!.areaM2).toBe(16)
  })

  it("undo reverts the last change", () => {
    useEditorStore.getState().updateRoom("r1", { width: 4, depth: 4 })
    useEditorStore.getState().undo()
    expect(room("r1")!.width).toBe(3)
  })

  it("redo re-applies an undone change", () => {
    useEditorStore.getState().updateRoom("r1", { width: 4, depth: 4 })
    useEditorStore.getState().undo()
    useEditorStore.getState().redo()
    expect(room("r1")!.width).toBe(4)
  })

  it("deletes the selected room", () => {
    useEditorStore.getState().selectObject("r2")
    useEditorStore.getState().deleteSelected()
    expect(room("r2")).toBeUndefined()
  })

  it("toggles a room lock", () => {
    useEditorStore.getState().toggleLock("r1")
    expect(room("r1")!.locked).toBe(true)
  })
})

describe("editor-store setRoof", () => {
  beforeEach(() => {
    useEditorStore.getState().loadLayout(makeLayout(), sampleSite, [])
  })

  it("merges the default roof with the patch when layout.roof is absent", () => {
    useEditorStore.getState().setRoof({ type: "pelana" })
    expect(useEditorStore.getState().layout!.roof).toEqual({
      ...DEFAULT_ROOF,
      type: "pelana",
    })
  })

  it("merges a second patch over the first (keeping earlier fields)", () => {
    useEditorStore.getState().setRoof({ type: "pelana", slopeDeg: 35 })
    useEditorStore.getState().setRoof({ overhangM: 0.8 })
    expect(useEditorStore.getState().layout!.roof).toEqual({
      type: "pelana",
      slopeDeg: 35,
      overhangM: 0.8,
      material: "genteng_beton",
    })
  })

  it("undo restores the previous roof state", () => {
    useEditorStore.getState().setRoof({ type: "limasan", material: "metal" })
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().layout!.roof).toBeUndefined()
  })

  it("undo after a second setRoof restores the first patch's result", () => {
    useEditorStore.getState().setRoof({ type: "pelana" })
    useEditorStore.getState().setRoof({ slopeDeg: 20 })
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().layout!.roof).toEqual({
      ...DEFAULT_ROOF,
      type: "pelana",
    })
  })
})

describe("editor-store setRooftopArea", () => {
  beforeEach(() => {
    useEditorStore.getState().loadLayout(makeLayout(), sampleSite, [])
  })

  // makeLayout footprint (non-rooftop rooms r1@0.5,0.5 3×3 + r2@4,0.5 3×3):
  // x0=0.5 y0=0.5 widthM=6.5 depthM=3.0.

  it("stores a rect that already fits the footprint unchanged (round2'd)", () => {
    const before = useEditorStore.getState().past.length
    useEditorStore.getState().setRooftopArea({ x: 1, y: 1, width: 3, depth: 2 })
    const st = useEditorStore.getState()
    expect(st.layout!.rooftopArea).toEqual({ x: 1, y: 1, width: 3, depth: 2 })
    expect(st.past.length).toBe(before + 1)
  })

  it("clamps an oversized/out-of-bounds rect to the building footprint", () => {
    useEditorStore.getState().setRooftopArea({ x: -5, y: -5, width: 100, depth: 100 })
    expect(useEditorStore.getState().layout!.rooftopArea).toEqual({
      x: 0.5,
      y: 0.5,
      width: 6.5,
      depth: 3,
    })
  })

  it("setRooftopArea(undefined) clears the deck rect", () => {
    useEditorStore.getState().setRooftopArea({ x: 1, y: 1, width: 3, depth: 2 })
    expect(useEditorStore.getState().layout!.rooftopArea).toBeDefined()
    useEditorStore.getState().setRooftopArea(undefined)
    expect(useEditorStore.getState().layout!.rooftopArea).toBeUndefined()
  })

  it("undo restores the previous rooftopArea (undefined → set → undo)", () => {
    expect(useEditorStore.getState().layout!.rooftopArea).toBeUndefined()
    useEditorStore.getState().setRooftopArea({ x: 1, y: 1, width: 3, depth: 2 })
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().layout!.rooftopArea).toBeUndefined()
  })

  it("undo after a second set restores the first clamped rect", () => {
    useEditorStore.getState().setRooftopArea({ x: 1, y: 1, width: 3, depth: 2 })
    useEditorStore.getState().setRooftopArea({ x: 2, y: 1, width: 2, depth: 1.5 })
    expect(useEditorStore.getState().layout!.rooftopArea).toEqual({
      x: 2,
      y: 1,
      width: 2,
      depth: 1.5,
    })
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().layout!.rooftopArea).toEqual({ x: 1, y: 1, width: 3, depth: 2 })
  })

  it("undo restores a previously-set rect after clearing it", () => {
    useEditorStore.getState().setRooftopArea({ x: 1, y: 1, width: 3, depth: 2 })
    useEditorStore.getState().setRooftopArea(undefined)
    expect(useEditorStore.getState().layout!.rooftopArea).toBeUndefined()
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().layout!.rooftopArea).toEqual({ x: 1, y: 1, width: 3, depth: 2 })
  })
})

describe("editor-store addRooftopTerrace", () => {
  beforeEach(() => {
    useEditorStore.getState().loadLayout(makeLayout(), sampleSite, [])
  })

  it("creates a furnishable rooftop_lounge over the full footprint (no deck rect)", () => {
    useEditorStore.getState().setRooftop(true)
    useEditorStore.getState().addRooftopTerrace()
    const terrace = useEditorStore.getState().layout!.rooms.find(
      (r) => r.floorId === "floor-rooftop" && r.type === "rooftop_lounge"
    )
    // makeLayout footprint: x0=0.5 y0=0.5 w=6.5 d=3.0
    expect(terrace).toMatchObject({ x: 0.5, y: 0.5, width: 6.5, depth: 3, floorId: "floor-rooftop" })
    expect(terrace!.areaM2).toBeGreaterThan(0)
  })

  it("matches the partial deck rect when rooftopArea is set", () => {
    useEditorStore.getState().setRooftop(true)
    useEditorStore.getState().setRooftopArea({ x: 1, y: 1, width: 3, depth: 2 })
    useEditorStore.getState().addRooftopTerrace()
    const terrace = useEditorStore.getState().layout!.rooms.find((r) => r.type === "rooftop_lounge")!
    expect(terrace).toMatchObject({ x: 1, y: 1, width: 3, depth: 2 })
  })

  it("is idempotent — a second call adds no duplicate terrace", () => {
    useEditorStore.getState().setRooftop(true)
    useEditorStore.getState().addRooftopTerrace()
    useEditorStore.getState().addRooftopTerrace()
    const count = useEditorStore.getState().layout!.rooms.filter((r) => r.type === "rooftop_lounge").length
    expect(count).toBe(1)
  })

  it("is a no-op without a rooftop floor", () => {
    const before = useEditorStore.getState().layout!.rooms.length
    useEditorStore.getState().addRooftopTerrace()
    expect(useEditorStore.getState().layout!.rooms.length).toBe(before)
  })
})

describe("editor-store setRooftopRailingStyle", () => {
  beforeEach(() => {
    useEditorStore.getState().loadLayout(makeLayout(), sampleSite, [])
  })

  it("sets rooftopRailingStyle on the layout (undo-aware)", () => {
    expect(useEditorStore.getState().layout!.rooftopRailingStyle).toBeUndefined()
    const before = useEditorStore.getState().past.length
    useEditorStore.getState().setRooftopRailingStyle("besi")
    expect(useEditorStore.getState().layout!.rooftopRailingStyle).toBe("besi")
    expect(useEditorStore.getState().past.length).toBe(before + 1)
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().layout!.rooftopRailingStyle).toBeUndefined()
  })

  it("does not affect a balcony room's own railingStyle (the reported bug)", () => {
    useEditorStore.getState().updateRoom("r1", { type: "balkon", railingStyle: "kaca" })
    useEditorStore.getState().setRooftopRailingStyle("kayu")
    expect(useEditorStore.getState().layout!.rooftopRailingStyle).toBe("kayu")
    expect(room("r1")!.railingStyle).toBe("kaca") // untouched
  })

  it("setRooftopRailingModel sets/clears the custom GLB; picking a style releases the model", () => {
    useEditorStore.getState().setRooftopRailingModel("/api/v1/assets/file/rail.glb", "asset-rail-1")
    expect(useEditorStore.getState().layout!.rooftopRailingModelUrl).toBe("/api/v1/assets/file/rail.glb")
    expect(useEditorStore.getState().layout!.rooftopRailingModelAssetId).toBe("asset-rail-1")
    // memilih gaya bawaan melepas model
    useEditorStore.getState().setRooftopRailingStyle("besi")
    expect(useEditorStore.getState().layout!.rooftopRailingModelUrl).toBeUndefined()
    // set lalu lepas manual
    useEditorStore.getState().setRooftopRailingModel("/x.glb", "a")
    useEditorStore.getState().setRooftopRailingModel(null)
    expect(useEditorStore.getState().layout!.rooftopRailingModelUrl).toBeUndefined()
  })
})

describe("editor-store addPool", () => {
  beforeEach(() => {
    // site 8×8, footprint 6.5×3 → yard exists → pool placed in yard on floor-1.
    useEditorStore.getState().loadLayout(makeLayout(), sampleSite, [])
  })

  it("adds a kolam room in the yard and returns its id (undo-aware)", () => {
    const before = useEditorStore.getState().past.length
    const id = useEditorStore.getState().addPool()
    expect(id).toBeTruthy()
    const pool = useEditorStore.getState().layout!.rooms.find((r) => r.id === id)
    expect(pool?.type).toBe("kolam")
    expect(pool?.floorId).toBe("floor-1")
    expect(pool?.poolKind).toBe("renang")
    expect(pool!.areaM2).toBeGreaterThan(0)
    expect(useEditorStore.getState().past.length).toBe(before + 1)
  })

  it("places a plunge pool on the rooftop deck when the lot has no yard", () => {
    // footprint == site (8×8) → no yard; add a rooftop floor → plunge on deck.
    const full: DesignLayout = {
      ...makeLayout(),
      floors: [
        { id: "floor-1", level: 1, name: "Lantai 1", heightM: 3.2 },
        { id: "floor-rooftop", level: 2, name: "Rooftop", heightM: 0.3 },
      ],
      rooms: [
        { id: "r1", floorId: "floor-1", name: "R", type: "ruang_tamu", x: 0, y: 0, width: 8, depth: 8, areaM2: 64 },
      ],
    }
    useEditorStore.getState().loadLayout(full, sampleSite, [])
    const id = useEditorStore.getState().addPool()
    const pool = useEditorStore.getState().layout!.rooms.find((r) => r.id === id)
    expect(pool?.floorId).toBe("floor-rooftop")
    expect(pool?.poolKind).toBe("plunge")
  })
})

describe("editor-store addStair", () => {
  it("adds a tangga room on the ground floor and returns its id (undo-aware)", () => {
    const two: DesignLayout = {
      ...makeLayout(),
      floors: [
        { id: "floor-1", level: 1, name: "Lantai 1", heightM: 3.2 },
        { id: "floor-2", level: 2, name: "Lantai 2", heightM: 3.2 },
      ],
    }
    useEditorStore.getState().loadLayout(two, sampleSite, [])
    const before = useEditorStore.getState().past.length
    const id = useEditorStore.getState().addStair()
    expect(id).toBeTruthy()
    const stair = useEditorStore.getState().layout!.rooms.find((r) => r.id === id)
    expect(stair?.type).toBe("tangga")
    expect(stair?.floorId).toBe("floor-1")
    expect(stair!.width).toBeGreaterThan(0)
    expect(useEditorStore.getState().past.length).toBe(before + 1)
  })

  it("returns null (no-op) when there is only one floor — nothing to access", () => {
    useEditorStore.getState().loadLayout(makeLayout(), sampleSite, []) // single floor-1
    const before = useEditorStore.getState().layout!.rooms.length
    const id = useEditorStore.getState().addStair()
    expect(id).toBeNull()
    expect(useEditorStore.getState().layout!.rooms.length).toBe(before)
  })

  it("addStairAt places stair at specified coordinates and returns id", () => {
    const two: DesignLayout = {
      ...makeLayout(),
      floors: [
        { id: "floor-1", level: 1, name: "Lantai 1", heightM: 3.2 },
        { id: "floor-2", level: 2, name: "Lantai 2", heightM: 3.2 },
      ],
    }
    useEditorStore.getState().loadLayout(two, sampleSite, [])
    const before = useEditorStore.getState().past.length
    const id = useEditorStore.getState().addStairAt(5, 3)
    expect(id).toBeTruthy()
    const stair = useEditorStore.getState().layout!.rooms.find((r) => r.id === id)
    expect(stair).toBeTruthy()
    expect(stair?.type).toBe("tangga")
    expect(stair?.x).toBe(5)
    expect(stair?.y).toBe(3)
    expect(stair?.floorId).toBe("floor-1")
    expect(useEditorStore.getState().past.length).toBe(before + 1)
  })

  it("addStairAt returns null when single floor (no-op)", () => {
    useEditorStore.getState().loadLayout(makeLayout(), sampleSite, [])
    const before = useEditorStore.getState().layout!.rooms.length
    const id = useEditorStore.getState().addStairAt(5, 3)
    expect(id).toBeNull()
    expect(useEditorStore.getState().layout!.rooms.length).toBe(before)
  })
})

describe("editor-store dragRooftopAreaTo", () => {
  // A layout with a non-rooftop room (footprint x0=0 y0=0 8×8) + a rooftop floor.
  const rooftopDragLayout = (): DesignLayout => ({
    id: "l-rt-drag", projectId: "p", versionId: "v",
    floors: [
      { id: "floor-1", level: 1, name: "Lantai 1", heightM: 3.2 },
      { id: "floor-rooftop", level: 2, name: "Rooftop", heightM: 0.3 },
    ],
    rooms: [
      { id: "r1", floorId: "floor-1", name: "Ruang", type: "ruang_tamu", x: 0, y: 0, width: 8, depth: 8, areaM2: 64 },
    ],
    walls: [], openings: [], stairs: [], pools: [],
    validation: { passed: true, issues: [] },
  })

  it("pushes exactly ONE undo entry per drag gesture and ends on the last clamped rect", () => {
    useEditorStore.getState().loadLayout(rooftopDragLayout(), { widthM: 10, depthM: 10 }, [])
    useEditorStore.getState().setSelectedFloor("floor-rooftop")
    useEditorStore.getState().setRooftopArea({ x: 1, y: 1, width: 4, depth: 4 })

    const before = useEditorStore.getState().past.length
    useEditorStore.getState().beginDrag()
    useEditorStore.getState().dragRooftopAreaTo({ x: 2, y: 2, width: 3, depth: 3 })
    useEditorStore.getState().dragRooftopAreaTo({ x: 1, y: 1, width: 5, depth: 5 })
    useEditorStore.getState().dragRooftopAreaTo({ x: 2, y: 1, width: 4, depth: 3 })
    useEditorStore.getState().endDrag()

    const st = useEditorStore.getState()
    expect(st.past.length).toBe(before + 1)
    expect(st.layout!.rooftopArea).toEqual({ x: 2, y: 1, width: 4, depth: 3 })
  })
})

describe("editor-store setSoilBearing", () => {
  beforeEach(() => {
    useEditorStore.getState().loadLayout(makeLayout(), sampleSite, [])
  })

  it("defaults to SOIL_DEFAULT_KPA (150) when structural is absent", () => {
    const layout = useEditorStore.getState().layout!
    expect(layout.structural).toBeUndefined()
    expect(layout.structural?.soilBearingKPa ?? SOIL_DEFAULT_KPA).toBe(150)
  })

  it("sets layout.structural.soilBearingKPa in one undo entry; undo reverts", () => {
    const before = useEditorStore.getState().past.length
    useEditorStore.getState().setSoilBearing(220)
    const st = useEditorStore.getState()
    expect(st.layout!.structural).toEqual({ soilBearingKPa: 220 })
    expect(st.past.length).toBe(before + 1)
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().layout!.structural).toBeUndefined()
  })

  it("overwrites a previous value; undo restores the earlier value", () => {
    useEditorStore.getState().setSoilBearing(200)
    useEditorStore.getState().setSoilBearing(300)
    expect(useEditorStore.getState().layout!.structural).toEqual({ soilBearingKPa: 300 })
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().layout!.structural).toEqual({ soilBearingKPa: 200 })
  })
})

const layout = (): DesignLayout => ({
  id: "l", projectId: "p", versionId: "v",
  floors: [{ id: "f1", level: 1, name: "Lantai 1", heightM: 3 }],
  rooms: [{ id: "r1", floorId: "f1", name: "R", type: "ruang_tamu", x: 0, y: 0, width: 3, depth: 3, areaM2: 9 }],
  walls: [], openings: [], stairs: [], pools: [],
  validation: { passed: true, issues: [] },
})
const site = { widthM: 10, depthM: 12 }

describe("editor-store create actions", () => {
  beforeEach(() => useEditorStore.getState().loadLayout(layout(), site, []))

  it("addRoom appends a room on the active floor and selects it; undo restores", () => {
    const s = useEditorStore.getState()
    s.addRoom("kamar_tidur", 4, 4)
    const st = useEditorStore.getState()
    expect(st.layout!.rooms).toHaveLength(2)
    const added = st.layout!.rooms.find((r) => r.type === "kamar_tidur")!
    expect(added.floorId).toBe("f1")
    expect(st.selectedObjectId).toBe(added.id)
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().layout!.rooms).toHaveLength(1)
  })

  it("addFloor adds a floor and selects it", () => {
    useEditorStore.getState().addFloor()
    const st = useEditorStore.getState()
    expect(st.layout!.floors).toHaveLength(2)
    expect(st.selectedFloorId).toBe(st.layout!.floors[1].id)
  })

  it("removeFloor removes the floor + its rooms; refuses the last floor", () => {
    useEditorStore.getState().addFloor()
    const f2 = useEditorStore.getState().layout!.floors[1].id
    useEditorStore.getState().addRoom("dapur", 1, 1) // on f2 (now active)
    useEditorStore.getState().removeFloor(f2)
    const st = useEditorStore.getState()
    expect(st.layout!.floors).toHaveLength(1)
    expect(st.layout!.rooms.some((r) => r.floorId === f2)).toBe(false)
    // last-floor guard
    useEditorStore.getState().removeFloor("f1")
    expect(useEditorStore.getState().layout!.floors).toHaveLength(1)
  })

  it("addRoom is a no-op when layout/site/selectedFloorId are null", () => {
    useEditorStore.setState({ layout: null, site: null, selectedFloorId: null })
    expect(() =>
      useEditorStore.getState().addRoom("kamar_tidur", 1, 1),
    ).not.toThrow()
    expect(useEditorStore.getState().layout).toBeNull()
  })
})

describe("editor-store updateOpening archShape clamp (bukaan lengkung)", () => {
  beforeEach(() => useEditorStore.getState().loadLayout(layout(), site, []))

  function firstOpeningId(): string {
    useEditorStore.getState().addOpening("r1", "s", 1.5, "window")
    return useEditorStore.getState().layout!.openings[0].id
  }

  it("arch: heightM terlalu pendek dibulatkan ke widthM/2 + 0.2 (radius muat)", () => {
    const id = firstOpeningId()
    useEditorStore.getState().updateOpening(id, { widthM: 1.6, heightM: 0.4, archShape: "arch" })
    const op = useEditorStore.getState().layout!.openings.find((o) => o.id === id)!
    expect(op.archShape).toBe("arch")
    // widthM/2 + 0.2 = 1.0 — heightM 0.4 di bawah minimum, harus dinaikkan.
    expect(op.heightM).toBe(1)
  })

  it("arch: heightM yang sudah cukup TIDAK diubah", () => {
    const id = firstOpeningId()
    useEditorStore.getState().updateOpening(id, { widthM: 1.2, heightM: 2, archShape: "arch" })
    const op = useEditorStore.getState().layout!.openings.find((o) => o.id === id)!
    expect(op.heightM).toBe(2)
  })

  it("capsule: widthM/heightM terlalu kecil dibulatkan ke minimum wajar (0.3 m)", () => {
    const id = firstOpeningId()
    useEditorStore.getState().updateOpening(id, { widthM: 0.1, heightM: 0.15, archShape: "capsule" })
    const op = useEditorStore.getState().layout!.openings.find((o) => o.id === id)!
    expect(op.archShape).toBe("capsule")
    expect(op.widthM).toBe(0.3)
    expect(op.heightM).toBe(0.3)
  })

  it("tanpa archShape (persegi): clamp lengkung tak berlaku — dimensi kecil dibiarkan apa adanya", () => {
    const id = firstOpeningId()
    useEditorStore.getState().updateOpening(id, { widthM: 0.25, heightM: 0.3 })
    const op = useEditorStore.getState().layout!.openings.find((o) => o.id === id)!
    expect(op.archShape).toBeUndefined()
    expect(op.widthM).toBe(0.25)
    expect(op.heightM).toBe(0.3)
  })
})

describe("editor-store updateOpening topSlopeM clamp (bukaan trapesium)", () => {
  beforeEach(() => useEditorStore.getState().loadLayout(layout(), site, []))

  function firstOpeningId(): string {
    useEditorStore.getState().addOpening("r1", "s", 1.5, "window")
    return useEditorStore.getState().layout!.openings[0].id
  }

  it("nilai wajar dalam batas: dipertahankan (dibulatkan 2 desimal)", () => {
    const id = firstOpeningId()
    useEditorStore.getState().updateOpening(id, { heightM: 2, topSlopeM: 0.567 })
    const op = useEditorStore.getState().layout!.openings.find((o) => o.id === id)!
    expect(op.topSlopeM).toBe(0.57)
  })

  it("|topSlopeM| > 3: dibatasi ke ±3 (tanda dipertahankan)", () => {
    const id = firstOpeningId()
    useEditorStore.getState().updateOpening(id, { heightM: 4, topSlopeM: 5 })
    let op = useEditorStore.getState().layout!.openings.find((o) => o.id === id)!
    expect(op.topSlopeM).toBe(3)
    useEditorStore.getState().updateOpening(id, { topSlopeM: -8 })
    op = useEditorStore.getState().layout!.openings.find((o) => o.id === id)!
    expect(op.topSlopeM).toBe(-3)
  })

  it("sisi rendah tak boleh < 0.3 m: topSlopeM disesuaikan ke heightM - 0.3", () => {
    const id = firstOpeningId()
    // heightM 1: sisi rendah minimum ⇒ maxDrop = 0.7.
    useEditorStore.getState().updateOpening(id, { heightM: 1, topSlopeM: 2 })
    const op = useEditorStore.getState().layout!.openings.find((o) => o.id === id)!
    expect(op.topSlopeM).toBe(0.7)
  })

  it("heightM di bawah 0.3: topSlopeM apa pun dihapus (maxDrop = 0)", () => {
    const id = firstOpeningId()
    useEditorStore.getState().updateOpening(id, { heightM: 0.25, topSlopeM: 0.5 })
    const op = useEditorStore.getState().layout!.openings.find((o) => o.id === id)!
    expect(op.topSlopeM).toBeUndefined()
  })

  it("topSlopeM: 0 atau NaN → field dihapus (persegi biasa)", () => {
    const id = firstOpeningId()
    useEditorStore.getState().updateOpening(id, { heightM: 2, topSlopeM: 1 })
    let op = useEditorStore.getState().layout!.openings.find((o) => o.id === id)!
    expect(op.topSlopeM).toBe(1)
    useEditorStore.getState().updateOpening(id, { topSlopeM: 0 })
    op = useEditorStore.getState().layout!.openings.find((o) => o.id === id)!
    expect(op.topSlopeM).toBeUndefined()
  })

  it("tanpa topSlopeM di patch: field lain tak terganggu, tak menambah topSlopeM", () => {
    const id = firstOpeningId()
    useEditorStore.getState().updateOpening(id, { widthM: 1.4 })
    const op = useEditorStore.getState().layout!.openings.find((o) => o.id === id)!
    expect(op.topSlopeM).toBeUndefined()
    expect(op.widthM).toBe(1.4)
  })
})

describe("editor-store resize — bukaan yatim dibersihkan (BUG D)", () => {
  beforeEach(() => useEditorStore.getState().loadLayout(layout(), site, []))

  it("updateRoom: dinding s mengecil, jendela masih muat → positionM ter-clamp ke dalam dinding baru", () => {
    // r1 3×3; jendela default (1,2 m) di tengah dinding s (positionM 1.5).
    useEditorStore.getState().addOpening("r1", "s", 1.5, "window")
    useEditorStore.getState().updateRoom("r1", { width: 1.2 }) // dinding s jadi PAS selebar jendela
    const openings = useEditorStore.getState().layout!.openings
    expect(openings).toHaveLength(1)
    expect(openings[0].positionM).toBe(0.6) // satu-satunya posisi yang muat di dinding 1,2 m
  })

  it("updateRoom: dinding s mengecil sampai lebih sempit dari jendela → jendela dihapus, bukan ditinggal 'yatim'", () => {
    useEditorStore.getState().addOpening("r1", "s", 1.5, "window") // widthM 1.2
    useEditorStore.getState().updateRoom("r1", { width: 1 }) // < 1,2 m — tak mungkin muat
    expect(useEditorStore.getState().layout!.openings).toHaveLength(0)
  })

  it("updateRoom: TIDAK dihapus hanya karena tipe ruang berubah (keputusan user, bukan geometri)", () => {
    useEditorStore.getState().addOpening("r1", "s", 1.5, "window")
    useEditorStore.getState().updateRoom("r1", { type: "gudang" }) // ganti tipe (mis. jadi massa solid), dimensi TETAP
    expect(useEditorStore.getState().layout!.openings).toHaveLength(1)
    expect(useEditorStore.getState().layout!.openings[0].positionM).toBe(1.5)
  })

  it("drag-resize interaktif (dragResize + endDrag): dinding s mengecil pas sebesar jendela → di-clamp, tak yatim", () => {
    useEditorStore.getState().addOpening("r1", "s", 1.5, "window") // widthM 1.2, positionM 1.5
    useEditorStore.getState().beginDrag()
    // Handle "e": width = max(MIN_ROOM=1.2, mx - x) = max(1.2, 1.2-0) = 1.2 m.
    useEditorStore.getState().dragResize("r1", "e", 1.2, 0, 0)
    useEditorStore.getState().endDrag()

    const st = useEditorStore.getState()
    expect(st.layout!.rooms.find((r) => r.id === "r1")!.width).toBe(1.2)
    const openings = st.layout!.openings
    expect(openings).toHaveLength(1)
    expect(openings[0].positionM).toBe(0.6)
  })

  it("drag-resize interaktif: jendela LEBIH LEBAR dari dinding minimum (MIN_ROOM 1,2 m) → dihapus di endDrag, bukan dibiarkan menempel di luar massa", () => {
    useEditorStore.getState().addOpening("r1", "s", 1.5, "window")
    const openingId = useEditorStore.getState().layout!.openings[0].id
    useEditorStore.getState().updateOpening(openingId, { widthM: 1.5 }) // jendela lebar 1,5 m
    useEditorStore.getState().beginDrag()
    useEditorStore.getState().dragResize("r1", "e", 1.2, 0, 0) // dinding mengecil ke MIN_ROOM 1,2 m < 1,5 m
    useEditorStore.getState().endDrag()

    const st = useEditorStore.getState()
    expect(st.layout!.rooms.find((r) => r.id === "r1")!.width).toBe(1.2)
    expect(st.layout!.openings).toHaveLength(0)
  })

  it("drag-MOVE (bukan resize): dimensi tak berubah → bukaan sama sekali tak tersentuh", () => {
    useEditorStore.getState().addOpening("r1", "s", 1.5, "window")
    const before = useEditorStore.getState().layout!.openings[0]
    useEditorStore.getState().beginDrag()
    useEditorStore.getState().dragRoomTo("r1", 2, 2, 0)
    useEditorStore.getState().endDrag()
    const after = useEditorStore.getState().layout!.openings[0]
    expect(after).toEqual(before)
  })
})

describe("editor-store addOpening — cari celah kosong berikutnya (BUG C)", () => {
  beforeEach(() => useEditorStore.getState().loadLayout(layout(), site, []))

  it("klik pertama di dinding kosong: berhasil (true), posisi sesuai klik", () => {
    const ok = useEditorStore.getState().addOpening("r1", "s", 1.5, "window")
    expect(ok).toBe(true)
    const openings = useEditorStore.getState().layout!.openings
    expect(openings).toHaveLength(1)
    expect(openings[0].positionM).toBe(1.5)
  })

  it("klik ke-2 di posisi yang SAMA (dinding 3 m, jendela 1.2 m — tak ada celah lain): ditolak (false), TIDAK menambah opening, TIDAK membuat entri undo", () => {
    useEditorStore.getState().addOpening("r1", "s", 1.5, "window")
    const pastLenBefore = useEditorStore.getState().past.length
    const ok = useEditorStore.getState().addOpening("r1", "s", 1.5, "window")
    expect(ok).toBe(false)
    expect(useEditorStore.getState().layout!.openings).toHaveLength(1)
    expect(useEditorStore.getState().past.length).toBe(pastLenBefore) // tak nge-dirty history
  })

  it("dinding cukup lebar utk 2 jendela: klik ke-2 di posisi berbeda berhasil menambah bukaan ke-2", () => {
    useEditorStore.getState().updateRoom("r1", { width: 6 }) // dinding s jadi 6 m
    const ok1 = useEditorStore.getState().addOpening("r1", "s", 1, "window")
    const ok2 = useEditorStore.getState().addOpening("r1", "s", 4.5, "window")
    expect(ok1).toBe(true)
    expect(ok2).toBe(true)
    const openings = useEditorStore
      .getState()
      .layout!.openings.filter((o) => o.wallId === "r1:s")
    expect(openings).toHaveLength(2)
    // Tak boleh bertumpuk.
    const [a, b] = openings.sort((x, y) => x.positionM - y.positionM)
    expect(a.positionM + a.widthM / 2).toBeLessThanOrEqual(b.positionM - b.widthM / 2 + 1e-6)
  })

  it("klik ke-2 menumpuk tapi masih ada celah lain di dinding: digeser ke celah kosong, bukan ditolak", () => {
    useEditorStore.getState().updateRoom("r1", { width: 5 }) // dinding s jadi 5 m
    useEditorStore.getState().addOpening("r1", "s", 1, "window") // 0.4–1.6
    const ok = useEditorStore.getState().addOpening("r1", "s", 1, "window") // menumpuk
    expect(ok).toBe(true)
    const openings = useEditorStore
      .getState()
      .layout!.openings.filter((o) => o.wallId === "r1:s")
    expect(openings).toHaveLength(2)
    const [a, b] = openings.sort((x, y) => x.positionM - y.positionM)
    expect(b.positionM - b.widthM / 2).toBeGreaterThanOrEqual(a.positionM + a.widthM / 2 - 1e-6)
  })
})

describe("editor-store electrical", () => {
  beforeEach(() => useEditorStore.getState().loadLayout(layout(), site, []))

  it("addElectricalPoint appends a point with an elec- id; grows past; undo reverts", () => {
    const before = useEditorStore.getState().past.length
    useEditorStore.getState().addElectricalPoint("r1", "stopkontak", 1, 1)
    const st = useEditorStore.getState()
    expect(st.layout!.electrical).toHaveLength(1)
    const pt = st.layout!.electrical![0]
    expect(pt.id.startsWith("elec-")).toBe(true)
    expect(pt).toMatchObject({ roomId: "r1", type: "stopkontak", x: 1, y: 1 })
    expect(st.past.length).toBe(before + 1)
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().layout!.electrical ?? []).toHaveLength(0)
  })

  it("updateElectricalPoint patches the type; grows past; undo reverts", () => {
    useEditorStore.getState().addElectricalPoint("r1", "stopkontak", 1, 1)
    const id = useEditorStore.getState().layout!.electrical![0].id
    const before = useEditorStore.getState().past.length
    useEditorStore.getState().updateElectricalPoint(id, { type: "data" })
    expect(useEditorStore.getState().layout!.electrical![0].type).toBe("data")
    expect(useEditorStore.getState().past.length).toBe(before + 1)
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().layout!.electrical![0].type).toBe("stopkontak")
  })

  it("moveElectricalPoint sets x/y; grows past; undo reverts", () => {
    useEditorStore.getState().addElectricalPoint("r1", "stopkontak", 1, 1)
    const id = useEditorStore.getState().layout!.electrical![0].id
    const before = useEditorStore.getState().past.length
    useEditorStore.getState().moveElectricalPoint(id, 2, 3)
    const pt = useEditorStore.getState().layout!.electrical![0]
    expect(pt.x).toBe(2)
    expect(pt.y).toBe(3)
    expect(useEditorStore.getState().past.length).toBe(before + 1)
    useEditorStore.getState().undo()
    const reverted = useEditorStore.getState().layout!.electrical![0]
    expect(reverted.x).toBe(1)
    expect(reverted.y).toBe(1)
  })

  it("removeElectricalPoint filters out the point; grows past; undo reverts", () => {
    useEditorStore.getState().addElectricalPoint("r1", "stopkontak", 1, 1)
    const id = useEditorStore.getState().layout!.electrical![0].id
    const before = useEditorStore.getState().past.length
    useEditorStore.getState().removeElectricalPoint(id)
    expect(useEditorStore.getState().layout!.electrical).toHaveLength(0)
    expect(useEditorStore.getState().past.length).toBe(before + 1)
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().layout!.electrical).toHaveLength(1)
  })

  it("setElectrical replaces the whole array in one undo entry; undo reverts", () => {
    useEditorStore.getState().addElectricalPoint("r1", "stopkontak", 1, 1)
    const before = useEditorStore.getState().past.length
    const points = [
      { id: "elec-aaa", roomId: "r1", type: "panel" as const, x: 0.3, y: 0.3 },
      { id: "elec-bbb", roomId: "r1", type: "saklar_tunggal" as const, x: 0.5, y: 0.5 },
    ]
    useEditorStore.getState().setElectrical(points)
    const st = useEditorStore.getState()
    expect(st.layout!.electrical).toHaveLength(2)
    expect(st.layout!.electrical!.map((p) => p.id)).toEqual(["elec-aaa", "elec-bbb"])
    expect(st.past.length).toBe(before + 1)
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().layout!.electrical).toHaveLength(1)
  })
})

describe("editor-store water & sanitation", () => {
  beforeEach(() => useEditorStore.getState().loadLayout(layout(), site, []))

  it("addWaterPoint appends a point with a water- id; grows past; undo reverts", () => {
    const before = useEditorStore.getState().past.length
    useEditorStore.getState().addWaterPoint("r1", "kloset", 1, 1)
    const st = useEditorStore.getState()
    expect(st.layout!.water).toHaveLength(1)
    const pt = st.layout!.water![0]
    expect(pt.id.startsWith("water-")).toBe(true)
    expect(pt).toMatchObject({ roomId: "r1", type: "kloset", x: 1, y: 1 })
    expect(st.past.length).toBe(before + 1)
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().layout!.water ?? []).toHaveLength(0)
  })

  it("updateWaterPoint patches the type; grows past; undo reverts", () => {
    useEditorStore.getState().addWaterPoint("r1", "kloset", 1, 1)
    const id = useEditorStore.getState().layout!.water![0].id
    const before = useEditorStore.getState().past.length
    useEditorStore.getState().updateWaterPoint(id, { type: "wastafel" })
    expect(useEditorStore.getState().layout!.water![0].type).toBe("wastafel")
    expect(useEditorStore.getState().past.length).toBe(before + 1)
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().layout!.water![0].type).toBe("kloset")
  })

  it("moveWaterPoint sets x/y; grows past; undo reverts", () => {
    useEditorStore.getState().addWaterPoint("r1", "kloset", 1, 1)
    const id = useEditorStore.getState().layout!.water![0].id
    const before = useEditorStore.getState().past.length
    useEditorStore.getState().moveWaterPoint(id, 2, 3)
    const pt = useEditorStore.getState().layout!.water![0]
    expect(pt.x).toBe(2)
    expect(pt.y).toBe(3)
    expect(useEditorStore.getState().past.length).toBe(before + 1)
    useEditorStore.getState().undo()
    const reverted = useEditorStore.getState().layout!.water![0]
    expect(reverted.x).toBe(1)
    expect(reverted.y).toBe(1)
  })

  it("removeWaterPoint filters out the point; grows past; undo reverts", () => {
    useEditorStore.getState().addWaterPoint("r1", "kloset", 1, 1)
    const id = useEditorStore.getState().layout!.water![0].id
    const before = useEditorStore.getState().past.length
    useEditorStore.getState().removeWaterPoint(id)
    expect(useEditorStore.getState().layout!.water).toHaveLength(0)
    expect(useEditorStore.getState().past.length).toBe(before + 1)
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().layout!.water).toHaveLength(1)
  })

  it("setWater replaces the whole array in one undo entry; undo reverts", () => {
    useEditorStore.getState().addWaterPoint("r1", "kloset", 1, 1)
    const before = useEditorStore.getState().past.length
    const points = [
      { id: "water-aaa", roomId: "r1", type: "wastafel" as const, x: 0.3, y: 0.3 },
      { id: "water-bbb", roomId: "r1", type: "shower" as const, x: 0.5, y: 0.5 },
    ]
    useEditorStore.getState().setWater(points)
    const st = useEditorStore.getState()
    expect(st.layout!.water).toHaveLength(2)
    expect(st.layout!.water!.map((p) => p.id)).toEqual(["water-aaa", "water-bbb"])
    expect(st.past.length).toBe(before + 1)
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().layout!.water).toHaveLength(1)
  })

  it("setSanitation sets the septicTank; grows past; undo reverts", () => {
    const before = useEditorStore.getState().past.length
    const septic = { id: "septic-1", x: 2, y: 10, widthM: 1.2, lengthM: 2.4, depthM: 1.8, capacity: 4.32 }
    useEditorStore.getState().setSanitation({ septicTank: septic })
    expect(useEditorStore.getState().layout!.sanitation?.septicTank).toEqual(septic)
    expect(useEditorStore.getState().past.length).toBe(before + 1)
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().layout!.sanitation?.septicTank).toBeUndefined()
  })

  it("moveSanitationObject('septicTank') updates x/y in one undo entry; undo reverts", () => {
    useEditorStore.getState().setSanitation({
      septicTank: { id: "septic-1", x: 2, y: 10, widthM: 1.2, lengthM: 2.4, depthM: 1.8, capacity: 4.32 },
    })
    const before = useEditorStore.getState().past.length
    useEditorStore.getState().beginDrag()
    useEditorStore.getState().moveSanitationObject("septicTank", null, 3, 8)
    useEditorStore.getState().endDrag()
    const moved = useEditorStore.getState().layout!.sanitation!.septicTank!
    expect(moved.x).toBe(3)
    expect(moved.y).toBe(8)
    expect(useEditorStore.getState().past.length).toBe(before + 1)
    useEditorStore.getState().undo()
    const reverted = useEditorStore.getState().layout!.sanitation!.septicTank!
    expect(reverted.x).toBe(2)
    expect(reverted.y).toBe(10)
  })

  it("moveSanitationObject('controlBox', index) updates the indexed box's x/y", () => {
    useEditorStore.getState().setSanitation({
      controlBoxes: [
        { id: "cb-0", x: 1, y: 11, widthM: 0.4, lengthM: 0.4, depthM: 0.5 },
        { id: "cb-1", x: 2, y: 11, widthM: 0.4, lengthM: 0.4, depthM: 0.5 },
      ],
    })
    useEditorStore.getState().beginDrag()
    useEditorStore.getState().moveSanitationObject("controlBox", 1, 5, 9)
    useEditorStore.getState().endDrag()
    const boxes = useEditorStore.getState().layout!.sanitation!.controlBoxes!
    expect(boxes[0]).toMatchObject({ x: 1, y: 11 })
    expect(boxes[1]).toMatchObject({ x: 5, y: 9 })
  })
})

describe("editor-store object-snap", () => {
  const layout = () => ({
    id: "l", projectId: "p", versionId: "v",
    floors: [{ id: "f1", level: 1, name: "L1", heightM: 3 }],
    rooms: [
      { id: "a", floorId: "f1", name: "A", type: "kamar_tidur", x: 1, y: 1, width: 4, depth: 3, areaM2: 12 },
      { id: "b", floorId: "f1", name: "B", type: "dapur", x: 2, y: 6, width: 3.27, depth: 2, areaM2: 6.54 },
    ],
    walls: [], openings: [], stairs: [], pools: [], validation: { passed: true, issues: [] },
  })
  const site = { widthM: 10, depthM: 12 }

  it("resize snaps the moving edge to a neighbor edge (beating grid) and records a guide", () => {
    useEditorStore.getState().loadLayout(layout() as never, site, [])
    useEditorStore.getState().beginDrag()
    // drag room A's right edge (handle 'e') to 5.27 → neighbor B's right edge (2+3.27) within tol
    useEditorStore.getState().dragResize("a", "e", 5.29, 2.5, 0.1)
    const a = useEditorStore.getState().layout!.rooms.find((r) => r.id === "a")!
    expect(a.x + a.width).toBeCloseTo(5.27, 5) // snapped to B's right edge, not grid (5.0/5.5)
    expect(useEditorStore.getState().alignmentGuides.x).toContain(5.27)
  })

  it("beginDrag and endDrag clear the guides", () => {
    useEditorStore.getState().loadLayout(layout() as never, site, [])
    useEditorStore.getState().beginDrag()
    useEditorStore.getState().dragRoomTo("a", 2, 6.05, 0.2) // near B — will produce guides
    useEditorStore.getState().endDrag()
    expect(useEditorStore.getState().alignmentGuides.x).toHaveLength(0)
    expect(useEditorStore.getState().alignmentGuides.y).toHaveLength(0)
  })
})

describe("setWallCladding — cladding fasad per dinding", () => {
  beforeEach(() => {
    useEditorStore.getState().loadLayout(makeLayout(), sampleSite, [])
  })

  it("sets, replaces, clears (undo-aware) dan menghapus map saat kosong", () => {
    const s = useEditorStore.getState()
    s.setWallCladding("r1:n", "batu_alam_gelap")
    expect(useEditorStore.getState().layout?.facade).toEqual({ "r1:n": "batu_alam_gelap" })
    useEditorStore.getState().setWallCladding("r1:n", "bata_ekspos")
    expect(useEditorStore.getState().layout?.facade?.["r1:n"]).toBe("bata_ekspos")
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().layout?.facade?.["r1:n"]).toBe("batu_alam_gelap")
    useEditorStore.getState().setWallCladding("r1:n", null)
    expect(useEditorStore.getState().layout?.facade).toBeUndefined()
  })
})

describe("addFlutedFacadePanel — preset 1-klik panel sirip (fluted) menutupi bidang penuh", () => {
  beforeEach(() => {
    useEditorStore.getState().loadLayout(makeLayout(), sampleSite, [])
  })

  it("lebar = panjang dinding penuh, sill 0, tinggi = tinggi dinding penuh, pattern fluted", () => {
    useEditorStore.getState().addFlutedFacadePanel("r1:n")
    const layout = useEditorStore.getState().layout!
    const fe = layout.facadeElements!.find((f) => f.wallId === "r1:n")!
    expect(fe.kind).toBe("louver_band")
    expect(fe.widthM).toBe(3) // r1.width (sisi n/s)
    expect(fe.sillHeightM).toBe(0)
    // floor-1 heightM 3.2 (floor-to-floor) → wallHM = 3.2 - SLAB_T(0.15) = 3.05.
    expect(fe.heightM).toBe(3.05)
    expect(fe.positionM).toBe(1.5)
    expect(fe.pattern).toEqual({ orientation: "v", pitchM: 0.07, barWidthM: 0.025, barDepthM: 0.02 })
    expect(fe.colorHex).toBeUndefined()
  })

  it("sisi w/e memakai depth dinding, bukan width", () => {
    useEditorStore.getState().updateRoom("r1", { width: 5, depth: 3 })
    useEditorStore.getState().addFlutedFacadePanel("r1:w")
    const fe = useEditorStore.getState().layout!.facadeElements!.find((f) => f.wallId === "r1:w")!
    expect(fe.widthM).toBe(3) // r1.depth, BUKAN r1.width (5)
  })

  it("undo-aware: undo mengembalikan facadeElements ke absen", () => {
    useEditorStore.getState().addFlutedFacadePanel("r1:n")
    expect(useEditorStore.getState().layout!.facadeElements!.length).toBe(1)
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().layout!.facadeElements ?? []).toHaveLength(0)
  })
})

describe("addRevealLineFacadePanel — preset 1-klik nat beton/reveal line menutupi bidang penuh", () => {
  beforeEach(() => {
    useEditorStore.getState().loadLayout(makeLayout(), sampleSite, [])
  })

  it("lebar = panjang dinding penuh, sill 0, finish aluminium_gelap, pattern.inset === true", () => {
    useEditorStore.getState().addRevealLineFacadePanel("r1:n")
    const layout = useEditorStore.getState().layout!
    const fe = layout.facadeElements!.find((f) => f.wallId === "r1:n")!
    expect(fe.kind).toBe("louver_band")
    expect(fe.widthM).toBe(3) // r1.width (sisi n/s)
    expect(fe.sillHeightM).toBe(0)
    expect(fe.finish).toBe("aluminium_gelap")
    expect(fe.colorHex).toBe("#2b2a27")
    expect(fe.pattern).toEqual({
      orientation: "grid",
      pitchM: 0.9,
      barWidthM: 0.02,
      barDepthM: 0.012,
      inset: true,
    })
    // Kontrak checkbox "Tenggelam di muka dinding" (wall-inspector.tsx) —
    // baca persis field ini.
    expect(fe.pattern?.inset).toBe(true)
  })

  it("round-trip: pattern.inset selamat lewat designLayoutSchema (commit + baca ulang dari state)", () => {
    useEditorStore.getState().addRevealLineFacadePanel("r1:n")
    const before = useEditorStore.getState().layout!
    const feBefore = before.facadeElements!.find((f) => f.wallId === "r1:n")!
    expect(feBefore.pattern?.inset).toBe(true)

    // Simulasi round-trip persist/load penuh: parse via schema yang sama
    // dipakai save/load API — bukan sekadar re-baca referensi di memori.
    const parsed = designLayoutSchema.parse(JSON.parse(JSON.stringify(before)))
    const feAfter = parsed.facadeElements!.find((f) => f.wallId === "r1:n")!
    expect(feAfter.pattern?.inset).toBe(true)
  })

  it("undo-aware: undo mengembalikan facadeElements ke absen", () => {
    useEditorStore.getState().addRevealLineFacadePanel("r1:n")
    expect(useEditorStore.getState().layout!.facadeElements!.length).toBe(1)
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().layout!.facadeElements ?? []).toHaveLength(0)
  })
})

describe("addFlutedFacadePanel/addFacadeElement — host dinding tepi sintetis w-edge", () => {
  // Lantai 2 (f2) mundur dari tepi footprint lantai 1 (f1, 6×3) di sisi timur
  // (f2 cuma 3 m lebar) → build-model menggambar w-edge-f2-e-* menutup
  // bentang y:0..3 di x=6 (fixture sama dgn build-model.test.ts "w-edge
  // claddable"). wallId sintetis: `edge-f2:e`.
  const twoFloorSetback: DesignLayout = {
    id: "l", projectId: "p", versionId: "v",
    floors: [
      { id: "f1", level: 1, name: "L1", heightM: 2.95 },
      { id: "f2", level: 2, name: "L2", heightM: 2.95 },
    ],
    rooms: [
      { id: "a", floorId: "f1", name: "A", type: "ruang_tamu", x: 0, y: 0, width: 6, depth: 3, areaM2: 18 },
      { id: "b", floorId: "f2", name: "B", type: "kamar_tidur", x: 0, y: 0, width: 3, depth: 3, areaM2: 9 },
    ],
    walls: [], openings: [], stairs: [], pools: [],
    validation: { passed: true, issues: [] },
  }
  const site6x3 = { widthM: 6, depthM: 3 }

  beforeEach(() => {
    useEditorStore.getState().loadLayout(twoFloorSetback, site6x3, [])
  })

  it("addFlutedFacadePanel pada wallId edge-{floorId}:{side} menghasilkan widthM/heightM masuk akal (dulu no-op, host tak ketemu)", () => {
    useEditorStore.getState().addFlutedFacadePanel("edge-f2:e")
    const layout = useEditorStore.getState().layout!
    const fe = layout.facadeElements?.find((f) => f.wallId === "edge-f2:e")
    expect(fe).toBeTruthy()
    // Span dinding tepi = footprint.depthM (3 m, sisi e/w vertikal).
    expect(fe!.widthM).toBe(3)
    expect(fe!.widthM).toBeGreaterThan(0)
    // f2.heightM 2.95 − SLAB_T(0.15) = 2.8; levelOffsetM edge wall = 0.
    expect(fe!.heightM).toBeCloseTo(2.8, 4)
    expect(fe!.heightM).toBeGreaterThan(0)
    expect(fe!.floorId).toBe("f2")
    expect(fe!.pattern?.orientation).toBe("v")
  })

  it("addRevealLineFacadePanel pada wallId sintetis: inset pattern + heightM konsisten dgn fluted", () => {
    useEditorStore.getState().addRevealLineFacadePanel("edge-f2:e")
    const fe = useEditorStore.getState().layout!.facadeElements!.find((f) => f.wallId === "edge-f2:e")!
    expect(fe.pattern?.inset).toBe(true)
    expect(fe.heightM).toBeCloseTo(2.8, 4)
  })

  it("addFacadeElement pada wallId sintetis: widthM proporsional thd panjang dinding tepi", () => {
    useEditorStore.getState().addFacadeElement("edge-f2:e", "roster_screen")
    const fe = useEditorStore.getState().layout!.facadeElements!.find((f) => f.wallId === "edge-f2:e")!
    expect(fe.kind).toBe("roster_screen")
    expect(fe.widthM).toBeGreaterThan(0)
    expect(fe.widthM).toBeLessThanOrEqual(3)
  })

  it("wallId sintetis TANPA dinding tepi nyata (mis. lantai pertama, i=0) tetap no-op — bukan crash", () => {
    useEditorStore.getState().addFlutedFacadePanel("edge-f1:n")
    expect(
      useEditorStore.getState().layout!.facadeElements?.some((f) => f.wallId === "edge-f1:n") ?? false,
    ).toBe(false)
  })
})

describe("lampu eksterior — copy-on-write materialization", () => {
  beforeEach(() => {
    useEditorStore.getState().loadLayout(makeLayout(), sampleSite, [])
  })

  it("updateLamp materializes auto placements then patches; removeLamp keeps []", () => {
    const s = useEditorStore.getState()
    expect(s.layout?.exteriorLamps).toBeUndefined()
    // materialisasi: patch lampu apa pun (id tak dikenal → daftar termaterialisasi utuh)
    s.updateLamp("nope", { intensity: 2 })
    expect(Array.isArray(useEditorStore.getState().layout?.exteriorLamps)).toBe(true)
    useEditorStore.getState().addWallLamp("r1:n")
    const lamps = useEditorStore.getState().layout!.exteriorLamps!
    const added = lamps[lamps.length - 1]
    expect(added.kind).toBe("wall")
    expect(added.side).toBe("n")
    useEditorStore.getState().updateLamp(added.id, { color: "#ff0000", intensity: 1.5 })
    const patched = useEditorStore.getState().layout!.exteriorLamps!.find((l) => l.id === added.id)!
    expect(patched.color).toBe("#ff0000")
    expect(patched.intensity).toBe(1.5)
    useEditorStore.getState().removeLamp(added.id)
    expect(useEditorStore.getState().layout!.exteriorLamps!.some((l) => l.id === added.id)).toBe(false)
  })
})

describe("setWallCladding — aksen muka dalam (face inner)", () => {
  beforeEach(() => {
    useEditorStore.getState().loadLayout(makeLayout(), sampleSite, [])
  })

  it("menulis facadeInner terpisah dari facade dan bisa dihapus", () => {
    const s = useEditorStore.getState()
    s.setWallCladding("r1:n", "bata_ekspos")
    s.setWallCladding("r1:n", "marmer_carrara", "inner")
    const l = useEditorStore.getState().layout!
    expect(l.facade).toEqual({ "r1:n": "bata_ekspos" })
    expect(l.facadeInner).toEqual({ "r1:n": "marmer_carrara" })
    useEditorStore.getState().setWallCladding("r1:n", null, "inner")
    expect(useEditorStore.getState().layout!.facadeInner).toBeUndefined()
    expect(useEditorStore.getState().layout!.facade).toEqual({ "r1:n": "bata_ekspos" })
  })
})

describe("setRooftop — tambah/hapus lantai rooftop dari editor", () => {
  beforeEach(() => {
    useEditorStore.getState().loadLayout(makeLayout(), sampleSite, [])
  })

  it("menambah floor-rooftop (paritas generator) lalu menghapus bersih", () => {
    const s = useEditorStore.getState()
    s.setRooftop(true)
    const withDeck = useEditorStore.getState().layout!
    const deck = withDeck.floors.find((f) => f.id === "floor-rooftop")!
    expect(deck.name).toBe("Rooftop")
    expect(deck.heightM).toBe(0.3)
    // idempotent
    useEditorStore.getState().setRooftop(true)
    expect(useEditorStore.getState().layout!.floors.filter((f) => f.id === "floor-rooftop")).toHaveLength(1)

    // isi rooftop lalu matikan → ruang/bukaan/rooftopArea ikut terhapus
    useEditorStore.getState().addRoom("rooftop_lounge", 1, 1)
    const st = useEditorStore.getState()
    st.setSelectedFloor("floor-rooftop")
    useEditorStore.getState().setRooftop(false)
    const after = useEditorStore.getState().layout!
    expect(after.floors.some((f) => f.id === "floor-rooftop")).toBe(false)
    expect(after.rooms.some((r) => r.floorId === "floor-rooftop")).toBe(false)
    expect(after.rooftopArea).toBeUndefined()
    expect(useEditorStore.getState().selectedFloorId).not.toBe("floor-rooftop")
  })
})

describe("editor-store alignFloorToReference", () => {
  beforeEach(() => {
    useEditorStore.getState().loadLayout(
      {
        id: "l", projectId: "p", versionId: "v",
        floors: [
          { id: "f1", level: 1, name: "Lantai 1", heightM: 3 },
          { id: "f2", level: 2, name: "Lantai 2", heightM: 3 },
        ],
        rooms: [
          { id: "a1", floorId: "f1", name: "A1", type: "ruang_tamu", x: 0, y: 0, width: 6, depth: 4, areaM2: 24 },
          { id: "a2", floorId: "f1", name: "A2", type: "dapur", x: 0, y: 4, width: 6, depth: 2, areaM2: 12 },
          { id: "b1", floorId: "f2", name: "B1", type: "kamar_tidur", x: 0, y: 0, width: 3, depth: 4, areaM2: 12 },
        ],
        walls: [], openings: [], stairs: [], pools: [],
        validation: { passed: true, issues: [] },
      } as DesignLayout,
      sampleSite, []
    )
  })

  it("grows floor-2 rooms to match floor-1 indoor footprint", () => {
    const summary = useEditorStore.getState().alignFloorToReference("f2", "f1")
    const b1 = useEditorStore.getState().layout!.rooms.find((rr) => rr.id === "b1")!
    expect(b1.width).toBe(6)   // lantai1 indoor bbox width = 6
    expect(summary?.grown).toContain("b1")
  })

  it("is undo-able as a single history entry", () => {
    const before = useEditorStore.getState().layout!.rooms.find((rr) => rr.id === "b1")!.width
    useEditorStore.getState().alignFloorToReference("f2", "f1")
    useEditorStore.getState().undo()
    const after = useEditorStore.getState().layout!.rooms.find((rr) => rr.id === "b1")!.width
    expect(after).toBe(before)
  })

  it("returns null and mutates nothing for same floor", () => {
    expect(useEditorStore.getState().alignFloorToReference("f2", "f2")).toBeNull()
  })
})

describe("editor-store roof zone visibility toggles", () => {
  beforeEach(() => {
    useEditorStore.getState().loadLayout(
      {
        ...makeLayout(),
        roofZones: [
          { id: "rz-1", type: "pelana", floorId: "f1", x: 2, y: 2, widthM: 4, depthM: 4, slopeDeg: 20, overhangM: 0.5 },
        ],
      },
      sampleSite, []
    )
  })

  it("setShowRoofZones toggles the global roof visibility flag", () => {
    expect(useEditorStore.getState().showRoofZones).toBe(true)
    useEditorStore.getState().setShowRoofZones(false)
    expect(useEditorStore.getState().showRoofZones).toBe(false)
  })

  it("setShowHiddenRoofZones toggles the reveal flag", () => {
    expect(useEditorStore.getState().showHiddenRoofZones).toBe(false)
    useEditorStore.getState().setShowHiddenRoofZones(true)
    expect(useEditorStore.getState().showHiddenRoofZones).toBe(true)
  })

  it("setRoofZoneHidden marks one zone hidden (undo-able)", () => {
    useEditorStore.getState().setRoofZoneHidden("rz-1", true)
    expect(useEditorStore.getState().layout!.roofZones![0].hidden).toBe(true)
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().layout!.roofZones![0].hidden).toBeUndefined()
  })
})

describe("editor-store — seleksi terpadu (EntityRef, unifikasi P1)", () => {
  const seeded = (): DesignLayout => ({
    ...makeLayout(),
    floors: [
      { id: "floor-1", level: 1, name: "Lantai 1", heightM: 3.2 },
      { id: "floor-2", level: 2, name: "Lantai 2", heightM: 3.2 },
    ],
    rooms: [
      ...makeLayout().rooms,
      { id: "r-up", floorId: "floor-2", name: "Atas", type: "kamar_tidur", x: 0, y: 0, width: 3, depth: 3, areaM2: 9 },
    ],
    electrical: [{ id: "el-1", roomId: "r1", type: "stopkontak", x: 1, y: 1 }],
    water: [{ id: "wa-1", roomId: "r1", type: "kran", x: 1, y: 1 }],
    sanitation: {
      septicTank: { id: "sep-1", x: 1, y: 1, widthM: 1, lengthM: 2, depthM: 1.5 },
      controlBoxes: [{ id: "cb-1", x: 2, y: 2, widthM: 0.4, lengthM: 0.4, depthM: 0.4 }],
    },
  })

  beforeEach(() => {
    useEditorStore.getState().loadLayout(seeded(), sampleSite, [])
  })

  it("select() mengisi selected + mirror legacy + pindah lantai ke lantai entity", () => {
    useEditorStore.getState().select({ kind: "room", id: "r-up" })
    const s = useEditorStore.getState()
    expect(s.selected).toEqual({ kind: "room", id: "r-up" })
    expect(s.selectedObjectId).toBe("r-up")
    expect(s.selectedFloorId).toBe("floor-2")
  })

  it("select() TIDAK menyentuh dirty/editSequence (autosave aman)", () => {
    const before = useEditorStore.getState()
    expect(before.dirty).toBe(false)
    useEditorStore.getState().select({ kind: "room", id: "r1" })
    const after = useEditorStore.getState()
    expect(after.dirty).toBe(false)
    expect(after.editSequence).toBe(before.editSequence)
  })

  it("selectObject (legacy id) terdelegasi ke select() dengan kind yang benar", () => {
    useEditorStore.getState().selectObject("el-1")
    expect(useEditorStore.getState().selected).toEqual({ kind: "electrical", id: "el-1" })
  })

  it("Del kini benar-benar menghapus titik listrik/air/sanitasi (dulu no-op)", () => {
    const st = useEditorStore.getState()
    st.selectObject("el-1")
    st.deleteSelected()
    expect(useEditorStore.getState().layout!.electrical ?? []).toHaveLength(0)

    useEditorStore.getState().selectObject("wa-1")
    useEditorStore.getState().deleteSelected()
    expect(useEditorStore.getState().layout!.water ?? []).toHaveLength(0)

    useEditorStore.getState().selectObject("cb-1")
    useEditorStore.getState().deleteSelected()
    expect(useEditorStore.getState().layout!.sanitation?.controlBoxes ?? []).toHaveLength(0)
  })

  it("deleteRef kind tanpa jalur hapus = no-op TANPA entri undo", () => {
    const pastLen = useEditorStore.getState().past.length
    useEditorStore.getState().deleteRef({ kind: "roof" })
    useEditorStore.getState().deleteRef({ kind: "wall", roomId: "r1", side: "n" })
    expect(useEditorStore.getState().past.length).toBe(pastLen)
  })

  it("epilogue validateSelection: ref menggantung di-null-kan oleh mutasi", () => {
    useEditorStore.getState().select({ kind: "room", id: "r2" })
    useEditorStore.getState().deleteObject("r2")
    const s = useEditorStore.getState()
    expect(s.selected).toBeNull()
    expect(s.selectedObjectId).toBeNull()
  })

  it("undo membersihkan seleksi (ref bisa menggantung di snapshot lama)", () => {
    useEditorStore.getState().select({ kind: "room", id: "r1" })
    useEditorStore.getState().updateRoom("r1", { width: 4 })
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().selected).toBeNull()
  })
})

describe("editor-store roof-zone auto-fit + layer Atap", () => {
  const zoneLayout = (): DesignLayout => ({
    ...makeLayout(),
    roofZones: [
      {
        id: "rz-snap",
        type: "datar",
        x: 5,
        y: 2,
        widthM: 4,
        depthM: 3,
        slopeDeg: 0,
        overhangM: 0.3,
      },
    ],
  })

  beforeEach(() => {
    useEditorStore.getState().loadLayout(zoneLayout(), sampleSite, [])
    // Tepi ruang sengaja dibuat TIDAK segrid (3.63) supaya snap-tepi terbukti
    // menang atas snap-grid.
    useEditorStore.getState().updateRoom("r1", { width: 3.13 })
  })

  it("resize zona nge-snap ke tepi ruang lantai referensi (auto-fit)", () => {
    const st = useEditorStore.getState()
    st.beginDrag()
    // r1 kanan = 0.5 + 3.13 = 3.63; target 3.66 masuk toleransi 0.05
    // (kandidat lain — center footprint 3.75, grid 3.5 — di luar toleransi).
    st.dragRoofZoneResize("rz-snap", "w", 3.66, 2, 0.05)
    st.endDrag()
    const z = useEditorStore.getState().layout!.roofZones![0]
    // Representasi center+size di-round2 → tepi presisi ±0.005 m (½ cm).
    expect(z.x - z.widthM / 2).toBeCloseTo(3.63, 1)
    expect(Math.abs(z.x - z.widthM / 2 - 3.63)).toBeLessThanOrEqual(0.0051)
  })

  it("geser zona nge-snap tepi-ke-tepi dan memunculkan alignment guide", () => {
    const st = useEditorStore.getState()
    st.beginDrag()
    // Target tepi kiri = 3.58 (pusat 5.58) → tepi r1 3.63 (d=0.05) menang;
    // center r2 5.5 (d=0.08) di luar toleransi 0.06.
    st.dragRoofZoneTo("rz-snap", 5.58, 2, 0.06)
    // Guide dibaca SEBELUM endDrag (pointer-up membersihkannya).
    expect(useEditorStore.getState().alignmentGuides.x).toContain(3.63)
    st.endDrag()
    const z = useEditorStore.getState().layout!.roofZones![0]
    expect(z.x - z.widthM / 2).toBeCloseTo(3.63, 2)
  })

  it("memilih zona atap memindahkan editor ke layer Atap", () => {
    useEditorStore.getState().select({ kind: "roofZone", id: "rz-snap" })
    expect(useEditorStore.getState().selectedFloorId).toBe(ROOF_LAYER_ID)
  })

  it("addRoom di layer Atap ditolak (bukan lantai sungguhan)", () => {
    useEditorStore.getState().setSelectedFloor(ROOF_LAYER_ID)
    const before = useEditorStore.getState().layout!.rooms.length
    useEditorStore.getState().addRoom("kamar_tidur", 2, 2)
    expect(useEditorStore.getState().layout!.rooms.length).toBe(before)
  })
})

describe("editor-store akses dak (rooftop access)", () => {
  const rooftopLayout = (): DesignLayout => ({
    ...makeLayout(),
    floors: [
      { id: "floor-1", level: 1, name: "Lantai 1", heightM: 3.2 },
      { id: "floor-2", level: 2, name: "Lantai 2", heightM: 3.2 },
      { id: "floor-rooftop", level: 3, name: "Rooftop", heightM: 0.3 },
    ],
  })

  beforeEach(() => {
    useEditorStore.getState().loadLayout(rooftopLayout(), sampleSite, [])
  })

  it("addRooftopAccessStair menaruh tangga di LANTAI TERATAS biasa (bukan dasar)", () => {
    const id = useEditorStore.getState().addRooftopAccessStair()
    const stair = useEditorStore.getState().layout!.rooms.find((r) => r.id === id)
    expect(stair?.type).toBe("tangga")
    expect(stair?.floorId).toBe("floor-2")
  })

  it("validasi: dak tanpa akses → warning; tangga akses menghapusnya", () => {
    const has = () =>
      useEditorStore
        .getState()
        .layout!.validation.issues.some((i) => i.id === "rooftop:no-access")
    // Trigger revalidate via mutasi apa pun.
    useEditorStore.getState().updateRoom("r1", { width: 3.25 })
    expect(has()).toBe(true)
    useEditorStore.getState().addRooftopAccessStair()
    expect(has()).toBe(false)
  })

  it("tangga monyet memenuhi akses dak servis; dak dihuni tetap dapat saran tangga", () => {
    useEditorStore.getState().setRooftopAccessLadder("e")
    const issues = () => useEditorStore.getState().layout!.validation.issues
    expect(issues().some((i) => i.id === "rooftop:no-access")).toBe(false)
    expect(useEditorStore.getState().layout!.rooftopAccess).toEqual({
      kind: "tangga_monyet",
      side: "e",
    })

    // Dak dihuni (rooftop_lounge) + hanya ladder → saran tangga dalam ruang.
    useEditorStore.getState().addRooftopTerrace()
    expect(issues().some((i) => i.id === "rooftop:ladder-only")).toBe(true)

    // Lepas ladder → kembali warning tanpa akses.
    useEditorStore.getState().setRooftopAccessLadder(null)
    expect(issues().some((i) => i.id === "rooftop:no-access")).toBe(true)
  })
})

describe("editor-store posisi tangga monyet (posM)", () => {
  beforeEach(() => {
    useEditorStore.getState().loadLayout(
      {
        ...makeLayout(),
        floors: [
          { id: "floor-1", level: 1, name: "Lantai 1", heightM: 3.2 },
          { id: "floor-rooftop", level: 2, name: "Rooftop", heightM: 0.3 },
        ],
      },
      sampleSite,
      [],
    )
    useEditorStore.getState().setRooftopAccessLadder("s")
  })

  it("setRooftopAccessLadder dgn posM meng-clamp ke rentang sisi", () => {
    // Footprint makeLayout: x0=0.5 w=6.5 → sisi s panjang 6.5.
    useEditorStore.getState().setRooftopAccessLadder("s", 99)
    expect(useEditorStore.getState().layout!.rooftopAccess?.posM).toBe(6.25)
    useEditorStore.getState().setRooftopAccessLadder("s", -3)
    expect(useEditorStore.getState().layout!.rooftopAccess?.posM).toBe(0.25)
  })

  it("dragRooftopLadderTo menggeser live; ganti sisi mereset posisi", () => {
    const st = useEditorStore.getState()
    st.beginDrag()
    st.dragRooftopLadderTo(2.4)
    st.endDrag()
    expect(useEditorStore.getState().layout!.rooftopAccess?.posM).toBe(2.4)

    // Ganti sisi → panjang sisi beda, posM lama dibuang.
    useEditorStore.getState().setRooftopAccessLadder("e")
    expect(useEditorStore.getState().layout!.rooftopAccess).toEqual({
      kind: "tangga_monyet",
      side: "e",
    })
  })
})

describe("editor-store generateWallAccent (aksen fasad 1-klik)", () => {
  beforeEach(() => {
    useEditorStore.getState().loadLayout(makeLayout(), sampleSite, [])
  })

  it("regenerate menimpa deret ber-tag sama (idempoten); null menghapus", () => {
    const st = useEditorStore.getState()
    st.generateWallAccent("r1", "s", {
      mode: "vertical_fins", pitchM: 0.5, heightM: 2.2, sillM: 0.3, materialId: "beton_ekspos",
    })
    const n1 = useEditorStore.getState().layout!.exteriorElements!.length
    expect(n1).toBeGreaterThan(0)

    st.generateWallAccent("r1", "s", {
      mode: "horizontal_bands", pitchM: 0.5, heightM: 1.5, sillM: 0.3, materialId: "beton_ekspos",
    })
    const els = useEditorStore.getState().layout!.exteriorElements!
    expect(els.every((e) => e.label?.includes("band"))).toBe(true)

    st.generateWallAccent("r1", "s", null)
    expect(useEditorStore.getState().layout!.exteriorElements).toBeUndefined()
  })

  it("elemen manual non-tag tidak tersapu", () => {
    const st = useEditorStore.getState()
    st.addExteriorElement({
      ...({} as never),
      id: "manual-1",
      kind: "facade_panel",
      x: 1, y: 1, widthM: 1, depthM: 0.2, heightM: 2,
    } as never)
    st.generateWallAccent("r1", "s", {
      mode: "vertical_fins", pitchM: 0.5, heightM: 2, sillM: 0, materialId: "x",
    })
    st.generateWallAccent("r1", "s", null)
    expect(
      useEditorStore.getState().layout!.exteriorElements!.some((e) => e.id === "manual-1"),
    ).toBe(true)
  })
})

describe("editor-store dragCourtyardRectTo (lubang courtyard editable)", () => {
  beforeEach(() => {
    const l = makeLayout()
    l.rooms.push({
      id: "taman-1", floorId: "floor-1", name: "Taman", type: "taman",
      x: 2, y: 2, width: 3, depth: 2, areaM2: 6, openToSky: true,
    })
    useEditorStore.getState().loadLayout(l, sampleSite, [])
  })

  it("menulis openToSkyRect ter-clamp ⊆ rect ruang + margin 0.5", () => {
    const st = useEditorStore.getState()
    st.beginDrag()
    st.dragCourtyardRectTo("taman-1", { x: -10, y: 1.8, width: 2, depth: 1 })
    st.endDrag()
    const r = useEditorStore.getState().layout!.rooms.find((x) => x.id === "taman-1")!
    // Batas kiri = room.x - 0.5 = 1.5.
    expect(r.openToSkyRect).toEqual({ x: 1.5, y: 1.8, width: 2, depth: 1 })
  })

  it("ruang tanpa openToSky diabaikan; matikan toggle menghapus rect", () => {
    const st = useEditorStore.getState()
    st.updateRoom("taman-1", { openToSky: undefined })
    st.beginDrag()
    st.dragCourtyardRectTo("taman-1", { x: 2, y: 2, width: 1, depth: 1 })
    st.endDrag()
    expect(
      useEditorStore.getState().layout!.rooms.find((x) => x.id === "taman-1")!.openToSkyRect,
    ).toBeUndefined()
  })
})

describe("editor-store convertRoofToCourtyardZones (atap miring → cincin)", () => {
  beforeEach(() => {
    const l = makeLayout()
    // Atap pelana + taman openToSky di TENGAH footprint (r1 0.5-3.5, r2 4-7).
    l.roof = { type: "pelana", slopeDeg: 30, overhangM: 0.5, material: "genteng_beton" }
    l.rooms.push({
      id: "taman-1", floorId: "floor-1", name: "Taman", type: "taman",
      x: 3, y: 1, width: 1.5, depth: 1.5, areaM2: 2.25,
    })
    useEditorStore.getState().loadLayout(l, sampleSite, [])
  })

  it("membuat cincin zona; sisi menghadap lubang overhang 0; room jadi openToSky; pindah layer Atap", () => {
    useEditorStore.getState().convertRoofToCourtyardZones("taman-1")
    const st = useEditorStore.getState()
    const zones = st.layout!.roofZones!
    expect(zones.length).toBeGreaterThanOrEqual(3)
    expect(zones.every((z) => z.type === "pelana")).toBe(true)
    expect(zones.every((z) => z.materialId === "genteng_beton")).toBe(true)
    // Tiap zona punya tepat satu sisi overhang-0 (menghadap lubang).
    for (const z of zones) {
      const sides = Object.entries(z.overhangSides ?? {})
      expect(sides).toHaveLength(1)
      expect(sides[0][1]).toBe(0)
      expect(z.overhangM).toBe(0.5)
    }
    expect(st.layout!.rooms.find((r) => r.id === "taman-1")!.openToSky).toBe(true)
    expect(st.selected?.kind).toBe("roofZone")
    expect(st.selectedFloorId).toBe(ROOF_LAYER_ID)
    // Tidak ada zona menutupi titik tengah lubang.
    const cx = 3.75, cy = 1.75
    for (const z of zones) {
      const inside =
        Math.abs(cx - z.x) < z.widthM / 2 - 1e-6 && Math.abs(cy - z.y) < z.depthM / 2 - 1e-6
      expect(inside).toBe(false)
    }
  })

  it("no-op bila sudah ada roofZones eksplisit", () => {
    useEditorStore.getState().convertRoofToCourtyardZones("taman-1")
    const zones1 = useEditorStore.getState().layout!.roofZones!.map((z) => z.id)
    useEditorStore.getState().convertRoofToCourtyardZones("taman-1")
    expect(useEditorStore.getState().layout!.roofZones!.map((z) => z.id)).toEqual(zones1)
  })
})

describe("editor-store updateFloor (tinggi lantai, Fase D5)", () => {
  beforeEach(() => {
    useEditorStore.getState().loadLayout(makeLayout(), sampleSite, [])
  })

  it("menulis heightM ter-clamp 2.4–4.5, undo-able; rooftop ditolak", () => {
    const st = useEditorStore.getState()
    st.updateFloor("floor-1", { heightM: 3.6 })
    expect(useEditorStore.getState().layout!.floors[0].heightM).toBe(3.6)
    st.updateFloor("floor-1", { heightM: 99 })
    expect(useEditorStore.getState().layout!.floors[0].heightM).toBe(4.5)
    useEditorStore.getState().undo()
    useEditorStore.getState().undo()
    // Fixture makeLayout mentah 3.2 (loadLayout tidak menormalisasi —
    // normalisasi v3 hidup di jalur load repo/HTTP).
    expect(useEditorStore.getState().layout!.floors[0].heightM).toBe(3.2)

    st.setRooftop(true)
    st.updateFloor("floor-rooftop", { heightM: 3 })
    expect(
      useEditorStore.getState().layout!.floors.find((f) => f.id === "floor-rooftop")!.heightM,
    ).toBe(0.3)
  })
})

describe("editor-store updateFloor offsetM (cantilever, CB3)", () => {
  const twoFloor = (): DesignLayout => ({
    ...makeLayout(),
    floors: [
      { id: "floor-1", level: 1, name: "Lantai 1", heightM: 3.2 },
      { id: "floor-2", level: 2, name: "Lantai 2", heightM: 3.2 },
    ],
  })

  beforeEach(() => {
    useEditorStore.getState().loadLayout(twoFloor(), sampleSite, [])
  })

  it("menulis offsetM ter-clamp ±1.5 tiap sumbu, undo-able", () => {
    const st = useEditorStore.getState()
    st.updateFloor("floor-2", { offsetM: { dx: 1, dy: -0.5 } })
    expect(
      useEditorStore.getState().layout!.floors.find((f) => f.id === "floor-2")!.offsetM,
    ).toEqual({ dx: 1, dy: -0.5 })

    // Clamp tiap sumbu ke ±1.5.
    st.updateFloor("floor-2", { offsetM: { dx: 9, dy: -9 } })
    expect(
      useEditorStore.getState().layout!.floors.find((f) => f.id === "floor-2")!.offsetM,
    ).toEqual({ dx: 1.5, dy: -1.5 })

    // Undo mengembalikan offset sebelumnya.
    useEditorStore.getState().undo()
    expect(
      useEditorStore.getState().layout!.floors.find((f) => f.id === "floor-2")!.offsetM,
    ).toEqual({ dx: 1, dy: -0.5 })
  })

  it("mempertahankan heightM/name saat hanya mengubah offsetM", () => {
    const st = useEditorStore.getState()
    st.updateFloor("floor-2", { offsetM: { dx: 0.8, dy: 0 } })
    const f = useEditorStore.getState().layout!.floors.find((x) => x.id === "floor-2")!
    expect(f.heightM).toBe(3.2)
    expect(f.name).toBe("Lantai 2")
  })

  it("rooftop menolak offsetM", () => {
    const st = useEditorStore.getState()
    st.setRooftop(true)
    st.updateFloor("floor-rooftop", { offsetM: { dx: 1, dy: 1 } })
    expect(
      useEditorStore.getState().layout!.floors.find((f) => f.id === "floor-rooftop")!.offsetM,
    ).toBeUndefined()
  })
})

describe("editor-store levelOffsetM clamp keras ±0.9 (E1)", () => {
  beforeEach(() => {
    useEditorStore.getState().loadLayout(makeLayout(), sampleSite, [])
  })

  it("edit baru di-clamp ±0.9; data lama di luar rentang tidak disentuh load", () => {
    useEditorStore.getState().updateRoom("r1", { levelOffsetM: 2.5 })
    expect(room("r1")!.levelOffsetM).toBe(0.9)
    useEditorStore.getState().updateRoom("r1", { levelOffsetM: -3 })
    expect(room("r1")!.levelOffsetM).toBe(-0.9)
  })
})

describe("editor-store addMezzanine (E7)", () => {
  const twoFloor = (): DesignLayout => ({
    ...makeLayout(),
    floors: [
      { id: "floor-1", level: 1, name: "Lantai 1", heightM: 3.2 },
      { id: "floor-2", level: 2, name: "Lantai 2", heightM: 3.2 },
    ],
  })

  beforeEach(() => {
    useEditorStore.getState().loadLayout(twoFloor(), sampleSite, [])
  })

  it("menyisipkan mezzanine TEPAT setelah induk + ruang 40% + tangga — SATU undo", () => {
    const before = useEditorStore.getState().past.length
    const id = useEditorStore.getState().addMezzanine("floor-1")
    expect(id).toBeTruthy()

    const st = useEditorStore.getState()
    const floors = st.layout!.floors
    // Sisip tepat setelah induk (index 1), floor-2 bergeser ke belakang.
    expect(floors.map((f) => f.id)).toEqual(["floor-1", id, "floor-2"])
    const mezz = floors[1]
    expect(mezz.kind).toBe("mezzanine")
    expect(mezz.level).toBe(1.5)
    expect(mezz.name).toBe("Mezzanine")
    expect(mezz.heightM).toBe(2.2)
    expect(mezz.baseOffsetM).toBe(1.6) // ½ × f2f induk (3.2)

    // Satu ruang default 40% luas footprint induk, di pojok footprint.
    // Fixture: bbox indoor floor-1 = x 0.5..7 (6.5 m) × y 0.5..3.5 (3 m)
    // → luas 19.5 m²; ruang mezz = 6.5 × 1.2 = 7.8 m² (40%).
    const mezzRooms = st.layout!.rooms.filter((r) => r.floorId === id)
    expect(mezzRooms).toHaveLength(1)
    expect(mezzRooms[0].type).toBe("balkon") // platform terbuka → auto-railing (E6)
    expect(mezzRooms[0].name).toBe("Mezzanine")
    expect(mezzRooms[0].x).toBe(0.5)
    expect(mezzRooms[0].y).toBe(0.5)
    expect(mezzRooms[0].areaM2).toBeCloseTo(19.5 * 0.4, 5)

    // Induk belum punya tangga → tangga otomatis ditambahkan di induk.
    expect(
      st.layout!.rooms.some((r) => r.floorId === "floor-1" && r.type === "tangga"),
    ).toBe(true)

    // Seleksi pindah ke lantai mezzanine baru; seluruhnya SATU entri undo.
    expect(st.selectedFloorId).toBe(id)
    expect(st.past.length).toBe(before + 1)
    useEditorStore.getState().undo()
    const after = useEditorStore.getState().layout!
    expect(after.floors.map((f) => f.id)).toEqual(["floor-1", "floor-2"])
    expect(after.rooms.some((r) => r.floorId === id)).toBe(false)
    expect(after.rooms.some((r) => r.type === "tangga")).toBe(false)
  })

  it("tidak menambah tangga bila induk sudah punya", () => {
    useEditorStore.getState().addStairAt(5, 3) // tangga eksisting di floor-1
    useEditorStore.getState().addMezzanine("floor-1")
    const stairs = useEditorStore
      .getState()
      .layout!.rooms.filter((r) => r.floorId === "floor-1" && r.type === "tangga")
    expect(stairs).toHaveLength(1)
  })

  it("guard: dobel-mezzanine, induk mezzanine/rooftop, id tak dikenal → null tanpa undo", () => {
    const id = useEditorStore.getState().addMezzanine("floor-1")!
    const before = useEditorStore.getState().past.length
    // Induk sudah ber-mezzanine langsung di atasnya.
    expect(useEditorStore.getState().addMezzanine("floor-1")).toBeNull()
    // Mezzanine bukan induk yang sah.
    expect(useEditorStore.getState().addMezzanine(id)).toBeNull()
    // Rooftop bukan induk yang sah.
    useEditorStore.getState().setRooftop(true)
    expect(useEditorStore.getState().addMezzanine("floor-rooftop")).toBeNull()
    // Id tak dikenal.
    expect(useEditorStore.getState().addMezzanine("floor-nope")).toBeNull()
    // Hanya setRooftop yang menambah entri undo (guard tidak).
    expect(useEditorStore.getState().past.length).toBe(before + 1)
  })

  it("removeFloor generik menghapus lantai mezzanine beserta ruangnya", () => {
    const id = useEditorStore.getState().addMezzanine("floor-1")!
    useEditorStore.getState().removeFloor(id)
    const l = useEditorStore.getState().layout!
    expect(l.floors.some((f) => f.id === id)).toBe(false)
    expect(l.rooms.some((r) => r.floorId === id)).toBe(false)
  })
})

describe("editor-store updateFloor baseOffsetM & heightM mezzanine (E7)", () => {
  beforeEach(() => {
    useEditorStore.getState().loadLayout(
      {
        ...makeLayout(),
        floors: [
          { id: "floor-1", level: 1, name: "Lantai 1", heightM: 3.2 },
          { id: "floor-2", level: 2, name: "Lantai 2", heightM: 3.2 },
        ],
      },
      sampleSite,
      [],
    )
  })

  it("baseOffsetM di-clamp [1.0, f2f induk − 0.5]; non-mezzanine ditolak", () => {
    const id = useEditorStore.getState().addMezzanine("floor-1")!
    const mezz = () =>
      useEditorStore.getState().layout!.floors.find((f) => f.id === id)!

    useEditorStore.getState().updateFloor(id, { baseOffsetM: 0.2 })
    expect(mezz().baseOffsetM).toBe(1.0)
    useEditorStore.getState().updateFloor(id, { baseOffsetM: 9 })
    expect(mezz().baseOffsetM).toBe(2.7) // 3.2 − 0.5

    // Non-mezzanine: baseOffsetM ditolak (tidak ditulis).
    useEditorStore.getState().updateFloor("floor-1", { baseOffsetM: 2 })
    expect(
      useEditorStore.getState().layout!.floors[0].baseOffsetM,
    ).toBeUndefined()
  })

  it("heightM mezzanine boleh turun sampai 2.0; lantai reguler tetap min 2.4", () => {
    const id = useEditorStore.getState().addMezzanine("floor-1")!
    useEditorStore.getState().updateFloor(id, { heightM: 1.0 })
    expect(
      useEditorStore.getState().layout!.floors.find((f) => f.id === id)!.heightM,
    ).toBe(2.0)
    useEditorStore.getState().updateFloor("floor-1", { heightM: 1.0 })
    expect(useEditorStore.getState().layout!.floors[0].heightM).toBe(2.4)
  })
})

describe("editor-store readOnly (public viewer plumbing)", () => {
  it("defaults to false when loadLayout is called without opts", () => {
    useEditorStore.getState().loadLayout(makeLayout(), sampleSite, [])
    expect(useEditorStore.getState().readOnly).toBe(false)
  })

  it("loadLayout(..., { readOnly: true }) sets readOnly", () => {
    useEditorStore
      .getState()
      .loadLayout(makeLayout(), sampleSite, [], null, { readOnly: true })
    expect(useEditorStore.getState().readOnly).toBe(true)
  })

  it("a later loadLayout without opts resets readOnly back to false (the real editor stays full-edit)", () => {
    useEditorStore
      .getState()
      .loadLayout(makeLayout(), sampleSite, [], null, { readOnly: true })
    expect(useEditorStore.getState().readOnly).toBe(true)

    useEditorStore.getState().loadLayout(makeLayout(), sampleSite, [])
    expect(useEditorStore.getState().readOnly).toBe(false)
  })

  it("commit() (e.g. updateRoom) is a no-op while readOnly", () => {
    useEditorStore
      .getState()
      .loadLayout(makeLayout(), sampleSite, [], null, { readOnly: true })
    useEditorStore.getState().updateRoom("r1", { width: 4, depth: 4 })
    expect(room("r1")!.width).toBe(3)
    expect(useEditorStore.getState().dirty).toBe(false)
    expect(useEditorStore.getState().past).toHaveLength(0)
  })

  it("live() (drag fast-path, e.g. dragRoomTo) is a no-op while readOnly", () => {
    useEditorStore
      .getState()
      .loadLayout(makeLayout(), sampleSite, [], null, { readOnly: true })
    useEditorStore.getState().beginDrag()
    useEditorStore.getState().dragRoomTo("r1", 5, 5)
    expect(room("r1")!.x).not.toBe(5)
    expect(useEditorStore.getState().dirty).toBe(false)
  })
})

// Fase 3 (unifikasi UI editor): pendingRoomType/pendingElectricalType/
// pendingWaterType/pendingExteriorKind/pendingRoofZoneType (5 field
// terpisah) dikonsolidasi jadi SATU `pendingPlacement {tool, variant}` —
// palette rail (Ruang/Utilitas/Eksterior) men-set keduanya bersamaan.
describe("editor-store pendingPlacement (konsolidasi 5 field pending*Type)", () => {
  beforeEach(() => {
    useEditorStore.getState().loadLayout(makeLayout(), sampleSite, [])
  })

  it("setPendingPlacement menyimpan tool + variant", () => {
    useEditorStore.getState().setPendingPlacement({ tool: "room", variant: "dapur" })
    expect(useEditorStore.getState().pendingPlacement).toEqual({
      tool: "room",
      variant: "dapur",
    })
  })

  it("setTool ke tool LAIN membuang pendingPlacement lama (kategori tak lagi relevan)", () => {
    useEditorStore.getState().setPendingPlacement({ tool: "room", variant: "dapur" })
    useEditorStore.getState().setTool("door")
    expect(useEditorStore.getState().pendingPlacement).toBeNull()
  })

  it("setTool ke tool YANG SAMA mempertahankan variant (mis. keydown 'v' berulang saat tool select)", () => {
    useEditorStore.getState().setPendingPlacement({ tool: "electrical", variant: "saklar_ganda" })
    useEditorStore.getState().setTool("electrical")
    expect(useEditorStore.getState().pendingPlacement).toEqual({
      tool: "electrical",
      variant: "saklar_ganda",
    })
  })

  it("addRoom membuang pendingPlacement setelah ruang ditempatkan (satu pick = satu ruang)", () => {
    useEditorStore.getState().setPendingPlacement({ tool: "room", variant: "dapur" })
    useEditorStore.getState().setTool("room")
    useEditorStore.getState().addRoom("dapur", 6, 6)
    expect(useEditorStore.getState().pendingPlacement).toBeNull()
  })

  it("addRoofZone membuang pendingPlacement setelah zona ditempatkan", () => {
    useEditorStore.getState().setPendingPlacement({ tool: "roofZone", variant: "datar" })
    useEditorStore.getState().setTool("roofZone")
    useEditorStore.getState().addRoofZone({
      id: "rz-1",
      type: "datar",
      x: 2,
      y: 2,
      widthM: 3,
      depthM: 3,
      slopeDeg: 0,
      overhangM: 0.3,
    })
    expect(useEditorStore.getState().pendingPlacement).toBeNull()
  })

  it("loadLayout mereset pendingPlacement ke null", () => {
    useEditorStore.getState().setPendingPlacement({ tool: "exterior", variant: "fence" })
    useEditorStore.getState().loadLayout(makeLayout(), sampleSite, [])
    expect(useEditorStore.getState().pendingPlacement).toBeNull()
  })
})
