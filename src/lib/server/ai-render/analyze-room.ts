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
  floorIndex: number // 0 = lantai dasar
  widthM: number
  depthM: number
  areaM2: number
  ceilingHeightM: number // WALL_H dibulatkan 1 desimal
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
 *  world→site: kandidat = rooms yang rect-nya memuat titik proyeksi;
 *  dipilih yang elevasi lantainya memuat pos[1] (tinggi mata). Tak ada
 *  kecocokan (baik id maupun pose) → undefined; tak pernah throw. */
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

  const candidates = layout.rooms.filter(
    (r) => siteX >= r.x && siteX <= r.x + r.width && siteY >= r.y && siteY <= r.y + r.depth
  )
  if (candidates.length === 0) return undefined

  const elev = floorElevations(layout.floors)
  for (const room of candidates) {
    const entry = elev.get(room.floorId)
    const baseY = entry?.baseY ?? 0
    // Band mencakup seluruh volume lantai (dinding + slab), memakai tinggi
    // floor-to-floor SPESIFIK lantai ini (floorElevations) — bukan konstanta
    // global WALL_H+SLAB_T, yang salah untuk lantai dgn heightM kustom.
    // Fallback ke konstanta global hanya bila entry tak dikenal.
    const floorToFloorM = entry?.floorToFloorM ?? WALL_H + SLAB_T
    if (py >= baseY && py < baseY + floorToFloorM) return room
  }
  return undefined
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

  if (close.length >= 2) {
    const ns = close.find((e) => e.ns)?.ns
    const ew = close.find((e) => e.ew)?.ew
    if (ns && ew) return `in the ${ns}-${ew} corner`
  }
  if (close.length === 1) {
    const side = close[0].ns ?? close[0].ew
    return `against the ${side} wall`
  }
  return "near the center"
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

  const roomRect: Rect = { x: room.x, y: room.y, width: room.width, depth: room.depth }
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
    widthM: round1(room.width),
    depthM: round1(room.depth),
    areaM2: round1(room.width * room.depth),
    ceilingHeightM: round1(WALL_H),
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
