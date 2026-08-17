/**
 * Keterjangkauan ruang: bisakah penghuni berjalan dari ruang ke ruang TANPA
 * keluar rumah?
 *
 * Kenapa ini terpisah dari "punya pintu": sebuah ruang bisa punya dua pintu —
 * satu ke halaman dan satu ke kamar mandinya sendiri — dan tetap tak
 * terjangkau dari ruang keluarga. Pemilik rumah melaporkannya persis begitu:
 * "kamar tidur 2 tidak ada akses ke dalam rumah, pintunya hanya keluar rumah".
 * Memeriksa keberadaan pintu per-ruang (properti LOKAL) tidak menangkap itu;
 * yang benar adalah konektivitas graf (properti GLOBAL).
 */
import type { Opening, Room } from "@/types"
import { parseOpeningWall } from "@/lib/geometry"
import { neighborServedByOpening } from "@/lib/geometry/opening-plan"
import { OPEN_TYPES } from "@/lib/three/build-model"

/**
 * Toleransi sentuh antar-ruang.
 *
 * Denah produksi memberi jarak ~0,06 m antar ruang bersebelahan (tebal
 * dinding), sedangkan default `roomsAdjacentOnSide` adalah 0,05 — sehingga
 * dengan default itu TAK SATU PUN tetangga terdeteksi dan seluruh rumah
 * tampak terputus. Nilai ini disamakan dengan `openingServesRoom` (0,12) yang
 * memang sudah bekerja pada data yang sama.
 */
export const ADJACENCY_TOL = 0.12

/** Ruang luar/terbuka: melewatinya berarti keluar rumah, jadi bukan jalur dalam. */
export function isOutdoorRoom(room: Pick<Room, "type">): boolean {
  return OPEN_TYPES.includes(room.type)
}

export interface RoomConnectivity {
  /** Ruang dalam yang TIDAK terhubung ke gugus utama LANTAINYA SENDIRI. */
  isolated: Room[]
  /** Ruang dalam yang punya pintu langsung ke luar/ruang terbuka. */
  withExteriorDoor: Set<string>
  /** id gugus per ruang; ruang segugus saling terjangkau (lintas lantai pun
   *  angkanya unik — tapi edge TAK PERNAH menyeberang lantai, lihat di bawah). */
  componentOf: Map<string, number>
  /** Gugus terbesar PER LANTAI (floorId → id gugus). Lantai tak terhubung
   *  satu sama lain lewat pintu (tangga di luar cakupan graf ini), jadi
   *  "gugus utama" harus dihitung per lantai — bukan satu angka global.
   *  Versi pertama fungsi ini memilih SATU gugus terbesar lintas seluruh
   *  layout: pada rumah 2 lantai kecil, itu bisa membuat ruang tamu di lantai
   *  dasar (1 ruang) tertandai "terputus" hanya karena kamar+kamar-mandi di
   *  lantai atas kebetulan membentuk gugus 2-ruang yang lebih besar. */
  mainComponentByFloor: Map<string, number>
}

/**
 * Bangun graf ruang-dalam (sisi = pintu antar dua ruang dalam) lalu tentukan
 * ruang yang terputus dari gugus terbesar.
 *
 * Hanya ruang pada LANTAI yang sama yang bisa bertetangga lewat dinding;
 * hubungan antar lantai terjadi lewat tangga, di luar cakupan fungsi ini —
 * karena itu analisis dijalankan per lantai lalu digabung.
 */
export function analyzeRoomConnectivity(rooms: Room[], openings: Opening[]): RoomConnectivity {
  const indoor = rooms.filter((r) => !isOutdoorRoom(r))
  const adj = new Map<string, string[]>(indoor.map((r) => [r.id, []]))
  const withExteriorDoor = new Set<string>()

  for (const o of openings) {
    if (o.type !== "door") continue
    const parsed = parseOpeningWall(o.wallId)
    if (!parsed) continue
    const host = rooms.find((r) => r.id === parsed.roomId)
    if (!host) continue
    // Tetangga ditentukan dari SEGMEN pintu, bukan sisi dinding. Satu dinding
    // bisa punya beberapa tetangga (insiden nyata: dinding utara Ruang Tamu
    // berbatasan Dapur DAN Ruang Makan) — resolusi per-sisi membuat graf
    // mengklaim koneksi ke ruang yang pintunya tidak pernah membuka ke sana,
    // sehingga audit ikut menganggap "sudah tersambung" padahal tidak.
    const neighbor = neighborServedByOpening(host, parsed.side, o.positionM, o.widthM, rooms)
    const hostIndoor = !isOutdoorRoom(host)
    const neighborRoom = neighbor ? rooms.find((r) => r.id === neighbor.id) ?? null : null
    const neighborIndoor = !!neighborRoom && !isOutdoorRoom(neighborRoom)

    if (hostIndoor && neighborRoom && neighborIndoor) {
      adj.get(host.id)?.push(neighborRoom.id)
      adj.get(neighborRoom.id)?.push(host.id)
    } else if (hostIndoor) {
      withExteriorDoor.add(host.id) // ke luar atau ke ruang terbuka
    } else if (neighborRoom && neighborIndoor) {
      withExteriorDoor.add(neighborRoom.id)
    }
  }

  const componentOf = new Map<string, number>()
  let comp = 0
  for (const room of indoor) {
    if (componentOf.has(room.id)) continue
    const queue = [room.id]
    componentOf.set(room.id, comp)
    while (queue.length) {
      const cur = queue.shift()!
      for (const next of adj.get(cur) ?? []) {
        if (!componentOf.has(next)) {
          componentOf.set(next, comp)
          queue.push(next)
        }
      }
    }
    comp++
  }

  // Ukuran tiap gugus, DIPECAH per lantai — satu gugus tak pernah memuat
  // ruang dari dua lantai berbeda (adjacency di atas sudah dibatasi
  // `sameFloor`), jadi ini aman dihitung sbg (floorId, compId) -> jumlah.
  const sizeByFloor = new Map<string, Map<number, number>>()
  for (const room of indoor) {
    const c = componentOf.get(room.id)!
    if (!sizeByFloor.has(room.floorId)) sizeByFloor.set(room.floorId, new Map())
    const m = sizeByFloor.get(room.floorId)!
    m.set(c, (m.get(c) ?? 0) + 1)
  }

  const mainComponentByFloor = new Map<string, number>()
  for (const [floorId, sizes] of sizeByFloor) {
    let best = -1, bestComp = 0
    for (const [c, n] of sizes) if (n > best) { best = n; bestComp = c }
    mainComponentByFloor.set(floorId, bestComp)
  }

  const isolated = indoor.filter(
    (r) => componentOf.get(r.id) !== mainComponentByFloor.get(r.floorId),
  )
  return { isolated, withExteriorDoor, componentOf, mainComponentByFloor }
}
