/**
 * Menghasilkan pintu yang menyambungkan sebuah denah — dipakai generator
 * (mock/layout.ts) agar denah BARU tidak lahir cacat seperti seed lama.
 *
 * AKAR MASALAH yang ditutup: generator selama ini hanya menambah jendela
 * (`requiresVentilation`/`requiresNaturalLight`) — nol baris membuat pintu.
 * Ditemukan lewat audit 15 denah produksi: 53 ruang terputus, semuanya lahir
 * dari generator ini, bukan kebetulan data seed.
 *
 * Semua keputusan di sini SEGMEN-BASED (lib/geometry/opening-plan.ts):
 * satu dinding bisa punya beberapa tetangga, jadi pintu ditaruh di bentang
 * bersama tetangga yang DIMAKSUD dan diperiksa bebas-tabrakan terhadap bukaan
 * di KEDUA sisi dinding — pelajaran dari insiden produksi ketika pintu "ke
 * Dapur" jatuh di depan Ruang Makan dan menabrak pintu yang sudah ada.
 *
 * Aturan kepantasan (tervalidasi di perbaikan seed 34-fix-missing-doors.mjs):
 *   - Ruang privat (kamar_tidur/kamar_mandi/musholla) TIDAK boleh jadi jalur
 *     lintasan — kecuali kamar mandi en-suite dari kamar tidurnya sendiri.
 *   - Pintu ke dinding luar hanya sah di lantai dasar (lantai atas tanpa
 *     tetangga yang bisa disambung berarti butuh koridor, bukan tambalan).
 *   - void/kolam tak pernah jadi target pintu (bukan permukaan yang bisa dipijak).
 */
import type { Floor, Opening, Room } from "@/types"
import { parseOpeningWall, type Side } from "@/lib/geometry"
import { isOutdoorRoom } from "./connectivity"
import { doorSpecFor } from "./door-spec"
import {
  OPENING_EDGE_MARGIN_M,
  freeDoorPosition,
  neighborServedByOpening,
  sharedWallSpan,
  type OpeningRef,
} from "./opening-plan"

const SIDES: Side[] = ["n", "s", "w", "e"]
const CIRCULATION = new Set(["ruang_tamu", "ruang_keluarga", "ruang_makan", "koridor", "foyer", "teras"])
const SEMI = new Set(["dapur", "laundry", "gudang", "tangga", "area_jemur"])
const PRIVATE = new Set(["kamar_tidur", "kamar_mandi", "musholla", "kamar_art"])
const NOT_WALKABLE = new Set(["void", "kolam"])
/** Pintu tersempit di katalog (ruang basah/servis) — ambang kelayakan sebuah
 *  dinding: lebih pendek dari ini, sisi itu tak mungkin memuat pintu apa pun.
 *  Lebar sesungguhnya per pintu ditentukan doorSpecFor(). */
const MIN_DOOR_W = 0.7
const MARGIN = OPENING_EDGE_MARGIN_M

const edgeLen = (room: Room, side: Side) => (side === "n" || side === "s" ? room.width : room.depth)

/**
 * Skor kepantasan menembus `neighbor` sbg akses ke `target`. Sama dgn
 * `sourceScore` yang tervalidasi di 34-fix-missing-doors.mjs — lihat komentar
 * di sana utk riwayat tiga iterasi yang menyingkirkan penempatan salah
 * (tembus kamar orang, tembus void, pintu ke udara kosong di lantai atas).
 */
function scoreNeighbor(target: Room, neighbor: Room | null, isGroundFloor: boolean): number {
  if (!neighbor) return isGroundFloor ? 1 : -1
  if (NOT_WALKABLE.has(neighbor.type)) return -1
  if (PRIVATE.has(neighbor.type)) {
    return target.type === "kamar_mandi" && neighbor.type === "kamar_tidur" ? 4 : -1
  }
  if (CIRCULATION.has(neighbor.type)) return 4
  if (SEMI.has(neighbor.type)) return 3
  return 2 // ruang terbuka lain (taman/carport/balkon) — akses luar yang wajar
}

interface Candidate {
  side: Side
  neighbor: Room | null
  score: number
}

/** SEMUA pasangan (sisi, tetangga) — bukan cuma tetangga pertama per sisi. */
function candidatesFor(room: Room, others: Room[], isGroundFloor: boolean): Candidate[] {
  const out: Candidate[] = []
  for (const side of SIDES) {
    if (edgeLen(room, side) < MIN_DOOR_W + 2 * MARGIN) continue
    const neighborsHere = others.filter((r) => sharedWallSpan(room, side, r))
    if (neighborsHere.length === 0) {
      out.push({ side, neighbor: null, score: scoreNeighbor(room, null, isGroundFloor) })
    }
    for (const nb of neighborsHere) {
      out.push({ side, neighbor: nb, score: scoreNeighbor(room, nb, isGroundFloor) })
    }
  }
  return out.filter((c) => c.score >= 0).sort((a, b) => b.score - a.score)
}

/** Union-find minimal — cukup untuk melacak gugus yang tersambung selagi
 *  pintu ditambahkan satu per satu di dalam fungsi ini. */
class UnionFind {
  private parent = new Map<string, string>()
  find(x: string): string {
    let r = this.parent.get(x) ?? x
    while (this.parent.has(r) && this.parent.get(r) !== r) r = this.parent.get(r)!
    this.parent.set(x, r)
    return r
  }
  union(a: string, b: string) {
    const ra = this.find(a), rb = this.find(b)
    if (ra !== rb) this.parent.set(ra, rb)
  }
  connected(a: string, b: string): boolean {
    return this.find(a) === this.find(b)
  }
}

/** Opening domain → ref duck-typed utk opening-plan. */
function toRef(o: Opening): OpeningRef | null {
  const parsed = parseOpeningWall(o.wallId)
  if (!parsed) return null
  return {
    id: o.id, roomId: parsed.roomId, side: parsed.side,
    positionM: o.positionM, widthM: o.widthM, type: o.type,
  }
}

/**
 * Bangun pintu baru agar tiap lantai tersambung: satu akses masuk (lantai
 * dasar) + tiap ruang tersambung ke gugus utama tanpa menembus ruang privat
 * lain. TIDAK memaksakan sambungan yang salah secara arsitektur — ruang yang
 * tetangganya cuma ruang privat lain dibiarkan (sinyal butuh koridor, bukan
 * tambalan otomatis).
 */
export function generateConnectingDoors(
  rooms: Room[],
  existingOpenings: Opening[],
  floors: Pick<Floor, "id" | "level">[],
): Opening[] {
  const newDoors: Opening[] = []
  const lowestLevel = Math.min(...floors.map((f) => f.level))

  for (const floor of floors) {
    const floorRooms = rooms.filter((r) => r.floorId === floor.id)
    const indoor = floorRooms.filter((r) => !isOutdoorRoom(r))
    if (indoor.length === 0) continue
    const isGroundFloor = floor.level === lowestLevel

    const uf = new UnionFind()
    // Semua bukaan (sedia + baru) sbg refs — dasar cek tabrakan dua-sisi.
    const refs: OpeningRef[] = existingOpenings
      .map(toRef)
      .filter((r): r is OpeningRef => !!r)

    // Sambungkan gugus yang SUDAH ada lewat pintu sedia — tetangga ditentukan
    // dari SEGMEN pintu, bukan sisi dinding.
    for (const o of existingOpenings.filter((x) => x.type === "door")) {
      const parsed = parseOpeningWall(o.wallId)
      if (!parsed) continue
      const host = indoor.find((r) => r.id === parsed.roomId)
      if (!host) continue
      const nb = neighborServedByOpening(host, parsed.side, o.positionM, o.widthM, floorRooms)
      if (nb && indoor.some((r) => r.id === nb.id)) uf.union(host.id, nb.id)
    }

    const addDoor = (room: Room, side: Side, neighbor: Room | null, positionM: number) => {
      // Jenis & lebar dari tabel keputusan domain (door-spec), bukan 0,9 m
      // seragam: kamar mandi sempit dapat pintu geser 0,7 m, kamar tidur
      // 0,8 m, dapur↔ruang makan dibiarkan terbuka, dst.
      const spec = doorSpecFor(room.type, {
        areaM2: room.areaM2 ?? room.width * room.depth,
        neighborType: neighbor?.type,
        isMainEntrance: neighbor === null,
      })
      newDoors.push({
        id: `gen-door-${room.id}-${side}`,
        floorId: room.floorId,
        wallId: `${room.id}:${side}`,
        type: "door",
        kind: spec.kind,
        positionM,
        widthM: spec.widthM,
        heightM: spec.heightM,
      })
      refs.push({ roomId: room.id, side, positionM, widthM: spec.widthM, type: "door" })
      if (neighbor) uf.union(room.id, neighbor.id)
    }

    // 1) Akses masuk: lantai dasar butuh SATU pintu ke luar/ruang terbuka,
    //    diprioritaskan pada ruang sirkulasi.
    if (isGroundFloor) {
      const hasEntry = existingOpenings.some((o) => {
        if (o.type !== "door") return false
        const parsed = parseOpeningWall(o.wallId)
        if (!parsed) return false
        const host = indoor.find((r) => r.id === parsed.roomId)
        if (!host) return false
        // Segmen pintu tak melayani satu pun ruang dalam = pintu keluar.
        const nb = neighborServedByOpening(host, parsed.side, o.positionM, o.widthM, floorRooms)
        return !nb || !indoor.some((r) => r.id === nb.id)
      })
      if (!hasEntry) {
        const entryRoom = indoor.find((r) => CIRCULATION.has(r.type)) ?? indoor[0]
        const exterior = candidatesFor(entryRoom, floorRooms.filter((r) => r.id !== entryRoom.id), isGroundFloor)
          .find((c) => c.neighbor === null)
        if (exterior) {
          const spec = doorSpecFor(entryRoom.type, {
            areaM2: entryRoom.areaM2 ?? entryRoom.width * entryRoom.depth,
            isMainEntrance: true,
          })
          const p = freeDoorPosition(entryRoom, exterior.side, null, spec.widthM, refs, floorRooms)
          if (p != null) addDoor(entryRoom, exterior.side, null, p)
        }
      }
    }

    // 2) Sambungkan tiap ruang ke gugus utama lewat tetangga paling pantas,
    //    berulang — menyambung satu ruang bisa membuka jalan bagi ruang lain.
    let progress = true
    while (progress) {
      progress = false
      const anchor = indoor.find((r) => CIRCULATION.has(r.type)) ?? indoor[0]
      for (const room of indoor) {
        if (uf.connected(room.id, anchor.id)) continue
        const candidates = candidatesFor(room, floorRooms.filter((r) => r.id !== room.id), isGroundFloor)
        for (const cand of candidates) {
          if (!cand.neighbor || !uf.connected(cand.neighbor.id, anchor.id)) continue
          // Posisi di bentang bersama tetangga yang dimaksud, bebas tabrakan
          // dua sisi — bukan titik tengah dinding penuh. Lebar diambil dari
          // spesifikasi jenis pintunya, agar clearance dihitung untuk daun
          // yang benar-benar akan dipasang.
          const spec = doorSpecFor(room.type, {
            areaM2: room.areaM2 ?? room.width * room.depth,
            neighborType: cand.neighbor.type,
          })
          const p = freeDoorPosition(room, cand.side, cand.neighbor, spec.widthM, refs, floorRooms)
          if (p == null) continue
          addDoor(room, cand.side, cand.neighbor, p)
          progress = true
          break
        }
        if (progress) break
      }
    }
  }

  return newDoors
}
