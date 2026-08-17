/**
 * emptyRectAt — cari petak KOSONG maksimal (bebas ruang) yang MEMUAT sebuah
 * titik, dibatasi tepi ruang tetangga & batas site. Dipakai fitur klik-kanan /
 * Ctrl+klik "Tambah ruang di sini": mendeteksi celah di bawah kursor supaya
 * ruang baru bisa dipasang PAS mengisi celah (mis. koridor tipis antar kamar)
 * alih-alih lahir 2×2 m lalu menimpa tetangga.
 *
 * Koordinat = ruang editor (x,y = pojok kiri-atas, y menurun ke bawah), meter.
 * Kembali null bila titik berada DI DALAM sebuah ruang, atau celah degenerate.
 */
import type { Rect } from "@/lib/geometry"
import { round2 } from "@/lib/geometry"

type Box = { x: number; y: number; width: number; depth: number }
type Pt = { x: number; y: number }

const EPS = 0.05

function contains(b: Box, p: Pt): boolean {
  return (
    p.x > b.x + EPS &&
    p.x < b.x + b.width - EPS &&
    p.y > b.y + EPS &&
    p.y < b.y + b.depth - EPS
  )
}

/** Overlap area > 0 (dengan toleransi) antara dua rect. */
function overlaps(a: Rect, b: Box): boolean {
  return (
    Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > EPS &&
    Math.min(a.y + a.depth, b.y + b.depth) - Math.max(a.y, b.y) > EPS
  )
}

export function emptyRectAt(
  point: Pt,
  rooms: ReadonlyArray<Box>,
  site: { widthM: number; depthM: number },
): Rect | null {
  if (!(site.widthM > 0) || !(site.depthM > 0)) return null
  // Titik di luar site → tak ada celah.
  if (
    point.x < 0 ||
    point.y < 0 ||
    point.x > site.widthM ||
    point.y > site.depthM
  )
    return null
  // Titik di dalam ruang → bukan area kosong.
  if (rooms.some((r) => contains(r, point))) return null

  // Mulai dari seluruh site, lalu perkecil tiap sisi agar tak menimpa ruang
  // manapun sambil TETAP memuat titik. Iteratif karena mengecilkan satu sisi
  // bisa membuat ruang lain (yang tadinya di luar) kini beririsan.
  let L = 0
  let R = site.widthM
  let T = 0
  let B = site.depthM

  for (let iter = 0; iter < 8; iter++) {
    let changed = false
    const rect: Rect = { x: L, y: T, width: R - L, depth: B - T }
    for (const rm of rooms) {
      if (!overlaps(rect, rm)) continue
      const rRight = rm.x + rm.width
      const rBottom = rm.y + rm.depth
      // Ruang ada di satu sisi titik → dorong tepi rect ke sisi terdekatnya.
      // (Titik dijamin tak di dalam ruang, jadi minimal satu cabang berlaku.)
      if (rm.x >= point.x && rm.x < R) {
        R = rm.x
        changed = true
      } else if (rRight <= point.x && rRight > L) {
        L = rRight
        changed = true
      } else if (rm.y >= point.y && rm.y < B) {
        B = rm.y
        changed = true
      } else if (rBottom <= point.y && rBottom > T) {
        T = rBottom
        changed = true
      }
    }
    if (!changed) break
  }

  const width = round2(R - L)
  const depth = round2(B - T)
  if (!(width > EPS) || !(depth > EPS)) return null
  return { x: round2(L), y: round2(T), width, depth }
}
