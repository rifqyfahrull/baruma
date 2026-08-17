/**
 * Memindahkan bukaan WARISAN yang menumpang titik pertemuan tembok ke bentang
 * ruang tetangga yang dilayaninya — dengan LEBAR DIPERTAHANKAN.
 *
 * PELAJARAN dari migration 0025 yang salah arah: `fitOpeningToWall` mencari
 * bidang solid TERDEKAT pada dinding, tapi tidak memeriksa apakah bidang itu
 * menghadap ruang yang bisa dimasuki. Akibatnya:
 *   - pintu Taman belakang digeser ke bidang yang di seberangnya TIDAK ADA
 *     ruang apa pun (pintu menuju kekosongan), dan
 *   - pintu Balkon dipaksa masuk bidang yang menghadap Void (bukan lantai
 *     pijak) sambil menyempit 30%.
 *
 * Modul ini memakai `freeDoorPosition` — yang sejak awal sadar tetangga DAN
 * sadar junction — sehingga bukaan mendarat di dalam bentang bersama dengan
 * ruang yang benar, tanpa mengorbankan lebar. Bila lebar asli tidak mungkin
 * dipertahankan, kembalikan null: lebih baik dilaporkan untuk ditinjau manusia
 * daripada menyempitkan pintu secara diam-diam.
 */
import {
  freeDoorPosition,
  neighborServedByOpening,
  openingWorldSegment,
  sharedWallSpan,
  wallJunctions,
  type OpeningRef,
  type RectRoom,
} from "./opening-plan"
import type { Side } from "@/lib/geometry"

/** Ruang yang bukan permukaan pijak — pintu tak boleh menuju ke sini. */
const NOT_WALKABLE = new Set(["void", "kolam"])

export interface RepositionInput {
  host: RectRoom
  side: Side
  positionM: number
  widthM: number
  /** Semua ruang di lantai yang sama (termasuk host). */
  rooms: Array<RectRoom & { type?: string }>
  /** Bukaan lain di denah, untuk cek tabrakan. */
  openings: OpeningRef[]
}

export interface RepositionResult {
  positionM: number
  widthM: number
  /** Ruang tetangga yang kini dilayani bukaan. */
  neighborId: string
}

const round2 = (v: number) => Math.round(v * 100) / 100
const edgeLen = (room: RectRoom, side: Side) => (side === "n" || side === "s" ? room.width : room.depth)

/**
 * Posisi baru bagi bukaan yang menumpang pertemuan tembok, di dalam bentang
 * tetangga yang paling banyak dilayaninya saat ini. Null bila sudah sah, atau
 * bila lebar asli tak mungkin dipertahankan di bentang mana pun.
 */
export function repositionOpeningToNeighbor({
  host,
  side,
  positionM,
  widthM,
  rooms,
  openings,
}: RepositionInput): RepositionResult | null {
  const len = edgeLen(host, side)
  const origin = side === "n" || side === "s" ? host.x : host.y
  const seg = openingWorldSegment(host, side, positionM, widthM)

  // Sudah sah? Tak menumpang junction & tak mepet ujung → jangan diutak-atik.
  const junctions = wallJunctions(host, side, rooms)
  const a = seg.a - origin
  const b = seg.b - origin
  const straddles = junctions.some((j) => j > a + 1e-6 && j < b - 1e-6)
  if (!straddles) return null

  // Tetangga mana yang paling banyak dilayani bukaan SEKARANG — itulah niat
  // aslinya. Ruang tak-bisa-dipijak (void/kolam) tidak pernah jadi tujuan.
  let target: (RectRoom & { type?: string }) | null = null
  let bestOverlap = 0
  for (const room of rooms) {
    if (room.id === host.id || room.floorId !== host.floorId) continue
    if (room.type && NOT_WALKABLE.has(room.type)) continue
    const span = sharedWallSpan(host, side, room)
    if (!span) continue
    const overlap = Math.min(seg.b, span.hi) - Math.max(seg.a, span.lo)
    if (overlap > bestOverlap) {
      bestOverlap = overlap
      target = room
    }
  }
  if (!target) return null

  // freeDoorPosition menjaga: di dalam bentang bersama target, clearance dari
  // ujung & junction, dan bebas tabrakan di kedua sisi dinding.
  const solved = freeDoorPosition(host, side, target, widthM, openings, rooms)
  if (solved == null) return null
  if (Math.abs(solved - positionM) < 1e-9) return null

  // Sanity: pastikan hasilnya benar-benar melayani target dan tetap di dinding.
  const check = neighborServedByOpening(host, side, solved, widthM, rooms)
  if (check?.id !== target.id) return null
  if (solved - widthM / 2 < -1e-6 || solved + widthM / 2 > len + 1e-6) return null

  return { positionM: round2(solved), widthM: round2(widthM), neighborId: target.id }
}
