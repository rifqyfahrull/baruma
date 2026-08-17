/**
 * 2D editor geometry helpers (PRD §16). Internal unit is meters; the canvas
 * maps meters to pixels via a base scale times the zoom level.
 */
import type { Opening, Room } from "@/types"

export const PX_PER_METER = 80

export type Side = "n" | "e" | "s" | "w"

/** Snap a meter value to the grid (e.g. 0.25 m / 0.5 m). */
export function snap(value: number, grid: number): number {
  if (grid <= 0) return value
  return Math.round(value / grid) * grid
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function roomArea(width: number, depth: number): number {
  return round2(width * depth)
}

export type Rect = { x: number; y: number; width: number; depth: number }

export function rectsOverlap(a: Rect, b: Rect, tolerance = 0.01): boolean {
  return (
    a.x < b.x + b.width - tolerance &&
    a.x + a.width > b.x + tolerance &&
    a.y < b.y + b.depth - tolerance &&
    a.y + a.depth > b.y + tolerance
  )
}

export function pointInRect(px: number, py: number, r: Rect): boolean {
  return px >= r.x && px <= r.x + r.width && py >= r.y && py <= r.y + r.depth
}

export function rectCenter(r: Rect): { x: number; y: number } {
  return { x: r.x + r.width / 2, y: r.y + r.depth / 2 }
}

export interface FindFreeRectOptions {
  tolerance?: number
  /** Only accept a spot with at least one edge on the site boundary — a
   *  simple, honest proxy for "an exterior wall could go here" (this app
   *  doesn't model window/wall visibility beyond the site rectangle, so a
   *  room that needs daylight/ventilation should border it directly). */
  requireExterior?: boolean
  /** Positions to try FIRST, ahead of the general search — e.g. to prefer
   *  keeping a bathroom stacked above the one on the floor below so their
   *  plumbing shares a riser. Still subject to the same overlap/bounds/
   *  `requireExterior` checks as any other candidate. */
  preferredPositions?: { x: number; y: number }[]
}

/**
 * Find a `size`-shaped rect that fits inside `site` (0..widthM, 0..depthM)
 * without overlapping any `obstacles` (e.g. the other rooms already on a
 * floor). Used whenever code — not a human dragging on the canvas — needs to
 * place or relocate a room, so it never lands on top of something else.
 *
 * `preferredPositions` (if any) are tried first, in order. Failing those (or
 * with none given), candidates are the classic bin-packing "guillotine
 * corner" set: (0,0), each obstacle's bottom-right corner, and each
 * obstacle's top-left corner offset back by `size` (so the new rect's right/
 * bottom edge can sit flush against it) — plus the site's own bottom-right
 * offset back by `size`. That covers every position where the new rect could
 * plausibly slot into the remaining free space. Candidates are scanned
 * top-to-bottom then left-to-right (how a plan naturally reads) and the
 * first collision-free, in-bounds (and, if `requireExterior`, site-boundary-
 * touching) one wins — so results are compact and stable, not scattered.
 *
 * Returns null if `size` doesn't fit anywhere under these constraints —
 * callers should treat that as "needs real reasoning about what to resize/
 * move (or whether an exterior wall is achievable at all)", not force a
 * placement or silently drop the `requireExterior` requirement.
 */
export function findFreeRect(
  size: { width: number; depth: number },
  obstacles: Rect[],
  site: { widthM: number; depthM: number },
  options: FindFreeRectOptions = {}
): { x: number; y: number } | null {
  const { tolerance = 0.01, requireExterior = false, preferredPositions = [] } = options
  if (size.width > site.widthM + tolerance || size.depth > site.depthM + tolerance) return null

  const fits = (x: number, y: number): boolean => {
    if (x < -tolerance || y < -tolerance) return false
    if (x + size.width > site.widthM + tolerance) return false
    if (y + size.depth > site.depthM + tolerance) return false
    if (
      requireExterior &&
      x > tolerance &&
      y > tolerance &&
      x + size.width < site.widthM - tolerance &&
      y + size.depth < site.depthM - tolerance
    ) {
      return false // boxed in on all four sides — no plausible exterior wall
    }
    const rect: Rect = { x, y, width: size.width, depth: size.depth }
    return !obstacles.some((o) => rectsOverlap(rect, o, tolerance))
  }

  for (const p of preferredPositions) {
    const x = round2(p.x)
    const y = round2(p.y)
    if (fits(x, y)) return { x: round2(Math.max(0, x)), y: round2(Math.max(0, y)) }
  }

  const xs = new Set<number>([0, round2(site.widthM - size.width)])
  const ys = new Set<number>([0, round2(site.depthM - size.depth)])
  for (const o of obstacles) {
    xs.add(round2(o.x + o.width))
    ys.add(round2(o.y + o.depth))
    xs.add(round2(Math.max(0, o.x - size.width)))
    ys.add(round2(Math.max(0, o.y - size.depth)))
  }

  const candidates = [...xs]
    .flatMap((x) => [...ys].map((y) => ({ x, y })))
    .filter((c) => c.x >= -tolerance && c.y >= -tolerance)
    .sort((a, b) => a.y - b.y || a.x - b.x)

  for (const { x, y } of candidates) {
    if (fits(x, y)) return { x: round2(Math.max(0, x)), y: round2(Math.max(0, y)) }
  }
  return null
}

export function edgeLength(room: Pick<Room, "width" | "depth">, side: Side): number {
  return side === "n" || side === "s" ? room.width : room.depth
}

/**
 * Encode/decode an opening's host edge in its `wallId` (`${roomId}:${side}`),
 * so openings move/resize with their room without separate wall bookkeeping.
 */
export function openingWallId(roomId: string, side: Side): string {
  return `${roomId}:${side}`
}

export function parseOpeningWall(
  wallId: string
): { roomId: string; side: Side } | null {
  const idx = wallId.lastIndexOf(":")
  if (idx < 0) return null
  const roomId = wallId.slice(0, idx)
  const side = wallId.slice(idx + 1) as Side
  if (!["n", "e", "s", "w"].includes(side)) return null
  return { roomId, side }
}

/**
 * Whether an opening physically serves `room` — registered on the room's OWN
 * wallId, or on a NEIGHBOUR's wall whose line coincides with this room's
 * boundary (dinding bersama). A door/window on a shared wall belongs to one
 * wallId but ventilates/opens BOTH sides, so validators must not rely on
 * wallId ownership alone (prod report: pintu kamar mandi digambar di dinding
 * void tetangga → warning "belum punya jendela/pintu" yang menyesatkan).
 * `tol` defaults to the wall thickness used by the 3D builder (0.12 m), which
 * also covers hand-drawn layouts whose rooms sit a few cm apart.
 */
export function openingServesRoom(
  opening: Pick<Opening, "wallId" | "positionM" | "widthM" | "floorId">,
  room: Room,
  allRooms: Room[],
  tol = 0.12
): boolean {
  const parsed = parseOpeningWall(opening.wallId)
  if (!parsed) return false
  if (parsed.roomId === room.id) return true
  if (opening.floorId !== room.floorId) return false
  const host = allRooms.find((r) => r.id === parsed.roomId)
  if (!host || host.floorId !== room.floorId) return false
  const seg = openingSegment(host, parsed.side, opening.positionM, opening.widthM)
  const MIN_SHARED = 0.1
  if (parsed.side === "n" || parsed.side === "s") {
    const onBoundary =
      Math.abs(seg.y1 - room.y) <= tol || Math.abs(seg.y1 - (room.y + room.depth)) <= tol
    const overlap = Math.min(seg.x2, room.x + room.width) - Math.max(seg.x1, room.x)
    return onBoundary && overlap > MIN_SHARED
  }
  const onBoundary =
    Math.abs(seg.x1 - room.x) <= tol || Math.abs(seg.x1 - (room.x + room.width)) <= tol
  const overlap = Math.min(seg.y2, room.y + room.depth) - Math.max(seg.y1, room.y)
  return onBoundary && overlap > MIN_SHARED
}

/** World-space segment (in meters) an opening spans on its host room edge.
 *  Accepts anything shaped like a room rect — dinding tepi sintetis w-edge
 *  (build-model.ts) memakai host semu tanpa properti Room lengkap. */
export function openingSegment(
  room: Pick<Room, "x" | "y" | "width" | "depth">,
  side: Side,
  positionM: number,
  widthM: number
): { x1: number; y1: number; x2: number; y2: number } {
  const len = edgeLength(room, side)
  const half = widthM / 2
  const center = clamp(positionM, half, Math.max(half, len - half))
  switch (side) {
    case "n":
      return { x1: room.x + center - half, y1: room.y, x2: room.x + center + half, y2: room.y }
    case "s":
      return {
        x1: room.x + center - half,
        y1: room.y + room.depth,
        x2: room.x + center + half,
        y2: room.y + room.depth,
      }
    case "w":
      return { x1: room.x, y1: room.y + center - half, x2: room.x, y2: room.y + center + half }
    case "e":
    default:
      return {
        x1: room.x + room.width,
        y1: room.y + center - half,
        x2: room.x + room.width,
        y2: room.y + center + half,
      }
  }
}

/** Jarak minimal (m) antar bukaan bertetangga di dinding yang sama (kusen). */
export const OPENING_MIN_GAP_M = 0.05

/**
 * Cari posisi (positionM) TERDEKAT dgn `desiredPositionM` untuk bukaan baru
 * selebar `widthM` di dinding sepanjang `wallLenM`, yang TIDAK bertumpuk
 * dengan bukaan `existing` (+ jarak kusen minimal di tiap sisi).
 *
 * Dipakai saat user klik "Tambah jendela/pintu": tanpa ini, klik kedua di
 * dinding yang sudah terisi diam-diam menumpuk bukaan baru di atas yang lama
 * (positionM klik ke-2 di-clamp ke rentang dinding, TAPI tak pernah dicek
 * terhadap bukaan existing) — build-model memotong span dinding yang sama
 * persis sehingga user tak melihat perubahan sama sekali, tanpa error.
 *
 * Return null bila TAK ADA celah yang muat sama sekali di sepanjang dinding
 * (caller wajib menampilkan pesan, bukan diam-diam gagal).
 */
export function findOpeningGapPositionM(
  wallLenM: number,
  widthM: number,
  existing: readonly { positionM: number; widthM: number }[],
  desiredPositionM: number
): number | null {
  const half = widthM / 2
  const occupied = existing
    .map((o) => ({
      start: o.positionM - o.widthM / 2 - OPENING_MIN_GAP_M,
      end: o.positionM + o.widthM / 2 + OPENING_MIN_GAP_M,
    }))
    .sort((a, b) => a.start - b.start)

  const free: { start: number; end: number }[] = []
  let cursor = 0
  for (const seg of occupied) {
    const start = Math.max(0, seg.start)
    const end = Math.min(wallLenM, seg.end)
    if (start > cursor) free.push({ start: cursor, end: start })
    cursor = Math.max(cursor, end)
  }
  if (cursor < wallLenM) free.push({ start: cursor, end: wallLenM })

  let best: number | null = null
  let bestDist = Infinity
  for (const gap of free) {
    if (gap.end - gap.start < widthM - 1e-6) continue // celah lebih sempit dari bukaan
    const lo = gap.start + half
    const hi = Math.max(lo, gap.end - half)
    const pos = Math.min(Math.max(desiredPositionM, lo), hi)
    const dist = Math.abs(pos - desiredPositionM)
    if (dist < bestDist) {
      bestDist = dist
      best = pos
    }
  }
  return best === null ? null : round2(best)
}

/**
 * Setelah resize (width/depth ruang berubah), dinding-dindingnya bisa jadi
 * LEBIH PENDEK dari sebelumnya — bukaan yang tadinya sah (positionM di
 * tengah dinding lama) bisa jatuh di luar rentang dinding baru: "yatim",
 * menempel di luar massa, baru ketahuan belakangan di render 3D (BUG D).
 *
 * Pilihan paling aman: clamp posisi bukaan itu ke dalam dinding baru bila
 * bukaan itu SENDIRI masih muat (lebar bukaan ≤ panjang dinding baru); buang
 * total hanya bila sudah tak mungkin muat di manapun. Bukaan di ruang LAIN
 * (atau tanpa `wallId` yang valid) dikembalikan apa adanya — resize satu
 * ruang tak pernah menyentuh bukaan ruang lain. Ruang tipe berubah TIDAK
 * memicu penghapusan di sini — itu keputusan user, bukan konsekuensi
 * geometri (hanya width/depth yang relevan).
 */
export function clampOrDropOpeningsForRoom<
  T extends { wallId: string; positionM: number; widthM: number },
>(openings: readonly T[], room: Room): T[] {
  return openings.flatMap((op): T[] => {
    if (!op.wallId.startsWith(`${room.id}:`)) return [op]
    const parsed = parseOpeningWall(op.wallId)
    if (!parsed) return [op]
    const wallLen = edgeLength(room, parsed.side)
    if (op.widthM > wallLen + 1e-6) return [] // tak mungkin muat lagi — buang
    const half = op.widthM / 2
    const clamped = round2(clamp(op.positionM, half, Math.max(half, wallLen - half)))
    return clamped === op.positionM ? [op] : [{ ...op, positionM: clamped }]
  })
}

/** Nearest room edge to a point, with the projected position along it. */
export function nearestEdge(
  room: Room,
  px: number,
  py: number
): { side: Side; positionM: number; distance: number } {
  const candidates: { side: Side; positionM: number; distance: number }[] = [
    { side: "n", positionM: px - room.x, distance: Math.abs(py - room.y) },
    { side: "s", positionM: px - room.x, distance: Math.abs(py - (room.y + room.depth)) },
    { side: "w", positionM: py - room.y, distance: Math.abs(px - room.x) },
    { side: "e", positionM: py - room.y, distance: Math.abs(px - (room.x + room.width)) },
  ]
  candidates.sort((a, b) => a.distance - b.distance)
  const best = candidates[0]
  return {
    side: best.side,
    positionM: clamp(best.positionM, 0, edgeLength(room, best.side)),
    distance: best.distance,
  }
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max)
}

/**
 * Squarified treemap (Bruls et al.) — tiles a rectangle with sub-rectangles
 * whose areas are proportional to `weights`, aiming for square-ish aspect
 * ratios. Used to pack rooms so they fill the floor footprint with no gaps.
 */
export function squarifiedTreemap(
  weights: number[],
  x: number,
  y: number,
  w: number,
  h: number
): Rect[] {
  const n = weights.length
  const out: Rect[] = new Array(n)
  if (n === 0) return out

  const total = weights.reduce((a, b) => a + b, 0) || 1
  const scale = (w * h) / total
  const items = weights.map((wt, i) => ({ a: Math.max(wt * scale, 1e-6), i }))

  let X = x
  let Y = y
  let W = w
  let H = h

  const worst = (row: { a: number }[], side: number) => {
    if (row.length === 0) return Infinity
    const sum = row.reduce((t, r) => t + r.a, 0)
    const mx = Math.max(...row.map((r) => r.a))
    const mn = Math.min(...row.map((r) => r.a))
    const s2 = sum * sum
    const side2 = side * side
    return Math.max((side2 * mx) / s2, s2 / (side2 * mn))
  }

  const commit = (row: { a: number; i: number }[]) => {
    const sum = row.reduce((t, r) => t + r.a, 0)
    if (W >= H) {
      const colW = sum / H
      let cy = Y
      for (const r of row) {
        const ih = r.a / colW
        out[r.i] = { x: X, y: cy, width: colW, depth: ih }
        cy += ih
      }
      X += colW
      W -= colW
    } else {
      const rowH = sum / W
      let cx = X
      for (const r of row) {
        const iw = r.a / rowH
        out[r.i] = { x: cx, y: Y, width: iw, depth: rowH }
        cx += iw
      }
      Y += rowH
      H -= rowH
    }
  }

  let row: { a: number; i: number }[] = []
  let i = 0
  while (i < items.length) {
    const side = Math.min(W, H)
    const next = items[i]
    if (row.length === 0 || worst(row, side) >= worst([...row, next], side)) {
      row.push(next)
      i++
    } else {
      commit(row)
      row = []
    }
  }
  if (row.length) commit(row)
  return out
}

/** Resize handles for a selected room (in meters). */
export const RESIZE_HANDLES = ["nw", "ne", "se", "sw", "n", "e", "s", "w"] as const
export type HandleId = (typeof RESIZE_HANDLES)[number]

export function handlePoint(r: Rect, h: HandleId): { x: number; y: number } {
  const midX = r.x + r.width / 2
  const midY = r.y + r.depth / 2
  const right = r.x + r.width
  const bottom = r.y + r.depth
  switch (h) {
    case "nw": return { x: r.x, y: r.y }
    case "n": return { x: midX, y: r.y }
    case "ne": return { x: right, y: r.y }
    case "e": return { x: right, y: midY }
    case "se": return { x: right, y: bottom }
    case "s": return { x: midX, y: bottom }
    case "sw": return { x: r.x, y: bottom }
    case "w": default: return { x: r.x, y: midY }
  }
}

/** Apply a resize handle drag to a rect, keeping a minimum size. */
export function applyResize(
  r: Rect,
  h: HandleId,
  mx: number,
  my: number,
  minSize: number
): Rect {
  let { x, y, width, depth } = r
  const right = x + width
  const bottom = y + depth

  if (h.includes("w")) {
    const nx = Math.min(mx, right - minSize)
    width = right - nx
    x = nx
  }
  if (h.includes("e")) {
    width = Math.max(minSize, mx - x)
  }
  if (h.includes("n")) {
    const ny = Math.min(my, bottom - minSize)
    depth = bottom - ny
    y = ny
  }
  if (h.includes("s")) {
    depth = Math.max(minSize, my - y)
  }
  return { x, y, width, depth }
}

/* ── Split-level + open-plan adjacency ── */

export const RISER_M = 0.18 // typical comfortable stair riser
export const COMFORT_MAX_M = 0.2 // a single step taller than this should be stairs

/** Snap a free elevation offset to a whole number of comfortable risers. */
export function snapLevelOffset(m: number): number {
  if (!Number.isFinite(m)) return 0
  return round2(Math.round(m / RISER_M) * RISER_M)
}

/** Soft warning when a level change exceeds one comfortable step (needs stairs). */
/** Batas keras offset split-level (±5 riser) — di luar ini = lantai terpisah. */
export const LEVEL_OFFSET_MAX_M = 0.9

export function levelStepWarning(m: number): string | null {
  if (Math.abs(m) > LEVEL_OFFSET_MAX_M)
    return "Beda tinggi > 0,9 m — gunakan lantai terpisah, bukan split-level."
  return Math.abs(m) > COMFORT_MAX_M ? "Beda tinggi > 20 cm — sebaiknya pakai tangga." : null
}

type EdgeRect = { x: number; y: number; width: number; depth: number }

/** The room in `others` that shares `room`'s given edge (collinear within `tol`
 *  and with an overlapping span), or null. */
export function roomsAdjacentOnSide<T extends EdgeRect>(
  room: EdgeRect,
  side: Side,
  others: T[],
  tol = 0.05
): T | null {
  const overlap = (a0: number, a1: number, b0: number, b1: number) =>
    a0 < b1 - tol && a1 > b0 + tol
  for (const o of others) {
    if (side === "n" && Math.abs(o.y + o.depth - room.y) <= tol &&
        overlap(room.x, room.x + room.width, o.x, o.x + o.width)) return o
    if (side === "s" && Math.abs(o.y - (room.y + room.depth)) <= tol &&
        overlap(room.x, room.x + room.width, o.x, o.x + o.width)) return o
    if (side === "w" && Math.abs(o.x + o.width - room.x) <= tol &&
        overlap(room.y, room.y + room.depth, o.y, o.y + o.depth)) return o
    if (side === "e" && Math.abs(o.x - (room.x + room.width)) <= tol &&
        overlap(room.y, room.y + room.depth, o.y, o.y + o.depth)) return o
  }
  return null
}
