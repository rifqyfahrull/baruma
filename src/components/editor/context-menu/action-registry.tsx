"use client"

/**
 * Registry AKSI klik-kanan — sumber tunggal aksi kontekstual per EntityKind,
 * dipakai identik oleh menu 2D (dan nanti 3D). Filosofi sama seperti inspector
 * registry: host hanya merender; DAFTAR aksi + predikat `enabled` tinggal di
 * sini. Aksi memanggil method editor-store yang sudah ada — tidak ada logika
 * mutasi baru di sini.
 */

import type { LucideIcon } from "lucide-react"
import {
  Copy,
  DoorOpen,
  Eye,
  EyeOff,
  Lightbulb,
  Lock,
  LockOpen,
  Magnet,
  PanelTop,
  Plus,
  RotateCw,
  Rows3,
  SunMedium,
  Trash2,
} from "lucide-react"

import type { DesignLayout, RoomType } from "@/types"
import type { EntityRef } from "@/types/entity-ref"
import type { Rect, Side } from "@/lib/geometry"
import { emptyRectAt } from "@/lib/geometry/empty-rect"
import { ROOF_LAYER_ID, useEditorStore } from "@/stores/editor-store"
import { useInteriorStore } from "@/stores/interior-store"

type Store = ReturnType<typeof useEditorStore.getState>

/** Konteks yang diberikan host saat membuka menu. */
export type MenuCtx = {
  /** Entity yang diklik-kanan; null = area kosong. */
  ref: EntityRef | null
  /** Titik klik dalam koordinat ruang (meter) — untuk aksi "tambah di sini". */
  point: { x: number; y: number } | null
  layout: DesignLayout | null
  store: Store
  /** Buka dialog "Tambah ruang" ter-prefill rect celah. */
  openAddRoom: (rect: Rect) => void
}

export type MenuAction = {
  id: string
  label: string
  icon?: LucideIcon
  danger?: boolean
  run: () => void
}

/** Ruang yang layak "terbuka ke langit" (courtyard/void/taman/kolam/balkon). */
const OPEN_SKY_TYPES: RoomType[] = ["taman", "kolam", "void", "balkon"]

function roomActions(ctx: MenuCtx, id: string): MenuAction[] {
  const room = ctx.layout?.rooms.find((r) => r.id === id)
  if (!room) return []
  const s = ctx.store
  const out: MenuAction[] = [
    { id: "duplicate", label: "Duplikat ruang", icon: Copy, run: () => s.duplicateRoom(id) },
  ]
  if (OPEN_SKY_TYPES.includes(room.type)) {
    out.push({
      id: "opensky",
      label: room.openToSky ? "Tutup dari langit" : "Terbuka ke langit",
      icon: SunMedium,
      run: () =>
        s.updateRoom(id, {
          openToSky: !room.openToSky || undefined,
          ...(room.openToSky ? { openToSkyRect: undefined } : {}),
        }),
    })
  }
  out.push({
    id: "lock",
    label: room.locked ? "Buka kunci" : "Kunci ruang",
    icon: room.locked ? LockOpen : Lock,
    run: () => s.toggleLock(id),
  })
  out.push({
    id: "delete",
    label: "Hapus ruang",
    icon: Trash2,
    danger: true,
    run: () => s.deleteRef({ kind: "room", id }),
  })
  return out
}

function wallActions(ctx: MenuCtx, roomId: string, side: Side): MenuAction[] {
  const s = ctx.store
  const wallId = `${roomId}:${side}`
  return [
    {
      id: "accent-fins",
      label: "Aksen sirip vertikal",
      icon: Rows3,
      run: () =>
        s.generateWallAccent(roomId, side, {
          mode: "vertical_fins",
          pitchM: 0.45,
          heightM: 2.2,
          sillM: 0.3,
          materialId: "beton_ekspos",
        }),
    },
    {
      id: "accent-bands",
      label: "Aksen band horizontal",
      icon: Rows3,
      run: () =>
        s.generateWallAccent(roomId, side, {
          mode: "horizontal_bands",
          pitchM: 0.45,
          heightM: 2.2,
          sillM: 0.3,
          materialId: "beton_ekspos",
        }),
    },
    { id: "wall-lamp", label: "Tambah lampu dinding", icon: Lightbulb, run: () => s.addWallLamp(wallId) },
  ]
}

function openingActions(ctx: MenuCtx, id: string): MenuAction[] {
  const op = ctx.layout?.openings.find((o) => o.id === id)
  if (!op) return []
  const s = ctx.store
  const toType = op.type === "door" ? "window" : "door"
  return [
    {
      id: "toggle-type",
      label: op.type === "door" ? "Jadikan jendela" : "Jadikan pintu",
      icon: DoorOpen,
      run: () => s.updateOpening(id, { type: toType }),
    },
    { id: "delete", label: "Hapus bukaan", icon: Trash2, danger: true, run: () => s.deleteRef({ kind: "opening", id }) },
  ]
}

function exteriorActions(ctx: MenuCtx, id: string): MenuAction[] {
  const el = ctx.layout?.exteriorElements?.find((e) => e.id === id)
  const s = ctx.store
  const hidden = !!el?.hidden
  const locked = !!el?.locked
  return [
    { id: "duplicate", label: "Duplikat", icon: Copy, run: () => s.duplicateExteriorElement(id) },
    {
      id: "hide",
      label: hidden ? "Tampilkan" : "Sembunyikan",
      icon: hidden ? Eye : EyeOff,
      run: () => s.setExteriorElementHidden(id, !hidden),
    },
    {
      id: "lock",
      label: locked ? "Buka kunci" : "Kunci",
      icon: locked ? LockOpen : Lock,
      run: () => s.setExteriorElementLocked(id, !locked),
    },
    { id: "delete", label: "Hapus", icon: Trash2, danger: true, run: () => s.removeExteriorElement(id) },
  ]
}

function roofZoneActions(ctx: MenuCtx, id: string): MenuAction[] {
  const s = ctx.store
  return [
    { id: "hide", label: "Sembunyikan zona", icon: EyeOff, run: () => s.setRoofZoneHidden(id, true) },
    { id: "delete", label: "Hapus zona atap", icon: Trash2, danger: true, run: () => s.removeRoofZone(id) },
  ]
}

const ROOF_TYPE_LABELS: Record<string, string> = {
  datar: "Atap datar",
  pelana: "Atap pelana",
  limasan: "Atap limasan",
  miring: "Atap miring (skillion)",
}

function roofActions(ctx: MenuCtx): MenuAction[] {
  const s = ctx.store
  const cur = ctx.layout?.roof?.type
  return (["datar", "pelana", "limasan", "miring"] as const)
    .filter((t) => t !== cur)
    .map((t) => ({
      id: `roof-${t}`,
      label: ROOF_TYPE_LABELS[t],
      icon: PanelTop,
      run: () => s.setRoof({ type: t }),
    }))
}

function emptyActions(ctx: MenuCtx): MenuAction[] {
  const s = ctx.store
  const site = s.site
  const floorId = s.selectedFloorId
  if (!ctx.point || !site || !floorId || floorId === ROOF_LAYER_ID) return []
  const rooms = (ctx.layout?.rooms ?? []).filter((r) => r.floorId === floorId)
  const rect = emptyRectAt(ctx.point, rooms, site)
  if (!rect) return []
  return [
    {
      id: "add-room-here",
      label: `Tambah ruang di sini (${rect.width.toFixed(1)}×${rect.depth.toFixed(1)} m)`,
      icon: Plus,
      run: () => ctx.openAddRoom(rect),
    },
  ]
}

/** Furnitur & lampu hidup di interior-store (bukan editor layout) — aksi
 *  memanggil interior-store langsung; seleksi dijembatani ke editor-store. */
function furnitureActions(roomId: string, id: string): MenuAction[] {
  return [
    { id: "rotate", label: "Putar 90°", icon: RotateCw, run: () => useInteriorStore.getState().rotateFurniture(roomId, id) },
    { id: "snap-wall", label: "Tempel ke dinding", icon: Magnet, run: () => useInteriorStore.getState().snapFurnitureToWall(roomId, id) },
    { id: "delete", label: "Hapus furnitur", icon: Trash2, danger: true, run: () => useInteriorStore.getState().removeFurniture(roomId, id) },
  ]
}

function lightActions(roomId: string, id: string): MenuAction[] {
  return [
    { id: "delete", label: "Hapus lampu", icon: Trash2, danger: true, run: () => useInteriorStore.getState().removeLight(roomId, id) },
  ]
}

/** Aksi mana pun yang hanya butuh id + deleteRef (fallback ringkas). */
function simpleDelete(ctx: MenuCtx, ref: EntityRef, label: string): MenuAction[] {
  return [
    { id: "delete", label, icon: Trash2, danger: true, run: () => ctx.store.deleteRef(ref) },
  ]
}

/** Daftar aksi untuk konteks klik-kanan saat ini. */
export function actionsForContext(ctx: MenuCtx): MenuAction[] {
  const ref = ctx.ref
  if (!ref) return emptyActions(ctx)
  switch (ref.kind) {
    case "room":
      return roomActions(ctx, ref.id)
    case "wall":
      return wallActions(ctx, ref.roomId, ref.side)
    case "opening":
      return openingActions(ctx, ref.id)
    case "exterior":
      return exteriorActions(ctx, ref.id)
    case "roofZone":
      return roofZoneActions(ctx, ref.id)
    case "roof":
      return roofActions(ctx)
    case "skylight":
      return [
        { id: "delete", label: "Hapus skylight", icon: PanelTop, danger: true, run: () => ctx.store.removeSkylight(ref.id) },
      ]
    case "lamp":
      return [
        { id: "delete", label: "Hapus lampu", icon: Trash2, danger: true, run: () => ctx.store.removeLamp(ref.id) },
      ]
    case "furniture":
      return furnitureActions(ref.roomId, ref.id)
    case "light":
      return lightActions(ref.roomId, ref.id)
    case "electrical":
    case "water":
      return simpleDelete(ctx, ref, "Hapus titik")
    default:
      return []
  }
}
