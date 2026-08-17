/**
 * INVARIANT: setiap ruang dalam harus tetap terjangkau dari dalam rumah.
 *
 * Keluhan pemilik yang melahirkan modul ini: "yang namanya ruangan itu harus
 * bisa diakses dari dalam rumah, bukan sembarangan naruh pintu; dan rumah itu
 * dari depan ke belakang bisa diakses dari dalam rumah — lumrahnya desain
 * rumah seperti ini."
 *
 * Ini BUKAN constraint per-bukaan (margin, clearance, jenis pintu). Itu semua
 * menjawab "apakah pintu ini sah secara geometri". Yang dijaga di sini
 * pertanyaan yang lebih mendasar: "apakah rumahnya masih bisa dihuni."
 *
 * `analyzeRoomConnectivity` sudah menjawabnya dengan benar sejak lama —
 * properti GLOBAL (konektivitas graf), bukan LOKAL ("punya pintu"). Tapi ia
 * hanya dipanggil REAKTIF: di `matchFixRoomAccess` yang di-gate
 * ACCESS_COMPLAINT (jadi cuma jalan kalau user mengeluh), dan di audit pasif.
 * Gerbang yang memvalidasi setiap aksi agent tidak memeriksanya sama sekali —
 * sehingga agent bisa menghapus pintu satu-satunya ke sebuah ruang, atau
 * menggeser ruang sampai terputus, tanpa ada yang menegur.
 *
 * Pola yang dipakai: bandingkan SEBELUM vs SESUDAH, laporkan hanya REGRESI.
 * Cacat warisan bukan salah aksi yang sedang diusulkan — menyalahkannya akan
 * membuat agent melapor "gagal" pada denah yang memang sudah cacat, dan itu
 * membuat gerbang ini diabaikan.
 */
import { analyzeRoomConnectivity, isOutdoorRoom } from "@/lib/geometry/connectivity"
import { ROOM_TYPES } from "@/lib/constants"
import { simulateFloorplanActions } from "./editor-assistant"
import type { FloorplanAction, FloorplanScene } from "@/lib/assistant/actions"
import type { Opening, Room } from "@/types"

/** Bukaan scene (roomId+side terpisah) → Opening domain (wallId gabungan). */
function toOpenings(
  list: Array<{ id: string; roomId: string; side: string; type: string; positionM: number; widthM?: number }>,
  floorOf: Map<string, string>
): Opening[] {
  return list.map(
    (o) =>
      ({
        id: o.id,
        floorId: floorOf.get(o.roomId) ?? "",
        wallId: `${o.roomId}:${o.side}`,
        type: o.type,
        positionM: o.positionM,
        widthM: o.widthM ?? 0.9,
        heightM: 2.1,
      }) as Opening
  )
}

/**
 * Simulasikan efek aksi terhadap daftar bukaan. Sengaja sederhana: hanya
 * add/delete/update opening — cukup untuk menilai konektivitas.
 */
function simulateOpenings(actions: FloorplanAction[], scene: FloorplanScene) {
  let list = scene.openings.map((o) => ({ ...o })) as Array<{
    id: string
    roomId: string
    side: string
    type: string
    positionM: number
    widthM?: number
  }>
  let seq = 0
  for (const a of actions) {
    if (a.type === "deleteOpening") {
      list = list.filter((o) => o.id !== a.openingId)
    } else if (a.type === "addOpening") {
      list.push({
        id: `sim-${seq++}`,
        roomId: a.roomId,
        side: a.side,
        type: a.openingType,
        positionM: a.positionM,
        widthM: a.openingType === "door" ? 0.9 : 1.2,
      })
    } else if (a.type === "updateOpening") {
      const o = list.find((x) => x.id === a.openingId)
      if (o) Object.assign(o, a.patch)
    } else if (a.type === "deleteRoom") {
      // Bukaan milik ruang yang dihapus ikut hilang.
      list = list.filter((o) => o.roomId !== a.roomId)
    }
  }
  return list
}

const labelOf = (r: Room) => r.name || ROOM_TYPES[r.type]?.label || r.type

/**
 * Regresi konektivitas akibat `actions`, sebagai kalimat siap-dibaca-agent.
 * Array kosong = usulan tidak memutus akses ruang mana pun.
 */
export function findConnectivityRegressions(scene: FloorplanScene, actions: FloorplanAction[]): string[] {
  try {
    const beforeRooms = scene.rooms as unknown as Room[]
    const beforeFloorOf = new Map(beforeRooms.map((r) => [r.id, r.floorId]))
    const before = analyzeRoomConnectivity(
      beforeRooms,
      toOpenings(scene.openings as never, beforeFloorOf)
    )

    const afterRooms = simulateFloorplanActions(actions, scene) as unknown as Room[]
    const afterFloorOf = new Map(afterRooms.map((r) => [r.id, r.floorId]))
    const after = analyzeRoomConnectivity(
      afterRooms,
      toOpenings(simulateOpenings(actions, scene) as never, afterFloorOf)
    )

    const wasIsolated = new Set(before.isolated.map((r) => r.id))
    const existed = new Set(beforeRooms.map((r) => r.id))

    // Hanya ruang yang BARU terputus — plus ruang baru yang lahir tanpa akses.
    const broke: Room[] = []
    for (const room of after.isolated) {
      if (isOutdoorRoom(room)) continue
      if (existed.has(room.id) && wasIsolated.has(room.id)) continue // cacat warisan
      broke.push(room)
    }
    // Ruang dalam yang berdiri sendiri di lantainya (satu-satunya gugus) tidak
    // dianggap "isolated" oleh analyzer — tapi bila ia ruang BARU tanpa pintu
    // sama sekali, itu tetap ruang yang tak bisa dimasuki.
    const doorHostsAfter = new Set(
      simulateOpenings(actions, scene).filter((o) => o.type === "door").map((o) => o.roomId)
    )
    for (const room of afterRooms) {
      if (existed.has(room.id) || isOutdoorRoom(room)) continue
      if (broke.some((b) => b.id === room.id)) continue
      const reachable =
        doorHostsAfter.has(room.id) ||
        after.componentOf.get(room.id) === after.mainComponentByFloor.get(room.floorId)
      if (!reachable || (!doorHostsAfter.has(room.id) && afterRooms.length > 1)) broke.push(room)
    }

    if (!broke.length) return []

    const names = broke.map(labelOf).join(", ")
    return [
      `Usulan ini membuat ${names} tidak bisa dijangkau dari dalam rumah ` +
        `(penghuni harus keluar rumah untuk masuk ke sana). Setiap ruang wajib punya jalur ` +
        `masuk dari dalam — lewat pintu ke ruang tetangga atau koridor. Perbaiki dengan ` +
        `menambah pintu ke ruang yang sudah tersambung, atau membuat koridor penghubung; ` +
        `jangan mengandalkan pintu yang hanya membuka ke luar/halaman.`,
    ]
  } catch (e) {
    console.error("[connectivity-guard]", e)
    return []
  }
}
