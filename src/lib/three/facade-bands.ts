/**
 * Band cladding VERTIKAL per dinding (split-facade, Fase A plan
 * ARSITEKTUR_MODERN) — modul murni.
 *
 * Format key `layout.facade`:
 *   - `roomId:side`                → cladding seluruh tinggi dinding (legacy,
 *                                    kompat penuh — band null);
 *   - `roomId:side@{sill}-{head}`  → band vertikal [sill..head] meter dari
 *                                    lantai ruang (2dp), mis. `r1:s@0.90-2.10`.
 * Room id memakai alfabet nanoid (tanpa `:`/`@`) → parser tidak ambigu.
 * Skema layout `.passthrough()` → key band persist tanpa migrasi.
 */

import type { Side } from "@/lib/geometry"

export type FacadeBand = { sillM: number; headM: number }
export type ParsedFacadeKey = { roomId: string; side: Side; band: FacadeBand | null }

const KEY_RE = /^(.+):([nswe])(?:@(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?))?$/

export function parseFacadeKey(key: string): ParsedFacadeKey | null {
  const m = KEY_RE.exec(key)
  if (!m) return null
  const [, roomId, side, sill, head] = m
  if (sill === undefined) return { roomId, side: side as Side, band: null }
  const sillM = Number(sill)
  const headM = Number(head)
  if (!Number.isFinite(sillM) || !Number.isFinite(headM) || headM <= sillM) return null
  return { roomId, side: side as Side, band: { sillM, headM } }
}

export function formatFacadeKey(roomId: string, side: Side, band?: FacadeBand | null): string {
  if (!band) return `${roomId}:${side}`
  return `${roomId}:${side}@${band.sillM.toFixed(2)}-${band.headM.toFixed(2)}`
}

export type WallBand = {
  /** Key map facade persis (utk resolusi renderer). */
  key: string
  sillM: number
  headM: number
  claddingId: string
}

/**
 * Band-band sebuah dinding, ter-clamp [0..wallH], urut sill, overlap di-clip
 * deterministik (band belakangan mengalah), degenerate (<0.05 m) dibuang.
 */
export function facadeBandsForWall(
  facade: Record<string, string> | undefined,
  roomId: string,
  side: Side,
  wallH: number,
): WallBand[] {
  if (!facade) return []
  const out: WallBand[] = []
  for (const [key, claddingId] of Object.entries(facade)) {
    const parsed = parseFacadeKey(key)
    if (!parsed || !parsed.band) continue
    if (parsed.roomId !== roomId || parsed.side !== side) continue
    const sillM = Math.max(0, Math.min(parsed.band.sillM, wallH))
    const headM = Math.max(0, Math.min(parsed.band.headM, wallH))
    if (headM - sillM < 0.05) continue
    out.push({ key, sillM, headM, claddingId })
  }
  out.sort((a, b) => a.sillM - b.sillM)
  // Clip overlap: band berikutnya dimulai minimal di head band sebelumnya.
  let cursor = 0
  const clipped: WallBand[] = []
  for (const b of out) {
    const sillM = Math.max(b.sillM, cursor)
    if (b.headM - sillM < 0.05) continue
    clipped.push({ ...b, sillM })
    cursor = b.headM
  }
  return clipped
}

/**
 * Garis potong vertikal unik (0..wallH) untuk memecah box dinding per band —
 * selalu menyertakan 0 dan wallH.
 */
export function wallCutYs(bands: WallBand[], wallH: number): number[] {
  const ys = new Set<number>([0, wallH])
  for (const b of bands) {
    ys.add(b.sillM)
    ys.add(b.headM)
  }
  return [...ys].sort((a, b) => a - b).filter((y, i, arr) => i === 0 || y - arr[i - 1] > 1e-6)
}

/** Band yang menutupi segmen vertikal [y0..y1); null = tak ada band. */
export function bandCovering(bands: WallBand[], y0: number, y1: number): WallBand | null {
  const mid = (y0 + y1) / 2
  return bands.find((b) => mid >= b.sillM - 1e-6 && mid <= b.headM + 1e-6) ?? null
}

/** Semua key facade milik (roomId, side) — polos maupun band. */
export function facadeKeysForWall(
  facade: Record<string, string> | undefined,
  roomId: string,
  side: Side,
): string[] {
  if (!facade) return []
  return Object.keys(facade).filter((key) => {
    const p = parseFacadeKey(key)
    return p !== null && p.roomId === roomId && p.side === side
  })
}
