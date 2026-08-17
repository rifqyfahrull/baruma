/**
 * Perencanaan BUKAAN yang sadar-keadaan: sebelum menaruh pintu/jendela,
 * hitung dulu apa yang sudah ada di dinding itu — di KEDUA sisi.
 *
 * Lahir dari insiden produksi nyata (proyek "Rumah Tropis Modern"): dinding
 * utara Ruang Tamu punya DUA tetangga (Dapur x 6.97–8.44, Ruang Makan
 * x 8.49–11.72). Agent memilih Dapur sebagai tujuan, tapi menaruh pintu di
 * titik tengah SELURUH dinding (x 8.90–9.80) — jatuh di depan Ruang Makan,
 * menabrak pintu yang sudah ada di sisi seberang (terdaftar atas wallId
 * Ruang Makan, jadi tak terlihat oleh cek satu-sisi), dan koneksi ke Dapur
 * tidak pernah terjadi. Grafnya pun ikut tertipu, karena tetangga ditentukan
 * per-SISI-dinding, bukan per-SEGMEN-bukaan.
 *
 * Prinsip modul ini: satu bukaan adalah SEGMEN dunia, dan semua keputusan
 * (tetangga mana yang dilayani, bentrok dengan apa, di mana posisi bebas)
 * dihitung dari segmen itu.
 */
import type { Side } from "@/lib/geometry"

/** Bentuk minimum yang dibutuhkan — duck-typed supaya bisa dipakai baik oleh
 *  Room domain (layout) maupun FloorplanRoom scene assistant. */
export interface RectRoom {
  id: string
  floorId: string
  x: number
  y: number
  width: number
  depth: number
}

export interface OpeningRef {
  id?: string
  roomId: string
  side: Side
  positionM: number
  widthM: number
  type?: string
}

/** Segmen dunia sebuah bukaan pada dinding host-nya. */
export interface WallSegment {
  axis: "x" | "y"
  /** Koordinat garis dinding pada sumbu tegak lurus. */
  line: number
  a: number
  b: number
}

const edgeLen = (room: RectRoom, side: Side) =>
  side === "n" || side === "s" ? room.width : room.depth

const clampNum = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)

/** Segmen dunia bukaan (positionM = TITIK TENGAH, konvensi openingSegment). */
export function openingWorldSegment(host: RectRoom, side: Side, positionM: number, widthM: number): WallSegment {
  const len = edgeLen(host, side)
  const half = widthM / 2
  const center = clampNum(positionM, half, Math.max(half, len - half))
  if (side === "n") return { axis: "x", line: host.y, a: host.x + center - half, b: host.x + center + half }
  if (side === "s") return { axis: "x", line: host.y + host.depth, a: host.x + center - half, b: host.x + center + half }
  if (side === "w") return { axis: "y", line: host.x, a: host.y + center - half, b: host.y + center + half }
  return { axis: "y", line: host.x + host.width, a: host.y + center - half, b: host.y + center + half }
}

/** Toleransi garis dinding — setebal dinding + selisih gambar tangan
 *  (selaras openingServesRoom di geometry/index.ts). */
export const WALL_LINE_TOL = 0.15

/**
 * Clearance minimal kusen ke dinding tegak lurus terdekat (ujung dinding ATAU
 * titik pertemuan tembok di tengah bidang). domain-knowledge-pintu.md §1:
 * "Sisakan clearance minimal 10–15 cm dari engsel pintu ke dinding/sudut
 * terdekat agar daun pintu bisa membuka penuh 90°" — diambil batas atasnya.
 */
export const OPENING_EDGE_MARGIN_M = 0.15

/**
 * Ruang (selain host) yang BENAR-BENAR dilayani segmen bukaan ini: batasnya
 * berimpit dengan garis dinding dan bentangnya beririsan dengan segmen.
 * Inilah resolusi tetangga per-segmen — pengganti asumsi per-sisi yang
 * terbukti salah saat satu dinding punya lebih dari satu tetangga.
 */
export function neighborServedByOpening(
  host: RectRoom,
  side: Side,
  positionM: number,
  widthM: number,
  rooms: RectRoom[],
  tol = WALL_LINE_TOL,
): RectRoom | null {
  const seg = openingWorldSegment(host, side, positionM, widthM)
  const MIN_SHARED = 0.1
  for (const room of rooms) {
    if (room.id === host.id || room.floorId !== host.floorId) continue
    if (seg.axis === "x") {
      const onBoundary =
        Math.abs(seg.line - room.y) <= tol || Math.abs(seg.line - (room.y + room.depth)) <= tol
      const overlap = Math.min(seg.b, room.x + room.width) - Math.max(seg.a, room.x)
      if (onBoundary && overlap > MIN_SHARED) return room
    } else {
      const onBoundary =
        Math.abs(seg.line - room.x) <= tol || Math.abs(seg.line - (room.x + room.width)) <= tol
      const overlap = Math.min(seg.b, room.y + room.depth) - Math.max(seg.a, room.y)
      if (onBoundary && overlap > MIN_SHARED) return room
    }
  }
  return null
}

/**
 * Bukaan lain yang bentrok dengan usulan ini — diperiksa dalam KOORDINAT
 * DUNIA, sehingga bukaan yang terdaftar atas nama ruang seberang (wallId
 * tetangga) ikut terlihat. `clearanceM` memberi jarak minimal antar kusen.
 */
export function findOpeningConflicts(
  host: RectRoom,
  side: Side,
  positionM: number,
  widthM: number,
  openings: OpeningRef[],
  rooms: RectRoom[],
  clearanceM = 0.1,
): OpeningRef[] {
  const proposed = openingWorldSegment(host, side, positionM, widthM)
  const roomById = new Map(rooms.map((r) => [r.id, r]))
  const out: OpeningRef[] = []
  for (const o of openings) {
    const oHost = roomById.get(o.roomId)
    if (!oHost || oHost.floorId !== host.floorId) continue
    const seg = openingWorldSegment(oHost, o.side, o.positionM, o.widthM)
    if (seg.axis !== proposed.axis) continue
    if (Math.abs(seg.line - proposed.line) > WALL_LINE_TOL) continue
    const gap = Math.max(seg.a, proposed.a) - Math.min(seg.b, proposed.b)
    if (gap < clearanceM) out.push(o)
  }
  return out
}

/** Bentang bersama host–tetangga di dinding `side`, dalam koordinat dunia
 *  sepanjang sumbu dinding; null bila tak benar-benar berimpit. */
export function sharedWallSpan(
  host: RectRoom,
  side: Side,
  neighbor: RectRoom,
  tol = WALL_LINE_TOL,
): { lo: number; hi: number } | null {
  if (host.floorId !== neighbor.floorId) return null
  if (side === "n" || side === "s") {
    const line = side === "n" ? host.y : host.y + host.depth
    const nbLine = side === "n" ? neighbor.y + neighbor.depth : neighbor.y
    if (Math.abs(line - nbLine) > tol) return null
    const lo = Math.max(host.x, neighbor.x)
    const hi = Math.min(host.x + host.width, neighbor.x + neighbor.width)
    return hi - lo > 0.1 ? { lo, hi } : null
  }
  const line = side === "w" ? host.x : host.x + host.width
  const nbLine = side === "w" ? neighbor.x + neighbor.width : neighbor.x
  if (Math.abs(line - nbLine) > tol) return null
  const lo = Math.max(host.y, neighbor.y)
  const hi = Math.min(host.y + host.depth, neighbor.y + neighbor.depth)
  return hi - lo > 0.1 ? { lo, hi } : null
}

/**
 * TITIK PERTEMUAN TEMBOK di sepanjang dinding `side` milik `host`, dalam
 * koordinat dinding host: tiap batas ruang tetangga yang co-planar dengan
 * dinding itu adalah tempat sebuah dinding sekat menempel TEGAK LURUS.
 *
 * Dipakai untuk menjauhkan kusen dari pertemuan tembok — `sharedWallSpan`
 * saja tidak cukup, karena batas bentang bersama ITULAH junction-nya.
 */
export function wallJunctions(host: RectRoom, side: Side, rooms: RectRoom[], tol = WALL_LINE_TOL): number[] {
  const len = edgeLen(host, side)
  const horizontal = side === "n" || side === "s"
  const line = side === "n" ? host.y : side === "s" ? host.y + host.depth : side === "w" ? host.x : host.x + host.width
  const origin = horizontal ? host.x : host.y
  const out = new Set<number>()
  for (const room of rooms) {
    if (room.id === host.id || room.floorId !== host.floorId) continue
    // Hanya tetangga yang benar-benar berimpit garis dinding ini.
    const nbLine = horizontal
      ? side === "n" ? room.y + room.depth : room.y
      : side === "w" ? room.x + room.width : room.x
    if (Math.abs(line - nbLine) > tol) continue
    const edges = horizontal ? [room.x, room.x + room.width] : [room.y, room.y + room.depth]
    for (const e of edges) {
      const t = e - origin
      // Ujung dinding host sendiri sudah dijaga marginM — yang dicari di sini
      // adalah pertemuan di TENGAH bidang dinding.
      if (t > tol && t < len - tol) out.add(Math.round(t * 100) / 100)
    }
  }
  return [...out].sort((a, b) => a - b)
}

/**
 * Cari positionM (koordinat dinding host) untuk pintu selebar `widthM` yang:
 *  1. berada DI DALAM bentang bersama dengan `neighbor` (bila diberikan) —
 *     supaya pintunya benar-benar membuka ke ruang yang dimaksud,
 *  2. tidak menabrak bukaan mana pun di garis dinding itu (kedua sisi), dan
 *  3. menyisakan `marginM` dari setiap TITIK PERTEMUAN TEMBOK — termasuk batas
 *     bentang bersama, karena di situlah dinding sekat menempel tegak lurus.
 *
 * Aturan (3) berasal dari domain-knowledge-pintu.md §1: "Sisakan clearance
 * minimal 10–15 cm dari engsel pintu ke dinding/sudut terdekat agar daun pintu
 * bisa membuka penuh 90°" dan "Kusen pintu idealnya tidak diletakkan persis di
 * sudut ruangan (< 15 cm dari dinding tegak lurus) — daun pintu akan mentok."
 * Tanpa (3), pintu bisa mendarat dengan kusen 5 cm dari pertemuan tembok, atau
 * MENUMPANG junction (separuh daun di ruang tetangga, separuh di dinding luar).
 *
 * Mulai dari titik tengah bentang, geser ±0,1 m. Null bila tak ada tempat —
 * dinding yang memang tak layak lebih baik dilaporkan apa adanya daripada
 * diberi pintu yang daunnya mentok.
 */
export function freeDoorPosition(
  host: RectRoom,
  side: Side,
  neighbor: RectRoom | null,
  widthM: number,
  openings: OpeningRef[],
  rooms: RectRoom[],
  marginM = OPENING_EDGE_MARGIN_M,
): number | null {
  const len = edgeLen(host, side)
  const half = widthM / 2
  const wallOrigin = side === "n" || side === "s" ? host.x : host.y

  // Batas pencarian dalam koordinat dinding host.
  let lo = half + marginM
  let hi = len - half - marginM
  if (neighbor) {
    const span = sharedWallSpan(host, side, neighbor)
    if (!span) return null
    // marginM juga berlaku di batas bentang bersama: batas itu adalah titik
    // pertemuan tembok, bukan sekadar batas logis.
    lo = Math.max(lo, span.lo - wallOrigin + half + marginM)
    hi = Math.min(hi, span.hi - wallOrigin - half - marginM)
  }
  if (hi < lo) return null

  const junctions = wallJunctions(host, side, rooms)
  const clearsJunctions = (p: number) =>
    junctions.every((j) => Math.abs(j - p) >= half + marginM - 1e-9)

  const center = clampNum((lo + hi) / 2, lo, hi)
  const fits = (p: number) =>
    clearsJunctions(p) &&
    findOpeningConflicts(host, side, p, widthM, openings, rooms).length === 0 &&
    // pintu harus tetap melayani tetangga yang dimaksud (bukan meleset ke
    // ruang lain di dinding yang sama)
    (!neighbor || neighborServedByOpening(host, side, p, widthM, rooms)?.id === neighbor.id)

  if (fits(center)) return Math.round(center * 100) / 100
  for (let d = 0.1; d <= len; d += 0.1) {
    for (const p of [center - d, center + d]) {
      if (p >= lo && p <= hi && fits(p)) return Math.round(p * 100) / 100
    }
  }
  return null
}
