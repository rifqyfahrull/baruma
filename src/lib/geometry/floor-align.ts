/**
 * Penyelarasan footprint lantai aktif ke lantai acuan (edge-alignment bbox).
 * Hanya ruang yang TEREKSPOS di sebuah sisi yang diubah; ruang interior
 * dibiarkan; ruang yang jadi degenerate (lebar/depth ≤ 0) dihapus.
 */
import type { Room } from "@/types"
import { isOutdoorRoom } from "./connectivity"
import { roomArea, round2, type Rect } from "./index"

// Toleransi adjacency: celah ≤ tebal tembok (WALL_T = 0.12) dianggap
// bertetangga sehingga tidak "ekspos" (konsisten dgn build-model.ts).
const TOL = 0.12

export type AlignSummary = { grown: string[]; shrunk: string[]; removed: string[] }

/** Bbox union ruang INDOOR (ruang terbuka dikecualikan). null bila tak ada. */
export function indoorFootprintBBox(rooms: Room[]): Rect | null {
  const indoor = rooms.filter((r) => !isOutdoorRoom(r))
  if (indoor.length === 0) return null
  const xs = indoor.map((r) => [r.x, r.x + r.width])
  const ys = indoor.map((r) => [r.y, r.y + r.depth])
  const minX = Math.min(...xs.map(([a]) => a))
  const maxX = Math.max(...xs.map(([, b]) => b))
  const minY = Math.min(...ys.map(([a]) => a))
  const maxY = Math.max(...ys.map(([, b]) => b))
  return { x: round2(minX), y: round2(minY), width: round2(maxX - minX), depth: round2(maxY - minY) }
}

function overlap1d(a0: number, a1: number, b0: number, b1: number): number {
  return Math.min(a1, b1) - Math.max(a0, b0)
}

function isExposed(room: Room, rooms: Room[], side: "n" | "e" | "s" | "w"): boolean {
  for (const o of rooms) {
    if (o.id === room.id) continue
    if (side === "e" || side === "w") {
      if (overlap1d(room.y, room.y + room.depth, o.y, o.y + o.depth) <= TOL) continue
      if (side === "e" && Math.abs(o.x - (room.x + room.width)) <= TOL) return false
      if (side === "w" && Math.abs(room.x - (o.x + o.width)) <= TOL) return false
    } else {
      if (overlap1d(room.x, room.x + room.width, o.x, o.x + o.width) <= TOL) continue
      if (side === "s" && Math.abs(o.y - (room.y + room.depth)) <= TOL) return false
      if (side === "n" && Math.abs(room.y - (o.y + o.depth)) <= TOL) return false
    }
  }
  return true
}

/**
 * Samakan batas luar ruang aktif ke `target` (bbox lantai acuan).
 * Eksposisi dihitung terhadap himpunan ruang ORIGINAL (deterministik).
 */
export function alignFloorRoomsToFootprint(
  rooms: Room[],
  target: Rect
): { rooms: Room[]; summary: AlignSummary } {
  const none: AlignSummary = { grown: [], shrunk: [], removed: [] }
  if (rooms.length === 0 || target.width <= 0 || target.depth <= 0) return { rooms, summary: none }

  const targetN = target.y
  const targetS = target.y + target.depth
  const targetW = target.x
  const targetE = target.x + target.width

  const grown = new Set<string>()
  const shrunk = new Set<string>()

  const out = rooms.map((r) => {
    let { x, y, width, depth } = r
    const exp = {
      n: isExposed(r, rooms, "n"),
      e: isExposed(r, rooms, "e"),
      s: isExposed(r, rooms, "s"),
      w: isExposed(r, rooms, "w"),
    }
    // Grow hanya bila tepi ruang ADA DI DALAM rentang target pada sumbu itu —
    // ruang yang seluruhnya di luar target (mis. "hang" jauh di selatan) tidak
    // di-regrow menutupi bangunan, tapi di-shrink sampai degenerate → dihapus.
    if (exp.e) {
      const edge = x + width
      if (edge < targetE - TOL && edge > targetW + TOL) { width = targetE - x; grown.add(r.id) }
      else if (edge > targetE + TOL) { width = targetE - x; shrunk.add(r.id) }
    }
    if (exp.w) {
      const edge = x
      if (edge > targetW + TOL && edge < targetE - TOL) { width += x - targetW; x = targetW; grown.add(r.id) }
      else if (edge < targetW - TOL) { width -= targetW - x; x = targetW; shrunk.add(r.id) }
    }
    if (exp.s) {
      const edge = y + depth
      if (edge < targetS - TOL && edge > targetN + TOL) { depth = targetS - y; grown.add(r.id) }
      else if (edge > targetS + TOL) { depth = targetS - y; shrunk.add(r.id) }
    }
    if (exp.n) {
      const edge = y
      if (edge > targetN + TOL && edge < targetS - TOL) { depth += y - targetN; y = targetN; grown.add(r.id) }
      else if (edge < targetN - TOL) { depth -= targetN - y; y = targetN; shrunk.add(r.id) }
    }
    const w = round2(Math.max(0, width))
    const d = round2(Math.max(0, depth))
    return { ...r, x: round2(x), y: round2(y), width: w, depth: d, areaM2: roomArea(w, d) }
  })

  const kept = out.filter((rr) => rr.width > 0 && rr.depth > 0)
  const removed = out.filter((rr) => rr.width <= 0 || rr.depth <= 0).map((rr) => rr.id)
  return {
    rooms: kept,
    summary: { grown: [...grown], shrunk: [...shrunk], removed },
  }
}
