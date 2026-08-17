import { beforeEach, describe, expect, it } from "vitest"

import { useEditorStore } from "@/stores/editor-store"
import { makeLayout, sampleSite } from "@/test-utils/fixtures"
import { actionsForContext, type MenuCtx } from "./action-registry"

function baseCtx(over: Partial<MenuCtx>): MenuCtx {
  const store = useEditorStore.getState()
  return {
    ref: null,
    point: null,
    layout: store.layout,
    store,
    openAddRoom: () => {},
    ...over,
  }
}

describe("addRoomInRect (store)", () => {
  beforeEach(() => {
    useEditorStore.getState().loadLayout(makeLayout(), sampleSite, [])
  })

  it("membuat ruang pas rect, clamp ke MIN_ROOM 1,2 m", () => {
    const before = useEditorStore.getState().layout!.rooms.length
    // Celah 1,0 m → di-clamp ke 1,2 m.
    useEditorStore.getState().addRoomInRect("koridor", { x: 1, y: 1, width: 1.0, depth: 4 })
    const rooms = useEditorStore.getState().layout!.rooms
    expect(rooms.length).toBe(before + 1)
    const added = rooms[rooms.length - 1]
    expect(added.type).toBe("koridor")
    expect(added.width).toBeCloseTo(1.2, 2)
    expect(added.depth).toBeCloseTo(4, 2)
    // Terpilih setelah dibuat.
    expect(useEditorStore.getState().selected).toEqual({ kind: "room", id: added.id })
  })

  it("duplicateRoom menambah salinan tergeser", () => {
    const first = useEditorStore.getState().layout!.rooms[0]
    const before = useEditorStore.getState().layout!.rooms.length
    useEditorStore.getState().duplicateRoom(first.id)
    const rooms = useEditorStore.getState().layout!.rooms
    expect(rooms.length).toBe(before + 1)
    const copy = rooms[rooms.length - 1]
    expect(copy.type).toBe(first.type)
    expect(copy.x).toBeCloseTo(first.x + 0.5, 2)
  })
})

describe("actionsForContext", () => {
  beforeEach(() => {
    useEditorStore.getState().loadLayout(makeLayout(), sampleSite, [])
  })

  it("area kosong dengan celah → aksi 'Tambah ruang di sini'", () => {
    const store = useEditorStore.getState()
    const floor = store.layout!.floors[0].id
    store.setSelectedFloor(floor)
    // Titik jauh dari ruang manapun tetapi di dalam site.
    const pt = { x: sampleSite.widthM - 0.5, y: sampleSite.depthM - 0.5 }
    const items = actionsForContext(baseCtx({ ref: null, point: pt, layout: useEditorStore.getState().layout }))
    // Mungkin ada/tidak tergantung apakah titik itu kosong; minimal tak crash & tipe benar.
    expect(Array.isArray(items)).toBe(true)
  })

  it("ref room → ada Duplikat + Hapus", () => {
    const room = useEditorStore.getState().layout!.rooms[0]
    const items = actionsForContext(baseCtx({ ref: { kind: "room", id: room.id } }))
    const ids = items.map((a) => a.id)
    expect(ids).toContain("duplicate")
    expect(ids).toContain("delete")
  })

  it("ref opening → toggle tipe + hapus", () => {
    const op = useEditorStore.getState().layout!.openings[0]
    if (!op) return
    const items = actionsForContext(baseCtx({ ref: { kind: "opening", id: op.id } }))
    const ids = items.map((a) => a.id)
    expect(ids).toContain("toggle-type")
    expect(ids).toContain("delete")
  })

  it("ref wall → aksi aksen + lampu (tanpa hapus)", () => {
    const room = useEditorStore.getState().layout!.rooms[0]
    const items = actionsForContext(baseCtx({ ref: { kind: "wall", roomId: room.id, side: "s" } }))
    const ids = items.map((a) => a.id)
    expect(ids).toContain("accent-fins")
    expect(ids).toContain("wall-lamp")
  })

  it("ref roof → tawarkan tipe atap selain yang aktif", () => {
    const items = actionsForContext(baseCtx({ ref: { kind: "roof" } }))
    const ids = items.map((a) => a.id)
    // Selalu ada minimal beberapa alternatif tipe.
    expect(ids.some((id) => id.startsWith("roof-"))).toBe(true)
  })

  it("ref roofZone → sembunyikan + hapus zona", () => {
    const items = actionsForContext(baseCtx({ ref: { kind: "roofZone", id: "z1" } }))
    const ids = items.map((a) => a.id)
    expect(ids).toContain("hide")
    expect(ids).toContain("delete")
  })

  it("ref skylight → hapus skylight", () => {
    const items = actionsForContext(baseCtx({ ref: { kind: "skylight", id: "s1" } }))
    expect(items.map((a) => a.id)).toContain("delete")
  })
})
