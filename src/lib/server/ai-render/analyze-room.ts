/**
 * Analyzer deterministik ruang AI Render (Fase B — Interior per Ruang, Task
 * 1). PURE — tanpa I/O, tanpa Math.random/Date.now, tanpa import three.js.
 * Input sama → output byte-identik: mengubah pilihan ruang (id langsung
 * ATAU pose kamera dunia) + layout DB jadi `RoomFacts` yang dikonsumsi
 * prompt interior (Task 2) & polish LLM opsional (Task 2/3).
 *
 * Mengikuti konvensi dunia analyze.ts: world x = site.x − site.widthM/2,
 * world z = site.y − site.depthM/2 (siteToWorld); di sini kebutuhannya
 * kebalikannya (world → site) karena pose kamera dikirim dalam world coords
 * three.js sementara rect ruang disimpan dalam site coords.
 *
 * `floorElevations` (src/lib/geometry/vertical.ts) diverifikasi PURE — hanya
 * mengimpor `@/lib/editor/floors` yang hanya mengimpor `@/types` (tanpa
 * three.js) — jadi aman dipakai langsung di sini, termasuk konstanta
 * WALL_H/SLAB_T sebagai satu-satunya sumber kebenaran tinggi vertikal.
 */
import type {
  DesignLayout,
  MaterialAssignment,
  PlacedFurniture,
  Room,
  Site,
} from "@/types"
import { floorElevations, SLAB_T, WALL_H } from "@/lib/geometry/vertical"
import {
  isMezzanineFloor,
  isRegularFloor,
  mezzanineParentOf,
} from "@/lib/editor/floors"

import type { CameraPose, FacadeSideId } from "./analyze"

export interface FurnitureFact {
  name: string // PlacedFurniture.name
  category: string
  /** Posisi relatif kasar: "against the north wall" | "near the center" |
   *  "in the south-east corner" — deterministik dari x/y vs rect ruang. */
  placement: string
}

export interface RoomFacts {
  roomId: string
  roomName: string
  roomType: string
  floorIndex: number // 0 = lantai dasar (index STACKING dari floorElevations — kompat lama)
  /** Dari `Floor.kind`: "mezzanine" hanya utk ruang di lantai kind:"mezzanine";
   *  absen ATAU "rooftop" → "regular" (rooftop tak relevan sbg target render
   *  interior tapi tak boleh terlabel mezzanine bila suatu saat jadi target). */
  floorKind: "regular" | "mezzanine"
  widthM: number
  depthM: number
  areaM2: number
  /** round1(wallHM lantai ruang ini) — PER LANTAI (bukan lagi WALL_H global),
   *  benar utk mezzanine & lantai ber-heightM kustom. Bila `doubleHeight` →
   *  wallHM + floorToFloorM lantai void di atasnya (plafon menembus lantai
   *  berikutnya). */
  ceilingHeightM: number
  /** Ada ruang `type:"void"` di lantai reguler BERIKUTNYA (urutan stacking,
   *  bukan urutan array) yang overlap denahnya menutupi ≥50% luas ruang ini. */
  doubleHeight: boolean
  /** HANYA ruang di lantai kind:"mezzanine": nama ruang di lantai INDUK
   *  (lantai reguler tepat sebelumnya di array) dengan overlap denah TERBESAR
   *  (>0). Tak ada overlap → absen. */
  mezzanineOverlooking?: string
  /** `Room.levelOffsetM` diteruskan (round1) bila ≠0; 0/absen → absen. */
  levelOffsetM?: number
  style?: string // RoomInteriorPlan.style bila ada
  /** RoomInteriorPlan.colorPalette (nilai objek colors di-flatten jadi
   *  daftar string, urut key abjad). */
  colorPalette?: string[]
  materials: Array<{ surface: string; name: string }> // urut surface abjad
  furniture: FurnitureFact[] // urut nama abjad
  windowSides: FacadeSideId[] // sisi ruang yang punya jendela (urut ring s,e,n,w)
  doorCount: number
  hasCurtains: boolean // ada opening window dgn curtainModelUrl terisi
  skylightCount: number // skylight layout yang rect-nya overlap rect ruang
  lighting: { fixtureCount: number; warmCount: number } // dari RoomInteriorPlan.lighting (qty dijumlah)
}

const round1 = (v: number): number => Math.round(v * 10) / 10

/** Ring azimuth sisi fasad, sama seperti analyze.ts — urutan dipakai untuk
 *  windowSides deterministik & pemilihan tepi terdekat pada corner. */
const RING_ORDER: FacadeSideId[] = ["s", "e", "n", "w"]

/** `${roomId}:${side}` → [roomId, side]. Toleran wallId tanpa ":" (roomId
 *  saja) — duplikat kecil dari analyze.ts (tak diekspor di sana, dan Task 1
 *  hanya boleh menyentuh analyze-room.ts). */
function splitWallId(wallId: string): [string, string] {
  const idx = wallId.lastIndexOf(":")
  if (idx === -1) return [wallId, ""]
  return [wallId.slice(0, idx), wallId.slice(idx + 1)]
}

type Rect = { x: number; y: number; width: number; depth: number }

/** Cari ruang berdasarkan id langsung, atau — bila absen — dari pose kamera
 *  world→site (resolver v2, "platform tertinggi di bawah mata menang"):
 *  kandidat = rooms yang rect-nya (denah) memuat titik proyeksi DAN band
 *  vertikal EFEKTIFnya memuat pos[1] (tinggi mata). Band efektif per ruang:
 *  `base = elev(floorId).baseY + (levelOffsetM ?? 0)`, `top = base +
 *  floorToFloorM` — ini membedakan mezzanine (baseY lebih tinggi, band-nya
 *  DI DALAM floor-to-floor lantai induk → tumpang-tindih) & ruang split-level
 *  (levelOffsetM menggeser bandnya) dari lantai induknya. Pemenang = `base`
 *  TERTINGGI di antara kandidat yg bandnya memuat y (fisik-intuitif: berdiri
 *  di platform tertinggi tepat di bawah kaki); seri → urutan array
 *  (deterministik, kandidat lebih awal menang krn hanya diganti bila STRICT
 *  lebih tinggi). Tak ada kandidat (baik id maupun pose) → undefined; tak
 *  pernah throw. */
function resolveRoom(
  layout: DesignLayout,
  site: Site,
  sel: { roomId?: string; pose?: CameraPose }
): Room | undefined {
  if (sel.roomId) {
    return layout.rooms.find((r) => r.id === sel.roomId)
  }
  if (!sel.pose) return undefined

  const [px, py, pz] = sel.pose.position
  const siteX = px + site.widthM / 2
  const siteY = pz + site.depthM / 2

  const elev = floorElevations(layout.floors)

  let winner: Room | undefined
  let winnerBase = -Infinity
  for (const room of layout.rooms) {
    const inPlan =
      siteX >= room.x && siteX <= room.x + room.width && siteY >= room.y && siteY <= room.y + room.depth
    if (!inPlan) continue

    const entry = elev.get(room.floorId)
    // Tinggi floor-to-floor SPESIFIK lantai ini (floorElevations) — bukan
    // konstanta global WALL_H+SLAB_T, yang salah untuk lantai dgn heightM
    // kustom. Fallback ke konstanta global hanya bila entry tak dikenal.
    const floorToFloorM = entry?.floorToFloorM ?? WALL_H + SLAB_T
    const base = (entry?.baseY ?? 0) + (room.levelOffsetM ?? 0)
    const top = base + floorToFloorM
    if (py < base || py >= top) continue

    if (base > winnerBase) {
      winner = room
      winnerBase = base
    }
  }
  return winner
}

/** Luas overlap dua rect denah (m²); tak overlap (lebar/dalam ≤0) → 0. */
function overlapAreaM2(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const d = Math.min(a.y + a.depth, b.y + b.depth) - Math.max(a.y, b.y)
  return w > 0 && d > 0 ? w * d : 0
}

/** Flatten objek warna preset (mis. InteriorStylePreset["colors"]) jadi
 *  daftar nilai, urut KEY abjad — deterministik & agnostik terhadap urutan
 *  properti di sumbernya. */
function flattenColorPalette(colors: Record<string, string>): string[] {
  return Object.keys(colors)
    .sort((a, b) => a.localeCompare(b))
    .map((k) => colors[k])
}

/** Posisi relatif furnitur vs rect ruang: gap dari tepi bounding-box item
 *  (bukan pusatnya) ke tepi ruang yang sesuai. ≤0.7 m ke SATU tepi →
 *  "against the {side} wall"; ≤0.7 m ke DUA tepi (satu N/S + satu E/W) →
 *  "in the {ns}-{ew} corner"; selainnya → "near the center". Kompas denah:
 *  y-min ruang = utara (top kanvas 2D), konsisten dengan analyze.ts. */
function placementOf(item: PlacedFurniture, room: Room): string {
  const THRESH = 0.7
  const distNorth = item.y - room.y
  const distSouth = room.y + room.depth - (item.y + item.depthM)
  const distWest = item.x - room.x
  const distEast = room.x + room.width - (item.x + item.widthM)

  const edges: Array<{ ns?: "north" | "south"; ew?: "east" | "west"; dist: number }> = [
    { ns: "north", dist: distNorth },
    { ns: "south", dist: distSouth },
    { ew: "east", dist: distEast },
    { ew: "west", dist: distWest },
  ]
  const close = edges.filter((e) => e.dist <= THRESH)
  if (close.length === 0) return "near the center"

  // Corner: ada tepi dekat di KEDUA sumbu → pakai yang TERDEKAT per sumbu
  // (bukan urutan array — item dekat selatan+utara+barat harus "south-west",
  // bukan "north-west" hanya karena north lebih dulu di daftar).
  const nearest = (list: typeof close) =>
    list.reduce((a, b) => (b.dist < a.dist ? b : a))
  const nsClose = close.filter((e) => e.ns)
  const ewClose = close.filter((e) => e.ew)
  if (nsClose.length > 0 && ewClose.length > 0) {
    return `in the ${nearest(nsClose).ns}-${nearest(ewClose).ew} corner`
  }
  // Satu sumbu saja (termasuk koridor sempit: dua tepi BERLAWANAN sama-sama
  // ≤ THRESH) → tepi terdekat menang, bukan "near the center".
  const win = nearest(close)
  return `against the ${win.ns ?? win.ew} wall`
}

/**
 * Analyzer deterministik: pilihan ruang (id atau pose kamera) + layout →
 * RoomFacts. Pure, tak pernah throw — resolusi ruang gagal (id tak
 * ditemukan, pose di luar semua ruang, atau sel kosong) → null.
 */
export function analyzeRoom(
  layout: DesignLayout,
  site: Site,
  sel: { roomId?: string; pose?: CameraPose }
): RoomFacts | null {
  const room = resolveRoom(layout, site, sel)
  if (!room) return null

  const elev = floorElevations(layout.floors)
  const floorIndex = elev.get(room.floorId)?.index ?? 0
  const roomRect: Rect = { x: room.x, y: room.y, width: room.width, depth: room.depth }

  const floor = layout.floors.find((f) => f.id === room.floorId)
  const floorKind: "regular" | "mezzanine" = floor && isMezzanineFloor(floor) ? "mezzanine" : "regular"

  // mezzanineOverlooking: HANYA ruang di lantai mezzanine — ruang di lantai
  // INDUK (mezzanineParentOf: lantai reguler tepat sebelumnya di array) dgn
  // overlap denah TERBESAR (>0). Tak ada overlap/induk → absen.
  let mezzanineOverlooking: string | undefined
  if (floorKind === "mezzanine") {
    const parent = mezzanineParentOf(layout.floors, room.floorId)
    if (parent) {
      let bestArea = 0
      for (const other of layout.rooms) {
        if (other.floorId !== parent.id) continue
        const area = overlapAreaM2(roomRect, {
          x: other.x,
          y: other.y,
          width: other.width,
          depth: other.depth,
        })
        if (area > bestArea) {
          bestArea = area
          mezzanineOverlooking = other.name
        }
      }
    }
  }

  // doubleHeight: ruang type:"void" di lantai reguler BERIKUTNYA (urutan
  // STACKING via floorElevations index — bukan urutan array, konsisten dgn
  // konvensi mezzanine yg berbagi index induknya) yg overlap denahnya
  // menutupi ≥50% luas ruang ini.
  const currentStackIndex = elev.get(room.floorId)?.index ?? 0
  const nextRegularFloor = layout.floors.find(
    (f) => isRegularFloor(f) && (elev.get(f.id)?.index ?? -1) === currentStackIndex + 1
  )
  const roomAreaM2Raw = room.width * room.depth
  let doubleHeight = false
  if (nextRegularFloor) {
    for (const other of layout.rooms) {
      if (other.floorId !== nextRegularFloor.id || other.type !== "void") continue
      const area = overlapAreaM2(roomRect, {
        x: other.x,
        y: other.y,
        width: other.width,
        depth: other.depth,
      })
      if (area >= roomAreaM2Raw * 0.5) {
        doubleHeight = true
        break
      }
    }
  }

  // Lantai rooftop punya wallHM 0 (bukan undefined — vertical.ts:118), jadi
  // `??` saja tidak cukup: ruang terbuka rooftop_lounge akan dapat "0 meter
  // ceiling" di prompt (temuan I1 final review MEZZ). ≤0 → fallback WALL_H.
  const rawWallHM = elev.get(room.floorId)?.wallHM
  const baseWallHM = rawWallHM !== undefined && rawWallHM > 0 ? rawWallHM : WALL_H
  const ceilingHeightM =
    doubleHeight && nextRegularFloor
      ? round1(baseWallHM + (elev.get(nextRegularFloor.id)?.floorToFloorM ?? 0))
      : round1(baseWallHM)

  const levelOffsetM =
    room.levelOffsetM !== undefined && room.levelOffsetM !== 0 ? round1(room.levelOffsetM) : undefined

  const plan = layout.interiors?.find((p) => p.roomId === room.id)

  const materials: Array<{ surface: string; name: string }> = (plan?.materials ?? [])
    .map((m: MaterialAssignment) => ({ surface: m.surface, name: m.name }))
    .sort((a, b) => a.surface.localeCompare(b.surface))

  const furniture: FurnitureFact[] = (plan?.furniture ?? [])
    .map((f) => ({ name: f.name, category: f.category, placement: placementOf(f, room) }))
    .sort((a, b) => a.name.localeCompare(b.name))

  const windowSidesSet = new Set<FacadeSideId>()
  let doorCount = 0
  let hasCurtains = false
  for (const o of layout.openings) {
    const [roomId, side] = splitWallId(o.wallId)
    if (roomId !== room.id) continue
    if (o.type === "window") {
      if ((RING_ORDER as string[]).includes(side)) windowSidesSet.add(side as FacadeSideId)
      if (o.curtainModelUrl) hasCurtains = true
    } else if (o.type === "door") {
      doorCount++
    }
  }
  const windowSides = RING_ORDER.filter((s) => windowSidesSet.has(s))

  const skylightCount = (layout.skylights ?? []).filter((sk) =>
    rectOverlapsRoom({ x: sk.x, y: sk.y, width: sk.widthM, depth: sk.depthM }, roomRect)
  ).length

  const lighting = (plan?.lighting ?? []).reduce(
    (acc, l) => {
      acc.fixtureCount += l.qty
      if (l.colorTemperature === "warm") acc.warmCount += l.qty
      return acc
    },
    { fixtureCount: 0, warmCount: 0 }
  )

  return {
    roomId: room.id,
    roomName: room.name,
    roomType: room.type,
    floorIndex,
    floorKind,
    widthM: round1(room.width),
    depthM: round1(room.depth),
    areaM2: round1(room.width * room.depth),
    ceilingHeightM,
    doubleHeight,
    mezzanineOverlooking,
    levelOffsetM,
    style: plan?.style,
    colorPalette: plan?.colorPalette ? flattenColorPalette(plan.colorPalette) : undefined,
    materials,
    furniture,
    windowSides,
    doorCount,
    hasCurtains,
    skylightCount,
    lighting,
  }
}

function rectOverlapsRoom(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.depth && a.y + a.depth > b.y
}
