/**
 * DARI MENEGUR MENJADI MENYELESAIKAN.
 *
 * `connectivity-guard` hanya bisa berkata "ruang X terputus". Agent lalu
 * menebak perbaikannya sendiri — dan tebakan itulah yang selama ini melahirkan
 * pintu asal-asalan (riwayat nyata: diminta memperbaiki pintu kamar mandi,
 * agent malah menggesernya MENDEKAT ke sudut).
 *
 * Padahal `generateConnectingDoors` sudah tahu cara menyambungkan denah dengan
 * benar, dan aturannya tervalidasi di produksi:
 *   - ruang privat (kamar tidur/mandi/musholla) TIDAK boleh jadi jalur
 *     lintasan, kecuali kamar mandi en-suite dari kamar tidurnya sendiri;
 *   - pintu ke dinding luar hanya sah di lantai dasar;
 *   - void/kolam tak pernah jadi target pintu;
 *   - posisi selalu di bentang bersama tetangga & bebas tabrakan dua sisi.
 *
 * Modul ini menjembatani keduanya, mengikuti pola `reconcileFloorplanOverlaps`
 * yang sudah dipakai untuk ruang bertumpuk: hitung patch perbaikan secara
 * DETERMINISTIK, gabungkan ke usulan agent, lalu validasi ulang dengan jujur.
 *
 * Prinsip yang sama dengan biaya/luas Baruma: hal yang bisa dihitung jangan
 * diserahkan ke LLM. Agent memilih NIAT arsitektural; kode yang menyusun
 * jalur kakinya.
 */
import { generateConnectingDoors } from "@/lib/geometry/connect-rooms"
import { planCorridorFor } from "@/lib/geometry/corridor-plan"
import { doorSpecFor } from "@/lib/geometry/door-spec"
import { analyzeRoomConnectivity } from "@/lib/geometry/connectivity"
import { parseOpeningWall, type Side } from "@/lib/geometry"
import { findConnectivityRegressions } from "./connectivity-guard"
import { simulateFloorplanActions } from "./editor-assistant"
import type { FloorplanAction, FloorplanScene } from "@/lib/assistant/actions"
import type { Floor, Opening, Room } from "@/types"

/** Ruang yang sah menjadi titik tolak jalur kaki. */
const CIRCULATION = new Set(["ruang_tamu", "ruang_keluarga", "ruang_makan", "koridor", "foyer", "teras"])
/** Toleransi sentuh antar-ruang (tebal dinding pada denah produksi). */
const TOUCH_TOL = 0.15

type Rect = { x: number; y: number; width: number; depth: number }

/** Sisi `host` yang menghadap `target`, atau null bila tak berimpit. */
function sideFacing(host: Rect, target: Rect): Side | null {
  if (Math.abs(target.x + target.width - host.x) <= TOUCH_TOL) return "w"
  if (Math.abs(host.x + host.width - target.x) <= TOUCH_TOL) return "e"
  if (Math.abs(target.y + target.depth - host.y) <= TOUCH_TOL) return "n"
  if (Math.abs(host.y + host.depth - target.y) <= TOUCH_TOL) return "s"
  return null
}

/** Titik tengah bentang bersama, dalam koordinat dinding `host`. */
function sharedCenter(host: Rect, target: Rect, side: Side): number | null {
  const horizontal = side === "n" || side === "s"
  const lo = horizontal ? Math.max(host.x, target.x) : Math.max(host.y, target.y)
  const hi = horizontal
    ? Math.min(host.x + host.width, target.x + target.width)
    : Math.min(host.y + host.depth, target.y + target.depth)
  if (hi - lo < 0.6) return null
  const origin = horizontal ? host.x : host.y
  return Math.round(((lo + hi) / 2 - origin) * 100) / 100
}

export interface ConnectivityRepair {
  /** Aksi asli + pintu perbaikan (aksi asli selalu di depan, tak diubah). */
  actions: FloorplanAction[]
  /** Ruang yang TETAP tak tersambung — jujur, bukan diklaim beres. */
  remainingIssues: string[]
}

/** Bukaan scene (roomId+side) → Opening domain (wallId gabungan). */
function toDomainOpenings(
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

/** Simulasi daftar bukaan setelah aksi — cukup untuk menilai konektivitas. */
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
    if (a.type === "deleteOpening") list = list.filter((o) => o.id !== a.openingId)
    else if (a.type === "deleteRoom") list = list.filter((o) => o.roomId !== a.roomId)
    else if (a.type === "addOpening") {
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
    }
  }
  return list
}

/**
 * Lengkapi usulan agent dengan pintu yang membuat setiap ruang terjangkau dari
 * dalam rumah. Aksi asli tidak diubah — hanya ditambahi.
 *
 * Pintu perbaikan dihitung terhadap denah HASIL simulasi, sehingga ruang yang
 * baru dibuat agent ikut disambungkan.
 */
export function repairConnectivity(scene: FloorplanScene, actions: FloorplanAction[]): ConnectivityRepair {
  try {
    const rooms = simulateFloorplanActions(actions, scene) as unknown as Room[]
    const floorOf = new Map(rooms.map((r) => [r.id, r.floorId]))
    const openings = toDomainOpenings(simulateOpenings(actions, scene) as never, floorOf)
    const floors = scene.floors as unknown as Array<Pick<Floor, "id" | "level">>

    // Solver yang sudah tervalidasi produksi: memilih tetangga yang PANTAS,
    // menaruh pintu di bentang bersama, bebas tabrakan dua sisi. Bila denah
    // sudah tersambung ia mengembalikan array kosong — jadi tak perlu cek
    // terpisah "apakah ada yang rusak".
    const newDoors = generateConnectingDoors(rooms, openings, floors)

    const roomIds = new Set(scene.rooms.map((r) => r.id))
    const repairActions: FloorplanAction[] = []
    for (const door of newDoors) {
      const parsed = parseOpeningWall(door.wallId)
      if (!parsed) continue
      // Ruang sintetis dari simulasi (mis. `new-2`) belum ada di scene nyata;
      // sanitizeActions akan membuangnya, jadi jangan diusulkan.
      if (!roomIds.has(parsed.roomId)) continue
      repairActions.push({
        type: "addOpening",
        roomId: parsed.roomId,
        side: parsed.side,
        positionM: door.positionM,
        openingType: "door",
        ...(door.kind ? { kind: door.kind } : {}),
      } as FloorplanAction)
    }

    const merged = [...actions, ...repairActions]
    // Pintu saja belum tentu cukup: ruang yang tetangganya hanya ruang privat
    // lain memang butuh KORIDOR. Sekarang agent bisa mengusulkannya — `koridor`
    // akhirnya terdaftar di RoomType.
    const withCorridors = [...merged, ...planCorridors(scene, merged)]

    // Validasi ulang secara jujur: bila masih ada yang terputus, laporkan.
    const remainingIssues = findConnectivityRegressions(scene, withCorridors)
    const stillIsolated = describeStillIsolated(scene, withCorridors)
    const changed = withCorridors.length > actions.length

    return {
      actions: changed ? withCorridors : actions,
      remainingIssues: remainingIssues.length ? remainingIssues : stillIsolated,
    }
  } catch (e) {
    console.error("[connectivity-repair]", e)
    return { actions, remainingIssues: [] }
  }
}

/**
 * Usulkan petak KORIDOR + pintu penghubungnya untuk ruang yang tetap terkurung.
 *
 * Kenapa pintunya dipasang pada ruang yang SUDAH ADA (bukan pada koridornya):
 * `sanitizeFloorplan` membuang aksi yang menyebut roomId belum-ada, dan id
 * koridor baru belum terbit saat usulan disusun. Memasang pintu di dinding
 * ruang terkurung yang menghadap petak koridor memberi hasil yang sama —
 * `neighborServedByOpening` akan mengenali koridor itu sebagai tetangga begitu
 * petaknya terpasang.
 *
 * Satu koridor per lantai per putaran: cukup untuk memutus kebuntuan, dan
 * menahan diri dari merombak denah lebih jauh daripada yang diminta.
 */
function planCorridors(scene: FloorplanScene, actions: FloorplanAction[]): FloorplanAction[] {
  const rooms = simulateFloorplanActions(actions, scene) as unknown as Room[]
  const floorOf = new Map(rooms.map((r) => [r.id, r.floorId]))
  const openings = toDomainOpenings(simulateOpenings(actions, scene) as never, floorOf)
  const { isolated } = analyzeRoomConnectivity(rooms, openings)

  const doorHosts = new Set(
    openings.filter((o) => o.type === "door").map((o) => parseOpeningWall(o.wallId)?.roomId)
  )
  // Terkurung = tak sekomponen dengan gugus utama, ATAU tak punya pintu apa pun.
  const stranded = rooms.filter(
    (r) =>
      !isOutdoorish(r.type) &&
      (isolated.some((i) => i.id === r.id) || !doorHosts.has(r.id))
  )
  if (!stranded.length) return []

  const realRoomIds = new Set(scene.rooms.map((r) => r.id))
  // Denah produksi tidak menyimpan `site` (0 dari 16 payload) — biarkan
  // planCorridorFor menurunkan batas dari bounding box ruang.
  const site = scene.site as { widthM: number; depthM: number } | undefined
  const usableSite = site && site.widthM > 0 && site.depthM > 0 ? site : undefined
  const out: FloorplanAction[] = []

  for (const floorId of new Set(stranded.map((r) => r.floorId))) {
    const floorRooms = rooms.filter((r) => r.floorId === floorId)
    const plan = planCorridorFor({
      floorId,
      rooms: floorRooms as never,
      isolatedIds: stranded.filter((r) => r.floorId === floorId).map((r) => r.id),
      circulationIds: floorRooms.filter((r) => CIRCULATION.has(r.type)).map((r) => r.id),
      ...(usableSite ? { site: usableSite } : {}),
    })
    if (!plan) continue

    out.push({
      type: "addRoom",
      roomType: "koridor",
      floorId,
      x: plan.room.x,
      y: plan.room.y,
      width: plan.room.width,
      depth: plan.room.depth,
    } as FloorplanAction)

    // Pintu dari tiap ruang yang dilayani ke petak koridor, plus satu pintu
    // dari area sirkulasi agar koridornya sendiri terjangkau.
    const anchors = [
      ...plan.servesIds,
      ...floorRooms.filter((r) => CIRCULATION.has(r.type)).map((r) => r.id),
    ]
    for (const id of new Set(anchors)) {
      if (!realRoomIds.has(id)) continue
      const host = floorRooms.find((r) => r.id === id)
      if (!host) continue
      const side = sideFacing(host, plan.room)
      if (!side) continue
      const positionM = sharedCenter(host, plan.room, side)
      if (positionM == null) continue
      const spec = doorSpecFor(host.type, {
        areaM2: host.areaM2 ?? host.width * host.depth,
        neighborType: "koridor",
      })
      out.push({
        type: "addOpening",
        roomId: id,
        side,
        positionM,
        openingType: "door",
        kind: spec.kind,
      } as FloorplanAction)
    }
  }
  return out
}

/**
 * Ruang yang tetap terkurung setelah perbaikan — biasanya karena tetangganya
 * hanya ruang privat lain, yang berarti denah butuh KORIDOR, bukan tambalan
 * pintu. Dilaporkan apa adanya agar agent/user tahu keputusan desain apa yang
 * masih tersisa.
 */
function describeStillIsolated(scene: FloorplanScene, actions: FloorplanAction[]): string[] {
  const rooms = simulateFloorplanActions(actions, scene) as unknown as Room[]
  const floorOf = new Map(rooms.map((r) => [r.id, r.floorId]))
  const openings = toDomainOpenings(simulateOpenings(actions, scene) as never, floorOf)
  const hosts = new Set(
    openings.filter((o) => o.type === "door").map((o) => parseOpeningWall(o.wallId)?.roomId)
  )
  const orphans = rooms.filter((r) => !hosts.has(r.id) && !isOutdoorish(r.type))
  if (!orphans.length) return []
  const names = orphans.map((r) => r.name || r.type).join(", ")
  return [
    `${names} tetap tidak bisa dijangkau dari dalam rumah setelah penambahan pintu otomatis — ` +
      `tetangganya hanya ruang privat atau tidak berbatasan dinding dengan ruang mana pun. ` +
      `Denah ini butuh KORIDOR penghubung, bukan tambalan pintu: usulkan koridor ` +
      `(lebar 0,9–1,2 m) yang menghubungkan area depan ke ruang tersebut.`,
  ]
}

const OUTDOORISH = new Set(["carport", "taman", "teras", "balkon", "void", "kolam", "area_jemur", "rooftop"])
const isOutdoorish = (t: string) => OUTDOORISH.has(t)
