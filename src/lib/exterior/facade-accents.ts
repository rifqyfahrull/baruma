/**
 * Generator aksen fasad 1-klik (split-facade F6, plan ARSITEKTUR_MODERN) —
 * parameterisasi pola "vertical-panel" facade-templates menjadi deret
 * `facade_panel` di garis SATU dinding: sirip vertikal (pitch teratur) atau
 * band horizontal (bertingkat via zM). Modul murni.
 *
 * Elemen ber-tag `Accent:{roomId}:{side}:{n}` — generator menimpa deret
 * ber-tag sama (idempoten, pola filter `Template:`); elemen hidup di
 * koordinat site sehingga TIDAK ikut saat ruang digeser — regenerate saja.
 */

import type { DesignLayout, Room } from "@/types"
import type { ExteriorBoxElement, MaterialRef } from "@/types/exterior"
import type { Side } from "@/lib/geometry"
import { makeBoxElement } from "@/lib/exterior/factories"

export type WallAccentOpts = {
  mode: "vertical_fins" | "horizontal_bands"
  /** Jarak antar sirip / antar band (m). */
  pitchM: number
  /** Tinggi sirip / rentang vertikal total band (m). */
  heightM: number
  /** Elevasi mulai dari lantai ruang (m). */
  sillM: number
  materialId: string
}

const FIN_W = 0.18
const FIN_D = 0.22
const BAND_H = 0.25
/** Offset muka aksen dari garis dinding (proud keluar). */
const OUT = 0.06 + FIN_D / 2

export const accentTag = (roomId: string, side: Side) => `Accent:${roomId}:${side}:`

export function isAccentOf(label: string | undefined, roomId: string, side: Side): boolean {
  return !!label?.startsWith(accentTag(roomId, side))
}

/** Deret elemen aksen utk satu dinding ruang; [] bila dinding terlalu pendek. */
export function buildWallAccent(
  room: Pick<Room, "id" | "floorId" | "x" | "y" | "width" | "depth">,
  side: Side,
  opts: WallAccentOpts,
): ExteriorBoxElement[] {
  const horizontal = side === "n" || side === "s"
  const len = horizontal ? room.width : room.depth
  if (len < Math.max(0.5, opts.pitchM)) return []
  const material: MaterialRef = { materialId: opts.materialId }
  // Garis dinding (site coords) + offset keluar.
  const lineX =
    side === "w" ? room.x - OUT : side === "e" ? room.x + room.width + OUT : 0
  const lineY =
    side === "n" ? room.y - OUT : side === "s" ? room.y + room.depth + OUT : 0
  const rotationDeg = horizontal ? 0 : 90
  const out: ExteriorBoxElement[] = []

  if (opts.mode === "vertical_fins") {
    const count = Math.max(2, Math.floor(len / opts.pitchM))
    for (let i = 0; i < count; i++) {
      const along = room.x + (horizontal ? 0 : 0) + (i + 0.5) * (len / count)
      const cx = horizontal ? room.x + (i + 0.5) * (len / count) : lineX
      const cy = horizontal ? lineY : room.y + (i + 0.5) * (len / count)
      void along
      out.push(
        makeBoxElement("facade_panel", cx, cy, {
          widthM: FIN_W,
          depthM: FIN_D,
          heightM: opts.heightM,
          zM: opts.sillM,
          rotationDeg,
          floorId: room.floorId,
          label: `${accentTag(room.id, side)}fin-${i + 1}`,
          material,
        }),
      )
    }
    return out
  }

  // horizontal_bands: bilah selebar dinding, bertumpuk tiap pitch.
  const count = Math.max(1, Math.floor(opts.heightM / opts.pitchM))
  const cx = horizontal ? room.x + room.width / 2 : lineX
  const cy = horizontal ? lineY : room.y + room.depth / 2
  for (let i = 0; i < count; i++) {
    out.push(
      makeBoxElement("facade_panel", cx, cy, {
        widthM: len,
        depthM: FIN_D,
        heightM: BAND_H,
        zM: opts.sillM + i * opts.pitchM,
        rotationDeg,
        floorId: room.floorId,
        label: `${accentTag(room.id, side)}band-${i + 1}`,
        material,
      }),
    )
  }
  return out
}

/** Ada aksen ber-tag dinding ini? (utk label tombol hapus di kartu) */
export function hasWallAccent(layout: DesignLayout, roomId: string, side: Side): boolean {
  return (layout.exteriorElements ?? []).some((el) => isAccentOf(el.label, roomId, side))
}
