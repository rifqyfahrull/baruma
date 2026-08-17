import { describe, expect, it } from "vitest"

import type { SavedInterior } from "@/lib/schemas/interior"
import { getFurniture } from "./presets"
import { addCustomAssetToRoom, addFurnitureToRoom, addLightToRoom, alignRotationToWall, isWallHangingItem, applySavedInterior, duplicatePlacedFurniture, generateInteriorPlan, generateRoomInterior, moveLightInRoom, movePlacedFurniture, nearestWallSide, normalizeLegacyRotation, removeLightFromRoom, resolvedFurniturePriceRange, rotatedAABB, rotatePlacedFurniture, setFurniturePriceInRoom, setFurnitureRotationInRoom, snapFurnitureToWallInRoom, snapPositionToWall, toSavedInterior, transferFurnitureBetweenRooms, updateLightInRoom, validateFurnitureInRoom, zoneSiblingRooms } from "./plan"
import { lightPriceFor } from "./lighting"
import { makeLayout } from "@/test-utils/fixtures"

describe("interior plan", () => {
  it("generates furniture, material, lighting, and budget per supported room", () => {
    const layout = makeLayout()
    const plan = generateInteriorPlan(layout, {
      projectId: "p1",
      style: "modern_tropical",
    })

    expect(plan.rooms.length).toBeGreaterThan(0)
    expect(plan.rooms[0].furniture.length).toBeGreaterThan(0)
    expect(plan.rooms[0].materials.length).toBeGreaterThan(0)
    expect(plan.rooms[0].lighting.length).toBeGreaterThan(0)
    expect(plan.totalEstimate.midIDR).toBeGreaterThan(0)
  })

  it("clamps moved furniture inside the selected room", () => {
    const layout = makeLayout()
    const room = layout.rooms[0]
    const plan = generateInteriorPlan(layout, {
      projectId: "p1",
      style: "modern_tropical",
    }).rooms[0]
    const item = plan.furniture[0]

    const moved = movePlacedFurniture(room, plan, item.id, 99, 99)
    const updated = moved.furniture.find((f) => f.id === item.id)!

    expect(updated.x + updated.widthM).toBeLessThanOrEqual(room.width)
    expect(updated.y + updated.depthM).toBeLessThanOrEqual(room.depth)
  })

  it("allows manual furniture outside the default room template", () => {
    const layout = makeLayout()
    const livingRoom = layout.rooms.find((room) => room.type === "ruang_tamu")!
    const plan = generateInteriorPlan(layout, {
      projectId: "p1",
      style: "modern_tropical",
    }).rooms.find((room) => room.roomId === livingRoom.id)!
    const bed = getFurniture("queen-bed")!

    const updated = addFurnitureToRoom(livingRoom, plan, bed)

    expect(updated.furniture.some((item) => item.furnitureId === "queen-bed")).toBe(true)
    expect(updated.budgetEstimate.lines.some((line) => line.item === "Kasur Queen")).toBe(true)
  })

  it("places living room furniture around a clear seating and TV axis", () => {
    const layout = makeLayout()
    const livingRoom = layout.rooms.find((room) => room.type === "ruang_tamu")!
    const plan = generateInteriorPlan(layout, {
      projectId: "p1",
      style: "modern_tropical",
    }).rooms.find((room) => room.roomId === livingRoom.id)!
    const find = (id: string) => plan.furniture.find((item) => item.furnitureId === id)!

    const sofa = find("sofa-3-seat")
    const coffee = find("coffee-table")
    const tvCabinet = find("tv-cabinet")
    const tv = find("tv-55")

    const sofaCenterX = sofa.x + sofa.widthM / 2
    const coffeeCenterX = coffee.x + coffee.widthM / 2
    const tvCenterX = tv.x + tv.widthM / 2

    expect(sofa.y).toBeLessThan(coffee.y)
    expect(coffee.y).toBeLessThan(tvCabinet.y)
    expect(tv.y).toBeLessThan(tvCabinet.y)
    expect(Math.abs(sofaCenterX - coffeeCenterX)).toBeLessThan(0.15)
    expect(Math.abs(coffeeCenterX - tvCenterX)).toBeLessThan(0.15)
  })
})

describe("harga furnitur kustom terintegrasi RAB (no silent Rp 0)", () => {
  function livingRoomPlan() {
    const layout = makeLayout()
    const room = layout.rooms.find((r) => r.type === "ruang_tamu")!
    const plan = generateInteriorPlan(layout, {
      projectId: "p1",
      style: "modern_tropical",
    }).rooms.find((p) => p.roomId === room.id)!
    return { room, plan }
  }

  it("mewarisi harga level aset ke furniture & budget line", () => {
    const { room, plan } = livingRoomPlan()
    const next = addCustomAssetToRoom(room, plan, {
      id: "asset-1",
      name: "Sofa Itali 1",
      category: "sofa",
      widthM: 2.2,
      depthM: 0.9,
      heightM: 0.8,
      priceIDR: 7_500_000,
    })
    const item = next.furniture.at(-1)!
    expect(item.priceRange).toEqual({ low: 7_500_000, mid: 7_500_000, high: 7_500_000 })
    const line = next.budgetEstimate.lines.find((l) => l.id === `budget-${item.id}`)!
    expect(line.midIDR).toBe(7_500_000)
    expect(line.priced).not.toBe(false)
    expect(next.budgetEstimate.unpricedCount ?? 0).toBe(0)
  })

  it("aset tanpa harga = excluded eksplisit: line priced=false, tidak menggelembungkan baseline instalasi, unpricedCount naik", () => {
    const { room, plan } = livingRoomPlan()
    const withPrice = addCustomAssetToRoom(room, plan, {
      id: "asset-priced",
      name: "Berharga",
      category: "generic",
      priceIDR: 1_000_000,
    })
    const withUnpriced = addCustomAssetToRoom(room, withPrice, {
      id: "asset-2",
      name: "Patung Kustom",
      category: "generic",
    })
    const item = withUnpriced.furniture.at(-1)!
    const line = withUnpriced.budgetEstimate.lines.find((l) => l.id === `budget-${item.id}`)!
    expect(line.priced).toBe(false)
    expect(line.midIDR).toBe(0)
    expect(withUnpriced.budgetEstimate.unpricedCount).toBe(1)
    // Baseline "jasa instalasi 12%" hanya dari line yang priced — item tanpa
    // harga tidak boleh mengubah baseline (dulu dihitung dari total termasuk 0).
    const installPriced = withPrice.budgetEstimate.lines.find((l) => l.category === "installation")!
    const installAfter = withUnpriced.budgetEstimate.lines.find((l) => l.category === "installation")!
    expect(installAfter.midIDR).toBe(installPriced.midIDR)
  })

  it("override harga per-instance menang atas priceRange item dan menghapus status unpriced", () => {
    const { room, plan } = livingRoomPlan()
    const withAsset = addCustomAssetToRoom(room, plan, {
      id: "asset-3",
      name: "Kursi Kustom",
      category: "generic",
    })
    const item = withAsset.furniture.at(-1)!
    expect(withAsset.budgetEstimate.unpricedCount).toBe(1)

    const priced = setFurniturePriceInRoom(room, withAsset, item.id, 2_250_000)
    const updated = priced.furniture.find((f) => f.id === item.id)!
    expect(updated.priceOverrideIDR).toBe(2_250_000)
    expect(resolvedFurniturePriceRange(updated).mid).toBe(2_250_000)
    const line = priced.budgetEstimate.lines.find((l) => l.id === `budget-${item.id}`)!
    expect(line.midIDR).toBe(2_250_000)
    expect(priced.budgetEstimate.unpricedCount ?? 0).toBe(0)

    // null = hapus override, kembali unpriced
    const cleared = setFurniturePriceInRoom(room, priced, item.id, null)
    expect(cleared.furniture.find((f) => f.id === item.id)!.priceOverrideIDR ?? null).toBeNull()
    expect(cleared.budgetEstimate.unpricedCount).toBe(1)
  })

  it("override juga berlaku untuk item katalog (harga proyek-spesifik)", () => {
    const { room, plan } = livingRoomPlan()
    const sofa = plan.furniture.find((f) => f.furnitureId === "sofa-3-seat")!
    const next = setFurniturePriceInRoom(room, plan, sofa.id, 12_000_000)
    const line = next.budgetEstimate.lines.find((l) => l.id === `budget-${sofa.id}`)!
    expect(line.midIDR).toBe(12_000_000)
  })
})

describe("interior persistence (hydrate/serialize)", () => {
  it("round-trips furniture and editable lighting without capability loss", () => {
    const layout = makeLayout()
    const plan = generateInteriorPlan(layout, { projectId: "p1", style: "modern_tropical" })

    const saved = toSavedInterior(plan)
    expect(saved.schemaVersion).toBe(2)
    expect(saved.versionId).toBe(plan.versionId)
    expect(saved.style).toBe("modern_tropical")

    const hydrated = applySavedInterior(layout, saved, { projectId: "p1" })
    const room0 = hydrated.rooms[0]
    const savedRoom0 = saved.rooms.find((r) => r.roomId === room0.roomId)!
    expect(room0.furniture.map((f) => f.id)).toEqual(savedRoom0.furniture.map((f) => f.id))
    expect(room0.lighting.map((light) => light.id)).toEqual(savedRoom0.lighting?.map((light) => light.id))
    expect(hydrated.totalEstimate.midIDR).toBeGreaterThan(0)
  })

  it("preserves custom lighting edits used by the unified Interior agent", () => {
    const layout = makeLayout()
    const plan = generateInteriorPlan(layout, { projectId: "p1", style: "modern_tropical" })
    const saved = toSavedInterior(plan)
    const room = saved.rooms.find((candidate) => candidate.lighting?.length)!
    room.lighting![0] = { ...room.lighting![0], watt: 17, colorTemperature: "cool" }

    const hydrated = applySavedInterior(layout, saved, { projectId: "p1" })
    const light = hydrated.rooms.find((candidate) => candidate.roomId === room.roomId)!.lighting[0]
    expect(light).toMatchObject({ watt: 17, colorTemperature: "cool" })
  })

  it("reflects an edited furniture list (added item) after re-apply", () => {
    const layout = makeLayout()
    const living = layout.rooms.find((r) => r.type === "ruang_tamu")!
    const plan = generateInteriorPlan(layout, { projectId: "p1", style: "modern_tropical" })

    const saved = toSavedInterior(plan)
    const savedLiving = saved.rooms.find((r) => r.roomId === living.id)!
    const extra = { ...savedLiving.furniture[0], id: "placed-extra-1" }
    savedLiving.furniture.push(extra)

    const hydrated = applySavedInterior(layout, saved, { projectId: "p1" })
    const hydratedLiving = hydrated.rooms.find((r) => r.roomId === living.id)!
    expect(hydratedLiving.furniture.some((f) => f.id === "placed-extra-1")).toBe(true)
  })

  it("falls back to generated default for rooms absent from saved", () => {
    const layout = makeLayout()
    const plan = generateInteriorPlan(layout, { projectId: "p1", style: "modern_tropical" })
    const saved = toSavedInterior(plan)
    // Drop the first room from saved → it should regenerate from template.
    const droppedRoomId = saved.rooms[0].roomId
    saved.rooms = saved.rooms.filter((r) => r.roomId !== droppedRoomId)

    const hydrated = applySavedInterior(layout, saved, { projectId: "p1" })
    const room = hydrated.rooms.find((r) => r.roomId === droppedRoomId)!
    expect(room.furniture.length).toBeGreaterThan(0)
  })
})

describe("room-plan lighting helpers", () => {
  const room = { id: "r1", floorId: "f1", name: "Kamar", type: "kamar_tidur", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 } as const
  const base = generateRoomInterior(room as never, { rooms: [room], openings: [] } as never, "scandinavian")

  it("addLightToRoom appends a fixture and grows the lighting budget lines", () => {
    const before = base.budgetEstimate.lines.filter((l) => l.category === "lighting").length
    const next = addLightToRoom(room as never, base, "task")
    expect(next.lighting.length).toBe(base.lighting.length + 1)
    expect(next.lighting.at(-1)!.type).toBe("task")
    const after = next.budgetEstimate.lines.filter((l) => l.category === "lighting").length
    expect(after).toBe(before + 1)
  })

  it("updateLightInRoom recomputes priceRange from type+qty", () => {
    const added = addLightToRoom(room as never, base, "downlight")
    const id = added.lighting.at(-1)!.id
    const next = updateLightInRoom(room as never, added, id, { qty: 3 })
    const f = next.lighting.find((l) => l.id === id)!
    expect(f.qty).toBe(3)
    expect(f.priceRange).toEqual(lightPriceFor("downlight", 3))
  })

  it("moveLightInRoom clamps to the room; removeLightFromRoom drops it", () => {
    const added = addLightToRoom(room as never, base, "pendant")
    const id = added.lighting.at(-1)!.id
    const moved = moveLightInRoom(room as never, added, id, 99, -5)
    const m = moved.lighting.find((l) => l.id === id)!
    expect(m.x).toBe(4)
    expect(m.y).toBe(0)
    const removed = removeLightFromRoom(room as never, moved, id)
    expect(removed.lighting.some((l) => l.id === id)).toBe(false)
  })
})

describe("free rotation model", () => {
  const room = { id: "r1", floorId: "f1", name: "R", type: "kamar_tidur", x: 0, y: 0, width: 4, depth: 4, areaM2: 16 } as const
  const base = generateRoomInterior(room as never, { rooms: [room], openings: [] } as never, "scandinavian")

  it("rotatePlacedFurniture increments the angle by 90 and does NOT swap dims", () => {
    const item = base.furniture[0]
    const before = { w: item.widthM, d: item.depthM }
    const next = rotatePlacedFurniture(room as never, base, item.id)
    const after = next.furniture.find((f) => f.id === item.id)!
    expect(after.rotationDeg).toBe((item.rotationDeg + 90) % 360)
    expect(after.widthM).toBe(before.w) // NOT swapped
    expect(after.depthM).toBe(before.d)
  })

  it("setFurnitureRotationInRoom sets an arbitrary angle (normalized)", () => {
    const item = base.furniture[0]
    const next = setFurnitureRotationInRoom(room as never, base, item.id, 405)
    expect(next.furniture.find((f) => f.id === item.id)!.rotationDeg).toBe(45)
  })

  it("normalizeLegacyRotation un-swaps dims for 90/270 (legacy) and leaves 0/180", () => {
    const legacy = [
      { id: "a", rotationDeg: 270, widthM: 0.6, depthM: 2 },
      { id: "b", rotationDeg: 0, widthM: 2, depthM: 0.6 },
      { id: "c", rotationDeg: 90, widthM: 0.6, depthM: 2 },
    ] as unknown as import("@/types").PlacedFurniture[]
    const out = normalizeLegacyRotation(legacy)
    expect([out[0].widthM, out[0].depthM]).toEqual([2, 0.6]) // un-swapped → intrinsic
    expect([out[1].widthM, out[1].depthM]).toEqual([2, 0.6]) // unchanged
    expect([out[2].widthM, out[2].depthM]).toEqual([2, 0.6]) // un-swapped
    expect(out.map((f) => f.rotationDeg)).toEqual([270, 0, 90]) // angle unchanged
  })
})

describe("legacy migration preserves furniture center (schemaVersion 1 → applySavedInterior)", () => {
  it("un-swaps dims and preserves the center for 90°/270° legacy items; v2 is not re-normalized", () => {
    const layout = makeLayout()
    const room = layout.rooms[0]

    // Legacy (schemaVersion 1) items stored SWAPPED dims for 90/270 rotations under the
    // old "rotation swaps dims" model. Intrinsic size is 1.6 (width) x 0.6 (depth); the
    // legacy payload stores it pre-swapped as widthM=0.6, depthM=1.6.
    const item90 = {
      id: "placed-legacy-90",
      furnitureId: "side-table",
      roomId: room.id,
      name: "Side table",
      category: "table",
      x: 0.5,
      y: 0.4,
      rotationDeg: 90,
      widthM: 0.6,
      depthM: 1.6,
      heightM: 0.5,
      locked: false,
      priceRange: { low: 0, mid: 0, high: 0 },
    } as unknown as import("@/types").PlacedFurniture
    const item270 = {
      id: "placed-legacy-270",
      furnitureId: "side-table",
      roomId: room.id,
      name: "Side table",
      category: "table",
      x: 1.2,
      y: 0.9,
      rotationDeg: 270,
      widthM: 0.6,
      depthM: 1.6,
      heightM: 0.5,
      locked: false,
      priceRange: { low: 0, mid: 0, high: 0 },
    } as unknown as import("@/types").PlacedFurniture

    // Center under the legacy (pre-migration) interpretation.
    const centerBefore90 = { x: item90.x + item90.widthM / 2, y: item90.y + item90.depthM / 2 }
    const centerBefore270 = { x: item270.x + item270.widthM / 2, y: item270.y + item270.depthM / 2 }

    const savedV1: SavedInterior = {
      schemaVersion: 1,
      versionId: layout.versionId,
      style: "modern_tropical",
      rooms: [{ roomId: room.id, furniture: [item90, item270] }],
    }

    const hydratedV1 = applySavedInterior(layout, savedV1, { projectId: "p1" })
    const roomPlanV1 = hydratedV1.rooms.find((r) => r.roomId === room.id)!
    const out90 = roomPlanV1.furniture.find((f) => f.id === "placed-legacy-90")!
    const out270 = roomPlanV1.furniture.find((f) => f.id === "placed-legacy-270")!

    // Dims are un-swapped to intrinsic (widthM=1.6, depthM=0.6).
    expect([out90.widthM, out90.depthM]).toEqual([1.6, 0.6])
    expect([out270.widthM, out270.depthM]).toEqual([1.6, 0.6])

    // Center is preserved: center before migration === center after migration.
    const centerAfter90 = { x: out90.x + out90.widthM / 2, y: out90.y + out90.depthM / 2 }
    const centerAfter270 = { x: out270.x + out270.widthM / 2, y: out270.y + out270.depthM / 2 }
    expect(centerAfter90.x).toBeCloseTo(centerBefore90.x, 10)
    expect(centerAfter90.y).toBeCloseTo(centerBefore90.y, 10)
    expect(centerAfter270.x).toBeCloseTo(centerBefore270.x, 10)
    expect(centerAfter270.y).toBeCloseTo(centerBefore270.y, 10)

    // Idempotency: a schemaVersion 2 payload with the SAME (already-intrinsic) dims
    // must NOT be re-normalized — dims and position pass through unchanged. The item
    // must be fully in-bounds (rotated AABB inside the room): out-of-bounds positions
    // are deliberately self-healed on load, which is covered by its own test.
    const itemV2 = {
      id: "placed-v2-90",
      furnitureId: "side-table",
      roomId: room.id,
      name: "Side table",
      category: "table",
      x: 0.5,
      y: 0.6, // rotated (90°) y-extent is ±0.8 about the center → spans [0.1, 1.7], inside
      rotationDeg: 90,
      widthM: 1.6,
      depthM: 0.6,
      heightM: 0.5,
      locked: false,
      priceRange: { low: 0, mid: 0, high: 0 },
    } as unknown as import("@/types").PlacedFurniture

    const savedV2: SavedInterior = {
      schemaVersion: 2,
      versionId: layout.versionId,
      style: "modern_tropical",
      rooms: [{ roomId: room.id, furniture: [itemV2] }],
    }

    const hydratedV2 = applySavedInterior(layout, savedV2, { projectId: "p1" })
    const outV2 = hydratedV2.rooms.find((r) => r.roomId === room.id)!.furniture.find((f) => f.id === "placed-v2-90")!
    expect(outV2.widthM).toBe(1.6)
    expect(outV2.depthM).toBe(0.6)
    expect(outV2.x).toBe(0.5)
    expect(outV2.y).toBe(0.6)
  })
})

describe("rotatedAABB", () => {
  it("matches the axis-aligned box when rotationDeg is 0", () => {
    const aabb = rotatedAABB({ x: 1, y: 0.5, widthM: 2, depthM: 0.6, rotationDeg: 0 })
    expect(aabb.minX).toBeCloseTo(1, 5)
    expect(aabb.maxX).toBeCloseTo(3, 5)
    expect(aabb.minY).toBeCloseTo(0.5, 5)
    expect(aabb.maxY).toBeCloseTo(1.1, 5)
  })

  it("swaps the effective footprint at 90 degrees (width<->depth extents)", () => {
    const aabb = rotatedAABB({ x: 0, y: 0, widthM: 2, depthM: 0.6, rotationDeg: 90 })
    const ex = (aabb.maxX - aabb.minX) / 2
    const ey = (aabb.maxY - aabb.minY) / 2
    expect(ex).toBeCloseTo(0.3, 5) // hd
    expect(ey).toBeCloseTo(1.0, 5) // hw
  })

  it("computes the diagonal extent at 45 degrees", () => {
    const aabb = rotatedAABB({ x: 0, y: 0, widthM: 2, depthM: 0.6, rotationDeg: 45 })
    const ex = (aabb.maxX - aabb.minX) / 2
    const ey = (aabb.maxY - aabb.minY) / 2
    expect(ex).toBeCloseTo(0.919, 2)
    expect(ey).toBeCloseTo(0.919, 2)
    // full extent per side ~1.84 as called out in the brief
    expect(aabb.maxX - aabb.minX).toBeCloseTo(1.84, 1)
  })
})

describe("validateFurnitureInRoom — rotated out-of-room check", () => {
  const room = { id: "r1", floorId: "f1", name: "R", type: "kamar_tidur", x: 0, y: 0, width: 4, depth: 4, areaM2: 16 } as const

  it("flags an item as out-of-room via its rotated AABB even though the unrotated box fits", () => {
    // widthM=2, depthM=0.6 at 45deg near the bottom wall: unrotated y-range [3.3, 3.9] fits in
    // [0,4], but the rotated AABB's y half-extent grows from 0.3 to ~0.92, pushing maxY past 4.
    const item = {
      id: "f1",
      furnitureId: "wardrobe-2m",
      roomId: room.id,
      name: "Wardrobe",
      category: "wardrobe",
      x: 1,
      y: 3.3,
      rotationDeg: 45,
      widthM: 2,
      depthM: 0.6,
      heightM: 2,
      locked: false,
      priceRange: { low: 0, mid: 0, high: 0 },
    } as unknown as import("@/types").PlacedFurniture

    // Sanity: the unrotated box would NOT trip the old axis-aligned test.
    expect(item.x + item.widthM).toBeLessThanOrEqual(room.width)
    expect(item.y + item.depthM).toBeLessThanOrEqual(room.depth)

    const warnings = validateFurnitureInRoom(room as never, [item])
    expect(warnings.some((w) => w.id === `inside-${item.id}`)).toBe(true)
  })

  it("does not flag an item whose rotated AABB fits fully inside the room", () => {
    const item = {
      id: "f2",
      furnitureId: "wardrobe-2m",
      roomId: room.id,
      name: "Wardrobe",
      category: "wardrobe",
      x: 1,
      y: 1,
      rotationDeg: 45,
      widthM: 2,
      depthM: 0.6,
      heightM: 2,
      locked: false,
      priceRange: { low: 0, mid: 0, high: 0 },
    } as unknown as import("@/types").PlacedFurniture

    const warnings = validateFurnitureInRoom(room as never, [item])
    expect(warnings.some((w) => w.id === `inside-${item.id}`)).toBe(false)
  })
})

describe("movePlacedFurniture clamps the ROTATED footprint", () => {
  const room = { id: "r1", floorId: "f1", name: "R", type: "kamar_tidur", x: 0, y: 0, width: 4, depth: 4, areaM2: 16 }
  const base = generateRoomInterior(room as never, { rooms: [room], openings: [] } as never, "scandinavian")
  const wardrobe = { ...base.furniture[0], widthM: 2, depthM: 0.6, rotationDeg: 90, x: 1, y: 1 }
  const plan = { ...base, furniture: [wardrobe] }

  it("a 90°-rotated wardrobe can reach flush against the left wall (visible edge = 0)", () => {
    const moved = movePlacedFurniture(room as never, plan, wardrobe.id, -99, 1)
    const item = moved.furniture[0]
    expect(rotatedAABB(item).minX).toBeCloseTo(0, 2) // flush — the gap is closable
    expect(item.x).toBeCloseTo(-0.7, 2) // corner may go negative; the visual stays inside
  })

  it("a 90°-rotated wardrobe cannot poke through the far wall", () => {
    const moved = movePlacedFurniture(room as never, plan, wardrobe.id, 1, 99)
    const aabb = rotatedAABB(moved.furniture[0])
    expect(aabb.maxY).toBeCloseTo(4, 2) // stops at the wall
    expect(aabb.minY).toBeGreaterThanOrEqual(0)
  })

  it("unrotated items keep the exact previous clamp behavior", () => {
    const flat = { ...base, furniture: [{ ...wardrobe, rotationDeg: 0 }] }
    const movedMin = movePlacedFurniture(room as never, flat, wardrobe.id, -99, -99)
    expect(movedMin.furniture[0].x).toBe(0)
    expect(movedMin.furniture[0].y).toBe(0)
    const movedMax = movePlacedFurniture(room as never, flat, wardrobe.id, 99, 99)
    expect(movedMax.furniture[0].x).toBeCloseTo(2, 5) // 4 - 2
    expect(movedMax.furniture[0].y).toBeCloseTo(3.4, 5) // 4 - 0.6
  })

  it("rotating an item flush against a wall slides it inward instead of through the wall", () => {
    // 2×0.6 wardrobe flush against the top wall (y=0) at 0°
    const flush = { ...base, furniture: [{ ...wardrobe, rotationDeg: 0, x: 1, y: 0 }] }
    const rotated = rotatePlacedFurniture(room as never, flush, wardrobe.id)
    const aabb = rotatedAABB(rotated.furniture[0])
    expect(rotated.furniture[0].rotationDeg).toBe(90)
    expect(aabb.minY).toBeGreaterThanOrEqual(-1e-9) // no poke-through above
    expect(aabb.maxY).toBeLessThanOrEqual(4 + 1e-9)
  })

  it("setting a free angle re-clamps the rotated footprint into the room", () => {
    const flush = { ...base, furniture: [{ ...wardrobe, rotationDeg: 0, x: 0, y: 1 }] }
    const rotated = setFurnitureRotationInRoom(room as never, flush, wardrobe.id, 45)
    const aabb = rotatedAABB(rotated.furniture[0])
    expect(aabb.minX).toBeGreaterThanOrEqual(-1e-9)
    expect(aabb.maxX).toBeLessThanOrEqual(4 + 1e-9)
    expect(aabb.minY).toBeGreaterThanOrEqual(-1e-9)
    expect(aabb.maxY).toBeLessThanOrEqual(4 + 1e-9)
  })
})

describe("every furniture item is GLB-uploadable (slotType never null)", () => {
  it("uncurated items fall back to the generic slot; curated ids keep their profile", async () => {
    const { slotTypeForFurniture } = await import("./validation-profiles")
    expect(slotTypeForFurniture("wardrobe-2m")).toBe("generic")
    expect(slotTypeForFurniture("bed-queen")).toBe("generic")
    expect(slotTypeForFurniture("tv-55")).toBe("tv")
    expect(slotTypeForFurniture("sofa-l")).toBe("sofa")
  })

  it("applySavedInterior backfills slotType for items saved before the generic slot existed", () => {
    const layout = makeLayout()
    const room = layout.rooms[0]
    const plan = generateInteriorPlan(layout, { projectId: "p1", style: "modern_tropical" })
    const saved = toSavedInterior(plan)
    const savedRoom = saved.rooms.find((r) => r.roomId === room.id)!
    savedRoom.furniture[0] = { ...savedRoom.furniture[0], slotType: null } // legacy save
    const hydrated = applySavedInterior(layout, saved, { projectId: "p1" })
    const item = hydrated.rooms.find((r) => r.roomId === room.id)!.furniture[0]
    expect(item.slotType).not.toBeNull()
  })
})

describe("applySavedInterior self-heals out-of-room positions", () => {
  it("re-clamps a saved rotated item that pokes through a wall", () => {
    const layout = makeLayout()
    const room = layout.rooms[0]
    const plan = generateInteriorPlan(layout, { projectId: "p1", style: "modern_tropical" })
    const saved = toSavedInterior(plan)
    const savedRoom = saved.rooms.find((r) => r.roomId === room.id)!
    // Corrupt one item the way the old buggy clamp allowed: rotated 90°, pushed
    // so its rotated footprint pokes past the room's far wall.
    savedRoom.furniture[0] = {
      ...savedRoom.furniture[0],
      widthM: 2,
      depthM: 0.6,
      rotationDeg: 90,
      x: 1,
      y: room.depth - 0.6, // old clamp allowed this; rotated footprint pokes 0.7m out
    }
    const hydrated = applySavedInterior(layout, saved, { projectId: "p1" })
    const healed = hydrated.rooms.find((r) => r.roomId === room.id)!.furniture[0]
    const aabb = rotatedAABB(healed)
    expect(aabb.maxY).toBeLessThanOrEqual(room.depth + 1e-9)
    expect(aabb.minY).toBeGreaterThanOrEqual(-1e-9)
  })
})

describe("open-plan zones (zoneId) — cross-room furniture", () => {
  // Two 3×4 rooms side by side sharing zoneId "open-1": A at x∈[0,3], B at x∈[3,6].
  function makeZoneLayout() {
    const layout = makeLayout()
    layout.rooms = [
      { id: "za", floorId: "floor-1", name: "Ruang keluarga", type: "ruang_keluarga", x: 0, y: 0, width: 3, depth: 4, areaM2: 12, zoneId: "open-1" },
      { id: "zb", floorId: "floor-1", name: "Dapur", type: "dapur", x: 3, y: 0, width: 3, depth: 4, areaM2: 12, zoneId: "open-1" },
      { id: "zc", floorId: "floor-1", name: "Kamar", type: "kamar_tidur", x: 0, y: 4, width: 3, depth: 3, areaM2: 9 },
    ]
    return layout
  }

  function planFor(layout: ReturnType<typeof makeZoneLayout>, roomId: string) {
    return generateInteriorPlan(layout, { projectId: "p1", style: "modern_tropical" })
      .rooms.find((r) => r.roomId === roomId)!
  }

  it("zoneSiblingRooms returns same-floor rooms sharing the zoneId only", () => {
    const layout = makeZoneLayout()
    const [za, , zc] = layout.rooms
    expect(zoneSiblingRooms(za, layout.rooms).map((r) => r.id)).toEqual(["zb"])
    expect(zoneSiblingRooms(zc, layout.rooms)).toEqual([])
  })

  it("lets a drag straddle the open boundary between zone rooms (no clamp, no warning)", () => {
    const layout = makeZoneLayout()
    const roomA = layout.rooms[0]
    const siblings = zoneSiblingRooms(roomA, layout.rooms)
    const plan = planFor(layout, roomA.id)
    const item = plan.furniture[0]

    // Center the item on the shared x=3 edge: half in A, half in B.
    const targetX = 3 - roomA.x - item.widthM / 2
    const moved = movePlacedFurniture(roomA, plan, item.id, targetX, 1, siblings)
    const updated = moved.furniture.find((f) => f.id === item.id)!

    expect(updated.x).toBeCloseTo(targetX, 2)
    expect(updated.x + updated.widthM).toBeGreaterThan(roomA.width) // benar-benar nyebrang
    expect(moved.warnings.some((w) => w.id === `inside-${item.id}`)).toBe(false)
  })

  it("lets a drag move fully into the zone sibling's area", () => {
    const layout = makeZoneLayout()
    const [roomA, roomB] = layout.rooms
    const siblings = zoneSiblingRooms(roomA, layout.rooms)
    const plan = planFor(layout, roomA.id)
    const item = plan.furniture[0]

    // Center the item inside B (coords stay local to A, the current owner).
    const targetX = roomB.x + (roomB.width - item.widthM) / 2 - roomA.x
    const targetY = roomB.y + (roomB.depth - item.depthM) / 2 - roomA.y
    const moved = movePlacedFurniture(roomA, plan, item.id, targetX, targetY, siblings)
    const updated = moved.furniture.find((f) => f.id === item.id)!

    expect(updated.x).toBeCloseTo(targetX, 2)
    expect(updated.x).toBeGreaterThan(roomA.width) // sepenuhnya melewati batas ruang A
    expect(moved.warnings.some((w) => w.id === `inside-${item.id}`)).toBe(false)
  })

  it("still clamps when the drag leaves the zone union entirely", () => {
    const layout = makeZoneLayout()
    const roomA = layout.rooms[0]
    const siblings = zoneSiblingRooms(roomA, layout.rooms)
    const plan = planFor(layout, roomA.id)
    const item = plan.furniture[0]

    const moved = movePlacedFurniture(roomA, plan, item.id, 99, 99, siblings)
    const updated = moved.furniture.find((f) => f.id === item.id)!
    const aabb = rotatedAABB(updated)

    expect(aabb.maxX).toBeLessThanOrEqual(roomA.width + 1e-9)
    expect(aabb.maxY).toBeLessThanOrEqual(roomA.depth + 1e-9)
  })

  it("does not relax containment for rooms WITHOUT a shared zone", () => {
    const layout = makeZoneLayout()
    const roomC = layout.rooms[2] // kamar, no zoneId
    const plan = planFor(layout, roomC.id)
    const item = plan.furniture[0]

    const moved = movePlacedFurniture(roomC, plan, item.id, 5, 1, zoneSiblingRooms(roomC, layout.rooms))
    const updated = moved.furniture.find((f) => f.id === item.id)!

    expect(updated.x + updated.widthM).toBeLessThanOrEqual(roomC.width + 1e-9)
  })

  it("transferFurnitureBetweenRooms preserves world position and moves budget lines", () => {
    const layout = makeZoneLayout()
    const [roomA, roomB] = layout.rooms
    const generated = generateInteriorPlan(layout, { projectId: "p1", style: "modern_tropical" })
    const planA = generated.rooms.find((r) => r.roomId === roomA.id)!
    const planB = generated.rooms.find((r) => r.roomId === roomB.id)!
    const item = planA.furniture[0]
    // Put the item fully inside B first (local to A), as a settled drag would.
    const staged = movePlacedFurniture(roomA, planA, item.id, 3.5, 1, zoneSiblingRooms(roomA, layout.rooms))

    const result = transferFurnitureBetweenRooms(roomA, staged, roomB, planB, item.id, layout.rooms)!
    const movedItem = result.dst.furniture.find((f) => f.id === item.id)!

    // World x = roomA.x + 3.5 = 3.5 → local to B (x=3) = 0.5
    expect(movedItem.x).toBeCloseTo(0.5, 2)
    expect(movedItem.y).toBeCloseTo(1, 2)
    expect(result.src.furniture.some((f) => f.id === item.id)).toBe(false)
    expect(result.src.budgetEstimate.lines.some((l) => l.item === item.name)).toBe(false)
    expect(result.dst.budgetEstimate.lines.filter((l) => l.item === item.name).length).toBeGreaterThan(0)
    expect(result.src.warnings.some((w) => w.furnitureId === item.id)).toBe(false)
  })

  it("applySavedInterior keeps a saved straddling item in place (no snap-back)", () => {
    const layout = makeZoneLayout()
    const roomA = layout.rooms[0]
    const plan = generateInteriorPlan(layout, { projectId: "p1", style: "modern_tropical" })
    const saved = toSavedInterior(plan)
    const savedRoom = saved.rooms.find((r) => r.roomId === roomA.id)!
    const item = savedRoom.furniture[0]
    const straddleX = 3 - roomA.x - item.widthM / 2 // setengah di A, setengah di B
    savedRoom.furniture[0] = { ...item, rotationDeg: 0, x: straddleX, y: 1 }

    const hydrated = applySavedInterior(layout, saved, { projectId: "p1" })
    const loaded = hydrated.rooms.find((r) => r.roomId === roomA.id)!.furniture[0]

    expect(loaded.x).toBeCloseTo(straddleX, 2)
    expect(hydrated.rooms.find((r) => r.roomId === roomA.id)!.warnings
      .some((w) => w.id === `inside-${loaded.id}`)).toBe(false)
  })
})

describe("duplicatePlacedFurniture", () => {
  it("clones the item with model attachment, offset 0.3 m, and recomputes budget", () => {
    const layout = makeLayout()
    const room = layout.rooms[0]
    const base = generateInteriorPlan(layout, { projectId: "p1", style: "modern_tropical" })
      .rooms.find((r) => r.roomId === room.id)!
    const source = { ...base.furniture[0], modelAssetId: "asset-1", modelUrl: "https://x/m.glb" }
    const plan = { ...base, furniture: [source, ...base.furniture.slice(1)] }

    const next = duplicatePlacedFurniture(room, plan, source.id)!

    expect(next.furniture).toHaveLength(plan.furniture.length + 1)
    const copy = next.furniture.at(-1)!
    expect(copy.id).toBe(`${source.id}-copy`)
    expect(copy.modelAssetId).toBe("asset-1")
    expect(copy.modelUrl).toBe("https://x/m.glb")
    expect(copy.widthM).toBe(source.widthM)
    expect(copy.rotationDeg).toBe(source.rotationDeg)
    // offset diagonal, tapi tetap di dalam ruang
    expect(copy.x + copy.widthM).toBeLessThanOrEqual(room.width + 1e-9)
    expect(copy.y + copy.depthM).toBeLessThanOrEqual(room.depth + 1e-9)
    expect(next.budgetEstimate.midIDR).toBeGreaterThanOrEqual(plan.budgetEstimate.midIDR)
  })

  it("suffixes -copy2 when -copy already exists and returns null for unknown ids", () => {
    const layout = makeLayout()
    const room = layout.rooms[0]
    const plan = generateInteriorPlan(layout, { projectId: "p1", style: "modern_tropical" })
      .rooms.find((r) => r.roomId === room.id)!
    const id = plan.furniture[0].id

    const once = duplicatePlacedFurniture(room, plan, id)!
    const twice = duplicatePlacedFurniture(room, once, id)!
    expect(twice.furniture.at(-1)!.id).toBe(`${id}-copy2`)

    expect(duplicatePlacedFurniture(room, plan, "nope")).toBeNull()
  })
})

describe("furniture luar ruangan — roam dalam batas tanah", () => {
  it("item taman boleh keluar rect ruang selama masih di dalam site; tanpa warning", () => {
    const layout = makeLayout()
    const taman: Room = { id: "tm", floorId: "floor-1", name: "Taman", type: "taman", x: 0, y: 4, width: 2, depth: 2, areaM2: 4 }
    layout.rooms.push(taman)
    const plan = generateRoomInterior(taman, layout, "modern_tropical")
    const item = plan.furniture[0] ?? {
      id: "pf", furnitureId: "planter", roomId: "tm", name: "Planter", category: "decor",
      x: 0.2, y: 0.2, rotationDeg: 0, widthM: 0.5, depthM: 0.5, heightM: 0.8, locked: false,
      priceRange: { low: 0, mid: 0, high: 0 },
    }
    const withItem = { ...plan, furniture: [item] }
    const site = { widthM: 8, depthM: 8 }

    // pindah JAUH ke pojok site (di luar rect taman) → dibolehkan (clamp site)
    const moved = movePlacedFurniture(taman, withItem, item.id, 5, -3.5, [], site)
    const placed = moved.furniture[0]
    expect(taman.x + placed.x).toBeGreaterThanOrEqual(0)
    expect(taman.y + placed.y).toBeGreaterThanOrEqual(-4) // y lokal bisa negatif (absolut >= 0)
    expect(taman.x + placed.x + placed.widthM).toBeLessThanOrEqual(8)
    expect(placed.x).toBeGreaterThan(taman.width) // benar-benar di luar rect ruang
    expect(moved.warnings.some((w) => w.id === `inside-${item.id}`)).toBe(false)

    // melewati batas tanah → di-clamp ke tepi site
    const clamped = movePlacedFurniture(taman, withItem, item.id, 99, 99, [], site)
    const p2 = clamped.furniture[0]
    expect(taman.x + p2.x + p2.widthM).toBeLessThanOrEqual(8.01)

    // ruang berdinding TIDAK roam: tetap clamp ke rect ruang
    const kamar = layout.rooms[0]
    const kplan = generateRoomInterior(kamar, layout, "modern_tropical")
    const kmoved = movePlacedFurniture(kamar, kplan, kplan.furniture[0].id, 99, 99, [], site)
    const kp = kmoved.furniture.find((f) => f.id === kplan.furniture[0].id)!
    expect(kp.x + kp.widthM).toBeLessThanOrEqual(kamar.width + 0.01)
  })
})

describe("snap ke dinding (nearestWallSide / snapPositionToWall / align)", () => {
  const room = { id: "r1", floorId: "f1", name: "R", type: "kamar_tidur", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 }
  const clock = { x: 1.5, y: 0.3, widthM: 0.4, depthM: 0.05, rotationDeg: 0 }

  it("nearestWallSide memilih dinding dgn jarak tepi terkecil", () => {
    expect(nearestWallSide(clock, room).side).toBe("n") // tepi atas 0.3-0.025=0.275
    expect(nearestWallSide({ ...clock, x: 3.5, y: 1.4 }, room).side).toBe("e")
  })

  it("snapPositionToWall menempelkan ke MUKA DALAM dinding (inset 0.06, bukan garis tengah)", () => {
    const n = snapPositionToWall(clock, room, "n")
    // rot 0: ey=hd → y = inset(0.06) + ey - hd = 0.06 (muka dalam, bukan 0)
    expect(n.y).toBeCloseTo(0.06, 5)
    expect(n.x).toBeCloseTo(1.5, 5) // sumbu sejajar dinding tidak berubah
    const e = snapPositionToWall({ ...clock, rotationDeg: 90 }, room, "e")
    // rot 90: ex = 0.025 → x = 4 - 0.06 - 0.025 - 0.2 = 3.715 (round2 → 3.72)
    expect(e.x).toBeCloseTo(3.72, 2)
  })

  it("REGRESI: jam dinding tipis tak terkubur — muka belakang di / setelah muka dalam dinding", () => {
    // Bug "jam dinding hilang saat ditempel": item kedalaman 5 cm ditempel ke
    // garis tengah dinding → seluruhnya di dalam tebal dinding 12 cm → tertutup.
    // Kini muka belakang item ≥ muka dalam dinding (0.06), jadi menonjol ke ruang.
    const jam = { x: 1.5, y: 0.9, widthM: 0.4, depthM: 0.05, rotationDeg: 0 }
    const p = snapPositionToWall(jam, room, "n")
    const backEdge = p.y // rot 0: pojok-min = muka belakang (utara)
    expect(backEdge).toBeGreaterThanOrEqual(0.06 - 1e-6) // di / setelah muka dalam
    const frontEdge = p.y + jam.depthM
    expect(frontEdge).toBeGreaterThan(0.06) // menonjol ke dalam ruang (terlihat)
  })

  it("benda gantung-dinding (jam/lukisan/TV) NAIK otomatis saat ditempel; furnitur lantai tidak", () => {
    const base = generateRoomInterior(room as never, { rooms: [room], openings: [] } as never, "scandinavian")
    const jam = { id: "jam", furnitureId: "custom-jam", roomId: room.id, name: "Jam", category: "decor",
      x: 1.5, y: 0.9, rotationDeg: 0, widthM: 0.4, depthM: 0.05, heightM: 0.4,
      locked: false, priceRange: { low: 0, mid: 0, high: 0 } }
    const lemari = { id: "lmr", furnitureId: "wardrobe", roomId: room.id, name: "Lemari", category: "wardrobe",
      x: 1, y: 0.9, rotationDeg: 0, widthM: 1.2, depthM: 0.6, heightM: 2.0,
      locked: false, priceRange: { low: 0, mid: 0, high: 0 } }
    expect(isWallHangingItem(jam)).toBe(true)
    expect(isWallHangingItem(lemari)).toBe(false)

    const withItems = { ...base, furniture: [...base.furniture, jam as never, lemari as never] }
    const afterJam = snapFurnitureToWallInRoom(room as never, withItems, "jam", "n")
    const snappedJam = afterJam.furniture.find((f) => f.id === "jam")!
    // Pusat jam ~1.5 m → base = 1.5 - 0.2 = 1.3
    expect(snappedJam.mountHeightM).toBeCloseTo(1.3, 5)

    const afterLmr = snapFurnitureToWallInRoom(room as never, withItems, "lmr", "n")
    const snappedLmr = afterLmr.furniture.find((f) => f.id === "lmr")!
    expect(snappedLmr.mountHeightM).toBeUndefined() // furnitur lantai tak dinaikkan
  })

  it("tinggi pasang eksplisit tidak ditimpa saat tempel dinding", () => {
    const base = generateRoomInterior(room as never, { rooms: [room], openings: [] } as never, "scandinavian")
    const jam = { id: "jam", furnitureId: "custom-jam", roomId: room.id, name: "Jam", category: "decor",
      x: 1.5, y: 0.9, rotationDeg: 0, widthM: 0.4, depthM: 0.05, heightM: 0.4, mountHeightM: 2.2,
      locked: false, priceRange: { low: 0, mid: 0, high: 0 } }
    const withJam = { ...base, furniture: [...base.furniture, jam as never] }
    const after = snapFurnitureToWallInRoom(room as never, withJam, "jam", "n")
    expect(after.furniture.find((f) => f.id === "jam")!.mountHeightM).toBe(2.2)
  })

  it("alignRotationToWall memilih kelipatan 90 SEJAJAR dinding terdekat dgn sudut sekarang", () => {
    expect(alignRotationToWall(10, "n")).toBe(0)
    expect(alignRotationToWall(170, "s")).toBe(180)
    expect(alignRotationToWall(100, "e")).toBe(90)
    expect(alignRotationToWall(350, "w")).toBe(270) // 350 → lebih dekat ke 270? diff(270)=80, diff(90)=100 ✓
  })

  it("snapFurnitureToWallInRoom: posisi flush + sudut lurus, undo-friendly (immutabel)", () => {
    const base = generateRoomInterior(room as never, { rooms: [room], openings: [] } as never, "scandinavian")
    const withClock = { ...base, furniture: [...base.furniture, {
      id: "clk", furnitureId: "custom-clk", roomId: room.id, name: "Jam", category: "decor",
      x: 1.5, y: 0.9, rotationDeg: 37, widthM: 0.4, depthM: 0.05, heightM: 0.4,
      locked: false, priceRange: { low: 0, mid: 0, high: 0 },
    } as never] }
    const next = snapFurnitureToWallInRoom(room as never, withClock, "clk")
    const clk = next.furniture.find((f) => f.id === "clk")!
    expect(clk.rotationDeg).toBe(0) // 37° → 0° (dinding n)
    expect(clk.y).toBeCloseTo(0.06, 5) // flush ke MUKA DALAM dinding utara
    expect(withClock.furniture.find((f) => f.id === "clk")!.y).toBeCloseTo(0.9, 5) // input tak dimutasi
  })
})
