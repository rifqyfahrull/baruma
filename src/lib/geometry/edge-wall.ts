/**
 * Geometri dinding tepi SINTETIS `w-edge-*` (penutup fasad lantai ELEVATED
 * yang footprint-nya mundur dari tepi bangunan — kantilever/massa berundak;
 * lihat build-model.ts blok "Penutup fasad lantai ELEVATED" utk narasi
 * lengkap kenapa dinding ini perlu ada sama sekali). SATU sumber kebenaran
 * dipakai oleh:
 * - build-model.ts: menggambar dinding w-edge itu sendiri (pushBandedWallBox)
 *   DAN resolve host elemen fasad (kisi/roster) yang wallId-nya menunjuk
 *   pseudo-room `edge-{floorId}` — sebelumnya `rooms.find` selalu gagal utk
 *   id sintetis ini sehingga elemen fasad diam-diam tak pernah tergambar.
 * - editor-store.ts: tombol preset "Panel sirip (fluted)" / "Nat beton" pada
 *   dinding tepi butuh panjang & tinggi dinding tanpa mengimpor build-model.ts
 *   (paket generator three.js — dilarang dari store inti, lihat baseline
 *   bundle di memori proyek).
 *
 * Modul MURNI: tanpa react/zustand/three.
 */
import type { DesignLayout } from "@/types"
import { buildingFootprint } from "@/lib/structural/grid"
import { isMezzanineFloor } from "@/lib/editor/floors"
import type { Side } from "@/lib/geometry"

export type Span = { start: number; end: number }

// Sama persis dgn konstanta w-edge di build-model.ts (disamakan lewat unit test).
export const EDGE_NEAR = 0.5
export const EDGE_MIN_SPAN = 0.35

/** Duplikat sengaja dari `subtractSpans` build-model.ts — modul ini murni
 *  (tanpa import lib/three) supaya aman diimpor dari editor-store.ts. */
export function subtractSpans(base: Span, cuts: Span[], tol = 0.01): Span[] {
  const sorted = cuts
    .map((cut) => ({
      start: Math.min(Math.max(cut.start, base.start), base.end),
      end: Math.min(Math.max(cut.end, base.start), base.end),
    }))
    .filter((cut) => cut.end - cut.start > tol)
    .sort((a, b) => a.start - b.start)

  const out: Span[] = []
  let cursor = base.start
  for (const cut of sorted) {
    if (cut.start > cursor + tol) out.push({ start: cursor, end: cut.start })
    cursor = Math.max(cursor, cut.end)
  }
  if (cursor < base.end - tol) out.push({ start: cursor, end: base.end })
  return out
}

export type EdgeWallSideGeometry = {
  /** Span MENTAH (sebelum filter EDGE_MIN_SPAN) — dipakai build-model.ts utk
   *  indeks `si` idBase kotak dinding, byte-identik dgn jalur lama. */
  rawSpans: Span[]
  /** Span yang benar-benar tergambar (panjang >= EDGE_MIN_SPAN). */
  spans: Span[]
  /** Koordinat garis tepi (x utk sisi w/e, y utk sisi n/s). */
  line: number
  horizontal: boolean
}

/**
 * Resolve geometri dinding tepi sintetis utk `floorId`+`side`, ATAU `null`
 * bila lantai ini tak menggambar dinding w-edge sama sekali (kondisi PERSIS
 * guard di build-model.ts: lantai dasar/rooftop/mezzanine dilewati, footprint
 * kosong dilewati, lantai tanpa ruang nyata dilewati).
 */
export function edgeWallSideGeometry(
  layout: DesignLayout,
  floorId: string,
  side: Side,
): EdgeWallSideGeometry | null {
  const i = layout.floors.findIndex((f) => f.id === floorId)
  const floor = i >= 0 ? layout.floors[i] : undefined
  if (!floor) return null
  const isRooftop = floor.id === "floor-rooftop"
  const isMezz = isMezzanineFloor(floor)
  const footprint = buildingFootprint(layout)
  const hasFp = footprint.widthM > 0 && footprint.depthM > 0
  const rooms = layout.rooms.filter((r) => r.floorId === floorId)
  if (!(i > 0 && !isRooftop && !isMezz && hasFp && rooms.length > 0)) return null

  const horizontal = side === "n" || side === "s"
  const fx1 = footprint.x0 + footprint.widthM
  const fy1 = footprint.y0 + footprint.depthM
  const base: Span = horizontal
    ? { start: footprint.x0, end: fx1 }
    : { start: footprint.y0, end: fy1 }
  const covered: Span[] = rooms
    .filter((r) => {
      const dist =
        side === "n" ? r.y - footprint.y0
        : side === "s" ? fy1 - (r.y + r.depth)
        : side === "w" ? r.x - footprint.x0
        : fx1 - (r.x + r.width)
      return dist <= (r.type === "void" ? 0.05 : EDGE_NEAR)
    })
    .map((r) =>
      horizontal ? { start: r.x, end: r.x + r.width } : { start: r.y, end: r.y + r.depth },
    )
  const line =
    side === "n" ? footprint.y0
    : side === "s" ? fy1
    : side === "w" ? footprint.x0
    : fx1
  const rawSpans = subtractSpans(base, covered)
  const spans = rawSpans.filter((s) => s.end - s.start >= EDGE_MIN_SPAN)
  return { rawSpans, spans, line, horizontal }
}

/** Span terpanjang (host dinding "utama" utk elemen fasad + tombol preset),
 *  atau `null` bila sisi ini tak punya dinding tepi sama sekali. */
export function widestEdgeWallSpan(geom: EdgeWallSideGeometry | null): Span | null {
  if (!geom || geom.spans.length === 0) return null
  return geom.spans.reduce((a, b) => (b.end - b.start > a.end - a.start ? b : a))
}
