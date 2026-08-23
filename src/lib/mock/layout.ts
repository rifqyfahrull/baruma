/**
 * Generates an editable floor-plan layout from a project + brief. The result is
 * a reasonable starting point the user rearranges in the 2D editor (PRD §16).
 */
import { nanoid } from "nanoid"
import { DEFAULT_FLOOR_TO_FLOOR_M } from "@/lib/geometry/vertical"

import type {
  Brief,
  DesignLayout,
  Floor,
  Opening,
  Project,
  Room,
  RoomType,
} from "@/types"
import { LIGHT_ROOM_TYPES, ROOM_TYPES, VENT_ROOM_TYPES } from "@/lib/constants"
import { openingWallId, round2, roomArea, squarifiedTreemap } from "@/lib/geometry"
import { generateConnectingDoors } from "@/lib/geometry/connect-rooms"
import { freeDoorPosition, sharedWallSpan } from "@/lib/geometry/opening-plan"
import { structuralNotes, validateLayout } from "@/lib/validation"

const GROUND_TYPES: RoomType[] = [
  "carport",
  "kolam",
  "taman",
  "ruang_tamu",
  "ruang_keluarga",
  "dapur",
  "ruang_makan",
  "area_kumpul",
  "gudang",
]

/** Sensible floor for a room when the brief did not pin one. */
function defaultFloor(type: RoomType, floorCount: number, seq: number, hasRooftop: boolean): number {
  // Rooftop rooms go to the rooftop floor (floorCount + 1 when rooftop exists)
  if (type === "rooftop_lounge") return hasRooftop ? floorCount + 1 : floorCount
  if (GROUND_TYPES.includes(type)) return 1
  if (floorCount <= 1) return 1
  return 2 + (seq % (floorCount - 1)) // bedrooms/baths/etc upstairs
}

function sizeFactor(size?: string): number {
  if (size === "small") return 0.8
  if (size === "large") return 1.3
  return 1
}

type Unit = {
  type: RoomType
  name: string
  size?: string
  vent: boolean
  light: boolean
  floor: number
}

function clampNum(v: number, min: number, max: number) {
  return Math.min(Math.max(v, min), max)
}

/** Ruang yang menjadikan sebuah lantai "bisa dilalui dari dalam". */
const CIRCULATION_TYPES = new Set(["ruang_tamu", "ruang_keluarga", "ruang_makan", "koridor", "foyer", "teras"])
const PRIVATE_TYPES = new Set(["kamar_tidur", "kamar_mandi", "musholla", "kamar_art"])

/**
 * Sisipkan unit KORIDOR bila sebuah lantai punya ruang privat TANPA ruang
 * sirkulasi. packFloor mengisi 100% footprint via treemap, jadi tanpa ini
 * ruang privat berjejer rapat dan mustahil terjangkau tanpa menembus kamar
 * orang — penyebab 15/16 denah produksi punya ruang terkurung.
 *
 * CATATAN 2026-08-02: sengaja TIDAK diaktifkan saat lantai SUDAH punya ruang
 * sirkulasi. Percobaan memaksa koridor di lantai dasar 12 ruang
 * (proj-modern-tropis-1) mengubah setiap ruang menjadi slice tipis
 * 10,44×1,4 m (carport tidak realistis) dan Ruang Tamu kehilangan pintu masuk
 * karena tidak menempel tepi lahan. Koridor strip+slice hanya layak untuk
 * lantai privat tanpa sirkulasi; lantai dasar padat butuh keputusan desain
 * (relokasi/pengecilan ruang), bukan otomasi penuh di sini.
 */
function ensureCorridor(units: Unit[], floor: number): Unit[] {
  const hasCirculation = units.some((u) => CIRCULATION_TYPES.has(u.type))
  if (hasCirculation) return units
  const privates = units.filter((u) => PRIVATE_TYPES.has(u.type))
  if (privates.length < 2) return units
  return [
    ...units,
    { type: "koridor", name: "Koridor", floor, vent: false, light: false, size: "small" },
  ]
}

/**
 * Sisipkan unit TANGGA di setiap lantai yang punya lantai di atasnya.
 *
 * AKAR MASALAH (ditemukan 2026-08-02 saat melatih agent pada brief nyata
 * proj-modern-tropis-1): `generateLayout` tidak pernah membuat tangga, dan
 * `spaceProgram` dari brief juga tak memuatnya — pemilik rumah menyebut kamar,
 * dapur, carport, bukan "tangga". Akibatnya SETIAP denah 2 lantai lahir tanpa
 * akses vertikal: 13 ruang, nol tangga, penghuni tak bisa naik.
 *
 * Kenapa lolos senyap: `analyzeRoomConnectivity` sengaja tidak melintasi lantai
 * (tangga di luar cakupan grafnya), jadi tiap lantai diperiksa terpisah dan
 * keduanya tampak sehat. Cacatnya baru terlihat bila ditanya "bagaimana
 * penghuni naik?".
 *
 * Tangga disisipkan sebagai UNIT (bukan ditempel setelah packing) supaya ia
 * mendapat petak sendiri dari treemap dan ikut disambungkan
 * `generateConnectingDoors` — ruang tangga tanpa pintu hanyalah ruang mati.
 * Lantai rooftop dihitung sebagai tujuan: dek terbuka pun harus bisa dicapai.
 */
function ensureStairs(units: Unit[], floor: number, topLevel: number): Unit[] {
  if (floor >= topLevel) return units // lantai teratas tak punya tujuan di atasnya
  if (units.some((u) => u.type === "tangga")) return units // brief sudah memintanya
  if (!units.length) return units // lantai kosong — tangga tanpa konteks
  return [...units, { type: "tangga", name: ROOM_TYPES.tangga.label, floor, vent: false, light: false }]
}

function packFloor(
  units: Unit[],
  site: { widthM: number; depthM: number },
  floorId: string
): Room[] {
  if (units.length === 0) return []
  const margin = 0.25
  const inset = 0.06 // gap between rooms so they read separately
  const x0 = margin
  const y0 = margin

  /**
   * SLACK — kelonggaran yang disisakan agar denah baru BISA DISUNTING.
   *
   * Treemap mengisi footprint 100%. Diukur pada brief nyata
   * proj-modern-tropis-1 (lahan 12×18 m): lantai 1 terisi 91,1%, tapi 19 m²
   * sisanya hanyalah margin tepi 0,25 m + celah antar-ruang 0,06 m — petak
   * 1×1 m pun tidak ada. Akibatnya SETIAP penyuntingan lanjutan yang butuh
   * ruang (tambah gudang, pindahkan laundry turun, geser kamar mandi) mentok:
   * `findFreeRect` menolak dengan benar, diserahkan ke LLM, dan LLM pun mentok
   * untuk denah sepadat ini — pengguna menerima 0 aksi.
   *
   * Menyisakan satu pita di sisi belakang membuat rumah baru punya ruang gerak
   * untuk diedit. Hanya diterapkan bila lahannya memang cukup (pita tidak boleh
   * memakan lebih dari seperlima kedalaman), dan tidak pada lantai berkoridor —
   * di sana slice sudah dijatah ketat demi lebar pintu.
   */
  const SLACK_M = 2.4
  const hasCorridorUnit = units.some((u) => u.type === "koridor")
  const slack =
    !hasCorridorUnit && site.depthM - 2 * margin - SLACK_M >= SLACK_M * 4 ? SLACK_M : 0

  const W = Math.max(2, site.widthM - 2 * margin)
  const H = Math.max(2, site.depthM - 2 * margin - slack)

  // Koridor dialokasikan sbg STRIP penuh-tinggi di sisi kiri. Sisa ruang
  // disusun sbg SLICE-SLICE vertikal sepanjang tinggi — bukan treemap 2D —
  // supaya TIAP ruang bersinggungan koridor di sisi baratnya. Treemap 2D
  // menempatkan kamar di timur kamar lain, memutus akses ke koridor (akar
  // kasus: Kamar tidur 2 di x4,03 tak tersentuh koridor x0,28–1,22).
  const corridorIdx = units.findIndex((u) => u.type === "koridor")
  if (corridorIdx >= 0) {
    const corridorW = 1.0
    const rooms: Room[] = []
    rooms.push({
      id: `room-${nanoid(6)}`, floorId, name: "Koridor", type: "koridor",
      x: round2(x0 + inset / 2), y: round2(y0 + inset / 2),
      width: round2(corridorW - inset), depth: round2(H - inset),
      areaM2: roomArea(corridorW - inset, H - inset),
      requiresVentilation: false, requiresNaturalLight: false,
    })
    const rest = units.filter((_, i) => i !== corridorIdx)
    const restW = Math.max(2, W - corridorW)
    // Slice sepanjang H proporsional terhadap luas tiap ruang — setiap slice
    // membentang penuh `restW` sehingga sisi baratnya selalu menempel koridor.
    // MIN sliceH menjamin pintu muat (pintu terlebar 1,2 m + margin 0,15 dua
    // sisi = 1,5 m); tanpa ini kamar mandi (bobot kecil) dapat slice 0,8 m
    // dan freeDoorPosition menolak pintu apa pun — kamar lahir terkurung.
    const MIN_SLICE_H = 1.5
    const weights = rest.map((u) => ROOM_TYPES[u.type].defaultAreaM2 * sizeFactor(u.size))
    const total = weights.reduce((a, b) => a + b, 0) || 1
    // Sisihkan ruang minimum tiap slice dulu, lalu bagi sisa proporsional.
    const reserved = rest.length * MIN_SLICE_H
    const proportional = Math.max(0, H - reserved)
    let cursor = y0
    rest.forEach((u, i) => {
      const sliceH = MIN_SLICE_H + (weights[i] / total) * proportional
      const r = { x: x0 + corridorW, y: cursor, width: restW, depth: sliceH }
      cursor += sliceH
      const d = Math.max(0.8, r.depth - inset)

      /**
       * BATAS LEBAR — ruang kecil tidak boleh dipaksa selebar rumah.
       *
       * Slice dibuat membentang penuh agar menempel koridor, tapi tanpa batas
       * atas luas, ruang berbobot kecil ikut tertarik: diukur pada brief nyata
       * proj-modern-tropis-1, kamar mandi lahir 10,44 × 2,15 m = 22 m² (rasio
       * 4,9) — itu lorong, bukan kamar mandi. Kamar tidur pun 37 m².
       *
       * Efeknya bukan cuma estetika: ruang selebar rumah mustahil dipindah ke
       * lantai lain (tak ada petak sebesar itu yang bersentuhan dinding),
       * sehingga penyuntingan lanjutan oleh agent langsung mentok.
       *
       * Lebar dipangkas ke yang dibutuhkan luas wajar tipe itu (dengan
       * kelonggaran), tapi TETAP mulai dari sisi koridor supaya aksesnya tak
       * berubah. Sisa di timur menjadi ruang kosong yang justru berguna:
       * kelonggaran untuk disunting. Batas rasio 3 menjaga bentuknya tetap
       * proporsional; MIN 2,0 m menjaga ruang tetap layak pakai.
       */
      const wajar = ROOM_TYPES[u.type].defaultAreaM2 * sizeFactor(u.size) * 1.6
      const byArea = wajar / d
      const byRatio = d * 3
      const maxW = Math.max(2.0, Math.min(byArea, byRatio))
      const w = Math.max(0.8, Math.min(r.width - inset, maxW))

      rooms.push({
        id: `room-${nanoid(6)}`, floorId, name: u.name, type: u.type,
        x: round2(r.x + inset / 2), y: round2(r.y + inset / 2),
        width: round2(w), depth: round2(d), areaM2: roomArea(w, d),
        requiresVentilation: u.vent, requiresNaturalLight: u.light,
      })
    })
    return rooms
  }

  // Tile the footprint proportional to each room's desired area.
  const weights = units.map(
    (u) => ROOM_TYPES[u.type].defaultAreaM2 * sizeFactor(u.size)
  )
  const rects = squarifiedTreemap(weights, x0, y0, W, H)

  return units.map((u, i) => {
    const r = rects[i] ?? { x: x0, y: y0, width: W, depth: H }
    const w = Math.max(0.8, r.width - inset)
    const d = Math.max(0.8, r.depth - inset)
    return {
      id: `room-${nanoid(6)}`,
      floorId,
      name: u.name,
      type: u.type,
      x: round2(r.x + inset / 2),
      y: round2(r.y + inset / 2),
      width: round2(w),
      depth: round2(d),
      areaM2: roomArea(w, d),
      requiresVentilation: u.vent,
      requiresNaturalLight: u.light,
    }
  })
}

export function generateLayout(project: Project, brief: Brief): DesignLayout {
  const site = project.site
  const floorCount = Math.max(1, project.floors)
  const hasRooftop = !!project.rooftop

  // Build regular floors
  const floors: Floor[] = Array.from({ length: floorCount }, (_, i) => ({
    id: `floor-${i + 1}`,
    level: i + 1,
    name: `Lantai ${i + 1}`,
    heightM: DEFAULT_FLOOR_TO_FLOOR_M,
  }))

  // Add rooftop floor when project has rooftop
  if (hasRooftop) {
    floors.push({
      id: "floor-rooftop",
      level: floorCount + 1,
      name: "Rooftop",
      heightM: 0.3, // thin slab — rooftop is an open deck
    })
  }

  const maxFloor = hasRooftop ? floorCount + 1 : floorCount

  // Expand the space program into individual room units, assigned to floors.
  const units: Unit[] = []
  let auto = 0
  for (const item of brief.spaceProgram) {
    const label = ROOM_TYPES[item.roomType].label
    for (let q = 0; q < item.quantity; q++) {
      const floor = clampNum(
        item.preferredFloor ?? defaultFloor(item.roomType, floorCount, auto++, hasRooftop),
        1,
        maxFloor
      )
      units.push({
        type: item.roomType,
        name: item.quantity > 1 ? `${label} ${q + 1}` : item.name || label,
        size: item.sizePreference,
        vent: VENT_ROOM_TYPES.includes(item.roomType),
        light: LIGHT_ROOM_TYPES.includes(item.roomType),
        floor,
      })
    }
  }

  const rooms: Room[] = []
  for (const floor of floors) {
    const floorUnits = units.filter((u) => u.floor === floor.level)
    // Tangga dulu (agar dapat petak dari treemap), baru koridor bila lantainya
    // ternyata hanya berisi ruang privat.
    const withStairs = ensureStairs(floorUnits, floor.level, maxFloor)
    rooms.push(...packFloor(ensureCorridor(withStairs, floor.level), site, floor.id))
  }

  // Auto-add a window to rooms that need light/ventilation — on an EXTERIOR
  // wall. Dulu selalu sisi "s" di tengah dinding, bahkan bila sisi itu
  // menghadap ruang lain (jendela ke dalam ruang tetangga — tidak memberi
  // cahaya, dan memblokir bentang pintu di dinding bersama). Kini tiap
  // penempatan memperhitungkan keadaan: cari sisi tanpa tetangga dgn bentang
  // bebas; fallback ke perilaku lama hanya bila benar-benar tak ada.
  const openings: Opening[] = []
  for (const room of rooms) {
    if (!room.requiresVentilation && !room.requiresNaturalLight) continue
    const floorRooms = rooms.filter((r) => r.floorId === room.floorId)
    const others = floorRooms.filter((r) => r.id !== room.id)
    const widthM = round2(Math.min(1.2, room.width * 0.5))
    const refs = openings.map((o) => {
      const [rid, side] = o.wallId.split(":")
      return { roomId: rid, side: side as "n" | "s" | "w" | "e", positionM: o.positionM, widthM: o.widthM, type: o.type }
    })
    let placed = false
    for (const side of ["s", "n", "e", "w"] as const) {
      if (others.some((r) => sharedWallSpan(room, side, r))) continue // bukan dinding luar
      const p = freeDoorPosition(room, side, null, widthM, refs, floorRooms)
      if (p == null) continue
      openings.push({
        id: `op-${nanoid(6)}`, floorId: room.floorId, wallId: openingWallId(room.id, side),
        type: "window", positionM: p, widthM, heightM: 1.2,
      })
      placed = true
      break
    }
    if (!placed) {
      openings.push({
        id: `op-${nanoid(6)}`, floorId: room.floorId, wallId: openingWallId(room.id, "s"),
        type: "window", positionM: round2(room.width / 2), widthM, heightM: 1.2,
      })
    }
  }

  // Auto-add doors so the generated house is actually walkable: one entrance
  // per ground floor + every enclosed room reachable without stepping
  // outside. Without this, generated layouts were born disconnected — every
  // room had a window but never a door (found auditing 15 production
  // layouts: 53 stranded rooms, all traced back to this generator, not to
  // one-off seed data). See lib/geometry/connect-rooms.ts for the placement
  // rules (private rooms never become a thru-path; upper-floor exterior
  // doors are refused rather than opening onto thin air).
  openings.push(...generateConnectingDoors(rooms, openings, floors))

  const layout: DesignLayout = {
    id: `layout-${project.id}`,
    projectId: project.id,
    versionId: project.currentVersionId ?? `ver-${project.id}`,
    floors,
    rooms,
    walls: [],
    openings,
    stairs: [],
    pools: [],
    validation: { passed: true, issues: [] },
  }
  layout.validation = validateLayout(layout, site, structuralNotes(project, layout))
  return layout
}
