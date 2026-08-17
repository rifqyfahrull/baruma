// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest"

import { useInteriorStore } from "./interior-store"
import { generateInteriorPlan, toSavedInterior } from "@/lib/interior/plan"
import { FURNITURE_LIBRARY } from "@/lib/interior/presets"
import { makeLayout } from "@/test-utils/fixtures"
import type { DesignLayout } from "@/types"

const lightingLayout: DesignLayout = {
  id: "l", projectId: "p", versionId: "v",
  floors: [{ id: "f1", level: 1, name: "Lantai 1", heightM: 3 }],
  rooms: [{ id: "r1", floorId: "f1", name: "Kamar", type: "kamar_tidur", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 }],
  walls: [], openings: [], stairs: [], pools: [], validation: { passed: true, issues: [] },
}

function reset() {
  useInteriorStore.setState({
    projectId: null,
    layout: null,
    plan: null,
    style: "modern_tropical",
    selectedRoomId: null,
    selectedFurnitureId: null,
    selectedLightId: null,
    dirty: false,
  })
}

describe("interior-store lighting", () => {
  beforeEach(() => useInteriorStore.getState().load({ projectId: "p", layout: lightingLayout, style: "scandinavian", initialRoomId: "r1" }))

  it("addLight appends + selects; undo restores", () => {
    const before = useInteriorStore.getState().plan!.rooms[0].lighting.length
    useInteriorStore.getState().addLight("r1", "pendant")
    const st = useInteriorStore.getState()
    expect(st.plan!.rooms[0].lighting.length).toBe(before + 1)
    expect(st.selectedLightId).toBe(st.plan!.rooms[0].lighting.at(-1)!.id)
    useInteriorStore.getState().undo()
    expect(useInteriorStore.getState().plan!.rooms[0].lighting.length).toBe(before)
  })

  it("updateLight changes qty; removeLight clears selection", () => {
    useInteriorStore.getState().addLight("r1", "downlight")
    const id = useInteriorStore.getState().plan!.rooms[0].lighting.at(-1)!.id
    useInteriorStore.getState().updateLight("r1", id, { qty: 4 })
    expect(useInteriorStore.getState().plan!.rooms[0].lighting.find((l) => l.id === id)!.qty).toBe(4)
    useInteriorStore.getState().removeLight("r1", id)
    expect(useInteriorStore.getState().selectedLightId).toBeNull()
  })

  it("selectLight clears furniture selection", () => {
    useInteriorStore.getState().selectFurniture("x")
    useInteriorStore.getState().selectLight("y")
    expect(useInteriorStore.getState().selectedFurnitureId).toBeNull()
    expect(useInteriorStore.getState().selectedLightId).toBe("y")
  })
})

describe("interior-store setFurniturePrice (override harga per-instance)", () => {
  beforeEach(() => useInteriorStore.getState().load({ projectId: "p", layout: lightingLayout, style: "scandinavian", initialRoomId: "r1" }))

  it("set override → budget line & unpricedCount sinkron; null menghapus override; undo-aware", () => {
    const store = useInteriorStore.getState()
    store.addAssetFurniture("r1", { id: "asset-x", name: "Kursi Kustom", category: "generic" })
    let st = useInteriorStore.getState()
    const itemId = st.plan!.rooms[0].furniture.at(-1)!.id
    expect(st.plan!.rooms[0].budgetEstimate.unpricedCount).toBe(1)

    useInteriorStore.getState().setFurniturePrice("r1", itemId, 3_000_000)
    st = useInteriorStore.getState()
    const item = st.plan!.rooms[0].furniture.find((f) => f.id === itemId)!
    expect(item.priceOverrideIDR).toBe(3_000_000)
    expect(st.plan!.rooms[0].budgetEstimate.unpricedCount ?? 0).toBe(0)
    expect(st.dirty).toBe(true)

    useInteriorStore.getState().setFurniturePrice("r1", itemId, null)
    st = useInteriorStore.getState()
    expect(st.plan!.rooms[0].furniture.find((f) => f.id === itemId)!.priceOverrideIDR ?? null).toBeNull()
    expect(st.plan!.rooms[0].budgetEstimate.unpricedCount).toBe(1)

    useInteriorStore.getState().undo()
    st = useInteriorStore.getState()
    expect(st.plan!.rooms[0].furniture.find((f) => f.id === itemId)!.priceOverrideIDR).toBe(3_000_000)
  })
})

describe("interior-store persistence", () => {
  beforeEach(reset)

  it("hydrates from a saved interior instead of regenerating", () => {
    const layout = makeLayout()
    const basePlan = generateInteriorPlan(layout, { projectId: "p1", style: "japandi" })
    const saved = toSavedInterior(basePlan)
    // mutate saved so we can detect it was used
    saved.rooms[0].furniture = saved.rooms[0].furniture.slice(0, 1)
    saved.rooms[0].materials = saved.rooms[0].materials?.map((item) =>
      item.surface === "floor" ? { ...item, materialId: "floor-polished-concrete" } : item
    )

    useInteriorStore.getState().load({ projectId: "p1", layout, style: "modern_tropical", saved })

    const state = useInteriorStore.getState()
    expect(state.style).toBe("japandi") // saved style wins
    const room0 = state.plan!.rooms.find((r) => r.roomId === saved.rooms[0].roomId)!
    expect(room0.furniture.length).toBe(1)
    expect(room0.materials.find((item) => item.surface === "floor")?.materialId).toBe("floor-polished-concrete")
    expect(state.dirty).toBe(false)
  })

  it("ignores a saved interior whose versionId does not match the layout", () => {
    const layout = makeLayout()
    const basePlan = generateInteriorPlan(layout, { projectId: "p1", style: "japandi" })
    const saved = toSavedInterior(basePlan)
    saved.versionId = "stale-version"
    saved.rooms[0].furniture = []

    useInteriorStore.getState().load({ projectId: "p1", layout, style: "modern_tropical", saved })

    const state = useInteriorStore.getState()
    const room0 = state.plan!.rooms[0]
    expect(room0.furniture.length).toBeGreaterThan(0) // regenerated, not the emptied saved
  })

  it("marks the store dirty after a mutation and clean after markSaved", () => {
    const layout = makeLayout()
    useInteriorStore.getState().load({ projectId: "p1", layout, style: "modern_tropical" })
    expect(useInteriorStore.getState().dirty).toBe(false)

    const room = useInteriorStore.getState().plan!.rooms[0]
    useInteriorStore.getState().rotateFurniture(room.roomId, room.furniture[0].id)
    expect(useInteriorStore.getState().dirty).toBe(true)

    useInteriorStore.getState().markSaved()
    expect(useInteriorStore.getState().dirty).toBe(false)
  })

  it("updates a room material with undo/redo and recomputes budget", () => {
    const layout = makeLayout()
    useInteriorStore.getState().load({ projectId: "p1", layout, style: "modern_tropical" })
    const room = useInteriorStore.getState().plan!.rooms[0]
    const beforeMid = room.budgetEstimate.midIDR

    useInteriorStore.getState().updateMaterial(room.roomId, "floor", "floor-polished-concrete")

    const updated = useInteriorStore.getState().plan!.rooms[0]
    expect(updated.materials.find((item) => item.surface === "floor")?.materialId).toBe("floor-polished-concrete")
    expect(updated.budgetEstimate.midIDR).not.toBe(beforeMid)
    expect(useInteriorStore.getState().dirty).toBe(true)

    useInteriorStore.getState().undo()
    expect(useInteriorStore.getState().plan!.rooms[0].materials.find((item) => item.surface === "floor")?.materialId).not.toBe("floor-polished-concrete")
  })
})

describe("interior-store open-plan zone (settleFurniture)", () => {
  const zoneLayout: DesignLayout = {
    id: "lz", projectId: "p", versionId: "v",
    floors: [{ id: "f1", level: 1, name: "Lantai 1", heightM: 3 }],
    rooms: [
      { id: "za", floorId: "f1", name: "Keluarga", type: "ruang_keluarga", x: 0, y: 0, width: 3, depth: 4, areaM2: 12, zoneId: "open-1" },
      { id: "zb", floorId: "f1", name: "Dapur", type: "dapur", x: 3, y: 0, width: 3, depth: 4, areaM2: 12, zoneId: "open-1" },
    ],
    walls: [], openings: [], stairs: [], pools: [], validation: { passed: true, issues: [] },
  }

  beforeEach(() => {
    reset()
    useInteriorStore.getState().load({ projectId: "p", layout: zoneLayout, style: "modern_tropical", initialRoomId: "za" })
  })

  it("re-parents a furniture dropped inside the zone sibling (world position preserved)", () => {
    const st = useInteriorStore.getState()
    const planA = st.plan!.rooms.find((r) => r.roomId === "za")!
    const item = planA.furniture[0]
    const roomB = zoneLayout.rooms[1]
    // Drag: center the item inside B (coords local to A).
    const targetX = roomB.x + (roomB.width - item.widthM) / 2 - 0
    const targetY = roomB.y + (roomB.depth - item.depthM) / 2 - 0
    useInteriorStore.getState().moveFurniture("za", item.id, targetX, targetY)
    useInteriorStore.getState().settleFurniture("za", item.id)

    const after = useInteriorStore.getState()
    const afterA = after.plan!.rooms.find((r) => r.roomId === "za")!
    const afterB = after.plan!.rooms.find((r) => r.roomId === "zb")!
    const moved = afterB.furniture.find((f) => f.id === item.id)!

    expect(afterA.furniture.some((f) => f.id === item.id)).toBe(false)
    expect(moved).toBeTruthy()
    // world x must be identical: za.x + targetX === zb.x + moved.x
    expect(0 + targetX).toBeCloseTo(3 + moved.x, 2)
    expect(after.selectedRoomId).toBe("zb")
    expect(after.selectedFurnitureId).toBe(item.id)
  })

  it("is a no-op when the item stays in (or straddles with center in) its own room", () => {
    const st = useInteriorStore.getState()
    const planA = st.plan!.rooms.find((r) => r.roomId === "za")!
    const item = planA.furniture[0]
    useInteriorStore.getState().moveFurniture("za", item.id, 0.2, 0.2)
    useInteriorStore.getState().settleFurniture("za", item.id)

    const after = useInteriorStore.getState()
    expect(after.plan!.rooms.find((r) => r.roomId === "za")!.furniture.some((f) => f.id === item.id)).toBe(true)
    expect(after.plan!.rooms.find((r) => r.roomId === "zb")!.furniture.some((f) => f.id === item.id)).toBe(false)
  })

  it("undo restores ownership after a settle", () => {
    const st = useInteriorStore.getState()
    const item = st.plan!.rooms.find((r) => r.roomId === "za")!.furniture[0]
    const roomB = zoneLayout.rooms[1]
    useInteriorStore.getState().moveFurniture("za", item.id,
      roomB.x + (roomB.width - item.widthM) / 2, roomB.y + (roomB.depth - item.depthM) / 2)
    useInteriorStore.getState().settleFurniture("za", item.id)
    expect(useInteriorStore.getState().plan!.rooms.find((r) => r.roomId === "zb")!.furniture.some((f) => f.id === item.id)).toBe(true)

    useInteriorStore.getState().undo()
    expect(useInteriorStore.getState().plan!.rooms.find((r) => r.roomId === "za")!.furniture.some((f) => f.id === item.id)).toBe(true)
  })
})

describe("interior-store water-point gate (titik air 2D → fixture 3D)", () => {
  const bathLayout: DesignLayout = {
    id: "lw", projectId: "p", versionId: "v",
    floors: [{ id: "f1", level: 1, name: "Lantai 1", heightM: 3 }],
    rooms: [{ id: "km", floorId: "f1", name: "Kamar Mandi", type: "kamar_mandi", x: 2, y: 1, width: 2, depth: 2.5, areaM2: 5 }],
    walls: [], openings: [], stairs: [], pools: [],
    water: [{ id: "w-shower", roomId: "km", type: "shower", x: 3.5, y: 1.5 }],
    validation: { passed: true, issues: [] },
  }

  beforeEach(() => {
    reset()
    useInteriorStore.getState().load({ projectId: "p", layout: bathLayout, style: "modern_tropical", initialRoomId: "km" })
  })

  it("refuses a water-bound fixture when the room has no matching titik air", () => {
    const toilet = FURNITURE_LIBRARY.find((f) => f.id === "toilet")!
    const before = useInteriorStore.getState().plan!.rooms[0].furniture.length
    const result = useInteriorStore.getState().addFurniture("km", toilet)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.missingWaterPoint).toBe("kloset")
    expect(useInteriorStore.getState().plan!.rooms[0].furniture.length).toBe(before)
  })

  it("installs the fixture AT the 2D titik air when it exists", () => {
    const shower = FURNITURE_LIBRARY.find((f) => f.id === "bathroom-shower")!
    const result = useInteriorStore.getState().addFurniture("km", shower)
    expect(result.ok).toBe(true)

    const room = bathLayout.rooms[0]
    const items = useInteriorStore.getState().plan!.rooms[0].furniture
    // generator kamar mandi juga menaruh shower default — ambil yang BARU ditambahkan
    const placed = items.at(-1)!
    // titik air absolut (3.5,1.5) → lokal ruang (1.5,0.5); fixture berpusat di titik itu.
    expect(room.x + placed.x + placed.widthM / 2).toBeCloseTo(3.5, 1)
    expect(room.y + placed.y + placed.depthM / 2).toBeCloseTo(1.5, 1)
  })

  it("dry furniture is unaffected by the gate", () => {
    const vanityless = FURNITURE_LIBRARY.find((f) => f.id === "queen-bed")!
    const result = useInteriorStore.getState().addFurniture("km", vanityless)
    expect(result.ok).toBe(true)
  })
})

describe("load — self-heal ruang baru pasca-muat", () => {
  it("ruang yang ditambah setelah load mendapat RoomInteriorPlan susulan", () => {
    const layout = makeLayout()
    useInteriorStore.getState().load({ projectId: "p1", layout, style: "modern_tropical" })
    expect(useInteriorStore.getState().plan?.rooms.some((r) => r.roomId === "cp-baru")).toBe(false)

    // user menambah Carport di 2D — id layout TIDAK berubah
    const edited = {
      ...layout,
      rooms: [
        ...layout.rooms,
        { id: "cp-baru", floorId: "floor-1", name: "Carport", type: "carport" as const, x: 0, y: 4, width: 3, depth: 3, areaM2: 9 },
      ],
    }
    useInteriorStore.getState().load({ projectId: "p1", layout: edited, style: "modern_tropical" })
    const plan = useInteriorStore.getState().plan!
    expect(plan.rooms.some((r) => r.roomId === "cp-baru")).toBe(true)
    // layout store ikut segar (zone/clamp melihat ruang baru)
    expect(useInteriorStore.getState().layout?.rooms.some((r) => r.id === "cp-baru")).toBe(true)
  })
})

describe("interior-store snap ke dinding", () => {
  const snapLayout: DesignLayout = {
    id: "ls", projectId: "p", versionId: "v",
    floors: [{ id: "f1", level: 1, name: "Lantai 1", heightM: 3 }],
    rooms: [{ id: "r1", floorId: "f1", name: "Kamar", type: "kamar_tidur", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 }],
    walls: [], openings: [], stairs: [], pools: [], validation: { passed: true, issues: [] },
  }

  beforeEach(() => {
    reset()
    useInteriorStore.getState().load({ projectId: "p", layout: snapLayout, style: "modern_tropical", initialRoomId: "r1" })
  })

  it("snapFurnitureToWall: flush ke dinding terdekat + sudut lurus + undo tersedia", () => {
    const st = useInteriorStore.getState()
    const item = st.plan!.rooms[0].furniture[0]
    useInteriorStore.getState().moveFurniture("r1", item.id, 1.2, 0.4)
    useInteriorStore.getState().setFurnitureRotation("r1", item.id, 33)
    useInteriorStore.getState().snapFurnitureToWall("r1", item.id)

    const snapped = useInteriorStore.getState().plan!.rooms[0].furniture.find((f) => f.id === item.id)!
    expect(snapped.rotationDeg % 90).toBe(0)
    expect(snapped.y).toBeCloseTo(0.06, 5) // muka dalam dinding utara (inset ½ tebal dinding)

    useInteriorStore.getState().undo()
    const undone = useInteriorStore.getState().plan!.rooms[0].furniture.find((f) => f.id === item.id)!
    expect(undone.rotationDeg).toBe(33)
  })

  it("settleFurniture (tanpa pindah ruang): magnet ≤ 20 cm merapatkan ke dinding, > 20 cm dibiarkan", () => {
    const st = useInteriorStore.getState()
    const item = st.plan!.rooms[0].furniture[0]
    // 12 cm dari dinding utara (rot 0 → ey = depth/2): y = 0.12
    useInteriorStore.getState().moveFurniture("r1", item.id, 1.2, 0.12)
    useInteriorStore.getState().settleFurniture("r1", item.id)
    let now = useInteriorStore.getState().plan!.rooms[0].furniture.find((f) => f.id === item.id)!
    expect(now.y).toBeCloseTo(0.06, 5) // dirapatkan ke muka dalam dinding

    // 60 cm dari dinding — di luar ambang magnet: tidak digeser.
    useInteriorStore.getState().moveFurniture("r1", item.id, 1.2, 0.6)
    useInteriorStore.getState().settleFurniture("r1", item.id)
    now = useInteriorStore.getState().plan!.rooms[0].furniture.find((f) => f.id === item.id)!
    expect(now.y).toBeCloseTo(0.6, 5)
  })

  it("setFurnitureMountHeight: set + clamp + null = kembali ke lantai", () => {
    const st = useInteriorStore.getState()
    const item = st.plan!.rooms[0].furniture[0]
    useInteriorStore.getState().setFurnitureMountHeight("r1", item.id, 1.6)
    expect(useInteriorStore.getState().plan!.rooms[0].furniture.find((f) => f.id === item.id)!.mountHeightM).toBe(1.6)
    useInteriorStore.getState().setFurnitureMountHeight("r1", item.id, 99)
    expect(useInteriorStore.getState().plan!.rooms[0].furniture.find((f) => f.id === item.id)!.mountHeightM).toBe(2.6)
    useInteriorStore.getState().setFurnitureMountHeight("r1", item.id, null)
    expect(useInteriorStore.getState().plan!.rooms[0].furniture.find((f) => f.id === item.id)!.mountHeightM).toBeNull()
  })
})
