/**
 * Merancang KORIDOR — kemampuan yang selama ini hilang dari agent.
 *
 * AKAR MASALAH: pratinjau perbaikan 16 denah produksi menunjukkan 15 pintu
 * bisa ditambah otomatis, tapi **30 ruang butuh koridor** — dua kali lebih
 * banyak. Solver penyambung pintu sengaja menolak menembus kamar orang untuk
 * mencapai kamar lain, dan diagnosisnya benar: denahnya yang salah, bukan
 * pintunya yang kurang.
 *
 * Masalahnya "buat koridor" adalah SOLUSI YANG MUSTAHIL DIEKSEKUSI: `koridor`
 * dirujuk sebagai ruang sirkulasi di connect-rooms.ts, deterministic.ts, dan
 * door-spec.ts — tapi TIDAK ADA di `RoomType`, sehingga `roomTypeSchema` (zod)
 * menolak addRoom bertipe koridor. Agent disuruh melakukan hal yang secara
 * teknis tidak mungkin, lalu menyerah dengan "coba perintah yang lebih
 * spesifik".
 *
 * Modul ini menghitung PETAK koridornya: di celah mana, seukuran apa, agar
 * ruang terkurung punya jalur kaki dari area sirkulasi — tanpa menembus kamar
 * orang. Lebar mengikuti praktik sirkulasi 0,9–1,2 m; celah yang lebih lebar
 * diisi penuh agar tak menyisakan sliver mati.
 */
import type { RectRoom } from "./opening-plan"

/** Sisi bersama minimal agar sebuah pintu masih bisa dipasang. */
const MIN_SHARED_WALL_M = 0.6
/** Toleransi sentuh antar-ruang (tebal dinding pada denah produksi). */
const TOUCH_TOL = 0.15

export interface CorridorPlanInput {
  floorId: string
  rooms: RectRoom[]
  /** Ruang yang tak terjangkau dari dalam rumah. */
  isolatedIds: string[]
  /** Ruang sirkulasi yang jadi titik tolak jalur kaki. */
  circulationIds: string[]
  /**
   * Batas lahan, bila diketahui. Denah produksi TIDAK menyimpannya (0 dari 16
   * payload punya field ini), jadi opsional — bila absen, batas diturunkan
   * dari bounding box ruang yang ada.
   */
  site?: { widthM: number; depthM: number }
  minWidthM?: number
  /** Di atas ini bukan koridor lagi, melainkan ruang — biarkan agent memutuskan. */
  maxWidthM?: number
}

export interface CorridorPlan {
  room: { floorId: string; x: number; y: number; width: number; depth: number }
  /** Ruang terkurung yang jadi terjangkau lewat koridor ini. */
  servesIds: string[]
  reason: string
}

const round2 = (v: number) => Math.round(v * 100) / 100
const areaOf = (r: { width: number; depth: number }) => r.width * r.depth

type Rect = { x: number; y: number; width: number; depth: number }

/** Dua petak berbagi dinding cukup panjang untuk dipasangi pintu. */
function sharesWall(a: Rect, b: Rect): boolean {
  const xo = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const yo = Math.min(a.y + a.depth, b.y + b.depth) - Math.max(a.y, b.y)
  const vAdj = Math.abs(a.x + a.width - b.x) <= TOUCH_TOL || Math.abs(b.x + b.width - a.x) <= TOUCH_TOL
  const hAdj = Math.abs(a.y + a.depth - b.y) <= TOUCH_TOL || Math.abs(b.y + b.depth - a.y) <= TOUCH_TOL
  return (vAdj && yo > MIN_SHARED_WALL_M) || (hAdj && xo > MIN_SHARED_WALL_M)
}

const overlaps = (a: Rect, b: Rect) =>
  Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 0.01 &&
  Math.min(a.y + a.depth, b.y + b.depth) - Math.max(a.y, b.y) > 0.01

/** Rentang bebas-ruang di [lo, hi] setelah dipotong para penghalang. */
function freeIntervals(blockers: Array<{ lo: number; hi: number }>, lo: number, hi: number) {
  const sorted = blockers.filter((b) => b.hi > lo && b.lo < hi).sort((a, b) => a.lo - b.lo)
  const out: Array<{ lo: number; hi: number }> = []
  let cur = lo
  for (const b of sorted) {
    if (b.lo > cur) out.push({ lo: cur, hi: Math.min(b.lo, hi) })
    cur = Math.max(cur, b.hi)
    if (cur >= hi) break
  }
  if (cur < hi) out.push({ lo: cur, hi })
  return out.filter((i) => i.hi - i.lo > 0.01)
}

/**
 * Petak koridor terbaik untuk menjangkau `isolatedIds`, atau null bila tidak
 * ada celah yang layak — atau bila koridor memang bukan jawabannya.
 */
export function planCorridorFor(input: CorridorPlanInput): CorridorPlan | null {
  const { floorId } = input
  const minW = input.minWidthM ?? 0.9
  const maxW = input.maxWidthM ?? 2.4
  const rooms = input.rooms.filter((r) => r.floorId === floorId)
  if (!rooms.length) return null
  const circulation = rooms.filter((r) => input.circulationIds.includes(r.id))
  if (!circulation.length) return null

  // Denah produksi tidak menyimpan `site` — turunkan batas dari bounding box
  // ruang yang ada. Koridor memang hanya masuk akal di dalam jejak bangunan.
  const site = input.site ?? {
    widthM: Math.max(...rooms.map((r) => r.x + r.width)),
    depthM: Math.max(...rooms.map((r) => r.y + r.depth)),
  }
  if (!(site.widthM > 0) || !(site.depthM > 0)) return null

  // Ruang terkurung yang SUDAH bersinggungan dinding dengan area sirkulasi
  // cukup diberi PINTU — koridor untuk itu berarti membuang ruang.
  const needy = rooms.filter(
    (r) => input.isolatedIds.includes(r.id) && !circulation.some((c) => sharesWall(r, c))
  )
  if (!needy.length) return null

  let best: { room: CorridorPlan["room"]; serves: RectRoom[] } | null = null

  for (const axis of ["v", "h"] as const) {
    const vertical = axis === "v"
    const bandSpan = vertical ? site.widthM : site.depthM
    const crossSpan = vertical ? site.depthM : site.widthM
    const edges = new Set<number>([0, bandSpan])
    for (const r of rooms) {
      edges.add(vertical ? r.x : r.y)
      edges.add(vertical ? r.x + r.width : r.y + r.depth)
    }
    const sorted = [...edges].sort((a, b) => a - b)

    for (let i = 0; i < sorted.length - 1; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const lo = sorted[i]
        const hi = sorted[j]
        const w = hi - lo
        if (w < minW - 1e-9) continue
        if (w > maxW + 1e-9) break // sorted naik: pita berikutnya makin lebar

        // Ruang yang memotong pita ini menghalangi koridor.
        const blockers = rooms
          .filter((r) => {
            const rLo = vertical ? r.x : r.y
            const rHi = vertical ? r.x + r.width : r.y + r.depth
            return Math.min(rHi, hi) - Math.max(rLo, lo) > 0.01
          })
          .map((r) => (vertical ? { lo: r.y, hi: r.y + r.depth } : { lo: r.x, hi: r.x + r.width }))

        for (const iv of freeIntervals(blockers, 0, crossSpan)) {
          const mk = (a: number, b: number): CorridorPlan["room"] =>
            vertical
              ? { floorId, x: round2(lo), y: round2(a), width: round2(w), depth: round2(b - a) }
              : { floorId, x: round2(a), y: round2(lo), width: round2(b - a), depth: round2(w) }

          let cand = mk(iv.lo, iv.hi)
          const serves = needy.filter((r) => sharesWall(cand, r))
          if (!serves.length || !circulation.some((c) => sharesWall(cand, c))) continue

          // Pangkas ke bentang yang benar-benar dibutuhkan — jangan mengambil
          // seluruh sisi lahan bila cuma perlu melewati beberapa ruang.
          const anchors = [...serves, ...circulation.filter((c) => sharesWall(cand, c))]
          const needLo = Math.max(iv.lo, Math.min(...anchors.map((r) => (vertical ? r.y : r.x))))
          const needHi = Math.min(
            iv.hi,
            Math.max(...anchors.map((r) => (vertical ? r.y + r.depth : r.x + r.width)))
          )
          if (needHi - needLo >= minW - 1e-9) {
            const trimmed = mk(needLo, needHi)
            const stillServes = needy.filter((r) => sharesWall(trimmed, r))
            if (stillServes.length === serves.length && circulation.some((c) => sharesWall(trimmed, c))) {
              cand = trimmed
            }
          }

          if (cand.width < minW - 1e-9 || cand.depth < minW - 1e-9) continue
          if (rooms.some((r) => overlaps(cand, r))) continue
          if (cand.x < -1e-6 || cand.y < -1e-6) continue
          if (cand.x + cand.width > site.widthM + 1e-6) continue
          if (cand.y + cand.depth > site.depthM + 1e-6) continue

          const finalServes = needy.filter((r) => sharesWall(cand, r))
          if (!finalServes.length) continue
          const better =
            !best ||
            finalServes.length > best.serves.length ||
            (finalServes.length === best.serves.length && areaOf(cand) < areaOf(best.room))
          if (better) best = { room: cand, serves: finalServes }
        }
      }
    }
  }

  if (!best) return null
  const names = best.serves.map((r) => r.id).join(", ")
  return {
    room: best.room,
    servesIds: best.serves.map((r) => r.id),
    reason:
      `Koridor selebar ${best.room.width} m untuk memberi akses dari dalam rumah ke ${names} — ` +
      `ruang ini tidak berbatasan dinding dengan area sirkulasi mana pun, jadi menambah pintu saja ` +
      `tidak cukup tanpa menembus kamar orang.`,
  }
}
