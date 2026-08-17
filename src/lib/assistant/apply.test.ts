// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest"

import {
  applyFloorplanActions,
  applyFloorplanActionsAtomic,
  applyInteriorActions,
} from "@/lib/assistant/apply"
import { useEditorStore } from "@/stores/editor-store"
import { useInteriorStore } from "@/stores/interior-store"
import { parseOpeningWall } from "@/lib/geometry"
import { buildingFootprint } from "@/lib/structural/grid"
import { makeLayout, sampleSite } from "@/test-utils/fixtures"
import { buildInitialFloorplan } from "@/lib/server/initial-floorplan"
import { handleFloorplanInstruction } from "@/lib/assistant/deterministic"
import type { FloorplanScene } from "@/lib/assistant/actions"
import type { DesignLayout, SanitationObject, Project, Brief } from "@/types"

const septic = (): SanitationObject => ({
  id: "sani-septic1",
  x: 2,
  y: 6,
  widthM: 1.2,
  lengthM: 2.4,
  depthM: 1.8,
  capacity: 4.32,
})

describe("applyFloorplanActions — moveSanitationObject undo parity", () => {
  beforeEach(() => {
    useEditorStore.getState().loadLayout(makeLayout(), sampleSite, [])
    useEditorStore.getState().setSanitation({ septicTank: septic() })
  })

  it("records exactly one undo entry for an AI-dispatched move (bracketed gesture)", () => {
    const before = useEditorStore.getState().past.length
    const applied = applyFloorplanActions([
      { type: "moveSanitationObject", kind: "septicTank", x: 3, y: 5 },
    ])
    expect(applied).toBe(1)
    const moved = useEditorStore.getState().layout!.sanitation!.septicTank!
    expect(moved.x).toBe(3)
    expect(moved.y).toBe(5)
    // one clean history entry → Ctrl+Z reverts the move
    expect(useEditorStore.getState().past.length).toBe(before + 1)
    useEditorStore.getState().undo()
    const reverted = useEditorStore.getState().layout!.sanitation!.septicTank!
    expect(reverted.x).toBe(2)
    expect(reverted.y).toBe(6)
  })

  it("skips (no-op, not counted) a move targeting a missing object", () => {
    const applied = applyFloorplanActions([
      { type: "moveSanitationObject", kind: "soakwell", x: 1, y: 1 },
    ])
    expect(applied).toBe(0)
    expect(useEditorStore.getState().layout!.sanitation!.soakwell).toBeUndefined()
  })
})

/** makeLayout() + a rooftop floor so the layout carries a real rooftop deck.
 *  Non-rooftop rooms r1/r2 give a footprint of x0=0.5 y0=0.5 6.5×3 m. */
function makeRooftopLayout(): DesignLayout {
  const base = makeLayout()
  return {
    ...base,
    floors: [...base.floors, { id: "floor-rooftop", level: 2, name: "Rooftop", heightM: 3.2 }],
  }
}

describe("applyFloorplanActions — rooftop area (set/clear + undo parity)", () => {
  beforeEach(() => {
    useEditorStore.getState().loadLayout(makeRooftopLayout(), sampleSite, [])
  })

  it("sets rooftopArea to the clamped rect (within footprint, unchanged) and returns 1", () => {
    const applied = applyFloorplanActions([
      { type: "setRooftopArea", area: { x: 1, y: 1, width: 2, depth: 2 } },
    ])
    expect(applied).toBe(1)
    expect(useEditorStore.getState().layout!.rooftopArea).toEqual({ x: 1, y: 1, width: 2, depth: 2 })
  })

  it("clamps an oversized area to inside the footprint", () => {
    const applied = applyFloorplanActions([
      { type: "setRooftopArea", area: { x: 0, y: 0, width: 100, depth: 100 } },
    ])
    expect(applied).toBe(1)
    const area = useEditorStore.getState().layout!.rooftopArea!
    const fp = buildingFootprint(useEditorStore.getState().layout!)
    // stored rect ⊆ footprint
    expect(area.x).toBeGreaterThanOrEqual(fp.x0 - 1e-9)
    expect(area.y).toBeGreaterThanOrEqual(fp.y0 - 1e-9)
    expect(area.x + area.width).toBeLessThanOrEqual(fp.x0 + fp.widthM + 1e-9)
    expect(area.y + area.depth).toBeLessThanOrEqual(fp.y0 + fp.depthM + 1e-9)
  })

  it("clearRooftopArea removes a previously set area", () => {
    applyFloorplanActions([{ type: "setRooftopArea", area: { x: 1, y: 1, width: 2, depth: 2 } }])
    expect(useEditorStore.getState().layout!.rooftopArea).toBeDefined()
    const applied = applyFloorplanActions([{ type: "clearRooftopArea" }])
    expect(applied).toBe(1)
    expect(useEditorStore.getState().layout!.rooftopArea).toBeUndefined()
  })

  it("records exactly one undo entry per setRooftopArea; undo restores the prior value", () => {
    const before = useEditorStore.getState().past.length
    const applied = applyFloorplanActions([
      { type: "setRooftopArea", area: { x: 1, y: 1, width: 2, depth: 2 } },
    ])
    expect(applied).toBe(1)
    expect(useEditorStore.getState().layout!.rooftopArea).toEqual({ x: 1, y: 1, width: 2, depth: 2 })
    // one clean history entry → Ctrl+Z reverts the change
    expect(useEditorStore.getState().past.length).toBe(before + 1)
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().layout!.rooftopArea).toBeUndefined()
  })
})

/* ----- Paritas editor 2026-07: bukaan kind, cladding, louver, lampu, rooftop, fascia ----- */

describe("applyFloorplanActions — openings (kind garasi, frameColor, model library)", () => {
  beforeEach(() => {
    useEditorStore.getState().loadLayout(makeLayout(), sampleSite, [])
  })

  it("addOpening with kind creates a garage door with the kind's defaults (2.7×2.2)", () => {
    const applied = applyFloorplanActions([
      { type: "addOpening", roomId: "r1", side: "n", positionM: 1.5, openingType: "door", kind: "garage_door" },
    ])
    expect(applied).toBe(1)
    const op = useEditorStore.getState().layout!.openings.at(-1)!
    expect(op.kind).toBe("garage_door")
    expect(op.type).toBe("door")
    expect(op.widthM).toBe(2.7)
    expect(op.heightM).toBe(2.2)
  })

  it("updateOpening: kind wins over openingType, explicit fields beat kind defaults, modelUrl:null detaches", () => {
    applyFloorplanActions([
      { type: "addOpening", roomId: "r1", side: "n", positionM: 1, openingType: "window" },
    ])
    const id = useEditorStore.getState().layout!.openings.at(-1)!.id
    const applied = applyFloorplanActions([
      {
        type: "updateOpening",
        openingId: id,
        patch: { kind: "garage_door", openingType: "window", widthM: 3, frameColor: "#3c4245", modelUrl: null },
      },
    ])
    expect(applied).toBe(1)
    const op = useEditorStore.getState().layout!.openings.find((o) => o.id === id)!
    expect(op.kind).toBe("garage_door")
    expect(op.type).toBe("door") // derived from the kind meta, NOT the stale openingType
    expect(op.widthM).toBe(3) // explicit patch field beats the 2.7 kind default
    expect(op.heightM).toBe(2.2) // kind default kept where not overridden
    expect(op.frameColor).toBe("#3c4245")
    expect(op.modelUrl).toBeNull()
  })

  it("updateOpening forwards frameDepthM to the store (gap pre-existing: schema+prompt+UI had it, apply.ts didn't)", () => {
    applyFloorplanActions([
      { type: "addOpening", roomId: "r1", side: "n", positionM: 1, openingType: "window" },
    ])
    const id = useEditorStore.getState().layout!.openings.at(-1)!.id
    const applied = applyFloorplanActions([
      { type: "updateOpening", openingId: id, patch: { frameDepthM: 0.35 } },
    ])
    expect(applied).toBe(1)
    const op = useEditorStore.getState().layout!.openings.find((o) => o.id === id)!
    expect(op.frameDepthM).toBe(0.35)
  })
})

describe("applyFloorplanActions — fasad (cladding per dinding + louver band)", () => {
  beforeEach(() => {
    useEditorStore.getState().loadLayout(makeLayout(), sampleSite, [])
  })

  it("setWallCladding writes the outer/inner maps; null clears back to polos", () => {
    expect(
      applyFloorplanActions([
        { type: "setWallCladding", wallId: "r1:n", claddingId: "bata_putih" },
        { type: "setWallCladding", wallId: "r1:s", claddingId: "kayu_cladding", face: "inner" },
      ])
    ).toBe(2)
    expect(useEditorStore.getState().layout!.facade).toEqual({ "r1:n": "bata_putih" })
    expect(useEditorStore.getState().layout!.facadeInner).toEqual({ "r1:s": "kayu_cladding" })

    applyFloorplanActions([{ type: "setWallCladding", wallId: "r1:n", claddingId: null }])
    expect(useEditorStore.getState().layout!.facade).toBeUndefined()
  })

  it("skips (not counted) cladding on a wall whose room does not exist", () => {
    expect(
      applyFloorplanActions([{ type: "setWallCladding", wallId: "ghost:n", claddingId: "bata_putih" }])
    ).toBe(0)
  })

  it("add/update/removeFacadeElement round-trip through the store; ghost ids are skipped", () => {
    expect(applyFloorplanActions([{ type: "addFacadeElement", wallId: "r1:n" }])).toBe(1)
    const fe = useEditorStore.getState().layout!.facadeElements!.at(-1)!
    expect(fe.kind).toBe("louver_band")

    expect(
      applyFloorplanActions([
        {
          type: "updateFacadeElement",
          id: fe.id,
          patch: {
            finish: "aluminium_gelap",
            heightM: 1.8,
            kind: "roster_screen",
            modelUrl: "/models/custom-facade.glb",
            modelAssetId: "asset-facade",
          },
        },
      ])
    ).toBe(1)
    const updated = useEditorStore.getState().layout!.facadeElements!.find((x) => x.id === fe.id)!
    expect(updated.finish).toBe("aluminium_gelap")
    expect(updated.heightM).toBe(1.8)
    expect(updated.kind).toBe("roster_screen")
    expect(updated.modelUrl).toBe("/models/custom-facade.glb")
    expect(updated.modelAssetId).toBe("asset-facade")

    expect(applyFloorplanActions([{ type: "removeFacadeElement", id: fe.id }])).toBe(1)
    expect(useEditorStore.getState().layout!.facadeElements).toBeUndefined()
    expect(applyFloorplanActions([{ type: "updateFacadeElement", id: "ghost", patch: { heightM: 2 } }])).toBe(0)
  })
})

describe("applyFloorplanActions — lampu eksterior (copy-on-write)", () => {
  beforeEach(() => {
    useEditorStore.getState().loadLayout(makeLayout(), sampleSite, [])
  })

  it("addWallLamp materialises the auto list and appends a wall lamp on the host wall", () => {
    expect(useEditorStore.getState().layout!.exteriorLamps).toBeUndefined()
    expect(applyFloorplanActions([{ type: "addWallLamp", wallId: "r1:n" }])).toBe(1)
    const added = useEditorStore.getState().layout!.exteriorLamps!.at(-1)!
    expect(added.kind).toBe("wall")
    expect(added.side).toBe("n")
  })

  it("updateLamp/removeLamp target effective ids; unknown ids are skipped", () => {
    applyFloorplanActions([{ type: "addWallLamp", wallId: "r1:n" }])
    const id = useEditorStore.getState().layout!.exteriorLamps!.at(-1)!.id

    expect(
      applyFloorplanActions([{ type: "updateLamp", id, patch: { color: "#ff0000", watt: 9, intensity: 1.5 } }])
    ).toBe(1)
    const lamp = useEditorStore.getState().layout!.exteriorLamps!.find((l) => l.id === id)!
    expect(lamp.color).toBe("#ff0000")
    expect(lamp.watt).toBe(9)
    expect(lamp.intensity).toBe(1.5)

    expect(applyFloorplanActions([{ type: "removeLamp", id }])).toBe(1)
    expect(useEditorStore.getState().layout!.exteriorLamps!.some((l) => l.id === id)).toBe(false)
    expect(applyFloorplanActions([{ type: "updateLamp", id: "ghost", patch: { watt: 5 } }])).toBe(0)
  })
})

describe("applyFloorplanActions — exterior semantic parity", () => {
  beforeEach(() => {
    useEditorStore.getState().loadLayout(makeLayout(), sampleSite, [])
  })

  it("creates factory-owned ids and keeps add/update/remove undo-aware", () => {
    const before = useEditorStore.getState().past.length
    expect(applyFloorplanActions([{
      type: "addExteriorElement",
      element: {
        kind: "portal_frame",
        label: "Portal depan",
        x: 4,
        y: 1,
        widthM: 5,
        heightM: 3,
        depthM: 0.3,
        memberSizeM: 0.3,
      },
    }])).toBe(1)

    const portal = useEditorStore.getState().layout!.exteriorElements!.at(-1)!
    expect(portal.id).toMatch(/^ext-frame-/)
    expect(portal).toMatchObject({ kind: "portal_frame", label: "Portal depan" })
    expect(useEditorStore.getState().past).toHaveLength(before + 1)

    expect(applyFloorplanActions([{
      type: "updateExteriorElement",
      id: portal.id,
      patch: { widthM: 5.5, material: { materialId: "beton_ekspos" } },
    }])).toBe(1)
    expect(useEditorStore.getState().layout!.exteriorElements!.at(-1)).toMatchObject({
      widthM: 5.5,
      material: { materialId: "beton_ekspos" },
    })

    expect(applyFloorplanActions([{ type: "removeExteriorElement", id: portal.id }])).toBe(1)
    expect(useEditorStore.getState().layout!.exteriorElements).toBeUndefined()
    expect(applyFloorplanActions([{ type: "removeExteriorElement", id: "ghost" }])).toBe(0)
  })

  it("applies a facade template through the same one-step store transaction", () => {
    const before = useEditorStore.getState().past.length
    expect(applyFloorplanActions([{
      type: "applyFacadeTemplate",
      templateId: "modern_concrete_vertical",
    }])).toBe(1)
    expect(useEditorStore.getState().past).toHaveLength(before + 1)
    expect(useEditorStore.getState().layout!.exteriorElements?.some(
      (element) => element.label?.includes("vertical-panel-5"),
    )).toBe(true)
  })
})

describe("applyFloorplanActions — updateFloor (kantilever offsetM)", () => {
  beforeEach(() => {
    useEditorStore.getState().loadLayout(makeLayout(), sampleSite, [])
  })

  it("applies offsetM to the store, undo-aware", () => {
    const before = useEditorStore.getState().past.length
    expect(applyFloorplanActions([{
      type: "updateFloor",
      floorId: "floor-1",
      patch: { offsetM: { dx: 0.8, dy: -0.4 } },
    }])).toBe(1)
    expect(useEditorStore.getState().past).toHaveLength(before + 1)

    const floor = useEditorStore.getState().layout!.floors.find((f) => f.id === "floor-1")!
    expect(floor.offsetM).toEqual({ dx: 0.8, dy: -0.4 })
  })

  it("clamps offsetM beyond CANTILEVER_MAX_M (±1.5 m) at the store layer", () => {
    expect(applyFloorplanActions([{
      type: "updateFloor",
      floorId: "floor-1",
      patch: { offsetM: { dx: 3, dy: -3 } },
    }])).toBe(1)

    const floor = useEditorStore.getState().layout!.floors.find((f) => f.id === "floor-1")!
    expect(floor.offsetM).toEqual({ dx: 1.5, dy: -1.5 })
  })

  it("leaves the layout unchanged for an unknown floor id (no-op, no undo entry)", () => {
    const before = useEditorStore.getState().past.length
    const beforeLayout = useEditorStore.getState().layout
    expect(applyFloorplanActions([{
      type: "updateFloor",
      floorId: "ghost-floor",
      patch: { offsetM: { dx: 0.5, dy: 0.5 } },
    }])).toBe(0)
    expect(useEditorStore.getState().past).toHaveLength(before)
    expect(useEditorStore.getState().layout).toBe(beforeLayout)
  })
})

describe("applyFloorplanActions — setRooftop & lis fascia", () => {
  beforeEach(() => {
    useEditorStore.getState().loadLayout(makeLayout(), sampleSite, [])
  })

  it("setRooftop true adds the floor-rooftop dak; false removes it again", () => {
    expect(applyFloorplanActions([{ type: "setRooftop", enabled: true }])).toBe(1)
    expect(useEditorStore.getState().layout!.floors.some((f) => f.id === "floor-rooftop")).toBe(true)
    expect(applyFloorplanActions([{ type: "setRooftop", enabled: false }])).toBe(1)
    expect(useEditorStore.getState().layout!.floors.some((f) => f.id === "floor-rooftop")).toBe(false)
  })

  it("setRoof with a fascia object turns the band on; fascia:null actually clears it", () => {
    applyFloorplanActions([{ type: "setRoof", patch: { fascia: { heightM: 0.4, color: "#222222" } } }])
    expect(useEditorStore.getState().layout!.roof!.fascia).toEqual({ heightM: 0.4, color: "#222222" })

    // The AI-visible OFF switch (audit A8): null must delete the key despite
    // the store's {...l.roof, ...patch} merge semantics.
    expect(applyFloorplanActions([{ type: "setRoof", patch: { fascia: null } }])).toBe(1)
    expect(useEditorStore.getState().layout!.roof!.fascia).toBeUndefined()
  })
})

describe("applyFloorplanActions — roof zones", () => {
  beforeEach(() => {
    useEditorStore.getState().loadLayout(makeLayout(), sampleSite, [])
  })

  it("adds, updates, and removes explicit roof zones through undo-aware store actions", () => {
    expect(applyFloorplanActions([
      {
        type: "addRoofZone",
        zone: {
          type: "datar",
          x: 2,
          y: 2,
          widthM: 3,
          depthM: 3,
          materialId: "genteng_beton",
        },
      },
    ])).toBe(1)
    const zone = useEditorStore.getState().layout!.roofZones![0]
    expect(zone.id).toMatch(/^roofz-ai-/)
    expect(zone).toMatchObject({ type: "datar", slopeDeg: 0, overhangM: 0.2 })

    expect(applyFloorplanActions([
      { type: "updateRoofZone", id: zone.id, patch: { type: "pelana", materialId: "metal", slopeDeg: 20 } },
    ])).toBe(1)
    expect(useEditorStore.getState().layout!.roofZones![0]).toMatchObject({
      type: "pelana",
      materialId: "metal",
      slopeDeg: 20,
    })

    expect(applyFloorplanActions([{ type: "removeRoofZone", id: zone.id }])).toBe(1)
    expect(useEditorStore.getState().layout!.roofZones).toBeUndefined()
  })
})

describe("applyInteriorActions — updateLight watt", () => {
  it("forwards watt to the interior store", () => {
    useInteriorStore
      .getState()
      .load({ projectId: "p", layout: makeLayout(), style: "japandi", initialRoomId: "r1" })
    useInteriorStore.getState().addLight("r1", "downlight")
    const room = () => useInteriorStore.getState().plan!.rooms.find((r) => r.roomId === "r1")!
    const lightId = room().lighting.at(-1)!.id

    const applied = applyInteriorActions([
      { type: "updateLight", roomId: "r1", lightId, patch: { watt: 18 } },
    ])
    expect(applied).toBe(1)
    expect(room().lighting.find((l) => l.id === lightId)!.watt).toBe(18)
  })
})

describe("applyFloorplanActions — floor-id mapping (resolveFloorId)", () => {
  /** Mirip kondisi prod proj-modern-tropis-1: lantai 1 id deterministik, lantai 2 id acak. */
  function twoFloorLayout(): DesignLayout {
    const base = makeLayout()
    return {
      ...base,
      floors: [
        { id: "floor-1", name: "Lantai 1", level: 1, heightM: 3.2 },
        { id: "floor-k4KTN1", name: "Lantai 2", level: 2, heightM: 3.2 },
      ],
      rooms: [],
      openings: [],
    }
  }

  beforeEach(() => {
    useEditorStore.getState().loadLayout(twoFloorLayout(), sampleSite, [])
  })

  it("merujuk label deterministik 'floor-2' ke lantai nyata level 2 (id acak)", () => {
    useEditorStore.getState().setSelectedFloor("floor-1")
    applyFloorplanActions([{
      type: "addRoom", roomType: "kamar_tidur", floorId: "floor-2",
      x: 0, y: 0, width: 3, depth: 3,
    }])
    const room = useEditorStore.getState().layout!.rooms[0]
    expect(room.floorId).toBe("floor-k4KTN1")
  })

  it("merujuk id yang sudah ada di layout tanpa diubah", () => {
    useEditorStore.getState().setSelectedFloor("floor-1")
    applyFloorplanActions([{
      type: "addRoom", roomType: "carport", floorId: "floor-1",
      x: 0, y: 0, width: 3, depth: 3,
    }])
    const room = useEditorStore.getState().layout!.rooms[0]
    expect(room.floorId).toBe("floor-1")
  })

  it("tanpa floorId memakai selectedFloorId (perilaku lama tak berubah)", () => {
    useEditorStore.getState().setSelectedFloor("floor-k4KTN1")
    applyFloorplanActions([{
      type: "addRoom", roomType: "ruang_tamu", x: 0, y: 0, width: 3, depth: 3,
    }])
    const room = useEditorStore.getState().layout!.rooms[0]
    expect(room.floorId).toBe("floor-k4KTN1")
  })

  it("seluruh addOpening tersambung ke ruang yang BENAR-BENAR dibuat (regresi proj-modern-tropis-1)", () => {
    // Aksi persis seperti dikeluarkan buildInitialFloorplan: addRoom menciptakan
    // id acak room-<nanoid>, tapi addOpening merujuk new-N. Tanpa pemetaan, tiap
    // addOpening jatuh ke ruang yang tak ada → di-skip → atomic rollback seluruh
    // build → pengguna melihat 0 aksi di editor nyata.
    const applied = applyFloorplanActionsAtomic([
      { type: "addFloor" },
      { type: "addFloor" },
      { type: "addRoom", roomType: "ruang_tamu", floorId: "floor-1", x: 0, y: 0, width: 4, depth: 4 },
      { type: "addRoom", roomType: "kamar_tidur", floorId: "floor-2", x: 0, y: 0, width: 3, depth: 3 },
      { type: "addOpening", roomId: "new-0", side: "e", positionM: 2, openingType: "door" },
      { type: "addOpening", roomId: "new-1", side: "w", positionM: 1.5, openingType: "door" },
    ])
    expect(applied).toBe(true)
    const l = useEditorStore.getState().layout!
    expect(l.rooms).toHaveLength(2)
    const doors = l.openings.filter((o) => o.type === "door")
    expect(doors).toHaveLength(2)
    // Setiap pintu menempel pada ruang yang benar-benar ada di layout.
    const roomIds = new Set(l.rooms.map((r) => r.id))
    for (const d of doors) {
      const rid = parseOpeningWall(d.wallId)?.roomId
      expect(rid && roomIds.has(rid), `pintu ${d.wallId} menempel ke ruang yang tak ada`).toBe(true)
    }
  })

  it("semua ruang hasil build denah kosong mendarat di lantai yang ada (regresi proj-modern-tropis-1)", () => {
    // Aksi yang dibangun buildInitialFloorplan untuk kanvas kosong — addFloor
    // menciptakan lantai ber-id acak, addRoom merujuk label floor-1/floor-2.
    const applied = applyFloorplanActions([
      { type: "addFloor" },
      { type: "addFloor" },
      { type: "addRoom", roomType: "carport", floorId: "floor-1", x: 0, y: 0, width: 3, depth: 4 },
      { type: "addRoom", roomType: "kamar_tidur", floorId: "floor-2", x: 0, y: 5, width: 3, depth: 3 },
    ])
    expect(applied).toBe(4)
    const floors = useEditorStore.getState().layout!.floors
    const floorIds = new Set(floors.map((f) => f.id))
    const rooms = useEditorStore.getState().layout!.rooms
    // Semua ruang wajib menempel di lantai yang benar-benar ada.
    for (const r of rooms) expect(floorIds.has(r.floorId), `ruang ${r.name} di floor ${r.floorId}`).toBe(true)
    const byLevel = new Map(floors.map((f) => [f.level, f.id]))
    const carport = rooms.find((r) => r.type === "carport")
    const kamar = rooms.find((r) => r.type === "kamar_tidur")
    expect(carport!.floorId).toBe(byLevel.get(1))
    expect(kamar!.floorId).toBe(byLevel.get(2))
  })
})

describe("atomic proposal application", () => {
  beforeEach(() => {
    useEditorStore.getState().loadLayout(makeLayout(), sampleSite, [])
  })

  it("rolls the entire proposal back when one action is stale", () => {
    const before = useEditorStore.getState()
    expect(applyFloorplanActionsAtomic([
      { type: "updateRoom", roomId: "r1", patch: { name: "Nama sementara" } },
      { type: "deleteRoom", roomId: "room-does-not-exist" },
    ])).toBe(false)
    expect(useEditorStore.getState().layout).toEqual(before.layout)
    expect(useEditorStore.getState().past).toEqual(before.past)
  })

  it("collapses a successful multi-action proposal into one Undo", () => {
    const original = useEditorStore.getState().layout!.rooms.find((room) => room.id === "r1")!
    const historyBefore = useEditorStore.getState().past.length
    expect(applyFloorplanActionsAtomic([
      { type: "updateRoom", roomId: "r1", patch: { name: "Ruang Baru" } },
      { type: "updateRoom", roomId: "r1", patch: { requiresNaturalLight: true } },
    ])).toBe(true)
    expect(useEditorStore.getState().past).toHaveLength(historyBefore + 1)

    useEditorStore.getState().undo()
    const reverted = useEditorStore.getState().layout!.rooms.find((room) => room.id === "r1")!
    expect(reverted.name).toBe(original.name)
    expect(reverted.requiresNaturalLight).toBe(original.requiresNaturalLight)
  })
})

describe("INTEGRASI — buildInitialFloorplan -> applyFloorplanActionsAtomic (jalur editor nyata)", () => {
  const project = {
    id: "proj-modern-tropis-1", name: "Rumah Tropis Modern",
    floors: 1, rooftop: false,
    site: { widthM: 12, depthM: 18, areaM2: 216 },
  } as unknown as Project
  const brief = {
    projectId: "proj-modern-tropis-1",
    spaceProgram: [
      { id: "sp-1", roomType: "carport", name: "Carport", required: true, quantity: 1 },
      { id: "sp-2", roomType: "ruang_tamu", name: "Ruang Tamu", required: true, quantity: 1 },
      { id: "sp-3", roomType: "ruang_keluarga", name: "Ruang Keluarga", required: true, quantity: 1 },
      { id: "sp-4", roomType: "dapur", name: "Dapur", required: true, quantity: 1 },
      { id: "sp-5", roomType: "ruang_makan", name: "Ruang Makan", required: true, quantity: 1 },
      { id: "sp-6", roomType: "kamar_tidur", name: "Kamar tidur 1", required: true, quantity: 1 },
      { id: "sp-7", roomType: "kamar_tidur", name: "Kamar tidur 2", required: true, quantity: 1 },
      { id: "sp-8", roomType: "kamar_tidur", name: "Kamar tidur 3", required: true, quantity: 1 },
      { id: "sp-9", roomType: "kamar_mandi", name: "Kamar mandi 1", required: true, quantity: 1 },
      { id: "sp-10", roomType: "kamar_mandi", name: "Kamar mandi 2", required: true, quantity: 1 },
      { id: "sp-11", roomType: "laundry", name: "Laundry", required: true, quantity: 1 },
      { id: "sp-12", roomType: "taman", name: "Taman Depan", required: true, quantity: 1 },
    ],
  } as unknown as Brief

  /** Mirip kondisi prod proj-modern-tropis-1: lantai 2 ber-id acak, tanpa ruang. */
  function prodLayout(rooms: unknown[] = []): DesignLayout {
    const base = makeLayout()
    return {
      ...base,
      id: "layout-prod",
      floors: [
        { id: "floor-1", name: "Lantai 1", level: 1, heightM: 3.2 },
        { id: "floor-k4KTN1", name: "Lantai 2", level: 2, heightM: 3.2 },
      ],
      rooms: rooms as DesignLayout["rooms"],
      openings: [],
    }
  }

  function sceneOf(rooms: unknown[]) {
    return {
      site: { widthM: 12, depthM: 18 },
      floors: prodLayout().floors,
      selectedFloorId: "floor-1", selectedRoomId: null,
      rooms, openings: [],
    } as never
  }

  it("build denah kosong diterapkan utuh: semua ruang & bukaan di lantai nyata", () => {
    useEditorStore.getState().loadLayout(prodLayout(), sampleSite, [])
    const res = buildInitialFloorplan("buatkan denah 2 lantai, sesuai brief", sceneOf([]), project, brief)
    expect(res.matched).toBe(true)

    expect(applyFloorplanActionsAtomic(res.actions)).toBe(true)

    const l = useEditorStore.getState().layout!
    const floorIds = new Set(l.floors.map((f) => f.id))
    for (const r of l.rooms) {
      expect(floorIds.has(r.floorId), `ruang ${r.name} di floor ${r.floorId}`).toBe(true)
    }
    const roomIds = new Set(l.rooms.map((r) => r.id))
    for (const o of l.openings) {
      const rid = parseOpeningWall(o.wallId)?.roomId
      expect(rid && roomIds.has(rid), `bukaan ${o.wallId} di ruang yang tak ada`).toBe(true)
    }
    expect(l.rooms.length).toBeGreaterThanOrEqual(brief.spaceProgram.length)
    expect(l.openings.filter((o) => o.type === "door").length).toBeGreaterThan(0)
  })

  it("reset dari nol di denah terisi: ruang lama hilang, ruang & bukaan baru utuh", () => {
    const lama = [
      { id: "r1", name: "Ruang Tamu", type: "ruang_tamu" as const, floorId: "floor-1", x: 0, y: 0, width: 4, depth: 4, areaM2: 16, locked: false },
      { id: "r2", name: "Dapur", type: "dapur" as const, floorId: "floor-1", x: 5, y: 0, width: 3, depth: 3, areaM2: 9, locked: false },
      { id: "r3", name: "Kamar tidur", type: "kamar_tidur" as const, floorId: "floor-k4KTN1", x: 0, y: 0, width: 3, depth: 3, areaM2: 9, locked: false },
    ]
    useEditorStore.getState().loadLayout(prodLayout(lama), sampleSite, [])

    const res = buildInitialFloorplan("bangun ulang denah ini dari nol, 2 lantai", sceneOf(lama), project, brief)
    expect(res.matched).toBe(true)
    expect(res.reset).toBe(true)

    expect(applyFloorplanActionsAtomic(res.actions)).toBe(true)

    const l = useEditorStore.getState().layout!
    const ids = new Set(l.rooms.map((r) => r.id))
    expect(ids.has("r1")).toBe(false)
    expect(ids.has("r2")).toBe(false)
    expect(ids.has("r3")).toBe(false)
    expect(l.rooms.length).toBeGreaterThanOrEqual(brief.spaceProgram.length)

    const floorIds = new Set(l.floors.map((f) => f.id))
    for (const r of l.rooms) {
      expect(floorIds.has(r.floorId), `ruang ${r.name} di floor ${r.floorId}`).toBe(true)
    }
    const roomIds = new Set(l.rooms.map((r) => r.id))
    for (const o of l.openings) {
      const rid = parseOpeningWall(o.wallId)?.roomId
      expect(rid && roomIds.has(rid), `bukaan ${o.wallId} di ruang yang tak ada`).toBe(true)
    }
    expect(l.openings.filter((o) => o.type === "door").length).toBeGreaterThan(0)
  })
})

describe("INTEGRASI penuh — build → apply → edit deterministik → apply (perjalanan editor nyata)", () => {
  const project = {
    id: "proj-modern-tropis-1", name: "Rumah Tropis Modern",
    floors: 1, rooftop: false,
    site: { widthM: 12, depthM: 18, areaM2: 216 },
  } as unknown as Project
  const brief = {
    projectId: "proj-modern-tropis-1",
    spaceProgram: [
      { id: "sp-1", roomType: "carport", name: "Carport", required: true, quantity: 1 },
      { id: "sp-2", roomType: "ruang_tamu", name: "Ruang Tamu", required: true, quantity: 1 },
      { id: "sp-3", roomType: "ruang_keluarga", name: "Ruang Keluarga", required: true, quantity: 1 },
      { id: "sp-4", roomType: "dapur", name: "Dapur", required: true, quantity: 1 },
      { id: "sp-5", roomType: "ruang_makan", name: "Ruang Makan", required: true, quantity: 1 },
      { id: "sp-6", roomType: "kamar_tidur", name: "Kamar tidur 1", required: true, quantity: 1 },
      { id: "sp-7", roomType: "kamar_tidur", name: "Kamar tidur 2", required: true, quantity: 1 },
      { id: "sp-8", roomType: "kamar_tidur", name: "Kamar tidur 3", required: true, quantity: 1 },
      { id: "sp-9", roomType: "kamar_mandi", name: "Kamar mandi 1", required: true, quantity: 1 },
      { id: "sp-10", roomType: "kamar_mandi", name: "Kamar mandi 2", required: true, quantity: 1 },
      { id: "sp-11", roomType: "laundry", name: "Laundry", required: true, quantity: 1 },
      { id: "sp-12", roomType: "taman", name: "Taman Depan", required: true, quantity: 1 },
    ],
  } as unknown as Brief

  function prodLayout(): DesignLayout {
    const base = makeLayout()
    return {
      ...base, id: "layout-prod",
      floors: [
        { id: "floor-1", name: "Lantai 1", level: 1, heightM: 3.2 },
        { id: "floor-k4KTN1", name: "Lantai 2", level: 2, heightM: 3.2 },
      ],
      rooms: [], openings: [],
    }
  }

  it("build lalu tambah kamar mandi di lantai 1, keduanya ter-apply utuh", () => {
    useEditorStore.getState().loadLayout(prodLayout(), sampleSite, [])

    // 1) BUILD
    const buildScene: FloorplanScene = {
      site: { widthM: 12, depthM: 18 },
      floors: useEditorStore.getState().layout!.floors,
      selectedFloorId: "floor-1", selectedRoomId: null, rooms: [], openings: [],
    }
    const build = buildInitialFloorplan("buatkan denah 2 lantai, sesuai brief", buildScene, project, brief)
    expect(build.matched).toBe(true)
    expect(applyFloorplanActionsAtomic(build.actions)).toBe(true)

    const afterBuild = useEditorStore.getState().layout!
    expect(afterBuild.rooms.length).toBeGreaterThanOrEqual(brief.spaceProgram.length)

    // Rekonstruksi scene persis seperti yang dilihat client setelah apply.
    const sceneRooms = afterBuild.rooms
    const sceneOpenings = afterBuild.openings.filter((o) => {
      const p = parseOpeningWall(o.wallId)
      return p && afterBuild.rooms.some((r) => r.id === p.roomId)
    }).map((o) => {
      const p = parseOpeningWall(o.wallId)!
      return { id: o.id, roomId: p.roomId, side: p.side, type: o.type, positionM: o.positionM }
    })
    const editScene: FloorplanScene = {
      site: { widthM: 12, depthM: 18 },
      floors: afterBuild.floors,
      selectedFloorId: "floor-1", selectedRoomId: null,
      rooms: sceneRooms,
      openings: sceneOpenings,
    }

    // 2) EDIT deterministik
    const edit = handleFloorplanInstruction("tambahkan kamar mandi di lantai 1", editScene)
    expect(edit.matched, "tambah kamar mandi seharusnya deterministic").toBe(true)
    if (!edit.matched) return
    expect(applyFloorplanActionsAtomic(edit.actions)).toBe(true)

    const afterEdit = useEditorStore.getState().layout!
    const newKms = afterEdit.rooms.filter((r) => r.type === "kamar_mandi")
    expect(newKms.length).toBeGreaterThanOrEqual(brief.spaceProgram.filter((s) => s.roomType === "kamar_mandi").length + 1)

    // Kamar mandi baru wajib punya pintu (ruang dalam harus terjangkau).
    const roomIds = new Set(afterEdit.rooms.map((r) => r.id))
    const newKm = newKms[newKms.length - 1]
    const kmDoors = afterEdit.openings.filter((o) => {
      const p = parseOpeningWall(o.wallId)
      return p && p.roomId === newKm.id && o.type === "door"
    })
    expect(kmDoors.length, `kamar mandi baru ${newKm.id} tanpa pintu`).toBeGreaterThan(0)

    // Semua ruang & bukaan masih menempel entitas yang ada (tak ada yang hantu).
    for (const r of afterEdit.rooms) {
      expect(afterEdit.floors.some((f) => f.id === r.floorId), `ruang ${r.name} di floor ${r.floorId}`).toBe(true)
    }
    for (const o of afterEdit.openings) {
      const p = parseOpeningWall(o.wallId)
      expect(p && roomIds.has(p.roomId), `bukaan ${o.wallId} di ruang tak ada`).toBe(true)
    }
  })
})
