/**
 * UNDAKAN KONEKTOR SPLIT-LEVEL (E3, plan ARSITEKTUR_MODERN) — modul murni.
 *
 * Dua ruang bertetangga yang TERHUBUNG (ada pintu di batasnya, atau berbagi
 * zona open-plan) dengan beda elevasi > 20 cm butuh anak tangga kecil di
 * bentang koneksinya — dulu hanya diberi warning teks. Deteksi di sini,
 * emisi prim di build-model, tanpa UI baru sama sekali (aturan, bukan tombol).
 */

import type { Opening, Room } from "@/types"
import {
  COMFORT_MAX_M,
  openingSegment,
  parseOpeningWall,
  roomsAdjacentOnSide,
  round2,
  type Side,
} from "@/lib/geometry"
import { sharesZone } from "@/lib/editor/zones"

const OPEN_TYPES_LOCAL = ["kolam", "taman", "carport", "balkon", "rooftop_lounge", "void"]
const MAX_RISER_M = 0.19
const MIN_SPAN_M = 0.6

export type LevelConnector = {
  /** Ruang yang LEBIH RENDAH — undakan dipasang menjorok ke ruang ini. */
  lowRoomId: string
  highRoomId: string
  /** Sisi ruang RENDAH tempat batas berada. */
  side: Side
  horizontal: boolean
  /** Garis batas (koordinat site pada sumbu tegak lurus). */
  line: number
  /** Bentang undakan sepanjang batas (koordinat site pada sumbu sejajar). */
  span: { start: number; end: number }
  deltaM: number
  steps: number
  riserM: number
}

function connectorFor(
  low: Room,
  high: Room,
  side: Side,
  span: { start: number; end: number },
): LevelConnector | null {
  const delta = round2((high.levelOffsetM ?? 0) - (low.levelOffsetM ?? 0))
  if (delta <= COMFORT_MAX_M) return null
  if (span.end - span.start < MIN_SPAN_M) return null
  const steps = Math.min(5, Math.max(2, Math.ceil(delta / MAX_RISER_M)))
  const horizontal = side === "n" || side === "s"
  const line =
    side === "n" ? low.y : side === "s" ? low.y + low.depth : side === "w" ? low.x : low.x + low.width
  return {
    lowRoomId: low.id,
    highRoomId: high.id,
    side,
    horizontal,
    line: round2(line),
    span: { start: round2(span.start), end: round2(span.end) },
    deltaM: delta,
    steps,
    riserM: round2(delta / steps),
  }
}

/**
 * Semua undakan konektor pada SATU lantai. Dua jalur koneksi:
 * (a) pintu pada batas kedua ruang → bentang = segmen pintu;
 * (b) berbagi zona open-plan (dinding di-drop) → bentang = overlap bersama.
 */
export function levelConnectors(rooms: Room[], openings: Opening[]): LevelConnector[] {
  const out: LevelConnector[] = []
  const seen = new Set<string>()
  const solids = rooms.filter((r) => !OPEN_TYPES_LOCAL.includes(r.type))

  const push = (c: LevelConnector | null) => {
    if (!c) return
    const key = `${c.lowRoomId}|${c.highRoomId}|${c.side}|${c.span.start}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(c)
  }

  // (a) via PINTU: pintu di dinding host yang melayani ruang seberang.
  for (const op of openings) {
    if (op.type !== "door") continue
    const parsed = parseOpeningWall(op.wallId)
    if (!parsed) continue
    const host = solids.find((r) => r.id === parsed.roomId)
    if (!host) continue
    const seg = openingSegment(host, parsed.side, op.positionM, op.widthM)
    const horizontal = parsed.side === "n" || parsed.side === "s"
    const line = horizontal ? seg.y1 : seg.x1
    const other = solids.find((o) => {
      if (o.id === host.id || o.floorId !== host.floorId) return false
      const oCenter = horizontal ? o.y + o.depth / 2 : o.x + o.width / 2
      const hCenter = horizontal ? host.y + host.depth / 2 : host.x + host.width / 2
      if ((oCenter < line) === (hCenter < line)) return false
      const onB = horizontal
        ? Math.abs(o.y - line) <= 0.12 || Math.abs(o.y + o.depth - line) <= 0.12
        : Math.abs(o.x - line) <= 0.12 || Math.abs(o.x + o.width - line) <= 0.12
      const overlap = horizontal
        ? Math.min(seg.x2, o.x + o.width) - Math.max(seg.x1, o.x)
        : Math.min(seg.y2, o.y + o.depth) - Math.max(seg.y1, o.y)
      return onB && overlap > 0.1
    })
    if (!other) continue
    const [low, high] =
      (host.levelOffsetM ?? 0) <= (other.levelOffsetM ?? 0) ? [host, other] : [other, host]
    // Sisi ruang RENDAH yang menghadap batas.
    const lowCenter = horizontal ? low.y + low.depth / 2 : low.x + low.width / 2
    const side: Side = horizontal ? (lowCenter < line ? "s" : "n") : (lowCenter < line ? "e" : "w")
    const span = horizontal ? { start: seg.x1, end: seg.x2 } : { start: seg.y1, end: seg.y2 }
    push(connectorFor(low, high, side, span))
  }

  // (b) via ZONA bersama: dinding di-drop, bentang = overlap penuh.
  for (const a of solids) {
    for (const side of ["s", "e"] as const) {
      const nb = roomsAdjacentOnSide(a, side, solids.filter((o) => o.id !== a.id && o.floorId === a.floorId))
      if (!nb || !sharesZone(a, nb)) continue
      const horizontal = side === "s"
      const start = horizontal ? Math.max(a.x, nb.x) : Math.max(a.y, nb.y)
      const end = horizontal
        ? Math.min(a.x + a.width, nb.x + nb.width)
        : Math.min(a.y + a.depth, nb.y + nb.depth)
      const [low, high] = (a.levelOffsetM ?? 0) <= (nb.levelOffsetM ?? 0) ? [a, nb] : [nb, a]
      const lowSide: Side = horizontal
        ? low.id === a.id
          ? "s"
          : "n"
        : low.id === a.id
          ? "e"
          : "w"
      push(connectorFor(low, high, lowSide, { start, end }))
    }
  }

  return out
}
