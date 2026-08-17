import { create } from "zustand"

import type {
  DesignLayout,
  FitMode,
  FurnitureItem,
  InteriorPlan,
  InteriorSurface,
  InteriorStyleId,
  LightingFixture,
  MaterialMode,
  Room,
  RoomInteriorPlan,
  WaterPointType,
} from "@/types"
import {
  addCustomAssetToRoom,
  addFurnitureToRoom,
  addLightToRoom,
  applySavedInterior,
  buildRoomBudget,
  combineBudget,
  duplicatePlacedFurniture,
  generateInteriorPlan,
  generateRoomInterior,
  interiorRooms,
  moveLightInRoom,
  movePlacedFurniture,
  nearestWallSide,
  removeLightFromRoom,
  removePlacedFurniture,
  requiredWaterPointFor,
  rotatePlacedFurniture,
  setFurniturePriceInRoom,
  setFurnitureRotationInRoom,
  snapFurnitureToWallInRoom,
  transferFurnitureBetweenRooms,
  WALL_SNAP_THRESHOLD_M,
  updateMaterialInRoom,
  updateLightInRoom,
  validateFurnitureInRoom,
  zoneSiblingRooms,
  type LibraryAssetInput,
} from "@/lib/interior/plan"
import { FURNITURE_LIBRARY } from "@/lib/interior/presets"
import type { SavedInterior } from "@/lib/schemas/interior"

const MAX_HISTORY = 30

type HistoryEntry = {
  plan: InteriorPlan
  selectedRoomId: string | null
  selectedFurnitureId: string | null
  selectedLightId: string | null
}

type InteriorState = {
  projectId: string | null
  layout: DesignLayout | null
  /** Batas tanah — clamp furniture outdoor (taman/carport) ke seluruh tapak. */
  site: { widthM: number; depthM: number } | null
  plan: InteriorPlan | null
  style: InteriorStyleId
  selectedRoomId: string | null
  selectedFurnitureId: string | null
  selectedLightId: string | null
  dirty: boolean

  // undo/redo
  history: HistoryEntry[]
  future: HistoryEntry[]

  load: (opts: {
    projectId: string
    layout: DesignLayout
    style: InteriorStyleId
    initialRoomId?: string
    saved?: SavedInterior
    site?: { widthM: number; depthM: number }
  }) => void
  markSaved: () => void
  selectRoom: (roomId: string) => void
  selectFurniture: (id: string | null) => void
  selectLight: (id: string | null) => void
  setStyle: (style: InteriorStyleId) => void
  moveFurniture: (roomId: string, furnitureId: string, x: number, y: number) => void
  /** Re-parent a dropped item to the open-plan zone sibling it now occupies (no-op otherwise). */
  settleFurniture: (roomId: string, furnitureId: string) => void
  /** Tempelkan item PRESISI ke dinding (default: terdekat) + luruskan sudut sejajar dinding. */
  snapFurnitureToWall: (roomId: string, furnitureId: string, side?: "n" | "s" | "w" | "e") => void
  /** Tinggi pasang dari lantai (jam dinding, rak ambalan, TV custom); null = di lantai. */
  setFurnitureMountHeight: (roomId: string, furnitureId: string, heightM: number | null) => void
  /** Override harga per-instance (Rp) — null menghapus override; budget &
   *  status "belum dihargai" di-recompute (lihat setFurniturePriceInRoom). */
  setFurniturePrice: (roomId: string, furnitureId: string, priceIDR: number | null) => void
  /**
   * Pasang/lepas model GLB kustom pada satu furniture slot di state KLIEN.
   * Server-side attach saja tidak cukup: load() menolak re-load saat plan
   * sudah di memori (guard autosave), sehingga tanpa ini attachment tidak
   * pernah tampil dan autosave berikutnya MENIMPA balik hasil attach server.
   */
  setFurnitureModel: (
    roomId: string,
    furnitureId: string,
    model: { modelAssetId: string | null; modelUrl: string | null; fitMode?: FitMode | null; materialMode?: MaterialMode | null }
  ) => void
  rotateFurniture: (roomId: string, furnitureId: string) => void
  setFurnitureRotation: (roomId: string, furnitureId: string, deg: number) => void
  removeFurniture: (roomId: string, furnitureId: string) => void
  /** Gandakan item (dimensi/rotasi/model GLB ikut), offset 0.3 m, lalu pilih salinannya. */
  duplicateFurniture: (roomId: string, furnitureId: string) => void
  /**
   * Adds furniture to a room. Water-bound fixtures (toilet/shower/wastafel)
   * require a matching titik air placed in the 2D editor first — the add is
   * refused with `{ ok: false, missingWaterPoint }` otherwise, and when the
   * point exists the fixture is placed AT it (2D shell drives the 3D model).
   */
  addFurniture: (
    roomId: string,
    item: FurnitureItem
  ) => { ok: true } | { ok: false; missingWaterPoint: WaterPointType }
  /** Pasang asset My Library sebagai furniture BARU (tanpa placeholder) di tengah ruang. */
  addAssetFurniture: (roomId: string, asset: LibraryAssetInput) => void
  updateMaterial: (roomId: string, surface: InteriorSurface, materialId: string) => void
  addLight: (roomId: string, type: LightingFixture["type"]) => void
  moveLight: (roomId: string, lightId: string, x: number, y: number) => void
  updateLight: (roomId: string, lightId: string, patch: Partial<Pick<LightingFixture, "type" | "colorTemperature" | "qty" | "heightM" | "watt">>) => void
  removeLight: (roomId: string, lightId: string) => void
  resetRoom: (roomId: string) => void
  undo: () => void
  redo: () => void
}

export const useInteriorStore = create<InteriorState>((set, get) => ({
  projectId: null,
  layout: null,
  site: null,
  plan: null,
  style: "modern_tropical",
  selectedRoomId: null,
  selectedFurnitureId: null,
  selectedLightId: null,
  dirty: false,
  history: [],
  future: [],

  load: ({ projectId, layout, style, initialRoomId, saved, site }) => {
    const current = get()
    // Load-bearing for autosave: useSaveInterior's onSuccess updates the
    // `saved` query data, which re-runs Preview3DView's load effect. This
    // guard short-circuits that re-run so autosave never clobbers the live
    // in-memory draft. Do not relax it without rethinking autosave.
    if (current.projectId === projectId && current.layout?.id === layout.id && current.plan) {
      if (initialRoomId) set({ selectedRoomId: initialRoomId })
      if (site && !current.site) set({ site })
      // SELF-HEAL: ruang yang ditambahkan di 2D SETELAH interior dimuat tidak
      // punya RoomInteriorPlan (id layout tidak berubah saat ruang ditambah,
      // jadi guard di atas menahan plan lama) → panel 3D kehilangan tombol
      // "Tambah Model 3D"/Interior Editor utk ruang itu. Generate susulan +
      // refresh referensi layout agar zone/clamp melihat ruang terbaru.
      const missing = interiorRooms(layout).filter(
        (r) => !current.plan!.rooms.some((p) => p.roomId === r.id)
      )
      if (missing.length > 0) {
        const added = missing.map((r) => generateRoomInterior(r, layout, current.plan!.style))
        const rooms = [...current.plan!.rooms, ...added]
        set({
          layout,
          plan: {
            ...current.plan!,
            rooms,
            totalEstimate: combineBudget(rooms.flatMap((r) => r.budgetEstimate.lines)),
            warnings: rooms.flatMap((r) => r.warnings),
          },
        })
      } else if (current.layout !== layout) {
        set({ layout })
      }
      return
    }
    const useSaved = saved && saved.versionId === layout.versionId
    const plan = useSaved
      ? applySavedInterior(layout, saved, { projectId })
      : generateInteriorPlan(layout, { projectId, versionId: layout.versionId, style })
    set({
      projectId,
      layout,
      site: site ?? null,
      plan,
      style: plan.style,
      selectedRoomId: initialRoomId ?? plan.rooms[0]?.roomId ?? null,
      selectedFurnitureId: null,
      selectedLightId: null,
      dirty: false,
      history: [],
      future: [],
    })
  },

  markSaved: () => set({ dirty: false }),

  selectRoom: (roomId) => {
    const current = get().selectedRoomId
    const switching = roomId !== current
    // Only reset furniture/light selection when switching to a different room
    set({
      selectedRoomId: roomId,
      selectedFurnitureId: switching ? null : get().selectedFurnitureId,
      selectedLightId: switching ? null : get().selectedLightId,
    })
  },
  selectFurniture: (id) => set({ selectedFurnitureId: id, selectedLightId: null }),
  selectLight: (id) => set({ selectedLightId: id, selectedFurnitureId: null }),

  setStyle: (style) => {
    const { layout, projectId, plan: currentPlan, selectedRoomId } = get()
    if (!layout || !projectId || !currentPlan) return

    // Push current state to history before changing
    pushHistory(set, get)

    // Generate a fresh plan with the new style (new materials, colors, lighting)
    const freshPlan = generateInteriorPlan(layout, {
      projectId,
      versionId: layout.versionId,
      style,
    })

    // Overlay existing user-edited furniture onto the fresh plan,
    // keeping positions/rotations but using new materials/colors/budget
    const currentByRoom = new Map(
      currentPlan.rooms.map((r) => [r.roomId, r.furniture])
    )

    const rooms = freshPlan.rooms.map((freshRoom) => {
      const currentFurniture = currentByRoom.get(freshRoom.roomId)
      const room = layout.rooms.find((r) => r.id === freshRoom.roomId)
      if (!currentFurniture || !room) return freshRoom

      // Keep user's furniture positions, but update prices for the new style
      const furniture = currentFurniture.map((item) => {
        const base = FURNITURE_LIBRARY.find((f) => f.id === item.furnitureId)
        return {
          ...item,
          priceRange: base
            ? {
                low: style === "luxury_compact" ? Math.round(base.priceRange.low * 1.25) : base.priceRange.low,
                mid: style === "luxury_compact" ? Math.round(base.priceRange.mid * 1.25) : base.priceRange.mid,
                high: style === "luxury_compact" ? Math.round(base.priceRange.high * 1.25) : base.priceRange.high,
              }
            : item.priceRange,
        }
      })

      // Recompute warnings + budget with the new style's materials/lighting
      return {
        ...freshRoom,
        furniture,
        warnings: validateFurnitureInRoom(room, furniture),
        budgetEstimate: buildRoomBudget(room, furniture, freshRoom.materials, freshRoom.lighting),
      }
    })

    const totalEstimate = combineBudget(rooms.flatMap((r: RoomInteriorPlan) => r.budgetEstimate.lines))

    set({
      style,
      plan: {
        ...freshPlan,
        style,
        rooms,
        totalEstimate,
        warnings: rooms.flatMap((r: RoomInteriorPlan) => r.warnings),
      },
      selectedRoomId: selectedRoomId ?? freshPlan.rooms[0]?.roomId ?? null,
      selectedFurnitureId: null,
      selectedLightId: null,
      dirty: true,
      future: [],
    })
  },

  moveFurniture: (roomId, furnitureId, x, y) =>
    updateRoomPlan(set, get, roomId, (room, plan, state) =>
      movePlacedFurniture(room, plan, furnitureId, x, y, zoneSiblingRooms(room, state.layout?.rooms ?? []), state.site)
    ),

  settleFurniture: (roomId, furnitureId) => {
    const state = get()
    const layout = state.layout
    const plan = state.plan
    if (!layout || !plan) return
    const room = layout.rooms.find((r) => r.id === roomId)
    const srcPlan = plan.rooms.find((r) => r.roomId === roomId)
    const item = srcPlan?.furniture.find((f) => f.id === furnitureId)
    if (!room || !srcPlan || !item) return

    // Owner follows the item's center: find the zone sibling that now contains it.
    const centerX = room.x + item.x + item.widthM / 2
    const centerY = room.y + item.y + item.depthM / 2
    const target = zoneSiblingRooms(room, layout.rooms).find(
      (s) =>
        centerX >= s.x && centerX <= s.x + s.width &&
        centerY >= s.y && centerY <= s.y + s.depth
    )
    // Tidak pindah ruang (kasus umum: drag di dalam ruang sendiri) → magnet
    // dinding: tepi ≤ 20 cm dari dinding dirapatkan flush (posisi saja,
    // sudut tidak diubah) — user tak perlu mengira-ngira presisi dinding.
    if (!target) {
      const near = nearestWallSide(item, room)
      if (near.distM > 0.005 && near.distM <= WALL_SNAP_THRESHOLD_M) {
        updateRoomPlan(set, get, roomId, (r, p, s) =>
          snapFurnitureToWallInRoom(
            r, p, furnitureId, near.side,
            zoneSiblingRooms(r, s.layout?.rooms ?? []), s.site,
            { align: false }
          )
        )
      }
      return
    }
    const dstPlan = plan.rooms.find((r) => r.roomId === target.id)
    if (!dstPlan) return

    const transferred = transferFurnitureBetweenRooms(room, srcPlan, target, dstPlan, furnitureId, layout.rooms)
    if (!transferred) return

    pushHistory(set, get)
    const rooms = plan.rooms.map((r) =>
      r.roomId === roomId ? transferred.src : r.roomId === target.id ? transferred.dst : r
    )
    const lines = rooms.flatMap((r) => r.budgetEstimate.lines)
    set({
      plan: {
        ...plan,
        rooms,
        totalEstimate: {
          lowIDR: roundMoney(lines.reduce((sum, line) => sum + line.lowIDR, 0)),
          midIDR: roundMoney(lines.reduce((sum, line) => sum + line.midIDR, 0)),
          highIDR: roundMoney(lines.reduce((sum, line) => sum + line.highIDR, 0)),
          lines,
        },
        warnings: rooms.flatMap((r) => r.warnings),
      },
      selectedRoomId: target.id,
      selectedFurnitureId: furnitureId,
      dirty: true,
      future: [],
    })
  },

  snapFurnitureToWall: (roomId, furnitureId, side) =>
    updateRoomPlan(
      set, get, roomId,
      (room, plan, state) =>
        snapFurnitureToWallInRoom(
          room, plan, furnitureId, side,
          zoneSiblingRooms(room, state.layout?.rooms ?? []), state.site
        ),
      () => ({ selectedFurnitureId: furnitureId })
    ),

  setFurnitureMountHeight: (roomId, furnitureId, heightM) =>
    updateRoomPlan(
      set, get, roomId,
      (_room, plan) => ({
        ...plan,
        furniture: plan.furniture.map((f) =>
          f.id === furnitureId
            ? { ...f, mountHeightM: heightM == null ? null : Math.max(0, Math.min(2.6, heightM)) }
            : f
        ),
      }),
      () => ({ selectedFurnitureId: furnitureId })
    ),

  setFurniturePrice: (roomId, furnitureId, priceIDR) =>
    updateRoomPlan(
      set, get, roomId,
      (room, plan) => setFurniturePriceInRoom(room, plan, furnitureId, priceIDR),
      () => ({ selectedFurnitureId: furnitureId })
    ),

  setFurnitureModel: (roomId, furnitureId, model) =>
    updateRoomPlan(
      set, get, roomId,
      (_room, plan) => ({
        ...plan,
        furniture: plan.furniture.map((f) =>
          f.id === furnitureId
            ? {
                ...f,
                modelAssetId: model.modelAssetId,
                modelUrl: model.modelUrl,
                ...(model.fitMode !== undefined ? { fitMode: model.fitMode } : {}),
                ...(model.materialMode !== undefined ? { materialMode: model.materialMode } : {}),
              }
            : f
        ),
      }),
      () => ({ selectedFurnitureId: furnitureId })
    ),

  rotateFurniture: (roomId, furnitureId) =>
    updateRoomPlan(
      set, get, roomId,
      (room, plan, state) =>
        rotatePlacedFurniture(room, plan, furnitureId, zoneSiblingRooms(room, state.layout?.rooms ?? []), state.site),
      () => ({ selectedFurnitureId: furnitureId }) // keep selection after rotate
    ),

  setFurnitureRotation: (roomId, furnitureId, deg) =>
    updateRoomPlan(
      set, get, roomId,
      (room, plan, state) =>
        setFurnitureRotationInRoom(room, plan, furnitureId, deg, zoneSiblingRooms(room, state.layout?.rooms ?? []), state.site),
      () => ({ selectedFurnitureId: furnitureId }) // keep selection after rotate
    ),

  removeFurniture: (roomId, furnitureId) =>
    updateRoomPlan(
      set,
      get,
      roomId,
      (room, plan) => removePlacedFurniture(room, plan, furnitureId),
      () => ({
        selectedFurnitureId:
          get().selectedFurnitureId === furnitureId ? null : get().selectedFurnitureId,
      })
    ),

  duplicateFurniture: (roomId, furnitureId) =>
    updateRoomPlan(
      set,
      get,
      roomId,
      (room, plan, state) =>
        duplicatePlacedFurniture(room, plan, furnitureId, zoneSiblingRooms(room, state.layout?.rooms ?? []), state.site) ?? plan,
      (nextRoom) => ({
        selectedRoomId: roomId,
        selectedFurnitureId: nextRoom.furniture.at(-1)?.id ?? get().selectedFurnitureId,
      })
    ),

  addFurniture: (roomId, item) => {
    const state = get()
    const room = state.layout?.rooms.find((r) => r.id === roomId)
    const required = requiredWaterPointFor(item.id)
    let waterAnchor: { x: number; y: number } | undefined
    if (required && room) {
      // The 2D editor's titik air layer is the shell: the 3D fixture may only
      // be installed where a matching point exists, and it lands on the point.
      const point = state.layout?.water?.find(
        (w) => w.roomId === roomId && w.type === required
      )
      if (!point) return { ok: false as const, missingWaterPoint: required }
      // WaterPoint coords are absolute metres → room-local, centered on the point.
      waterAnchor = {
        x: point.x - room.x - item.widthM / 2,
        y: point.y - room.y - item.depthM / 2,
      }
    }
    updateRoomPlan(
      set,
      get,
      roomId,
      (r, plan) => addFurnitureToRoom(r, plan, item, waterAnchor),
      (nextRoom) => ({
        selectedRoomId: roomId,
        selectedFurnitureId: nextRoom.furniture.at(-1)?.id ?? null,
      })
    )
    return { ok: true as const }
  },

  addAssetFurniture: (roomId, asset) =>
    updateRoomPlan(
      set, get, roomId,
      (room, plan) => addCustomAssetToRoom(room, plan, asset),
      (nextRoom) => ({
        selectedRoomId: roomId,
        selectedFurnitureId: nextRoom.furniture.at(-1)?.id ?? null,
      })
    ),

  updateMaterial: (roomId, surface, materialId) =>
    updateRoomPlan(
      set,
      get,
      roomId,
      (room, plan) => updateMaterialInRoom(room, plan, surface, materialId),
      () => ({ selectedRoomId: roomId })
    ),

  addLight: (roomId, type) =>
    updateRoomPlan(
      set, get, roomId,
      (room, plan) => addLightToRoom(room, plan, type),
      (nextRoom) => ({ selectedRoomId: roomId, selectedLightId: nextRoom.lighting.at(-1)?.id ?? null, selectedFurnitureId: null })
    ),

  moveLight: (roomId, lightId, x, y) =>
    updateRoomPlan(set, get, roomId, (room, plan) => moveLightInRoom(room, plan, lightId, x, y)),

  updateLight: (roomId, lightId, patch) =>
    updateRoomPlan(set, get, roomId, (room, plan) => updateLightInRoom(room, plan, lightId, patch),
      () => ({ selectedLightId: lightId })),

  removeLight: (roomId, lightId) =>
    updateRoomPlan(set, get, roomId, (room, plan) => removeLightFromRoom(room, plan, lightId),
      () => ({ selectedLightId: get().selectedLightId === lightId ? null : get().selectedLightId })),

  resetRoom: (roomId) =>
    updateRoomPlan(set, get, roomId, (room, _plan, state) =>
      generateRoomInterior(room, state.layout!, state.style)
    ),

  undo: () => {
    const { history, plan, selectedRoomId, selectedFurnitureId, selectedLightId } = get()
    if (!history.length || !plan) return

    const prev = history[history.length - 1]
    const newHistory = history.slice(0, -1)
    const newFuture = [
      { plan, selectedRoomId, selectedFurnitureId, selectedLightId },
      ...get().future,
    ].slice(0, MAX_HISTORY)

    set({
      plan: prev.plan,
      selectedRoomId: prev.selectedRoomId,
      selectedFurnitureId: prev.selectedFurnitureId,
      selectedLightId: prev.selectedLightId,
      history: newHistory,
      future: newFuture,
      dirty: true,
    })
  },

  redo: () => {
    const { future, plan, selectedRoomId, selectedFurnitureId, selectedLightId } = get()
    if (!future.length || !plan) return

    const next = future[0]
    const newFuture = future.slice(1)
    const newHistory = [
      ...get().history,
      { plan, selectedRoomId, selectedFurnitureId, selectedLightId },
    ].slice(-MAX_HISTORY)

    set({
      plan: next.plan,
      selectedRoomId: next.selectedRoomId,
      selectedFurnitureId: next.selectedFurnitureId,
      selectedLightId: next.selectedLightId,
      history: newHistory,
      future: newFuture,
      dirty: true,
    })
  },
}))

function pushHistory(
  set: (partial: Partial<InteriorState>) => void,
  get: () => InteriorState
) {
  const { plan, selectedRoomId, selectedFurnitureId, selectedLightId, history } = get()
  if (!plan) return
  const entry: HistoryEntry = { plan, selectedRoomId, selectedFurnitureId, selectedLightId }
  set({ history: [...history, entry].slice(-MAX_HISTORY) })
}

function updateRoomPlan(
  set: (partial: Partial<InteriorState>) => void,
  get: () => InteriorState,
  roomId: string,
  updater: (
    room: Room,
    plan: RoomInteriorPlan,
    state: InteriorState
  ) => RoomInteriorPlan,
  after?: (nextRoom: RoomInteriorPlan) => Partial<InteriorState>
) {
  const state = get()
  const room = state.layout?.rooms.find((item) => item.id === roomId)
  const current = state.plan?.rooms.find((item) => item.roomId === roomId)
  if (!state.plan || !room || !current) return

  // Push current state to history before mutation
  pushHistory(set, get)

  const nextRoom = updater(room, current, state)
  const rooms = state.plan.rooms.map((item) =>
    item.roomId === roomId ? nextRoom : item
  )
  const lines = rooms.flatMap((item) => item.budgetEstimate.lines)
  const totalEstimate = {
    lowIDR: roundMoney(lines.reduce((sum, line) => sum + line.lowIDR, 0)),
    midIDR: roundMoney(lines.reduce((sum, line) => sum + line.midIDR, 0)),
    highIDR: roundMoney(lines.reduce((sum, line) => sum + line.highIDR, 0)),
    lines,
  }
  set({
    plan: {
      ...state.plan,
      rooms,
      totalEstimate,
      warnings: rooms.flatMap((item) => item.warnings),
    },
    dirty: true,
    future: [], // new mutation clears redo stack
    ...after?.(nextRoom),
  })
}

function roundMoney(n: number): number {
  return Math.round(n / 1000) * 1000
}
