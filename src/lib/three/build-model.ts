/**
 * Builds 3D primitives from a DesignLayout (PRD §17.1). Pure data — no three.js
 * imports — so it stays cheap and testable. The R3F scene renders these as boxes.
 */
import type { DesignLayout, ExteriorElement, FacadeElement, Opening, Project, RailingStyle, Room, RoomType, RoofMaterial } from "@/types"
import { clamp, openingSegment, parseOpeningWall, rectsOverlap, roomsAdjacentOnSide, round2 } from "@/lib/geometry"
import { effectiveRoof } from "@/lib/geometry/roof"
import { effectiveRoofZones, hasExplicitRoofZones } from "@/lib/exterior/roof-zones"
import { roomZones, sharesZone } from "@/lib/editor/zones"
import { buildingFootprint } from "@/lib/structural/grid"
import {
  clampRooftopArea,
  expandStripForOverhang,
  isPartialRooftop,
  rooftopStrips,
} from "@/lib/geometry/rooftop"
import { POOL_FINISHES, effectivePoolDepth, effectivePoolDepthRange, effectivePoolFinish } from "@/lib/three/pool"
import { subtractRectHoles } from "@/lib/geometry/slab"
import {
  clampCourtyardRect,
  courtyardRect,
  flatRoofHosts,
  roofHoleRectsFor,
  skylightsOnHost,
} from "@/lib/geometry/roof-holes"
import { bandCovering, facadeBandsForWall, wallCutYs, type WallBand } from "@/lib/three/facade-bands"
import { levelConnectors } from "@/lib/geometry/level-connectors"
import { floorOffset, isMezzanineFloor, regularFloorsOf, topRegularFloorId } from "@/lib/editor/floors"
import { exteriorElementPrimitives } from "@/lib/three/exterior-primitives"
import { interiorStairLayout, interiorStairSpec } from "@/lib/stairs/geometry"
import {
  patternBarOffsets,
  resolveBarDepthM,
  resolveBarWidthM,
  resolveOrientation,
  resolvePitchM,
  wantsFrame,
  wantsInset,
} from "@/lib/three/component-pattern"
import { bowFloorStrips, bowRailSegments } from "@/lib/geometry/balcony-bow"

// WALL_H/SLAB_T kini didefinisikan di geometry/vertical (tabel elevasi —
// Fase D); di-re-export dari sini agar 14 pengimpor lama tak berubah.
import { WALL_H, SLAB_T, floorElevations, stairPenetratesSlabAbove, stairRiseM } from "@/lib/geometry/vertical"
export { WALL_H, SLAB_T }
export const WALL_T = 0.12
export const EXPLODE_GAP = 2.6

/** Sentinel `roomId` for the rooftop deck's railing prims — the deck isn't a
 *  Room (it can be full with zero rooms on floor-rooftop), so it needs its own
 *  stable, non-colliding identity for click-to-select (house-model.tsx) and
 *  the RailingQuickEditor (preview-controls.tsx) to key off of. Never equals a
 *  real Room id (those are `room-${nanoid(8)}`). */
export const ROOFTOP_RAIL_ID = "rooftop-deck-railing"
// Identitas sintetis dinding w-edge — didefinisikan di entity-ref (satu arah
// dependensi types ← lib), di-re-export utk kompat pemakai lama build-model.
import { edgeWallRoomId, isEdgeWallRoomId } from "@/types/entity-ref"
export { edgeWallRoomId, isEdgeWallRoomId }
import {
  edgeWallSideGeometry,
  widestEdgeWallSpan,
  EDGE_MIN_SPAN,
  type EdgeWallSideGeometry,
} from "@/lib/geometry/edge-wall"

const ROOF_ZONE_EDGE_EPS = 1e-4

type RoofZoneRenderInput = {
  id: string
  x: number
  y: number
  widthM: number
  depthM: number
  overhangM: number
  overhangSides?: Partial<Record<"n" | "s" | "w" | "e", number>>
}

type RoofZoneRenderRect = {
  x: number
  y: number
  widthM: number
  depthM: number
}

function roofZoneCoreRect(zone: RoofZoneRenderInput) {
  return {
    minX: zone.x - zone.widthM / 2,
    maxX: zone.x + zone.widthM / 2,
    minY: zone.y - zone.depthM / 2,
    maxY: zone.y + zone.depthM / 2,
  }
}

function spansTouch(a: number, b: number): boolean {
  return Math.abs(a - b) <= ROOF_ZONE_EDGE_EPS
}

function spansOverlap(a0: number, a1: number, b0: number, b1: number): boolean {
  return Math.min(a1, b1) - Math.max(a0, b0) > ROOF_ZONE_EDGE_EPS
}

function roofZoneRenderRect(zone: RoofZoneRenderInput, zones: readonly RoofZoneRenderInput[]): RoofZoneRenderRect {
  const core = roofZoneCoreRect(zone)
  // Override per sisi (cincin courtyard: sisi menghadap lubang = 0) — sisi
  // tanpa override tetap overhangM, dan tetap bisa dinolkan aturan seam.
  let west = zone.overhangSides?.w ?? zone.overhangM
  let east = zone.overhangSides?.e ?? zone.overhangM
  let north = zone.overhangSides?.n ?? zone.overhangM
  let south = zone.overhangSides?.s ?? zone.overhangM

  for (const other of zones) {
    if (other.id === zone.id) continue
    const otherCore = roofZoneCoreRect(other)
    const overlapsY = spansOverlap(core.minY, core.maxY, otherCore.minY, otherCore.maxY)
    const overlapsX = spansOverlap(core.minX, core.maxX, otherCore.minX, otherCore.maxX)

    if (overlapsY && spansTouch(otherCore.maxX, core.minX)) west = 0
    if (overlapsY && spansTouch(otherCore.minX, core.maxX)) east = 0
    if (overlapsX && spansTouch(otherCore.maxY, core.minY)) north = 0
    if (overlapsX && spansTouch(otherCore.minY, core.maxY)) south = 0
  }

  const minX = core.minX - west
  const maxX = core.maxX + east
  const minY = core.minY - north
  const maxY = core.maxY + south

  return {
    x: round2((minX + maxX) / 2),
    y: round2((minY + maxY) / 2),
    widthM: round2(Math.max(0.1, maxX - minX)),
    depthM: round2(Math.max(0.1, maxY - minY)),
  }
}

export type PrimKind =
  | "slab"
  | "tile"
  | "garden"
  | "pool"
  | "wall"
  | "riser"
  | "door"
  | "window"
  | "furniture"
  | "roof"
  | "roof_gable"
  | "roof_hip"
  | "roof_skillion"
  | "roof_glass"
  | "wall_gable"
  | "fascia"
  | "rail"
  | "rail_glass"
  | "louver"
  | "stair"
  | "exterior"

export type Prim = {
  id: string
  kind: PrimKind
  floorId: string | null
  roomId?: string
  name?: string
  /** Untuk prim door/window: id Opening pada layout — dipakai edit-dari-3D. */
  openingId?: string
  /** Untuk prim wall milik ruang: sisi dinding (wallId = `${roomId}:${wallSide}`) — dipakai cladding fasad & edit-dari-3D. */
  wallSide?: "n" | "s" | "w" | "e"
  /** Warna spesifik prim (mis. finish louver) — renderer memakai ini di atas baseColor. */
  tint?: string
  /** Untuk prim roof_skillion: sisi RENDAH atap miring (arah air). */
  dir?: "n" | "s" | "w" | "e"
  /** Untuk prim roof_gable: geser bubungan dari tengah (gable asimetris, m). */
  ridgeOffsetM?: number
  /** Untuk prim roof_gable: end-cap segitiga yang DIBUKA karena ujung tsb diisi
   *  sopi-sopi (`wall_gable`) — tanpa ini infill tersembunyi di balik cap.
   *  neg = ujung sumbu negatif (w/n), pos = positif (e/s). Absen = cap penuh. */
  openGableEnds?: { neg?: boolean; pos?: boolean }
  /** Untuk prim wall_gable (sopi-sopi): tritisan atap induk (m) — menentukan
   *  ketinggian sisi profil di bidang dinding. */
  gableOverhangM?: number
  /** Untuk prim exterior kind gable_frame: profil bingkai pelana asimetris
   *  (W4) — renderer memakai buildGableFrameGeometry, bukan box. args =
   *  [widthM, apexH, depthM]; origin prim = TENGAH-DASAR bingkai. */
  gableFrame?: {
    eaveLeftM: number
    eaveRightM: number
    apexOffsetM: number
    memberM: number
  }
  /** Untuk prim wall_gable: render sebagai KACA gable (transparan). */
  glassEnd?: boolean
  /** Untuk prim roof_glass: id skylight pada layout — dipakai edit-dari-3D. */
  skylightId?: string
  /** Key `layout.facade` PERSIS utk muka luar prim wall ini (band vertikal
   *  split-facade); absent = resolusi key polos `roomId:side` (jalur lama). */
  facadeKey?: string
  /** Material atap eksplisit per prim (roofZones); absent = layout.roof fallback. */
  roofMaterial?: RoofMaterial
  opening?: Pick<
    Opening,
    | "type"
    | "kind"
    | "purpose"
    | "operation"
    | "frameMaterial"
    | "frameColor"
    | "privacyLevel"
    | "shading"
    | "sillHeightM"
    | "headHeightM"
    | "notes"
    | "modelUrl"
    | "curtainModelUrl"
  >
  /**
   * Untuk prim louver yang mewakili satu elemen fasad kustom. Renderer memakai
   * envelope `args` untuk fit model GLB; tanpa field ini louver tetap procedural.
   */
  facadeElement?: Pick<FacadeElement, "id" | "kind" | "modelUrl" | "modelAssetId">
  /** Semantic exterior owner. Geometry tetap berasal dari DesignLayout, bukan mesh. */
  exteriorElement?: Pick<ExteriorElement, "id" | "kind" | "model" | "material">
  /** Polygon site-plane dalam koordinat world x/z; hanya untuk surface exterior. */
  surfacePoints?: Array<[number, number]>
  /** Rotasi box pada sumbu vertikal Three.js. */
  rotationY?: number
  /** Untuk prim window: tanda arah INTERIOR sepanjang normal dinding (+1/-1).
   *  Dipakai renderer untuk menggantung gorden di sisi dalam (bukan luar). */
  interiorSign?: number
  pos: [number, number, number]
  args: [number, number, number]
  /**
   * Depth tie-breaker for coplanar overlapping faces (z-fighting). Prims whose
   * same-normal faces lie on the same plane AND overlap get DIFFERENT ranks;
   * the renderer maps rank → glPolygonOffset so the depth buffer orders them
   * deterministically without moving any geometry. Absent/0 = no offset.
   */
  depthRank?: number
}

export type Label = {
  id: string
  floorId: string
  roomId: string
  name: string
  pos: [number, number, number]
}

export type BuildOpts = {
  exploded: boolean
  showRoof: boolean
  showFurniture: boolean
}

/** Rooms rendered open (no walls). */
export const OPEN_TYPES: RoomType[] = [
  "kolam",
  "taman",
  "carport",
  "balkon",
  "rooftop_lounge",
  "void",
]

export type Model = { prims: Prim[]; labels: Label[]; height: number }

export type WallSideId = "n" | "s" | "w" | "e"

/**
 * Sisi TERBUKA sebuah ruang hazard (balkon/void) — sisi yang butuh pengaman
 * (railing) karena tak ada dinding di situ. Sisi yang menempel ruang berdinding
 * NORMAL sudah tertutup dinding tetangga; menempel ruang SETIPE dianggap
 * menerus (dua balkon/void bersebelahan). Tapi bila tetangga berbagi ZONA
 * (open-plan) dengan ruang ini, dinding tetangga itu DI-DROP oleh
 * `sameZoneOpenSpans` — sisi itu jadi terbuka juga, walau tetangganya solid.
 * Dipakai build-model (prim railing gaya bawaan) DAN renderer GLB railing
 * kustom (house-model) agar keduanya tak pernah menyimpang.
 */
export function hazardOpenSides(room: Room, others: Room[]): WallSideId[] {
  return (["n", "s", "w", "e"] as const).filter((side) => {
    const nb = roomsAdjacentOnSide(room, side, others)
    if (!nb) return true
    if (nb.type === room.type) return false
    if (sharesZone(room, nb)) return true
    return OPEN_TYPES.includes(nb.type)
  })
}

/**
 * Sisi "DEPAN" sebuah balkon untuk fitur tepi melengkung (edgeBowM) — dipilih
 * OTOMATIS dari sisi-sisi terbuka (`hazardOpenSides`): sisi yang tepinya
 * paling JAUH dari titik tengah footprint bangunan (arah menjorok keluar).
 * Balkon umum (1 sisi terbuka, menempel bangunan di 3 sisi lain) → hasilnya
 * satu-satunya sisi terbuka itu sendiri. Balkon sudut (2-3 sisi terbuka)
 * → sisi yang paling "mencuat" keluar dianggap depan, sisi lain (samping)
 * tetap lurus — sesuai maksud produk: tepi depan membusur, samping & belakang
 * tidak. Tak ada sisi terbuka → null (edgeBowM tak berefek, mis. balkon
 * terkubur di tengah, seharusnya tak terjadi tapi jaga-jaga).
 */
function balconyBowSide(
  room: Room,
  others: Room[],
  footprint: { x0: number; y0: number; widthM: number; depthM: number }
): WallSideId | null {
  const open = hazardOpenSides(room, others)
  if (open.length === 0) return null
  const fpCenterX = footprint.x0 + footprint.widthM / 2
  const fpCenterY = footprint.y0 + footprint.depthM / 2
  const outward: Record<WallSideId, number> = {
    n: fpCenterY - room.y,
    s: room.y + room.depth - fpCenterY,
    w: fpCenterX - room.x,
    e: room.x + room.width - fpCenterX,
  }
  return open.reduce((best, s) => (outward[s] > outward[best] ? s : best), open[0])
}

/**
 * Memetakan koordinat LOKAL tepi bowed (u sepanjang tepi dari titik tengah,
 * v menjorok KELUAR dari garis tepi lurus) ke [worldX, worldZ] — dipakai baik
 * untuk posisi (isi rx/rz/edgeLine sungguhan) maupun VEKTOR ARAH murni (isi
 * rx=rz=edgeLine=0, lalu (u,v) = komponen arah) karena petanya linear.
 */
function bowLocalToWorld(
  side: WallSideId,
  u: number,
  v: number,
  rx: number,
  rz: number,
  edgeLine: number
): [number, number] {
  switch (side) {
    case "n": return [rx + u, edgeLine - v]
    case "s": return [rx + u, edgeLine + v]
    case "w": return [edgeLine - v, rz + u]
    case "e": return [edgeLine + v, rz + u]
  }
}

/** Warna finish louver band (fasad). */
export const LOUVER_FINISH_COLORS: Record<"kayu" | "aluminium_gelap" | "putih" | "terakota", string> = {
  kayu: "#8a6242",
  aluminium_gelap: "#3c4245",
  putih: "#e8e6e0",
  // Roster/breeze-block bata terakota (ref: fasad tropis krawangan tanah liat).
  terakota: "#b5623c",
}

/**
 * Band lis fascia keliling tepi sebuah slab (atap datar / dak rooftop): 4 box
 * tipis MENONJOL 2 cm dari tepi slab (bebas z-fight), bibir atas 3 cm di atas
 * muka slab (kesan parapet), menjuntai `heightM` ke bawah — signature fasad
 * modern (tepi atap/dak gelap tebal).
 */
/**
 * Sisi band yang mau digambar — default 4 (dak/slab datar, keliling penuh).
 * Atap miring (pelana/limasan/skillion) hanya punya EAVE (tepi bawah bidang
 * miring) di sebagian sisi — sisi lain (mis. ujung sopi-sopi pelana) tak
 * punya tepi rendah untuk digantungi fascia. Urutan output selalu n,s,w,e
 * (subset dari default) → byte-identik utk caller lama yang tak mengirim arg.
 */
const FASCIA_SIDES_ALL = ["n", "s", "w", "e"] as const

function fasciaBands(
  idPrefix: string,
  floorId: string | null,
  rect: { cx: number; cz: number; w: number; d: number },
  slabTopY: number,
  fascia: { heightM: number; color: string },
  sides: readonly ("n" | "s" | "w" | "e")[] = FASCIA_SIDES_ALL
): Prim[] {
  const T = 0.06
  const PROUD = 0.02
  const LIP = 0.03
  const fh = fascia.heightM
  const yC = slabTopY + LIP - fh / 2
  const hw = rect.w / 2
  const hd = rect.d / 2
  const spanX = rect.w + 2 * (PROUD + T / 2)
  const spanZ = rect.d + 2 * (PROUD + T / 2)
  const mk = (tag: string, pos: [number, number, number], args: [number, number, number]): Prim => ({
    id: `${idPrefix}-${tag}`,
    kind: "fascia",
    floorId,
    tint: fascia.color,
    pos,
    args,
  })
  const bands: Record<"n" | "s" | "w" | "e", Prim> = {
    n: mk("n", [rect.cx, yC, rect.cz - hd - PROUD - T / 2], [spanX, fh, T]),
    s: mk("s", [rect.cx, yC, rect.cz + hd + PROUD + T / 2], [spanX, fh, T]),
    w: mk("w", [rect.cx - hw - PROUD - T / 2, yC, rect.cz], [T, fh, spanZ]),
    e: mk("e", [rect.cx + hw + PROUD + T / 2, yC, rect.cz], [T, fh, spanZ]),
  }
  return FASCIA_SIDES_ALL.filter((s) => sides.includes(s)).map((s) => bands[s])
}

type Span = { start: number; end: number }

function subtractSpans(base: Span, cuts: Span[], tol = 0.01): Span[] {
  const sorted = cuts
    .map((cut) => ({
      start: clamp(cut.start, base.start, base.end),
      end: clamp(cut.end, base.start, base.end),
    }))
    .filter((cut) => cut.end - cut.start > tol)
    .sort((a, b) => a.start - b.start)

  const out: Span[] = []
  let cursor = base.start
  for (const cut of sorted) {
    if (cut.start > cursor + tol) out.push({ start: cursor, end: cut.start })
    cursor = Math.max(cursor, cut.end)
  }
  if (cursor < base.end - tol) out.push({ start: cursor, end: base.end })
  return out
}

function sameZoneOpenSpans(room: Room, side: "n" | "s" | "w" | "e", others: Room[], tol = 0.05): Span[] {
  if (roomZones(room).length === 0) return []
  const spans: Span[] = []
  for (const other of others) {
    if (!sharesZone(room, other)) continue
    if (side === "n" && Math.abs(other.y + other.depth - room.y) <= tol) {
      const start = Math.max(room.x, other.x) - room.x
      const end = Math.min(room.x + room.width, other.x + other.width) - room.x
      if (end - start > tol) spans.push({ start, end })
    } else if (side === "s" && Math.abs(other.y - (room.y + room.depth)) <= tol) {
      const start = Math.max(room.x, other.x) - room.x
      const end = Math.min(room.x + room.width, other.x + other.width) - room.x
      if (end - start > tol) spans.push({ start, end })
    } else if (side === "w" && Math.abs(other.x + other.width - room.x) <= tol) {
      const start = Math.max(room.y, other.y) - room.y
      const end = Math.min(room.y + room.depth, other.y + other.depth) - room.y
      if (end - start > tol) spans.push({ start, end })
    } else if (side === "e" && Math.abs(other.x - (room.x + room.width)) <= tol) {
      const start = Math.max(room.y, other.y) - room.y
      const end = Math.min(room.y + room.depth, other.y + other.depth) - room.y
      if (end - start > tol) spans.push({ start, end })
    }
  }
  return spans
}

/**
 * Versi per-BENTANG dari `hazardOpenSides` — dipakai `void` (bukan balkon,
 * yang tetap pakai versi whole-side lama; lihat catatan di call site). Sisi
 * balkon biasanya ditutupi SATU tetangga penuh sepanjang sisinya, jadi
 * whole-side cukup; void seringkali ditempatkan manual & tetangganya cuma
 * menutupi SEBAGIAN sisi (mis. dua void bersebelahan dgn ukuran beda) —
 * whole-side salah menganggap seluruh sisi "tertutup" padahal cuma sebagian.
 * Mengembalikan bentang yang BUTUH railing (sudah di-subtract dari bentang
 * yang punya tetangga penutup — solid tak sezona, ATAU void/hazard lain
 * SETIPE yang dianggap menyatu/menerus, tanpa peduli zona).
 */
function hazardOpenSpans(room: Room, side: WallSideId, others: Room[], tol = 0.05): Span[] {
  const horizontal = side === "n" || side === "s"
  const full: Span = { start: 0, end: horizontal ? room.width : room.depth }
  const closed: Span[] = []
  for (const other of others) {
    const touches =
      side === "n" ? Math.abs(other.y + other.depth - room.y) <= tol
      : side === "s" ? Math.abs(other.y - (room.y + room.depth)) <= tol
      : side === "w" ? Math.abs(other.x + other.width - room.x) <= tol
      : Math.abs(other.x - (room.x + room.width)) <= tol
    if (!touches) continue
    const continuous = other.type === room.type
    const barrier = !continuous && !sharesZone(room, other) && !OPEN_TYPES.includes(other.type)
    if (!continuous && !barrier) continue // tetangga tak menutup apa-apa di sini (mis. sezona, beda tipe)
    const start = horizontal ? Math.max(room.x, other.x) - room.x : Math.max(room.y, other.y) - room.y
    const end = horizontal ? Math.min(room.x + room.width, other.x + other.width) - room.x : Math.min(room.y + room.depth, other.y + other.depth) - room.y
    if (end - start > tol) closed.push({ start, end })
  }
  return subtractSpans(full, closed)
}

/**
 * Bukaan railing balkon di PENDARATAN tangga EKSTERIOR (R1): elemen
 * exterior_stair yang ujung atasnya (start + arah·lengthM) menempel sisi
 * balkon → railing sisi itu dipotong selebar tangga + 0,1 m sehingga
 * pendaratan bisa dilewati. Undakan pendek (riseM < 1.5) diabaikan.
 * Span dalam koordinat lokal-dinding (0..len), pola stairExitCut.
 */
function exteriorStairLandingCuts(
  room: Room,
  side: WallSideId,
  elements: DesignLayout["exteriorElements"],
): Span[] {
  const cuts: Span[] = []
  for (const el of elements ?? []) {
    if (el.kind !== "exterior_stair") continue
    if (!(el.riseM >= 1.5)) continue
    const v =
      el.direction === "n" ? { x: 0, z: 1 }
      : el.direction === "s" ? { x: 0, z: -1 }
      : el.direction === "e" ? { x: 1, z: 0 }
      : { x: -1, z: 0 }
    const horizontal = side === "n" || side === "s"
    // Tangga harus berjalan TEGAK-LURUS sisi (mendarat menghadap sisi itu).
    if (horizontal ? v.z === 0 : v.x === 0) continue
    const lx = el.x + v.x * el.lengthM
    const ly = el.y + v.z * el.lengthM
    const edge =
      side === "n" ? room.y
      : side === "s" ? room.y + room.depth
      : side === "w" ? room.x
      : room.x + room.width
    if (Math.abs((horizontal ? ly : lx) - edge) > 0.35) continue
    const along0 = horizontal ? room.x : room.y
    const center = horizontal ? lx : ly
    cuts.push({
      start: center - el.widthM / 2 - 0.05 - along0,
      end: center + el.widthM / 2 + 0.05 - along0,
    })
  }
  return cuts
}

type StairExitCut = { horizontal: boolean; line: number; start: number; end: number }

/**
 * Bentang tempat tangga BENAR-BENAR keluar/naik ke lantai ini — anak tangga
 * teratas rata dengan slab lantai ini, jadi sepanjang bentang ini TIDAK BOLEH
 * ada dinding ATAU railing sama sekali, di ruang MANAPUN yang kebetulan
 * dindingnya persis di garis itu (bukan cuma void — kalau tidak, tangga jadi
 * tak terpakai: naik lalu mentok dinding/railing tepat di ujung anak terakhir).
 * Diberlakukan universal & TANPA syarat zona, sama seperti doorCuts (§630) —
 * ini persyaratan struktural (tangga = jalur wajib), bukan preferensi tata
 * ruang. Dihitung dari segmen TERAKHIR interiorStairLayout tangga itu (arah
 * `dir`-nya = arah keluar, jadi baris/kolom sisi itu = garis keluarnya).
 */
function stairExitCut(tangga: Room, floorHeightM: number): StairExitCut | null {
  const layout = interiorStairLayout(tangga, floorHeightM)
  const last = [...layout.segments].reverse().find((s) => s.kind === "run")
  if (!last) return null
  const horizontal = last.dir === "n" || last.dir === "s"
  const line =
    last.dir === "n" ? last.y
    : last.dir === "s" ? last.y + last.depth
    : last.dir === "w" ? last.x
    : last.x + last.width
  return horizontal
    ? { horizontal, line, start: last.x, end: last.x + last.width }
    : { horizontal, line, start: last.y, end: last.y + last.depth }
}

/**
 * Railing prims for ONE side of a perimeter, per style (kaca/besi/tembok/kayu)
 * — shared by the rooftop deck perimeter (keyed by `ROOFTOP_RAIL_ID`, deck
 * isn't a Room) and the `void` room hazard-railing branch below (keyed by the
 * void's own room id). `pos`/`len` describe the side's centreline (world
 * metres, already cx/cz-offset) at railing-base height; `baseY` is the top of
 * whatever it's mounted on (roomTopY equivalent) used to place the kayu slats.
 * `roomId`/`idPrefix` default to the rooftop-deck identity so all 8 existing
 * rooftop call sites are byte-identical without passing them explicitly.
 */
function railSidePrims(
  side: "n" | "s" | "w" | "e",
  style: RailingStyle,
  pos: [number, number, number],
  len: number,
  railH: number,
  baseY: number,
  floorId: string,
  roomId: string = ROOFTOP_RAIL_ID,
  idPrefix: string = "railrt-"
): Prim[] {
  const horizontal = side === "n" || side === "s"
  const out: Prim[] = []
  const glassT = 0.05
  const id = (suffix: string) => `${idPrefix}${side}${suffix}`

  if (style === "tembok") {
    out.push({
      id: id(""), kind: "rail", floorId, roomId, tint: "#c9c3b6",
      pos, args: horizontal ? [len, railH, WALL_T] : [WALL_T, railH, len],
    })
    return out
  }

  if (style === "kaca") {
    out.push({
      id: id(""), kind: "rail_glass", floorId, roomId,
      pos, args: horizontal ? [len, railH, glassT] : [glassT, railH, len],
    })
  } else {
    const tint = style === "kayu" ? "#8a6242" : "#3c4245"
    if (style === "besi") {
      const count = Math.max(2, Math.floor(len / 0.12))
      for (let b = 0; b < count; b++) {
        const along = -len / 2 + (b + 0.5) * (len / count)
        out.push({
          id: id(`-${b}`), kind: "rail", floorId, roomId, tint,
          pos: horizontal ? [pos[0] + along, pos[1], pos[2]] : [pos[0], pos[1], pos[2] + along],
          args: [0.02, railH, 0.02],
        })
      }
    } else {
      // kayu: 3 bilah horizontal + tiang tiap ~1,2 m
      for (const [bi, hRel] of [0.25, 0.55, 0.85].entries()) {
        out.push({
          id: id(`-b${bi}`), kind: "rail", floorId, roomId, tint,
          pos: [pos[0], baseY + hRel * railH, pos[2]],
          args: horizontal ? [len, 0.06, 0.04] : [0.04, 0.06, len],
        })
      }
      const posts = Math.max(2, Math.ceil(len / 1.2) + 1)
      for (let b = 0; b < posts; b++) {
        const along = -len / 2 + (b * len) / (posts - 1)
        out.push({
          id: id(`-p${b}`), kind: "rail", floorId, roomId, tint,
          pos: horizontal ? [pos[0] + along, pos[1], pos[2]] : [pos[0], pos[1], pos[2] + along],
          args: [0.05, railH, 0.05],
        })
      }
    }
  }
  // Rel atas (handrail cap) — semua gaya kecuali tembok (early-return di atas).
  out.push({
    id: id("-h"), kind: "rail", floorId, roomId,
    ...(style === "kayu" ? { tint: "#8a6242" } : {}),
    pos: [pos[0], pos[1] + railH / 2 + 0.025, pos[2]],
    args: horizontal ? [len, 0.05, 0.06] : [0.06, 0.05, len],
  })
  return out
}

/**
 * Fase A F1 (split-facade): dorong satu box dinding, DIPECAH VERTIKAL menurut
 * band cladding dindingnya. Tanpa band (atau rentang tak tersentuh boundary)
 * → SATU box dgn id asli (byte-identik jalur lama); ada boundary di dalam
 * rentang → segmen `-b{k}` masing-masing membawa `facadeKey` band penutupnya.
 * `relY0..relY1` = rentang vertikal box relatif DASAR dinding (lantai ruang).
 */
function pushBandedWallBox(
  prims: Prim[],
  opts2: {
    idBase: string
    floorId: string
    roomId: string
    wallSide: "n" | "s" | "w" | "e"
    horizontal: boolean
    posX: number
    posZ: number
    alongLen: number
    thick: number
    wallBaseY: number
    relY0: number
    relY1: number
    bands: WallBand[]
  },
): void {
  const { idBase, floorId, roomId, wallSide, horizontal, posX, posZ, alongLen, thick, wallBaseY, relY0, relY1, bands } = opts2
  const inner = wallCutYs(bands, relY1).filter(
    (y) => y > relY0 + 1e-6 && y < relY1 - 1e-6,
  )
  const cuts = [relY0, ...inner, relY1]
  const emit = (id: string, y0: number, y1: number) => {
    const fk = bandCovering(bands, y0, y1)?.key
    prims.push({
      id,
      kind: "wall",
      floorId,
      roomId,
      wallSide,
      pos: [posX, wallBaseY + (y0 + y1) / 2, posZ],
      args: horizontal ? [alongLen, y1 - y0, thick] : [thick, y1 - y0, alongLen],
      ...(fk ? { facadeKey: fk } : {}),
    })
  }
  if (cuts.length === 2) {
    emit(idBase, relY0, relY1)
    return
  }
  for (let k = 0; k < cuts.length - 1; k++) {
    emit(`${idBase}-b${k}`, cuts[k], cuts[k + 1])
  }
}

/** Jumlah step per sudut untuk aproksimasi lengkung arch/kapsul — 2 sudut
 *  (arch) atau 4 sudut (kapsul) × ARCH_STEPS ≈ 10-20 segmen total, konsisten
 *  dgn budget low-poly "8-12 segmen per kurva" (satu arch = satu kurva; satu
 *  kapsul = DUA kurva, satu di tiap ujung). */
const ARCH_STEPS = 5

/**
 * Satu SUDUT (seperempat lingkaran radius `r`, pusat = titik siku) dari
 * lubang bukaan diisi dgn `ARCH_STEPS` box bertingkat, pola sama dgn
 * corner-fill porthole (Track B): tiap box dijaga TIDAK menutupi area kaca
 * (batas box konservatif ≥ kurva lingkaran) — hasilnya siluet bukaan
 * terbaca melengkung (staircase low-poly) tanpa memotong dinding jadi
 * bentuk non-persegi sungguhan.
 *
 * `alongBase`/`crossCoord`: sama konvensi dgn openingSegment — `alongBase`
 * = koordinat ABSOLUT pusat lingkaran sepanjang dinding (mx bila horizontal,
 * mz bila tidak), `crossCoord` = koordinat tetap tegak lurus dinding
 * (mz/mx). `yBase` = ketinggian ABSOLUT pusat lingkaran. `alongSign`/`ySign`
 * menentukan arah sudut (kiri/kanan × atas/bawah) dari pusat itu.
 *
 * `sweepAxis` memilih sumbu yang DIBAGI rata jadi ARCH_STEPS (sumbu
 * lainnya diturunkan dari kurva lingkaran via sqrt): "along" pas untuk arch
 * & ujung atas/bawah kapsul VERTIKAL (kurva y=f(x)); "height" pas untuk
 * ujung kiri/kanan kapsul HORIZONTAL (kurva x=f(y)) — sama radius, hanya
 * sumbu tangga yang beda supaya step terasa alami di tiap orientasi.
 */
function quarterArcCornerFillPrims(opts: {
  idBase: string
  floorId: string
  roomId: string
  wallSide: WallSideId
  horizontal: boolean
  sweepAxis: "along" | "height"
  alongBase: number
  crossCoord: number
  alongSign: 1 | -1
  yBase: number
  ySign: 1 | -1
  r: number
  tint?: string
}): Prim[] {
  const { idBase, floorId, roomId, wallSide, horizontal, sweepAxis, alongBase, crossCoord, alongSign, yBase, ySign, r, tint } = opts
  if (r < 0.03) return []
  const prims: Prim[] = []
  for (let i = 0; i < ARCH_STEPS; i++) {
    const s0 = (i / ARCH_STEPS) * r
    const s1 = ((i + 1) / ARCH_STEPS) * r
    // Batas AMAN pada sumbu turunan, dihitung di tepi DALAM (dekat pusat)
    // segmen — box tak pernah turun di bawah kurva sungguhan (tak menutup
    // kaca).
    const safe = Math.sqrt(Math.max(0, r * r - s0 * s0))
    const span = r - safe
    if (span < 0.02) continue
    let alongMid: number, alongW: number, yMid: number, hSpan: number
    if (sweepAxis === "along") {
      alongMid = alongBase + (alongSign * (s0 + s1)) / 2
      alongW = s1 - s0
      yMid = yBase + (ySign * (safe + r)) / 2
      hSpan = span
    } else {
      yMid = yBase + (ySign * (s0 + s1)) / 2
      hSpan = s1 - s0
      alongMid = alongBase + (alongSign * (safe + r)) / 2
      alongW = span
    }
    prims.push({
      id: `${idBase}-${i}`,
      kind: "wall",
      floorId,
      roomId,
      wallSide,
      ...(tint ? { tint } : {}),
      pos: horizontal ? [alongMid, yMid, crossCoord] : [crossCoord, yMid, alongMid],
      args: horizontal ? [alongW, hSpan, WALL_T] : [WALL_T, hSpan, alongW],
    })
  }
  return prims
}

/**
 * Bukaan TRAPESIUM (`topSlopeM`): tepi atas ditutup step box bertingkat
 * dari sudut TINGGI (fill 0, sisi `heightM` dibiarkan) ke sudut RENDAH
 * (fill penuh = `drop`) — idiom identik dgn `quarterArcCornerFillPrims`
 * (ARCH_STEPS langkah), tapi garis batasnya LINEAR (bukan busur): fill
 * naik proporsional sepanjang lebar bukaan, bukan hanya di satu sudut
 * lokal. Lubang bukaan tetap PERSEGI setinggi penuh (`topY` = puncak sisi
 * tinggi); tiap box dihitung di tepi segmen DEKAT sudut TINGGI (nilai fill
 * TERKECIL di segmen, sama prinsip "batas aman di titik nol-fill" dgn
 * arch) sehingga box tak pernah turun di bawah garis miring sungguhan
 * (tak menutup kaca) — siluet bukaan terbaca trapesium.
 *
 * `alongBase`/`crossCoord`: sama konvensi dgn openingSegment/
 * quarterArcCornerFillPrims. `lowSign` = arah sudut RENDAH dari pusat
 * bukaan (+1/−1 sepanjang dinding).
 */
function topSlopeCornerFillPrims(opts: {
  idBase: string
  floorId: string
  roomId: string
  wallSide: WallSideId
  horizontal: boolean
  alongBase: number
  crossCoord: number
  width: number
  topY: number
  drop: number
  lowSign: 1 | -1
  tint?: string
}): Prim[] {
  const { idBase, floorId, roomId, wallSide, horizontal, alongBase, crossCoord, width, topY, drop, lowSign, tint } = opts
  if (drop < 0.03 || width < 0.03) return []
  const prims: Prim[] = []
  // s=0 di sudut TINGGI (titik fill-nol, spt "pusat" arch), s bertambah
  // menuju sudut RENDAH (di s=width) — arah lowSign dari sudut tinggi.
  const highCornerAlong = alongBase - lowSign * (width / 2)
  for (let i = 0; i < ARCH_STEPS; i++) {
    const s0 = (i / ARCH_STEPS) * width
    const s1 = ((i + 1) / ARCH_STEPS) * width
    // Tinggi box = fill pada tepi DEKAT sudut tinggi (s0) — nilai TERKECIL
    // dalam segmen ini (garis miring naik linear menuju sudut rendah),
    // jadi box tak pernah melewati garis sungguhan di sisa segmen.
    const h = (drop * s0) / width
    if (h < 0.02) continue
    const alongMid = highCornerAlong + (lowSign * (s0 + s1)) / 2
    const alongW = s1 - s0
    const yMid = topY - h / 2
    prims.push({
      id: `${idBase}-${i}`,
      kind: "wall",
      floorId,
      roomId,
      wallSide,
      ...(tint ? { tint } : {}),
      pos: horizontal ? [alongMid, yMid, crossCoord] : [crossCoord, yMid, alongMid],
      args: horizontal ? [alongW, h, WALL_T] : [WALL_T, h, alongW],
    })
  }
  return prims
}

export function buildModel(
  layout: DesignLayout,
  site: { widthM: number; depthM: number },
  project: Project,
  opts: BuildOpts
): Model {
  const cx = site.widthM / 2
  const cz = site.depthM / 2
  const floorStep = WALL_H + SLAB_T
  // TABEL ELEVASI (Fase D): satu sumber vertikal — baseY prefix-sum
  // Floor.heightM, tinggi dinding per lantai = heightM − SLAB_T. Data
  // ternormalisasi 2.95 mereproduksi rumus lama bit-identik (vertical.ts).
  const elev = floorElevations(layout.floors)
  const gap = opts.exploded ? EXPLODE_GAP : 0
  const prims: Prim[] = []
  const labels: Label[] = []

  const hasRooftopFloor = layout.floors.some((f) => f.id === "floor-rooftop")
  // top regular floor (exclude rooftop floor for roof slab position)
  // Lantai reguler via helper kind (mezzanine & rooftop dikecualikan) —
  // dulu slice(0,-1) yang mengasumsikan rooftop selalu elemen terakhir.
  const regularFloors = regularFloorsOf(layout.floors)
  const topRegIdx = regularFloors.length - 1
  // Puncak tumpukan lantai reguler (prefix-sum heightM) — pengganti
  // regularFloors.length × floorStep utk framing kamera/bayangan.
  const regularStackTopM = (() => {
    const last = regularFloors[regularFloors.length - 1]
    if (!last) return 0
    const e = floorElevations(layout.floors).get(last.id)
    return e ? e.baseY + e.floorToFloorM : regularFloors.length * (WALL_H + SLAB_T)
  })()
  const topFloorId = regularFloors[topRegIdx]?.id ?? layout.floors[layout.floors.length - 1]?.id ?? null

  // Partial-rooftop decomposition (single source of truth: @/lib/geometry/rooftop).
  // `deck` is the clamped rooftopArea rect; `partialRooftop` ⇒ hasRooftopFloor
  // AND deck present AND at least one roof strip. When false everything below
  // stays byte-identical to the legacy full-site behaviour.
  const footprint = buildingFootprint(layout)
  const deck = layout.rooftopArea ? clampRooftopArea(layout.rooftopArea, footprint) : null
  const partialRooftop = isPartialRooftop(layout)

  // Atap & slab mengikuti FOOTPRINT BANGUNAN, bukan kavling penuh — rumah 6×3
  // di kavling 10×8 tidak boleh punya atap/slab beton menggantung di atas
  // halaman. cx/cz tetap setengah SITE (frame dunia tidak berubah); footprint
  // degenerate (layout tanpa ruang) jatuh kembali ke kavling penuh supaya
  // model kosong tetap tampak seperti sebelumnya.
  const hasFp = footprint.widthM > 0 && footprint.depthM > 0
  const fpW = hasFp ? footprint.widthM : site.widthM
  const fpD = hasFp ? footprint.depthM : site.depthM
  const fpCx = hasFp ? footprint.x0 + footprint.widthM / 2 - cx : 0
  const fpCz = hasFp ? footprint.y0 + footprint.depthM / 2 - cz : 0

  layout.floors.forEach((floor, i) => {
    const isRooftop = floor.id === "floor-rooftop"
    // Regular floors stack normally; the rooftop deck rests directly on the top
    // regular floor — its slab IS the building's flat (walk-on) roof, so it must
    // not float a storey above (that buried the roof and left an empty void).
    const floorIndex = isRooftop ? regularFloors.length : i
    const fe = elev.get(floor.id)
    const baseY = fe ? fe.baseY + fe.index * gap : floorIndex * (floorStep + gap)
    const wallH = fe?.wallHM ?? WALL_H
    const isMezz = isMezzanineFloor(floor)
    const slabTopY = baseY + SLAB_T

    // Floor slab: the BUILDING footprint (halaman bukan beton — lantai dasar
    // pun hanya sebesar bangunan). A PARTIAL rooftop deck covers only the
    // rooftopArea rect (the surrounding strips are roof, emitted below), so its
    // slab shrinks to the deck dims/position.
    // MEZZANINE (E6): lantai antara PARSIAL — slab hanya seluas ruang-ruang
    // miliknya (BUKAN footprint), tanpa lubang, tanpa penutup fasad w-edge.
    // Platform terbuka lazimnya bertipe balkon → mesin railing existing
    // otomatis memagari tepinya pada elevasi mezzanine (roomTopY dari tabel).
    if (isMezz) {
      for (const r of layout.rooms) {
        if (r.floorId !== floor.id) continue
        if (!(Number.isFinite(r.x) && Number.isFinite(r.y) && r.width > 0 && r.depth > 0)) continue
        prims.push({
          id: `slab-${floor.id}-${r.id}`,
          kind: "slab",
          floorId: floor.id,
          roomId: r.id,
          pos: [r.x + r.width / 2 - cx, baseY + SLAB_T / 2, r.y + r.depth / 2 - cz],
          args: [r.width, SLAB_T, r.depth],
        })
      }
    }

    const deckSlab = isRooftop && partialRooftop && deck
    const slabY = baseY + SLAB_T / 2
    // Bukaan vertikal punch a REAL hole through this floor's slab — otherwise a
    // staircase rises into a solid ceiling (tak ada akses ke lantai/rooftop di
    // atas). Holes = (a) `void` rooms ON this floor (atrium/void manual), plus
    // (b) `tangga` rooms on the floor BELOW (auto: tangga naik dari bawah ke
    // lantai ini, jadi butuh lubang di slab lantai ini tepat di atasnya —
    // pindahkan tangga, lubang ikut). Zero holes → single slab prim
    // `slab-<floor.id>` (byte-identical dgn jalur lama).
    const slabRect = deckSlab
      ? { x: deck.x, y: deck.y, width: deck.width, depth: deck.depth }
      : { x: fpCx + cx - fpW / 2, y: fpCz + cz - fpD / 2, width: fpW, depth: fpD }
    const floorBelow = i > 0 ? layout.floors[i - 1] : undefined
    const holeRects = layout.rooms
      .filter(
        (r) =>
          Number.isFinite(r.x) && Number.isFinite(r.y) && r.width > 0 && r.depth > 0 &&
          ((r.floorId === floor.id && r.type === "void") ||
            (!!floorBelow &&
              r.floorId === floorBelow.id &&
              r.type === "tangga" &&
              stairPenetratesSlabAbove(elev, r.floorId)))
      )
      .map((r) => ({ x: r.x, y: r.y, width: r.width, depth: r.depth }))
    // KOLAM DI ROOFTOP: dak dituang solid seluas footprint/deck,
    // menutupi kolam yang sengaja RECESSED di bawah muka slab (blok isPool di
    // bawah: waterTop = roomTopY − 0.08) — dari atas (satu-satunya sudut
    // pandang dak) hanya decking yang tampak, air tak pernah terlihat.
    // Lubangi slab dak SELUAS ruang kolam itu sendiri (bukan cuma bak airnya)
    // supaya prim `pool-<id>` + coping muncul lewat lubang; blok isPool di
    // bawah menambal celah antara tepi lubang & kotak air (band coping) dgn
    // prim `poolwall-<id>-*` agar tak tembus pandang ke plafon lantai di
    // bawah dak. Di-scope KETAT ke floor-rooftop — kolam di lantai biasa
    // sudah benar secara visual & TIDAK disentuh (byte-identical, tanpa
    // kolam rooftop holeRects tetap sama persis dgn sebelumnya).
    if (isRooftop) {
      for (const r of layout.rooms) {
        if (r.floorId !== floor.id || r.type !== "kolam") continue
        if (!(Number.isFinite(r.x) && Number.isFinite(r.y) && r.width > 0 && r.depth > 0)) continue
        holeRects.push({ x: r.x, y: r.y, width: r.width, depth: r.depth })
      }
    }
    // COURTYARD: taman/kolam openToSky di lantai BAWAH melubangi slab lantai
    // ini (cahaya turun sampai halaman dalam) — rect efektifnya yang
    // user-editable (openToSkyRect ?? rect ruang), pola lubang tangga.
    if (floorBelow) {
      for (const r of layout.rooms) {
        if (r.floorId !== floorBelow.id || r.openToSky !== true) continue
        if (r.type !== "taman" && r.type !== "kolam") continue
        holeRects.push(clampCourtyardRect(r, courtyardRect(r)))
      }
    }
    // Skylight di DAK rooftop: melubangi slab dak (walk-on) + prim kaca pada
    // elevasi slab (mesin roof-holes; tanpa skylight = jalur lama utuh).
    if (isRooftop) {
      const deckHost = flatRoofHosts(layout).find((h) => h.kind === "deck")
      const deckSkylights = deckHost ? skylightsOnHost(layout, deckHost) : []
      // Lubang dak = skylight + courtyard openToSky (roofHoleRectsFor);
      // courtyard tanpa prim kaca.
      if (deckHost) {
        for (const hole of roofHoleRectsFor(layout, deckHost)) holeRects.push(hole)
      }
      for (const sk of deckSkylights) {
        prims.push({
          id: `roof-glass-${sk.id}`,
          kind: "roof_glass",
          floorId: floor.id,
          skylightId: sk.id,
          pos: [
            sk.rect.x + sk.rect.width / 2 - cx,
            slabY,
            sk.rect.y + sk.rect.depth / 2 - cz,
          ],
          args: [sk.rect.width, SLAB_T * 0.6, sk.rect.depth],
        })
      }
    }
    if (isMezz) {
      // slab per-room sudah diemisi di atas — jangan tuang slab footprint.
    } else if (holeRects.length === 0) {
      prims.push({
        id: `slab-${floor.id}`,
        kind: "slab",
        floorId: floor.id,
        pos: deckSlab
          ? [deck.x + deck.width / 2 - cx, slabY, deck.y + deck.depth / 2 - cz]
          : [fpCx, slabY, fpCz],
        args: deckSlab ? [deck.width, SLAB_T, deck.depth] : [fpW, SLAB_T, fpD],
      })
    } else {
      for (const [hi, s] of subtractRectHoles(slabRect, holeRects).entries()) {
        prims.push({
          id: `slab-${floor.id}-h${hi}`,
          kind: "slab",
          floorId: floor.id,
          pos: [s.x + s.width / 2 - cx, slabY, s.y + s.depth / 2 - cz],
          args: [s.width, SLAB_T, s.depth],
        })
      }
    }
    // Lis fascia keliling tepi DAK rooftop (slab rooftop = atap datar rumah).
    if (isRooftop) {
      const fascia = effectiveRoof(layout).fascia
      if (fascia) {
        const rect = deckSlab
          ? { cx: deck.x + deck.width / 2 - cx, cz: deck.y + deck.depth / 2 - cz, w: deck.width, d: deck.depth }
          : { cx: fpCx, cz: fpCz, w: fpW, d: fpD }
        prims.push(...fasciaBands(`fascia-deck`, floor.id, rect, baseY + SLAB_T, fascia))
      }
    }

    // UNDAKAN KONEKTOR split-level (E3): ruang terhubung (pintu/zona) dgn
    // beda level > 20 cm mendapat anak tangga kecil otomatis di bentang
    // koneksinya — menjorok ke ruang RENDAH, naik ke lantai ruang tinggi.
    for (const conn of levelConnectors(
      layout.rooms.filter((r) => r.floorId === floor.id),
      layout.openings.filter((o) => o.floorId === floor.id),
    )) {
      const low = layout.rooms.find((r) => r.id === conn.lowRoomId)
      if (!low) continue
      const lowTopY = slabTopY + (low.levelOffsetM ?? 0)
      const treadM = 0.3
      const spanLen = conn.span.end - conn.span.start
      const spanMid = (conn.span.start + conn.span.end) / 2
      const inward = conn.side === "n" || conn.side === "w" ? 1 : -1
      for (let k = 0; k < conn.steps - 1; k++) {
        // Anak ke-k dari bawah: tinggi (k+1)×riser, menjorok makin dekat batas.
        const h = conn.riserM * (k + 1)
        const away = (conn.steps - 1 - k) * treadM - treadM / 2
        const px = conn.horizontal ? spanMid : conn.line + inward * away
        const pz = conn.horizontal ? conn.line + inward * away : spanMid
        prims.push({
          id: `stepc-${conn.lowRoomId}-${conn.highRoomId}-${conn.side}-${k}`,
          kind: "stair",
          floorId: floor.id,
          roomId: conn.lowRoomId,
          pos: [px - cx, lowTopY + h / 2, pz - cz],
          args: conn.horizontal ? [spanLen, h, treadM] : [treadM, h, spanLen],
        })
      }
    }

    const rooms = layout.rooms.filter((r) => r.floorId === floor.id)

    const SIDES = ["n", "s", "w", "e"] as const

    // Penutup fasad lantai ELEVATED: slab dituang seluas footprint BANGUNAN,
    // jadi bentang tepi footprint yang TIDAK ditempati ruang lantai ini adalah
    // slab telanjang di tepi gedung — drop-off terbuka (lubang fasad di samping
    // lubang tangga, laporan prod). Tutup dengan dinding penuh. Ruang (tipe apa
    // pun) yang tepinya berjarak ≤ EDGE_NEAR dari garis tepi dianggap MENUTUP
    // bentangnya: ruang solid menggambar dinding luarnya sendiri (dinding
    // sintetis di depannya justru mengubur jendela/cladding), balkon menggambar
    // railing, ledge sempit di belakang dinding ruang bukan area jalan. Lantai
    // dasar dilewati (halaman/carport memang terbuka, tak ada bahaya jatuh);
    // dak rooftop dilewati (perimeternya sudah dapat railing ROOFTOP_RAIL_ID).
    // Geometri (span-span TERBUKA + garis tepi + orientasi) hidup di modul
    // murni lib/geometry/edge-wall.ts — SATU sumber kebenaran dipakai di sini
    // (menggambar dinding w-edge) DAN oleh generator elemen fasad (kisi/roster)
    // di bawah, yang butuh resolve host w-edge tanpa `rooms.find` (rooms
    // lantai ini tak punya entri utk pseudo-room edge-*, sebelumnya elemen
    // fasad di situ diam-diam tak pernah tergambar).
    const edgeWallGeom = new Map<WallSideId, EdgeWallSideGeometry>()
    for (const side of SIDES) {
      const geom = edgeWallSideGeometry(layout, floor.id, side)
      if (!geom) continue
      edgeWallGeom.set(side, geom)
      const edgeBands = facadeBandsForWall(layout.facade, edgeWallRoomId(floor.id), side, wallH)
      geom.rawSpans.forEach((span, si) => {
        const len = span.end - span.start
        if (len < EDGE_MIN_SPAN) return
        const mid = (span.start + span.end) / 2
        pushBandedWallBox(prims, {
          idBase: `w-edge-${floor.id}-${side}-${si}`,
          floorId: floor.id,
          // roomId sintetis → FacadeWallMesh (klik + cladding) menyala;
          // sebelum ini w-edge jatuh ke mesh generik yang mati rasa.
          roomId: edgeWallRoomId(floor.id),
          wallSide: side,
          horizontal: geom.horizontal,
          posX: geom.horizontal ? mid - cx : geom.line - cx,
          posZ: geom.horizontal ? geom.line - cz : mid - cz,
          alongLen: len + WALL_T,
          thick: WALL_T,
          wallBaseY: slabTopY,
          relY0: 0,
          relY1: wallH,
          bands: edgeBands,
        })
      })
    }

    // Door openings punch REAL holes through walls (a header strip remains
    // above the leaf). Cuts are collected per wall LINE in absolute metres so
    // the coincident wall drawn by the room on the OTHER side of a shared
    // boundary is cut too — each room draws its own four walls, and without
    // this the neighbour's wall would visually fill the hole back in.
    // 2026-07-11: jendela IKUT melubangi dinding (dulu hanya pintu — panel
    // kaca ditempel di dinding solid, ketahuan saat dinding diberi tekstur).
    // Bentang jendela dipotong penuh lalu ambang bawah + balok atas digambar
    // kembali di loop openings (ws-/wh-), meniru pola header pintu.
    type DoorCut = { horizontal: boolean; line: number; start: number; end: number }
    const doorCuts: DoorCut[] = []
    for (const op of layout.openings.filter((o) => o.floorId === floor.id)) {
      const parsed = parseOpeningWall(op.wallId)
      if (!parsed) continue
      const opRoom = rooms.find((r) => r.id === parsed.roomId)
      if (!opRoom) continue
      const seg = openingSegment(opRoom, parsed.side, op.positionM, op.widthM)
      const horizontal = parsed.side === "n" || parsed.side === "s"
      doorCuts.push(
        horizontal
          ? { horizontal, line: seg.y1, start: seg.x1, end: seg.x2 }
          : { horizontal, line: seg.x1, start: seg.y1, end: seg.y2 }
      )
    }
    const doorCutsForWall = (horizontal: boolean, line: number, offset: number): Span[] =>
      doorCuts
        .filter((c) => c.horizontal === horizontal && Math.abs(c.line - line) <= 0.06)
        .map((c) => ({ start: c.start - offset, end: c.end - offset }))

    // Tangga di lantai BAWAH yang lubangnya nembus ke lantai ini — dipakai
    // stairExitCutsForWall (lihat stairExitCut) agar dinding/railing ruang
    // MANAPUN di lantai ini tak pernah menutup jalur keluar tangga.
    const stairsBelow = floorBelow
      ? layout.rooms.filter((r) => r.floorId === floorBelow.id && r.type === "tangga")
      : []
    const stairExitCuts: StairExitCut[] = stairsBelow
      // Lantai reguler: hanya tangga yang MENEMBUS slab-nya; lantai MEZZANINE:
      // tangga induk memang mendarat di sini (rise = baseOffset) — mulutnya
      // wajib terbuka di dinding/railing platform.
      .filter((st) => stairPenetratesSlabAbove(elev, st.floorId) || isMezz)
      .map((st) => stairExitCut(st, stairRiseM(elev, st.floorId)))
      .filter((c): c is StairExitCut => c !== null)
    const stairExitCutsForWall = (horizontal: boolean, line: number, offset: number): Span[] =>
      stairExitCuts
        .filter((c) => c.horizontal === horizontal && Math.abs(c.line - line) <= 0.06)
        .map((c) => ({ start: c.start - offset, end: c.end - offset }))

    for (const room of rooms) {
      const rx = room.x + room.width / 2 - cx
      const rz = room.y + room.depth / 2 - cz
      const isPool = room.type === "kolam"
      const isOpen = OPEN_TYPES.includes(room.type)
      const offset = room.levelOffsetM ?? 0
      const roomTopY = slabTopY + offset
      // PLAFON RATA (E2): puncak dinding SELALU slabTopY + wallH — ruang
      // ber-offset dindingnya memendek (offset<0: memanjang) sehingga bidang
      // plafon satu lantai rata; dulu dinding naik penuh dan menembus slab.
      const roomWallH = Math.max(0.4, wallH - offset)
      const roomWallCenterY = roomTopY + roomWallH / 2
      const w = room.width
      const d = room.depth
      const t = WALL_T
      const others = rooms.filter((o) => o.id !== room.id)

      if (isPool) {
        // Kolam: air RECESSED sedalam poolDepthM (di bawah bibir) + coping (bibir
        // batu) keliling. Warna air/coping dari finish. Air lebih kecil dari
        // footprint ruang sebesar lebar coping → bibir terlihat mengelilingi air.
        const depth = effectivePoolDepth(room)
        const fin = POOL_FINISHES[effectivePoolFinish(room)]
        const cwRaw = 0.18 // lebar coping
        const cw = Math.min(cwRaw, w / 2 - 0.1, d / 2 - 0.1) // jaga air tetap ada di kolam kecil
        const copingH = 0.12
        const innerW = Math.max(0.2, w - 2 * cw)
        const innerD = Math.max(0.2, d - 2 * cw)
        const waterTop = roomTopY - 0.08 // permukaan air sedikit di bawah bibir
        // Permukaan air (clickable → PoolQuickEditor via selectRoom).
        prims.push({
          id: `pool-${room.id}`,
          kind: "pool",
          floorId: floor.id,
          roomId: room.id,
          name: room.name,
          tint: fin.water,
          pos: [rx, waterTop - depth / 2, rz],
          args: [innerW, depth, innerD],
        })
        // Coping / bibir kolam — 4 bar batu keliling di roomTopY.
        const copingY = roomTopY + copingH / 2
        const zOff = innerD / 2 + cw / 2
        const xOff = innerW / 2 + cw / 2
        const cop = (tag: string, pos: [number, number, number], args: [number, number, number]): Prim => ({
          id: `coping-${room.id}-${tag}`, kind: "tile", floorId: floor.id, roomId: room.id, tint: fin.coping, pos, args,
        })
        prims.push(cop("n", [rx, copingY, rz - zOff], [innerW + 2 * cw, copingH, cw]))
        prims.push(cop("s", [rx, copingY, rz + zOff], [innerW + 2 * cw, copingH, cw]))
        prims.push(cop("w", [rx - xOff, copingY, rz], [cw, copingH, innerD]))
        prims.push(cop("e", [rx + xOff, copingY, rz], [cw, copingH, innerD]))

        // ROOFTOP ONLY: slab dak dilubangi SELUAS ruang kolam (lihat holeRects
        // di atas), tapi kotak air hanya innerW×innerD — sisakan celah band
        // lebar cw di sekeliling (persis footprint bar coping di atas) yang
        // tembus pandang ke plafon lantai di bawah dak kalau dibiarkan kosong.
        // Tambal dgn dinding basin tipis (tinggi SLAB_T, warna coping) persis
        // mengisi kembali volume slab yang terpotong di band itu.
        if (isRooftop) {
          const wallY = baseY + SLAB_T / 2
          const poolWall = (tag: string, pos: [number, number, number], args: [number, number, number]): Prim => ({
            id: `poolwall-${room.id}-${tag}`, kind: "tile", floorId: floor.id, roomId: room.id, tint: fin.coping, pos, args,
          })
          prims.push(poolWall("n", [rx, wallY, rz - zOff], [innerW + 2 * cw, SLAB_T, cw]))
          prims.push(poolWall("s", [rx, wallY, rz + zOff], [innerW + 2 * cw, SLAB_T, cw]))
          prims.push(poolWall("w", [rx - xOff, wallY, rz], [cw, SLAB_T, innerD]))
          prims.push(poolWall("e", [rx + xOff, wallY, rz], [cw, SLAB_T, innerD]))
        }

        // Tangga masuk kolam: undakan solid menurun di sisi poolEntrySide.
        // k anak (riser ±25 cm dari kedalaman DANGKAL); blok terakhir = dasar,
        // jadi hanya k-1 blok yang dirender. Tanpa field → tanpa prim (legacy).
        if (room.poolEntrySide) {
          const range = effectivePoolDepthRange(room)
          const kSteps = Math.min(5, Math.max(3, Math.round(range.shallowM / 0.25)))
          const stepRiser = range.shallowM / kSteps
          const stepTread = 0.35
          const side = room.poolEntrySide
          const horizontalSide = side === "n" || side === "s"
          const stepW = Math.min(1.2, (horizontalSide ? w : d) - 0.6)
          const floorY = waterTop - range.shallowM
          for (let i = 0; i < kSteps - 1; i++) {
            const hStep = range.shallowM - stepRiser * (i + 1)
            const inset = cw + stepTread * (i + 0.5)
            const px =
              side === "w" ? room.x + inset
              : side === "e" ? room.x + w - inset
              : room.x + w / 2
            const py =
              side === "n" ? room.y + inset
              : side === "s" ? room.y + d - inset
              : room.y + d / 2
            prims.push({
              id: `pool-step-${room.id}-${i}`,
              kind: "tile",
              floorId: floor.id,
              roomId: room.id,
              tint: fin.coping,
              pos: [px - cx, floorY + hStep / 2, py - cz],
              args: horizontalSide ? [stepW, hStep, stepTread] : [stepTread, hStep, stepW],
            })
          }
        }
      } else {
        // Lubang vertikal lantai ini (void di lantai ini / tangga di lantai
        // bawah) juga MEMOTONG penutup lantai ruang — tanpa ini ubin utuh
        // menutup balik lubang slab (bug akses dak: tangga menembus slab
        // rooftop tapi tertutup ubin rooftop lounge yang seluas deck).
        const tilePieces = subtractRectHoles(
          { x: room.x, y: room.y, width: w, depth: d },
          holeRects,
        )
        if (tilePieces.length === 1) {
          prims.push({
            id: `tile-${room.id}`,
            kind: room.type === "taman" ? "garden" : "tile",
            floorId: floor.id,
            roomId: room.id,
            name: room.name,
            pos: [rx, roomTopY + 0.02, rz],
            args: [w, 0.05, d],
          })
        } else {
          for (const [ti, t] of tilePieces.entries()) {
            prims.push({
              id: `tile-${room.id}-h${ti}`,
              kind: room.type === "taman" ? "garden" : "tile",
              floorId: floor.id,
              roomId: room.id,
              name: room.name,
              pos: [t.x + t.width / 2 - cx, roomTopY + 0.02, t.y + t.depth / 2 - cz],
              args: [t.width, 0.05, t.depth],
            })
          }
        }
      }

      // Ruang tipe "tangga": render anak tangga solid memenuhi footprint —
      // naik dari lantai ini ke lantai berikutnya (anak teratas rata dengan
      // slab atas). Arah naik dari stairDirection; default sisi terpanjang.
      if (room.type === "tangga" && interiorStairLayout(room, stairRiseM(elev, room.floorId)).shape !== "lurus") {
        // ── L/U: anak per run (nomor menerus) + bordes solid + railing kedua
        // sisi lateral tiap run + keliling bordes — SELALU digambar, sama
        // seperti tangga lurus di bawah, tanpa mengecek status dinding (murah,
        // aman; tepi lateral run seringkali INTERIOR ke room — mis. sisi
        // bordes L-shape — dan tak pernah punya konsep dinding sama sekali di
        // desain SIDES-only build-model ini, jadi "asumsi dikelilingi dinding"
        // yang dipakai sebelumnya salah — lihat sameZoneOpenSpans yang bisa
        // men-drop dinding room ini sendiri via open-plan zona).
        const stairLayout = interiorStairLayout(room, stairRiseM(elev, room.floorId))
        for (const seg of stairLayout.segments) {
          if (seg.kind === "landing") {
            const hLand = seg.elevStartM
            prims.push({
              id: `stairland-${room.id}`,
              kind: "stair",
              floorId: floor.id,
              roomId: room.id,
              pos: [seg.x + seg.width / 2 - cx, roomTopY + hLand / 2, seg.y + seg.depth / 2 - cz],
              args: [seg.width, hLand, seg.depth],
            })
            const cy = roomTopY + hLand + 0.9
            // Bordes disambung run SEBELUM & SESUDAHnya (jalur jalan) di 2 dari
            // 4 sisinya — hanya sisi yang TIDAK bersambung segmen lain yang
            // benar-benar terbuka/butuh railing. Merender ke-4 sisi (versi lama)
            // menaruh palang persis di jalur naik/turun, menghalangi jalan.
            const otherSegs = stairLayout.segments.filter((s) => s !== seg)
            const landEdges = [
              { tag: "n" as const, horizontal: true, line: seg.y, c: seg.x + seg.width / 2, len: seg.width },
              { tag: "s" as const, horizontal: true, line: seg.y + seg.depth, c: seg.x + seg.width / 2, len: seg.width },
              { tag: "w" as const, horizontal: false, line: seg.x, c: seg.y + seg.depth / 2, len: seg.depth },
              { tag: "e" as const, horizontal: false, line: seg.x + seg.width, c: seg.y + seg.depth / 2, len: seg.depth },
            ] as const
            landEdges.forEach((e, ei) => {
              if (roomsAdjacentOnSide(seg, e.tag, otherSegs)) return // sambungan ke run — jalur jalan
              prims.push({
                id: `strail-${room.id}-land-${ei}`,
                kind: "rail",
                floorId: floor.id,
                roomId: room.id,
                pos: e.horizontal ? [e.c - cx, cy, e.line - cz] : [e.line - cx, cy, e.c - cz],
                args: e.horizontal ? [e.len + 0.02, 0.05, 0.05] : [0.05, 0.05, e.len + 0.02],
              })
            })
            continue
          }
          const segHorizontal = seg.dir === "w" || seg.dir === "e"
          const tread = seg.treadM!
          const laneW = segHorizontal ? seg.depth : seg.width
          for (let s = 0; s < seg.steps!; s++) {
            const hStep = seg.elevStartM + (seg.elevEndM - seg.elevStartM) * ((s + 1) / seg.steps!)
            const along = (s + 0.5) * tread
            const cxs =
              seg.dir === "e" ? seg.x + along
              : seg.dir === "w" ? seg.x + seg.width - along
              : seg.x + seg.width / 2
            const cys =
              seg.dir === "s" ? seg.y + along
              : seg.dir === "n" ? seg.y + seg.depth - along
              : seg.y + seg.depth / 2
            const globalStep = seg.firstStepNo! - 1 + s
            prims.push({
              id: `stair-${room.id}-${globalStep}`,
              kind: "stair",
              floorId: floor.id,
              roomId: room.id,
              pos: [cxs - cx, roomTopY + hStep / 2, cys - cz],
              args: segHorizontal ? [tread, hStep, laneW] : [laneW, hStep, tread],
            })

            // Handrail 0,9 m mengikuti kemiringan di KEDUA sisi lateral segmen
            // + tiang tiap 4 anak — persis pola tangga lurus, tapi memakai
            // koordinat SEGMEN (bukan room) karena tepi lateral run seringkali
            // interior ke room.
            const railY = roomTopY + hStep + 0.9
            for (const [tag, edge] of [["a", 0.04], ["b", laneW - 0.04]] as const) {
              const pos: [number, number, number] = segHorizontal
                ? [cxs - cx, railY, seg.y + edge - cz]
                : [seg.x + edge - cx, railY, cys - cz]
              prims.push({
                id: `strail-${room.id}-${globalStep}-${tag}`,
                kind: "rail",
                floorId: floor.id,
                roomId: room.id,
                pos,
                args: segHorizontal ? [tread + 0.02, 0.05, 0.05] : [0.05, 0.05, tread + 0.02],
              })
              if (s % 4 === 0) {
                prims.push({
                  id: `strailp-${room.id}-${globalStep}-${tag}`,
                  kind: "rail",
                  floorId: floor.id,
                  roomId: room.id,
                  pos: [pos[0], roomTopY + hStep + 0.45, pos[2]],
                  args: [0.04, 0.9, 0.04],
                })
              }
            }
          }
        }
      } else if (room.type === "tangga") {
        const spec = interiorStairSpec(room, stairRiseM(elev, room.floorId))
        const { dir, horizontalRun, widthM: stairW, totalRiseM: totalRise, steps } = spec
        const treadD = spec.treadM
        for (let s = 0; s < steps; s++) {
          const hStep = (totalRise * (s + 1)) / steps
          const along = (s + 0.5) * treadD
          const cxs =
            dir === "e" ? room.x + along
            : dir === "w" ? room.x + w - along
            : room.x + w / 2
          const cys =
            dir === "s" ? room.y + along
            : dir === "n" ? room.y + d - along
            : room.y + d / 2
          prims.push({
            id: `stair-${room.id}-${s}`,
            kind: "stair",
            floorId: floor.id,
            roomId: room.id,
            pos: [cxs - cx, roomTopY + hStep / 2, cys - cz],
            args: horizontalRun ? [treadD, hStep, stairW] : [stairW, hStep, treadD],
          })

          // Handrail 0,9 m mengikuti kemiringan (rel bertingkat per anak
          // tangga) di KEDUA sisi run + tiang tiap 4 anak — tangga tanpa
          // pegangan tidak layak huni.
          const railY = roomTopY + hStep + 0.9
          for (const [tag, edge] of [["a", 0.04], ["b", (horizontalRun ? d : w) - 0.04]] as const) {
            const pos: [number, number, number] = horizontalRun
              ? [cxs - cx, railY, room.y + edge - cz]
              : [room.x + edge - cx, railY, cys - cz]
            prims.push({
              id: `strail-${room.id}-${tag}-${s}`,
              kind: "rail",
              floorId: floor.id,
              roomId: room.id,
              pos,
              args: horizontalRun ? [treadD + 0.02, 0.05, 0.05] : [0.05, 0.05, treadD + 0.02],
            })
            if (s % 4 === 0) {
              prims.push({
                id: `strailp-${room.id}-${tag}-${s}`,
                kind: "rail",
                floorId: floor.id,
                roomId: room.id,
                pos: [pos[0], roomTopY + hStep + 0.45, pos[2]],
                args: [0.04, 0.9, 0.04],
              })
            }
          }
        }
      }

      // Per-edge risers: drawn by the higher room down to the neighbor (or slab).
      if (offset !== 0 || others.some((o) => (o.levelOffsetM ?? 0) !== offset)) {
        for (const side of SIDES) {
          const neighbor = roomsAdjacentOnSide(room, side, others)
          const otherOffset = neighbor?.levelOffsetM ?? 0
          if (offset <= otherOffset + 1e-6) continue
          const h = offset - otherOffset
          const yC = slabTopY + otherOffset + h / 2
          const pos: [number, number, number] =
            side === "n" ? [rx, yC, room.y - cz]
            : side === "s" ? [rx, yC, room.y + d - cz]
            : side === "w" ? [room.x - cx, yC, rz]
            : [room.x + w - cx, yC, rz]
          const args: [number, number, number] =
            side === "n" || side === "s" ? [w, h, t] : [t, h, d]
          prims.push({ id: `riser-${room.id}-${side}`, kind: "riser", floorId: floor.id, roomId: room.id, pos, args })
        }
      }

      if (!isOpen) {
        for (const side of SIDES) {
          const full: Span = { start: 0, end: side === "n" || side === "s" ? w : d }
          const horizontal = side === "n" || side === "s"
          const line =
            side === "n" ? room.y
            : side === "s" ? room.y + d
            : side === "w" ? room.x
            : room.x + w
          // De-dupe shared interior walls: every room drawing its own four
          // sides puts TWO coincident boxes on a shared boundary — coplanar
          // faces z-fight (flickering seams at room junctions). Ownership
          // rule: the wall on a shared line belongs to the room on its
          // NORTH/WEST side (that room's s/e wall); the neighbour's n/w span
          // over the same line is skipped. Walls without a neighbour beyond
          // (exterior / gaps) are unaffected.
          const neighborOwnedSpans: Span[] = []
          if (side === "n" || side === "w") {
            // Tolerance = WALL_T: hand-drawn/AI layouts often leave 5–6 cm
            // gaps between "adjacent" rooms; within a wall's thickness the two
            // walls visually merge into one, so drawing both gives a shimmering
            // near-coincident pair (prod report: tiled bath wall vs neighbour).
            const tol = WALL_T
            for (const other of others) {
              // NOTE: level offsets deliberately do NOT exempt a neighbour —
              // an offset only shifts a wall vertically; its X/Z plane stays
              // coincident with ours, so drawing both still z-fights over most
              // of the wall height (seen in prod: tiled bathroom wall
              // flickering against the neighbour's plain wall).
              // An open-type neighbour (taman/void/…) draws no interior wall of
              // its own — it can't own the boundary; keep this room's wall.
              if (OPEN_TYPES.includes(other.type)) continue
              if (side === "n" && Math.abs(other.y + other.depth - room.y) <= tol) {
                const start = Math.max(room.x, other.x) - room.x
                const end = Math.min(room.x + w, other.x + other.width) - room.x
                if (end - start > tol) neighborOwnedSpans.push({ start, end })
              } else if (side === "w" && Math.abs(other.x + other.width - room.x) <= tol) {
                const start = Math.max(room.y, other.y) - room.y
                const end = Math.min(room.y + d, other.y + other.depth) - room.y
                if (end - start > tol) neighborOwnedSpans.push({ start, end })
              }
            }
          }
          const wallSpans = subtractSpans(full, [
            ...sameZoneOpenSpans(room, side, others),
            ...doorCutsForWall(horizontal, line, horizontal ? room.x : room.y),
            ...neighborOwnedSpans,
            ...stairExitCutsForWall(horizontal, line, horizontal ? room.x : room.y),
          ])
          // Band cladding vertikal dinding ini (split-facade F1) — kosong =
          // jalur lama byte-identik.
          const wallBands = facadeBandsForWall(layout.facade, room.id, side, roomWallH)
          wallSpans.forEach((span, index) => {
            const spanLen = span.end - span.start
            const mid = (span.start + span.end) / 2
            const singleFullWall = wallSpans.length === 1 && Math.abs(span.start) < 0.01 && Math.abs(span.end - full.end) < 0.01
            const id = singleFullWall ? `w-${room.id}-${side}` : `w-${room.id}-${side}-${index}`
            const pos: [number, number, number] =
              side === "n" ? [room.x + mid - cx, roomWallCenterY, room.y - cz]
              : side === "s" ? [room.x + mid - cx, roomWallCenterY, room.y + d - cz]
              : side === "w" ? [room.x - cx, roomWallCenterY, room.y + mid - cz]
              : [room.x + w - cx, roomWallCenterY, room.y + mid - cz]
            pushBandedWallBox(prims, {
              idBase: id,
              floorId: floor.id,
              roomId: room.id,
              wallSide: side,
              horizontal: side === "n" || side === "s",
              posX: pos[0],
              posZ: pos[2],
              alongLen: spanLen + t,
              thick: t,
              wallBaseY: roomWallCenterY - roomWallH / 2,
              relY0: 0,
              relY1: roomWallH,
              bands: wallBands,
            })
          })
        }

        if (opts.showFurniture && room.type !== "tangga") {
          prims.push({
            id: `f-${room.id}`,
            kind: "furniture",
            floorId: floor.id,
            pos: [rx, roomTopY + 0.25, rz],
            args: [clamp(room.width * 0.45, 0.6, 1.6), 0.5, clamp(room.depth * 0.45, 0.6, 1.6)],
          })
        }
      } else if (room.type === "carport") {
        // Carport = tempat mobil BERATAP: kanopi slab tipis (~2,5 m) + tiang
        // ramping. Bila ruang lantai ATAS menutupi footprint carport, lantai
        // itu sudah menjadi atapnya — tanpa kanopi ganda. Tiang hanya di
        // sudut yang TIDAK menempel ruang berdinding (sisi rumah menopang
        // kanopi tanpa tiang).
        const floorAbove = layout.floors[i + 1]
        const coveredAbove =
          !!floorAbove &&
          layout.rooms.some((r) => r.floorId === floorAbove.id && rectsOverlap(r, room))
        if (!coveredAbove && room.carportCanopyMode !== "none") {
          const canopyH = 2.5
          prims.push({
            id: `cpr-${room.id}`,
            kind: "roof",
            floorId: floor.id,
            roomId: room.id,
            pos: [rx, roomTopY + canopyH + 0.06, rz],
            args: [w + 0.3, 0.12, d + 0.3],
          })
          const walled = (s: (typeof SIDES)[number]) => {
            const nb = roomsAdjacentOnSide(room, s, others)
            return !!nb && !OPEN_TYPES.includes(nb.type)
          }
          const sideWalled = { n: walled("n"), s: walled("s"), w: walled("w"), e: walled("e") }
          const inset = 0.15
          const corners: Array<{ tag: string; x: number; y: number; skip: boolean }> = [
            { tag: "nw", x: room.x + inset, y: room.y + inset, skip: sideWalled.n || sideWalled.w },
            { tag: "ne", x: room.x + w - inset, y: room.y + inset, skip: sideWalled.n || sideWalled.e },
            { tag: "sw", x: room.x + inset, y: room.y + d - inset, skip: sideWalled.s || sideWalled.w },
            { tag: "se", x: room.x + w - inset, y: room.y + d - inset, skip: sideWalled.s || sideWalled.e },
          ]
          for (const c of corners) {
            if (c.skip) continue
            prims.push({
              id: `cpp-${room.id}-${c.tag}`,
              kind: "rail",
              floorId: floor.id,
              roomId: room.id,
              pos: [c.x - cx, roomTopY + canopyH / 2, c.y - cz],
              args: [0.1, canopyH, 0.1],
            })
          }
        }
      } else if (room.type === "balkon") {
        // Balkon butuh pengaman pada sisi TERBUKA (railing ≥ 1,0 m). Sisi yang
        // menempel ruang berdinding sudah tertutup; sisi menempel balkon lain
        // dianggap menerus. MODEL railing bisa dipilih per balkon
        // (Room.railingStyle): kaca (default), besi (baluster vertikal),
        // tembok (parapet solid), kayu (bilah horizontal).
        const style = room.railingStyle ?? "kaca"
        const railH = 1.0
        const glassT = 0.05
        const balconyFascia = effectiveRoof(layout).fascia
        // Model GLB kustom (railingModelUrl) menggantikan VISUAL railing —
        // prim gaya bawaan di-skip; house-model men-tile GLB pada sisi
        // terbuka yang sama (hazardOpenSides). Fascia dak tetap digambar.
        const customRailing = !!room.railingModelUrl
        // Tepi depan MELENGKUNG (bowed, opsional): sisi terbuka yang paling
        // menjorok keluar footprint bangunan membusur — lihat balconyBowSide
        // & geometry/balcony-bow.ts. 0/absen → bowSide null, blok di bawah
        // tak pernah aktif (byte-identik dgn jalur lama).
        const bowM = clamp(room.edgeBowM ?? 0, 0, 1.5)
        const bowSide = bowM > 0 ? balconyBowSide(room, others, footprint) : null
        for (const side of hazardOpenSides(room, others)) {
          const horizontal = side === "n" || side === "s"
          const len = horizontal ? w : d
          const yC = roomTopY + railH / 2
          const pos: [number, number, number] =
            side === "n" ? [rx, yC, room.y - cz + glassT / 2]
            : side === "s" ? [rx, yC, room.y + d - cz - glassT / 2]
            : side === "w" ? [room.x - cx + glassT / 2, yC, rz]
            : [room.x + w - cx - glassT / 2, yC, rz]

          // Pelat lantai tepi bowed: strip kipas MENAMBAH tonjolan di luar
          // rect ruang (slab footprint biasa sudah menutupi rect-nya sendiri
          // — lihat blok slab per-floor di atas — jadi ini murni tambahan
          // volume busur). Independen dari customRailing/extCuts: bentuk
          // lantai tetap tampil walau railingnya GLB kustom atau terpotong
          // tangga eksterior.
          if (side === bowSide) {
            const edgeLine =
              side === "n" ? room.y - cz
              : side === "s" ? room.y + d - cz
              : side === "w" ? room.x - cx
              : room.x + w - cx
            for (const [fi, strip] of bowFloorStrips(len, bowM).entries()) {
              const [wx, wz] = bowLocalToWorld(side, strip.uMid, strip.vDepth / 2, rx, rz, edgeLine)
              prims.push({
                id: `slabb-${room.id}-${side}-${fi}`,
                kind: "slab",
                floorId: floor.id,
                roomId: room.id,
                pos: [wx, roomTopY - SLAB_T / 2, wz],
                args: horizontal ? [strip.uLen, SLAB_T, strip.vDepth] : [strip.vDepth, SLAB_T, strip.uLen],
              })
            }
          }

          // Lis fascia di tepi DAK balkon (sisi terbuka saja): band gelap
          // menjuntai dari muka slab ke bawah, persis di bawah railing —
          // signature fasad modern (tepi dak tebal gelap di atas garasi/teras).
          if (balconyFascia) {
            const fT = 0.06
            const fOut = 0.02 + fT / 2
            const fh = balconyFascia.heightM
            const fY = roomTopY + 0.01 - fh / 2
            prims.push({
              id: `fasciab-${room.id}-${side}`,
              kind: "fascia",
              floorId: floor.id,
              roomId: room.id,
              tint: balconyFascia.color,
              pos:
                side === "n" ? [rx, fY, room.y - cz - fOut]
                : side === "s" ? [rx, fY, room.y + d - cz + fOut]
                : side === "w" ? [room.x - cx - fOut, fY, rz]
                : [room.x + w - cx + fOut, fY, rz],
              args: horizontal ? [len + 2 * fOut + fT, fh, fT] : [fT, fh, len + 2 * fOut + fT],
            })
          }

          if (customRailing) {
            // Visual dari GLB (house-model) — tanpa prim gaya bawaan.
            continue
          }

          // R1: railing dipotong pada PENDARATAN tangga eksterior — pola
          // span+cut (spt void/rooftop). Tanpa tangga menempel: satu span
          // penuh dgn id & posisi persis jalur lama (byte-identik).
          const extCuts = exteriorStairLandingCuts(room, side, layout.exteriorElements)

          // Railing tepi bowed: segmen pendek berjajar mengikuti kurva
          // (polyline aproksimasi busur), sudut tiap segmen menyesuaikan
          // kemiringan lokalnya (rotationY). Tak digabung dgn jalur
          // pendaratan tangga eksterior (extCuts) — kombinasi bowed+cut di
          // luar lingkup fitur ini; balkon begitu tetap dapat railing LURUS
          // seperti sebelumnya (byte-identik), hanya pelat lantainya (di
          // atas) yang tetap membusur.
          if (side === bowSide && extCuts.length === 0) {
            const edgeLine =
              side === "n" ? room.y - cz
              : side === "s" ? room.y + d - cz
              : side === "w" ? room.x - cx
              : room.x + w - cx
            for (const [ri, seg] of bowRailSegments(len, bowM).entries()) {
              const [wx, wz] = bowLocalToWorld(side, seg.uMid, seg.vMid, rx, rz, edgeLine)
              const [dwx, dwz] = bowLocalToWorld(side, seg.dirU, seg.dirV, 0, 0, 0)
              const rotationY = -Math.atan2(dwz, dwx)
              const spPos: [number, number, number] = [wx, yC, wz]
              const spLen = seg.length
              const sfx = `-b${ri}`

              if (style === "kaca") {
                prims.push({
                  id: `railg-${room.id}-${side}${sfx}`,
                  kind: "rail_glass",
                  floorId: floor.id,
                  roomId: room.id,
                  rotationY,
                  pos: spPos,
                  args: [spLen, railH, glassT],
                })
              } else if (style === "tembok") {
                prims.push({
                  id: `railg-${room.id}-${side}${sfx}`,
                  kind: "wall",
                  floorId: floor.id,
                  roomId: room.id,
                  wallSide: side,
                  rotationY,
                  pos: spPos,
                  args: [spLen, railH, WALL_T],
                })
              } else {
                const tint = style === "kayu" ? "#8a6242" : "#3c4245"
                if (style === "besi") {
                  const count = Math.max(1, Math.floor(spLen / 0.12))
                  for (let b = 0; b < count; b++) {
                    const along = -spLen / 2 + (b + 0.5) * (spLen / count)
                    prims.push({
                      id: `railb-${room.id}-${side}${sfx}-${b}`,
                      kind: "rail",
                      floorId: floor.id,
                      roomId: room.id,
                      tint,
                      pos: [spPos[0] + dwx * along, yC, spPos[2] + dwz * along],
                      args: [0.02, railH, 0.02],
                    })
                  }
                } else {
                  // kayu: 3 bilah horizontal + tiang mengikuti chord segmen.
                  for (const [bi, hRel] of [0.25, 0.55, 0.85].entries()) {
                    prims.push({
                      id: `railb-${room.id}-${side}${sfx}-${bi}`,
                      kind: "rail",
                      floorId: floor.id,
                      roomId: room.id,
                      tint,
                      rotationY,
                      pos: [spPos[0], roomTopY + hRel * railH, spPos[2]],
                      args: [spLen, 0.06, 0.04],
                    })
                  }
                  const posts = Math.max(1, Math.ceil(spLen / 1.2) + 1)
                  for (let b = 0; b < posts; b++) {
                    const along = -spLen / 2 + (b * spLen) / Math.max(1, posts - 1)
                    prims.push({
                      id: `railp-${room.id}-${side}${sfx}-${b}`,
                      kind: "rail",
                      floorId: floor.id,
                      roomId: room.id,
                      tint,
                      pos: [spPos[0] + dwx * along, yC, spPos[2] + dwz * along],
                      args: [0.05, railH, 0.05],
                    })
                  }
                }
              }

              if (style !== "tembok") {
                prims.push({
                  id: `railh-${room.id}-${side}${sfx}`,
                  kind: "rail",
                  floorId: floor.id,
                  roomId: room.id,
                  ...(style === "kayu" ? { tint: "#8a6242" } : {}),
                  rotationY,
                  pos: [spPos[0], roomTopY + railH + 0.025, spPos[2]],
                  args: [spLen, 0.05, 0.06],
                })
              }
            }
            continue
          }

          const rSpans = extCuts.length
            ? subtractSpans({ start: 0, end: len }, extCuts)
            : [{ start: 0, end: len }]
          for (const [si, sp] of rSpans.entries()) {
            const sfx = extCuts.length ? `-s${si}` : ""
            const spLen = sp.end - sp.start
            if (spLen < 0.08) continue
            const spOff = (sp.start + sp.end) / 2 - len / 2
            const spPos: [number, number, number] = horizontal
              ? [pos[0] + spOff, pos[1], pos[2]]
              : [pos[0], pos[1], pos[2] + spOff]

          if (style === "kaca") {
            prims.push({
              id: `railg-${room.id}-${side}${sfx}`,
              kind: "rail_glass",
              floorId: floor.id,
              roomId: room.id,
              pos: spPos,
              args: horizontal ? [spLen, railH, glassT] : [glassT, railH, spLen],
            })
          } else if (style === "tembok") {
            // Parapet solid setebal dinding — ikut material/cladding ruang.
            prims.push({
              id: `railg-${room.id}-${side}${sfx}`,
              kind: "wall",
              floorId: floor.id,
              roomId: room.id,
              wallSide: side,
              pos: spPos,
              args: horizontal ? [spLen, railH, WALL_T] : [WALL_T, railH, spLen],
            })
          } else {
            // besi/kayu: baluster/bilah + rel — kind "rail" dgn tint per gaya.
            const tint = style === "kayu" ? "#8a6242" : "#3c4245"
            if (style === "besi") {
              const count = Math.max(2, Math.floor(spLen / 0.12))
              for (let b = 0; b < count; b++) {
                const along = -spLen / 2 + (b + 0.5) * (spLen / count)
                prims.push({
                  id: `railb-${room.id}-${side}${sfx}-${b}`,
                  kind: "rail",
                  floorId: floor.id,
                  roomId: room.id,
                  tint,
                  pos: horizontal ? [spPos[0] + along, yC, spPos[2]] : [spPos[0], yC, spPos[2] + along],
                  args: [0.02, railH, 0.02],
                })
              }
            } else {
              // kayu: 3 bilah horizontal + tiang tiap ~1,2 m
              for (const [bi, hRel] of [0.25, 0.55, 0.85].entries()) {
                prims.push({
                  id: `railb-${room.id}-${side}${sfx}-${bi}`,
                  kind: "rail",
                  floorId: floor.id,
                  roomId: room.id,
                  tint,
                  pos: [spPos[0], roomTopY + hRel * railH, spPos[2]],
                  args: horizontal ? [spLen, 0.06, 0.04] : [0.04, 0.06, spLen],
                })
              }
              const posts = Math.max(2, Math.ceil(spLen / 1.2) + 1)
              for (let b = 0; b < posts; b++) {
                const along = -spLen / 2 + (b * spLen) / (posts - 1)
                prims.push({
                  id: `railp-${room.id}-${side}${sfx}-${b}`,
                  kind: "rail",
                  floorId: floor.id,
                  roomId: room.id,
                  tint,
                  pos: horizontal ? [spPos[0] + along, yC, spPos[2]] : [spPos[0], yC, spPos[2] + along],
                  args: [0.05, railH, 0.05],
                })
              }
            }
          }

          if (style !== "tembok") {
            prims.push({
              id: `railh-${room.id}-${side}${sfx}`,
              kind: "rail",
              floorId: floor.id,
              roomId: room.id,
              ...(style === "kayu" ? { tint: "#8a6242" } : {}),
              pos: [spPos[0], roomTopY + railH + 0.025, spPos[2]],
              args: horizontal ? [spLen, 0.05, 0.06] : [0.06, 0.05, spLen],
            })
          }
          }
        }
      } else if (room.type === "void") {
        // A void is a floor opening (atrium/light well), NOT an outdoor room:
        // its interior sides stay open (neighbouring rooms draw their own
        // walls), but when it sits on the building's edge the facade must
        // still close it off — otherwise the 3D model shows a hole in the
        // exterior wall. Sides on the footprint boundary get a full wall.
        const tol = 0.05
        const exteriorSides = SIDES.filter((side) =>
          side === "n" ? Math.abs(room.y - footprint.y0) <= tol
          : side === "s" ? Math.abs(room.y + d - (footprint.y0 + footprint.depthM)) <= tol
          : side === "w" ? Math.abs(room.x - footprint.x0) <= tol
          : Math.abs(room.x + w - (footprint.x0 + footprint.widthM)) <= tol
        )
        for (const side of exteriorSides) {
          const pos: [number, number, number] =
            side === "n" ? [rx, roomWallCenterY, room.y - cz]
            : side === "s" ? [rx, roomWallCenterY, room.y + d - cz]
            : side === "w" ? [room.x - cx, roomWallCenterY, rz]
            : [room.x + w - cx, roomWallCenterY, rz]
          const args: [number, number, number] =
            side === "n" || side === "s" ? [w + t, roomWallH, t] : [t, roomWallH, d + t]
          prims.push({ id: `w-${room.id}-${side}`, kind: "wall", floorId: floor.id, roomId: room.id, wallSide: side, pos, args })
        }

        // Sisi INTERIOR yang jadi terbuka karena berbagi zona open-plan dengan
        // tetangga solid (dindingnya di-drop oleh sameZoneOpenSpans, di luar
        // kendali blok ini) butuh pengaman — tanpa ini lubang lantai jadi
        // drop-off tanpa pembatas. Sisi footprint-boundary DI-SKIP di sini
        // (sudah dinding penuh dari loop di atas — jangan dobel render).
        // Per-BENTANG (hazardOpenSpans), bukan whole-side: void seringkali
        // ditempatkan manual & tetangganya (mis. void lain) cuma menutupi
        // SEBAGIAN sisi — whole-side salah menganggap seluruh sisi tertutup.
        // Bentang yang persis di jalur KELUAR tangga dari lantai bawah (kalau
        // ada, lihat stairExitCutsForWall — dipakai bersama loop dinding biasa
        // di atas) dikecualikan — jangan pagari mulut tangga sendiri
        // (dilaporkan: baluster menerus menutup jalan naik).
        // Default besi (baluster rapat) — lebih terlihat & sulit dipanjat anak
        // drpd kaca polos untuk lubang lantai. Balkon tetap default "kaca"
        // (tak diubah, lihat blok balkon di atas).
        const railStyle = room.railingStyle ?? "besi"
        const railH = 1.0
        for (const side of SIDES) {
          if (exteriorSides.includes(side)) continue
          const horizontal = side === "n" || side === "s"
          const openSpans = hazardOpenSpans(room, side, others)
          if (openSpans.length === 0) continue
          const line = side === "n" ? room.y : side === "s" ? room.y + d : side === "w" ? room.x : room.x + w
          const exitCuts = stairExitCutsForWall(horizontal, line, horizontal ? room.x : room.y)
          const finalSpans = exitCuts.length ? openSpans.flatMap((sp) => subtractSpans(sp, exitCuts)) : openSpans
          const yC = roomTopY + railH / 2
          finalSpans.forEach((span, si) => {
            const len = span.end - span.start
            if (len < 0.1) return
            const mid = (span.start + span.end) / 2
            const pos: [number, number, number] = horizontal
              ? [room.x + mid - cx, yC, line - cz]
              : [line - cx, yC, room.y + mid - cz]
            prims.push(...railSidePrims(side, railStyle, pos, len, railH, roomTopY, floor.id, room.id, `vrail-${room.id}-${si}-`))
          })
        }
      }

      labels.push({
        id: `lbl-${room.id}`,
        floorId: floor.id,
        roomId: room.id,
        name: room.name,
        pos: [rx, roomTopY + (isOpen ? 0.6 : wallH * 0.62), rz],
      })
    }

    // Openings (door/window panels on room edges)
    for (const op of layout.openings.filter((o) => o.floorId === floor.id)) {
      const parsed = parseOpeningWall(op.wallId)
      if (!parsed) continue
      const room = rooms.find((r) => r.id === parsed.roomId)
      if (!room) continue
      const seg = openingSegment(room, parsed.side, op.positionM, op.widthM)
      const mx = (seg.x1 + seg.x2) / 2 - cx
      const mz = (seg.y1 + seg.y2) / 2 - cz
      const horizontal = parsed.side === "n" || parsed.side === "s"
      const isDoor = op.type === "door"
      const sill = Math.max(0, isDoor ? 0 : op.sillHeightM ?? 0.9)
      const configuredH =
        op.headHeightM !== undefined && op.headHeightM > sill
          ? op.headHeightM - sill
          : op.heightM
      // Plafon rata: tinggi dinding host = wallH − offset (E2).
      const hostWallH = Math.max(0.4, wallH - (room.levelOffsetM ?? 0))
      const availableH = Math.max(0.2, hostWallH - sill)
      const panelH = clamp(configuredH || (isDoor ? 2.1 : 1.2), 0.2, availableH)
      // Bukaan ikut lantai RUANG host: split-level (levelOffsetM) menggeser
      // dinding ruang ke atas (roomTopY) — panel/ambang/balok bukaan harus
      // ikut naik, bukan menempel slab dasar.
      const opBaseY = slabTopY + (room.levelOffsetM ?? 0)
      const yC = opBaseY + sill + panelH / 2
      const thick = WALL_T + 0.06

      // Bukaan melubangi dinding sungguhan (doorCuts di atas memotong bentang
      // penuh, termasuk dinding tetangga yang segaris). Yang digambar kembali:
      // balok ATAS (pintu & jendela) dan ambang BAWAH (jendela) — keduanya
      // membawa wallSide agar cladding fasad ikut menutupinya.
      {
        // Identitas strip = ruang PEMILIK dinding (aturan dedupe: garis batas
        // milik ruang di sisi utara/barat garis → dinding s/e ruang itu).
        // Bukaan boleh tercatat di dinding n/w ruang seberang; tanpa resolusi
        // ini strip membawa key ruang seberang → cladding/material yang di-set
        // lewat klik dinding tidak pernah menutup strip di atas pintu, dan
        // muka luar/dalamnya terbalik (laporan Rumah Qyfa: tembok di atas
        // pintu ayun "beda sendiri").
        let stripRoomId = room.id
        let stripSide = parsed.side
        if (parsed.side === "n" || parsed.side === "w") {
          const tol = WALL_T
          const midAlong = horizontal ? (seg.x1 + seg.x2) / 2 : (seg.y1 + seg.y2) / 2
          const owner = rooms.find((o) =>
            o.id !== room.id &&
            !OPEN_TYPES.includes(o.type) &&
            (parsed.side === "n"
              ? Math.abs(o.y + o.depth - room.y) <= tol && midAlong > o.x && midAlong < o.x + o.width
              : Math.abs(o.x + o.width - room.x) <= tol && midAlong > o.y && midAlong < o.y + o.depth)
          )
          if (owner) {
            stripRoomId = owner.id
            stripSide = parsed.side === "n" ? "s" : "e"
          }
        }
        // Band cladding milik dinding PEMILIK strip (bukan room pengklik) —
        // tanpa ini band horizontal tidak menutup balok di atas pintu.
        const stripBands = facadeBandsForWall(layout.facade, stripRoomId, stripSide, hostWallH)
        const headerH = hostWallH - (sill + panelH)
        if (headerH > 0.05) {
          pushBandedWallBox(prims, {
            idBase: `wh-${op.id}`,
            floorId: floor.id,
            roomId: stripRoomId,
            wallSide: stripSide,
            horizontal,
            posX: mx,
            posZ: mz,
            alongLen: op.widthM,
            thick: WALL_T,
            wallBaseY: opBaseY,
            relY0: sill + panelH,
            relY1: hostWallH,
            bands: stripBands,
          })
        }
        if (!isDoor && sill > 0.05) {
          pushBandedWallBox(prims, {
            idBase: `ws-${op.id}`,
            floorId: floor.id,
            roomId: stripRoomId,
            wallSide: stripSide,
            horizontal,
            posX: mx,
            posZ: mz,
            alongLen: op.widthM,
            thick: WALL_T,
            wallBaseY: opBaseY,
            relY0: 0,
            relY1: sill,
            bands: stripBands,
          })
        }
      }

      // PORTHOLE (jendela bulat, Track B PLAN_TUTUP_GAP): lubang bukaan =
      // kotak (bentang × panelH) dengan cakram kaca di tengah. Isi 4 SUDUT
      // kotak dgn wall-box kecil → bukaan terbaca OKTAGON/bundar dari segala
      // sudut (bukan hanya cakram menutupi kotak, MVP). Ukuran sudut a =
      // r·(1 − 1/√2) menjaga fill tepat menyinggung lingkaran radius r,
      // tak menutupi kaca. Prim membawa wallSide → cladding fasad ikut.
      if (op.kind === "porthole") {
        const r = Math.min(op.widthM, panelH) / 2
        const a = r * (1 - Math.SQRT1_2)
        if (a > 0.02) {
          const halfW = op.widthM / 2
          const halfH = panelH / 2
          const alongOff = halfW - a / 2
          const yTop = opBaseY + sill + panelH - a / 2
          const yBot = opBaseY + sill + a / 2
          const corners: Array<[number, number]> = [
            [alongOff, yTop],
            [-alongOff, yTop],
            [alongOff, yBot],
            [-alongOff, yBot],
          ]
          for (const [ci, [along, cy]] of corners.entries()) {
            prims.push({
              id: `wc-${op.id}-${ci}`,
              kind: "wall",
              floorId: floor.id,
              roomId: room.id,
              wallSide: parsed.side,
              pos: horizontal ? [mx + along, cy, mz] : [mx, cy, mz + along],
              args: horizontal ? [a, a, WALL_T] : [WALL_T, a, a],
            })
          }
        }
      }

      // ARCH & KAPSUL (Studio Komponen — siluet lengkung fasad mediterania):
      // lubang dinding TETAP PERSEGI (segmentasi dinding tak berubah, sama
      // prinsip dgn porthole di atas); kaca/daun TETAP prim persegi penuh —
      // corner-fill di sini menutupi sudutnya dari luar sehingga yang
      // terlihat adalah siluet melengkung. `frameColor` (kalau di-set)
      // menang di corner-fill supaya "kusen" ikut warna kustom; absen =
      // menyatu dgn cladding dinding (jalur sama dgn porthole).
      if (op.archShape === "arch" || op.archShape === "capsule") {
        const tint = op.frameColor
        const alongBase = horizontal ? mx : mz
        const crossCoord = horizontal ? mz : mx
        const halfW = op.widthM / 2
        if (op.archShape === "arch") {
          // Radius = widthM/2; springline (awal lengkung) = heightM − r.
          const r = Math.min(op.widthM, panelH) / 2
          const springlineY = opBaseY + sill + panelH - r
          for (const alongSign of [1, -1] as const) {
            prims.push(
              ...quarterArcCornerFillPrims({
                idBase: `wa-${op.id}-${alongSign > 0 ? "r" : "l"}`,
                floorId: floor.id,
                roomId: room.id,
                wallSide: parsed.side,
                horizontal,
                sweepAxis: "along",
                alongBase,
                crossCoord,
                alongSign,
                yBase: springlineY,
                ySign: 1,
                r,
                tint,
              }),
            )
          }
        } else {
          // Kapsul (pill/stadium): dua ujung membundar. Radius = separuh
          // dimensi PENDEK; orientasi (horizontal/vertikal) dari rasio w:h.
          const r = Math.min(op.widthM, panelH) / 2
          if (op.widthM >= panelH) {
            // Horizontal: ujung KIRI/KANAN membundar — kurva x=f(y), jadi
            // sumbu tangga = "height" (langkah membagi tinggi, lebar
            // diturunkan dari kurva).
            const leftPivot = alongBase - (halfW - r)
            const rightPivot = alongBase + (halfW - r)
            for (const ySign of [1, -1] as const) {
              prims.push(
                ...quarterArcCornerFillPrims({
                  idBase: `wa-${op.id}-l${ySign > 0 ? "t" : "b"}`,
                  floorId: floor.id,
                  roomId: room.id,
                  wallSide: parsed.side,
                  horizontal,
                  sweepAxis: "height",
                  alongBase: leftPivot,
                  crossCoord,
                  alongSign: -1,
                  yBase: yC,
                  ySign,
                  r,
                  tint,
                }),
                ...quarterArcCornerFillPrims({
                  idBase: `wa-${op.id}-r${ySign > 0 ? "t" : "b"}`,
                  floorId: floor.id,
                  roomId: room.id,
                  wallSide: parsed.side,
                  horizontal,
                  sweepAxis: "height",
                  alongBase: rightPivot,
                  crossCoord,
                  alongSign: 1,
                  yBase: yC,
                  ySign,
                  r,
                  tint,
                }),
              )
            }
          } else {
            // Vertikal: ujung ATAS/BAWAH membundar — arch normal di atas
            // DAN cerminnya di bawah (sill).
            const topPivotY = opBaseY + sill + panelH - r
            const botPivotY = opBaseY + sill + r
            for (const [pivotY, ySign, tag] of [
              [topPivotY, 1, "t"],
              [botPivotY, -1, "b"],
            ] as const) {
              for (const alongSign of [1, -1] as const) {
                prims.push(
                  ...quarterArcCornerFillPrims({
                    idBase: `wa-${op.id}-${tag}${alongSign > 0 ? "r" : "l"}`,
                    floorId: floor.id,
                    roomId: room.id,
                    wallSide: parsed.side,
                    horizontal,
                    sweepAxis: "along",
                    alongBase,
                    crossCoord,
                    alongSign,
                    yBase: pivotY,
                    ySign,
                    r,
                    tint,
                  }),
                )
              }
            }
          }
        }
      }

      // TRAPESIUM (tepi atas miring mengikuti kemiringan atap/gable): lubang
      // bukaan tetap PERSEGI setinggi panelH (sisi TINGGI, tak berubah); sudut
      // atas sisi RENDAH (arah dari tanda topSlopeM) ditutup step-fill
      // staircase — siluet bukaan terbaca trapesium. Sama idiom dgn ARCH &
      // KAPSUL di atas: prim "wall" + wallSide ikut cladding fasad, kaca/daun
      // tetap prim persegi penuh di baliknya. Independen dari archShape
      // (kombinasi keduanya bukan kasus yang ditargetkan — jarang dipakai
      // bersamaan di praktik).
      if (op.topSlopeM) {
        const drop = Math.abs(op.topSlopeM)
        const lowSign: 1 | -1 = op.topSlopeM > 0 ? -1 : 1
        const alongBase = horizontal ? mx : mz
        const crossCoord = horizontal ? mz : mx
        const topY = opBaseY + sill + panelH
        prims.push(
          ...topSlopeCornerFillPrims({
            idBase: `wa-${op.id}-tp`,
            floorId: floor.id,
            roomId: room.id,
            wallSide: parsed.side,
            horizontal,
            alongBase,
            crossCoord,
            width: op.widthM,
            topY,
            drop,
            lowSign,
            tint: op.frameColor,
          }),
        )
      }

      // "Bukaan tanpa pintu": the hole + header IS the visual — no leaf panel.
      if (op.kind === "open_passage") continue

      // Arah INTERIOR sepanjang normal dinding: kebalikan arah "keluar" (out)
      // yang dipakai louver fasad (proven exterior). Gorden digantung ke sisi
      // dalam ini.
      const outDir = parsed.side === "n" || parsed.side === "w" ? -1 : 1
      prims.push({
        id: `op-${op.id}`,
        kind: isDoor ? "door" : "window",
        floorId: floor.id,
        roomId: room.id,
        openingId: op.id,
        interiorSign: -outDir,
        opening: {
          type: op.type,
          kind: op.kind,
          purpose: op.purpose,
          operation: op.operation,
          frameMaterial: op.frameMaterial,
          frameColor: op.frameColor,
          privacyLevel: op.privacyLevel,
          shading: op.shading,
          sillHeightM: op.sillHeightM,
          headHeightM: op.headHeightM,
          notes: op.notes,
          modelUrl: op.modelUrl,
          curtainModelUrl: op.curtainModelUrl,
        },
        pos: [mx, yC, mz],
        args: horizontal ? [op.widthM, panelH, thick] : [thick, panelH, op.widthM],
      })

      // BINGKAI MENONJOL (D1, ref prototipe v5): 4 box bingkai mengelilingi
      // bukaan, menonjol KELUAR dari muka dinding sejauh frameDepthM. Kind
      // "louver" (castShadow) + tint warna kusen. Absen/0 = flush (tanpa prim).
      if (op.frameDepthM && op.frameDepthM > 0.05) {
        const fd = Math.min(0.8, op.frameDepthM)
        const FR_T = 0.12
        const frTint = op.frameColor ?? "#3c4245"
        // Berakar 0.02 ke dalam dinding agar tak melayang; menonjol fd keluar.
        const frOut = outDir * (WALL_T / 2 - 0.02 + fd / 2)
        const fx = horizontal ? mx : mx + frOut
        const fz = horizontal ? mz + frOut : mz
        const yTop = opBaseY + sill + panelH + FR_T / 2
        const yBot = opBaseY + sill - FR_T / 2
        const spanOut = op.widthM + 2 * FR_T
        const bars: Array<[string, [number, number, number], [number, number, number]]> =
          horizontal
            ? [
                ["t", [fx, yTop, fz], [spanOut, FR_T, fd + 0.02]],
                ["b", [fx, yBot, fz], [spanOut, FR_T, fd + 0.02]],
                ["l", [fx - (op.widthM + FR_T) / 2, yC, fz], [FR_T, panelH, fd + 0.02]],
                ["r", [fx + (op.widthM + FR_T) / 2, yC, fz], [FR_T, panelH, fd + 0.02]],
              ]
            : [
                ["t", [fx, yTop, fz], [fd + 0.02, FR_T, spanOut]],
                ["b", [fx, yBot, fz], [fd + 0.02, FR_T, spanOut]],
                ["l", [fx, yC, fz - (op.widthM + FR_T) / 2], [fd + 0.02, panelH, FR_T]],
                ["r", [fx, yC, fz + (op.widthM + FR_T) / 2], [fd + 0.02, panelH, FR_T]],
              ]
        for (const [suffix, fpos, fargs] of bars) {
          prims.push({
            id: `ofr-${op.id}-${suffix}`,
            kind: "louver",
            floorId: floor.id,
            roomId: room.id,
            tint: frTint,
            pos: fpos,
            args: fargs,
          })
        }
      }
    }

    // Elemen fasad mandiri: louver band — deretan sirip vertikal PROUD di muka
    // luar dinding host (menutupi band jendela; look fasad modern). Sirip
    // pitch 0,25 m + rel atas/bawah; posisi memakai konvensi openingSegment.
    for (const fe of (layout.facadeElements ?? []).filter((f) => f.floorId === floor.id)) {
      const parsed = parseOpeningWall(fe.wallId)
      if (!parsed) continue
      const horizontal = parsed.side === "n" || parsed.side === "s"
      let host: Pick<Room, "id" | "levelOffsetM" | "x" | "y" | "width" | "depth">
      if (isEdgeWallRoomId(parsed.roomId)) {
        // Host w-edge: bukan Room nyata — bangun host semu dari span dinding
        // tepi TERLEBAR sisi ini (satu sumber kebenaran dgn dinding w-edge
        // itu sendiri, lib/geometry/edge-wall.ts). x/y = garis tepi &
        // width/depth = 0 pada sumbu yang tak dipakai openingSegment utk
        // sisi ini, sehingga formula n/s/w/e generiknya tetap berlaku tanpa
        // cabang per-sisi terpisah di sini.
        const geom = edgeWallGeom.get(parsed.side)
        const hostSpan = widestEdgeWallSpan(geom ?? null)
        if (!geom || !hostSpan) continue
        host = {
          id: edgeWallRoomId(floor.id),
          levelOffsetM: undefined,
          x: horizontal ? hostSpan.start : geom.line,
          y: horizontal ? geom.line : hostSpan.start,
          width: horizontal ? hostSpan.end - hostSpan.start : 0,
          depth: horizontal ? 0 : hostSpan.end - hostSpan.start,
        }
      } else {
        const found = rooms.find((r) => r.id === parsed.roomId)
        if (!found) continue
        host = found
      }
      const seg = openingSegment(host, parsed.side, fe.positionM, fe.widthM)
      // Arah keluar dari muka dinding (ruang ada di sisi dalam garis).
      const out = parsed.side === "n" || parsed.side === "w" ? -1 : 1
      const FIN_W = 0.08
      const FIN_D = 0.15
      const PITCH = 0.25
      const standoff = WALL_T / 2 + 0.06 + FIN_D / 2
      const baseYFe = slabTopY + (host.levelOffsetM ?? 0)
      const feWallH = Math.max(0.4, wallH - (host.levelOffsetM ?? 0))
      const bandH = clamp(fe.heightM, 0.3, feWallH)
      const sillFe = clamp(fe.sillHeightM, 0, feWallH - bandH)
      const yBand = baseYFe + sillFe + bandH / 2
      const lineX = horizontal ? (seg.x1 + seg.x2) / 2 : seg.x1
      const lineY = horizontal ? seg.y1 : (seg.y1 + seg.y2) / 2
      const cxOff = lineX - cx
      const czOff = lineY - cz
      const span = horizontal ? seg.x2 - seg.x1 : seg.y2 - seg.y1
      // colorHex menang atas warna finish (mis. cocokkan dgn cladding kayu
      // gelap); absen → byte-identik jalur lama.
      const tint = fe.colorHex ?? LOUVER_FINISH_COLORS[fe.finish]
      const feKind = fe.kind ?? "louver_band"
      const yBottom = baseYFe + sillFe
      if (fe.modelUrl) {
        prims.push({
          id: `louv-${fe.id}-model`,
          kind: "louver",
          floorId: floor.id,
          roomId: host.id,
          tint,
          facadeElement: {
            id: fe.id,
            kind: feKind,
            modelUrl: fe.modelUrl,
            modelAssetId: fe.modelAssetId,
          },
          pos: horizontal
            ? [cxOff, yBand, czOff + out * standoff]
            : [cxOff + out * standoff, yBand, czOff],
          args: horizontal ? [span, bandH, FIN_D] : [FIN_D, bandH, span],
        })
        continue
      }
      const pattern = fe.pattern
      if (!pattern) {
        // Jalur numerik LAMA — PERSIS (byte-identity tanpa pattern).
        // Sirip VERTIKAL (louver_band + roster_screen) — pitch sepanjang bentang.
        if (feKind === "louver_band" || feKind === "roster_screen") {
          const vCount = Math.max(2, Math.floor(span / PITCH))
          for (let i = 0; i < vCount; i++) {
            const along = -span / 2 + (i + 0.5) * (span / vCount)
            prims.push({
              id: `louv-${fe.id}-v${i}`,
              kind: "louver",
              floorId: floor.id,
              roomId: host.id,
              tint,
              pos: horizontal
                ? [cxOff + along, yBand, czOff + out * standoff]
                : [cxOff + out * standoff, yBand, czOff + along],
              args: horizontal ? [FIN_W, bandH, FIN_D] : [FIN_D, bandH, FIN_W],
            })
          }
        }
        // Bilah HORIZONTAL (slat_horizontal + roster_screen) — pitch sepanjang tinggi.
        if (feKind === "slat_horizontal" || feKind === "roster_screen") {
          const hCount = Math.max(2, Math.floor(bandH / PITCH))
          for (let i = 0; i < hCount; i++) {
            const y = yBottom + (i + 0.5) * (bandH / hCount)
            prims.push({
              id: `louv-${fe.id}-h${i}`,
              kind: "louver",
              floorId: floor.id,
              roomId: host.id,
              tint,
              pos: horizontal
                ? [cxOff, y, czOff + out * standoff]
                : [cxOff + out * standoff, y, czOff],
              args: horizontal ? [span, FIN_W, FIN_D] : [FIN_D, FIN_W, span],
            })
          }
        }
      } else {
        // PATTERN KUSTOM (ComponentPatternSpec) — menggantikan konstanta
        // pitch/lebar/kedalaman bawaan `feKind`. `orientation` menggantikan
        // pemilihan arah bilah dari `feKind` (absen = arah alami kind):
        // "v"=vertikal (ala louver_band), "h"=horizontal (ala slat_horizontal),
        // "grid"/"cross"=dua arah (ala roster_screen). `rhythm` mengelompokkan
        // spasi (lihat component-pattern.ts); `frame`=true menambah bingkai
        // kiri/kanan (atas/bawah SUDAH selalu ada, lihat blok rel di bawah).
        const effPitch = resolvePitchM(pattern, PITCH)
        const effBarW = resolveBarWidthM(pattern, FIN_W)
        const effBarD = resolveBarDepthM(pattern, FIN_D)
        const defaultOrientation = feKind === "slat_horizontal" ? "h" : feKind === "roster_screen" ? "grid" : "v"
        const orientation = resolveOrientation(pattern, defaultOrientation)
        const showV = orientation === "v" || orientation === "grid" || orientation === "cross"
        const showH = orientation === "h" || orientation === "grid" || orientation === "cross"
        // Reveal line/nat beton (`pattern.inset`): bilah TENGGELAM di muka
        // dinding alih-alih menonjol keluar — kebalikan `standoff` proud di
        // atas. Kedalaman efektif dibatasi ≈ WALL_T/2 - 0.01 supaya tak
        // tembus ke sisi dalam dinding; offset 0.01 yang sama dipakai
        // sebagai "reveal gap" (muka bilah sedikit di belakang muka dinding,
        // idiom sama dgn inset 0.02 pada kusen jendela di atas) hingga muka
        // terdalam bilah tak pernah melewati sumbu tengah dinding.
        // Hanya memengaruhi bilah pola & bingkainya — rel atas/bawah (selalu
        // ada, lihat blok di bawah) tetap proud (kedalamannya FIN_D tetap,
        // tak proporsional thd effBarD tipis sehingga tak aman diinset).
        const insetOn = wantsInset(pattern)
        const insetBarD = Math.min(effBarD, WALL_T / 2 - 0.01)
        const barStandoff = insetOn ? WALL_T / 2 - 0.01 - insetBarD / 2 : standoff
        const barEffD = insetOn ? insetBarD : effBarD
        if (showV) {
          const offsets = patternBarOffsets(span, effPitch, pattern.rhythm)
          offsets.forEach((along, i) => {
            prims.push({
              id: `louv-${fe.id}-v${i}`,
              kind: "louver",
              floorId: floor.id,
              roomId: host.id,
              tint,
              pos: horizontal
                ? [cxOff + along, yBand, czOff + out * barStandoff]
                : [cxOff + out * barStandoff, yBand, czOff + along],
              args: horizontal ? [effBarW, bandH, barEffD] : [barEffD, bandH, effBarW],
            })
          })
        }
        if (showH) {
          const offsets = patternBarOffsets(bandH, effPitch, pattern.rhythm)
          offsets.forEach((offset, i) => {
            const y = yBand + offset
            prims.push({
              id: `louv-${fe.id}-h${i}`,
              kind: "louver",
              floorId: floor.id,
              roomId: host.id,
              tint,
              pos: horizontal
                ? [cxOff, y, czOff + out * barStandoff]
                : [cxOff + out * barStandoff, y, czOff],
              args: horizontal ? [span, effBarW, barEffD] : [barEffD, effBarW, span],
            })
          })
        }
        if (wantsFrame(pattern)) {
          for (const [tag, alongEdge] of [["l", -span / 2], ["r", span / 2]] as const) {
            prims.push({
              id: `louvr-${fe.id}-${tag}`,
              kind: "louver",
              floorId: floor.id,
              roomId: host.id,
              tint: "#3c4245",
              pos: horizontal
                ? [cxOff + alongEdge, yBand, czOff + out * barStandoff]
                : [cxOff + out * barStandoff, yBand, czOff + alongEdge],
              args: horizontal ? [0.06, bandH + 0.06, barEffD + 0.02] : [barEffD + 0.02, bandH + 0.06, 0.06],
            })
          }
        }
      }
      // Rel/bingkai atas & bawah pengikat (semua jenis).
      for (const [tag, yRel] of [["t", baseYFe + sillFe + bandH], ["b", baseYFe + sillFe]] as const) {
        prims.push({
          id: `louvr-${fe.id}-${tag}`,
          kind: "louver",
          floorId: floor.id,
          roomId: host.id,
          tint: "#3c4245",
          pos: horizontal
            ? [cxOff, yRel, czOff + out * standoff]
            : [cxOff + out * standoff, yRel, czOff],
          args: horizontal ? [span, 0.06, FIN_D + 0.02] : [FIN_D + 0.02, 0.06, span],
        })
      }
    }
  })

  // Elemen tapak/fasad additive memakai source of truth yang sama dengan editor
  // 2D. Derivasi dipisah agar buildModel tidak menjadi tempat formula domain.
  prims.push(
    ...exteriorElementPrimitives(layout.exteriorElements ?? [], {
      centerX: cx,
      centerZ: cz,
      floorBaseY: new Map(
        layout.floors.map((floor, index) => {
          const e = elev.get(floor.id)
          return [
            floor.id,
            e
              ? e.baseY + e.index * gap
              : (floor.id === "floor-rooftop" ? regularFloors.length : index) *
                (floorStep + gap),
          ]
        }),
      ),
    }),
  )

  // Tangga monyet (ship ladder servis) akses dak — menempel muka luar bangunan
  // pada sisi terpilih, dari tanah sampai 1 m di atas permukaan dak (pegangan
  // menerus standar). Dua rel vertikal + anak tangga tiap 30 cm.
  if (hasRooftopFloor && layout.rooftopAccess?.kind === "tangga_monyet") {
    const side = layout.rooftopAccess.side
    const rtElev = elev.get("floor-rooftop")
    const deckTopY =
      (rtElev
        ? rtElev.baseY + rtElev.index * gap
        : regularFloors.length * (floorStep + gap)) + SLAB_T
    const railTopY = deckTopY + 1.0
    const LW = 0.5 // lebar tangga (jarak antar rel)
    const RT = 0.05 // tebal rel
    const OFF = 0.15 // jarak sumbu tangga dari muka dinding
    const horizontal = side === "n" || side === "s"
    // Posisi sepanjang sisi (m dari ujung sisi); absent = tengah. Clamp
    // setengah lebar tangga dari tiap ujung.
    const edgeLen = horizontal ? fpW : fpD
    const posM = Math.min(
      Math.max(layout.rooftopAccess.posM ?? edgeLen / 2, LW / 2),
      Math.max(LW / 2, edgeLen - LW / 2),
    )
    const lx =
      side === "w"
        ? fpCx - fpW / 2 - OFF
        : side === "e"
          ? fpCx + fpW / 2 + OFF
          : fpCx - fpW / 2 + posM
    const lz =
      side === "n"
        ? fpCz - fpD / 2 - OFF
        : side === "s"
          ? fpCz + fpD / 2 + OFF
          : fpCz - fpD / 2 + posM
    const tint = "#3c4245"
    for (const sgn of [-1, 1]) {
      prims.push({
        id: `rooftop-ladder-rail${sgn > 0 ? "b" : "a"}`,
        kind: "rail",
        floorId: null,
        tint,
        pos: [
          horizontal ? lx + (sgn * LW) / 2 : lx,
          railTopY / 2,
          horizontal ? lz : lz + (sgn * LW) / 2,
        ],
        args: [RT, railTopY, RT],
      })
    }
    const rungs = Math.floor(deckTopY / 0.3)
    for (let r = 1; r <= rungs; r++) {
      prims.push({
        id: `rooftop-ladder-rung-${r}`,
        kind: "rail",
        floorId: null,
        tint,
        pos: [lx, r * 0.3, lz],
        args: horizontal ? [LW, 0.035, 0.035] : [0.035, 0.035, LW],
      })
    }
  }

  const topElev = topFloorId ? elev.get(topFloorId) : undefined
  const topBaseY = topElev
    ? topElev.baseY + topElev.index * gap
    : topRegIdx * (floorStep + gap)
  const roofY = topBaseY + SLAB_T + (topElev?.wallHM ?? WALL_H)

  // End-cap prisma gable yang harus DIBUKA: ujung yang punya sopi-sopi.
  // Ridge along x → neg=w/pos=e; along z → neg=n/pos=s. undefined bila tak ada
  // (spread kondisional menjaga byte-identity prim legacy).
  const openEndsFor = (
    gableEnds: Partial<Record<"n" | "s" | "w" | "e", "wall" | "glass">> | undefined,
    ridgeAlongX: boolean,
  ): { neg?: boolean; pos?: boolean } | undefined => {
    if (!gableEnds) return undefined
    const neg = !!gableEnds[ridgeAlongX ? "w" : "n"]
    const pos = !!gableEnds[ridgeAlongX ? "e" : "s"]
    if (!neg && !pos) return undefined
    return { ...(neg ? { neg: true } : {}), ...(pos ? { pos: true } : {}) }
  }

  // SOPI-SOPI (G2): prim `wall_gable` pengisi ujung bubungan pelana (dinding/
  // kaca). Ridge along x → ujung w/e; along z → n/s; sisi lain diabaikan.
  // Geometri origin di TENGAH-DASAR (y = puncak dinding), bukan center.
  const pushGableEnds = (
    idPrefix: string,
    gwFloorId: string,
    gableEnds: Partial<Record<"n" | "s" | "w" | "e", "wall" | "glass">> | undefined,
    geom: { cxM: number; czM: number; wM: number; dM: number },
    baseY: number,
    rise: number,
    overhang: number,
    ridgeOffset: number,
  ) => {
    if (!gableEnds) return
    const ridgeAlongX = geom.wM >= geom.dM
    const ends: Array<"n" | "s" | "w" | "e"> = ridgeAlongX ? ["w", "e"] : ["n", "s"]
    const span = ridgeAlongX ? geom.dM : geom.wM
    for (const side of ends) {
      const fill = gableEnds[side]
      if (!fill) continue
      const sign = side === "w" || side === "n" ? -1 : 1
      const off = sign * ((ridgeAlongX ? geom.wM : geom.dM) / 2 - WALL_T / 2)
      prims.push({
        id: `gw-${idPrefix}-${side}`,
        kind: "wall_gable",
        floorId: gwFloorId,
        dir: side,
        pos: [
          geom.cxM + (ridgeAlongX ? off : 0),
          baseY,
          geom.czM + (ridgeAlongX ? 0 : off),
        ],
        args: [span, rise, WALL_T],
        gableOverhangM: overhang,
        ...(ridgeOffset ? { ridgeOffsetM: ridgeOffset } : {}),
        ...(fill === "glass" ? { glassEnd: true } : {}),
      })
    }
  }

  // A rooftop house already caps itself with the rooftop deck slab (its flat
  // roof), so a separate roof prim would only z-fight buried underneath it.
  const explicitRoofZones = hasExplicitRoofZones(layout)
  if (opts.showRoof && !hasRooftopFloor && !explicitRoofZones) {
    // Semua varian atap menaungi FOOTPRINT bangunan (fpW×fpD di fpCx/fpCz) —
    // bukan kavling penuh — sehingga atap tidak menggantung di atas halaman.
    const roof = effectiveRoof(layout)
    if (roof.type === "datar") {
      // Skylight melubangi atap datar (mesin roof-holes; tanpa skylight =
      // prim "roof" tunggal byte-identik dgn jalur lama).
      const legacyHost = flatRoofHosts(layout).find((h) => h.kind === "legacy-flat")
      const roofSkylights = legacyHost ? skylightsOnHost(layout, legacyHost) : []
      // Lubang = skylight (dapat kaca) + courtyard openToSky (terbuka penuh).
      const roofHoles = legacyHost ? roofHoleRectsFor(layout, legacyHost) : []
      if (roofHoles.length === 0) {
        prims.push({
          id: "roof",
          kind: "roof",
          floorId: topFloorId,
          pos: [fpCx, roofY + SLAB_T / 2, fpCz],
          args: [fpW + 0.2, SLAB_T, fpD + 0.2],
        })
      } else {
        // Rect atap luar (footprint + tritisan mini 0.1/sisi) dalam site coords.
        const outer = {
          x: fpCx + cx - (fpW + 0.2) / 2,
          y: fpCz + cz - (fpD + 0.2) / 2,
          width: fpW + 0.2,
          depth: fpD + 0.2,
        }
        for (const [hi, r] of subtractRectHoles(outer, roofHoles).entries()) {
          prims.push({
            id: `roof-h${hi}`,
            kind: "roof",
            floorId: topFloorId,
            pos: [r.x + r.width / 2 - cx, roofY + SLAB_T / 2, r.y + r.depth / 2 - cz],
            args: [r.width, SLAB_T, r.depth],
          })
        }
        for (const sk of roofSkylights) {
          prims.push({
            id: `roof-glass-${sk.id}`,
            kind: "roof_glass",
            floorId: topFloorId,
            skylightId: sk.id,
            pos: [
              sk.rect.x + sk.rect.width / 2 - cx,
              roofY + SLAB_T / 2,
              sk.rect.y + sk.rect.depth / 2 - cz,
            ],
            args: [sk.rect.width, SLAB_T * 0.6, sk.rect.depth],
          })
        }
      }
      if (roof.fascia) {
        prims.push(
          ...fasciaBands(
            "fascia-roof",
            topFloorId,
            { cx: fpCx, cz: fpCz, w: fpW + 0.2, d: fpD + 0.2 },
            roofY + SLAB_T,
            roof.fascia
          )
        )
      }
    } else if (roof.type === "miring") {
      // Skillion: wedge satu bidang miring menuruni `lowSide`. Rise dihitung
      // dari bentang PENUH searah kemiringan (bukan setengah bentang pelana).
      const ov = roof.overhangM
      const low = roof.lowSide ?? "s"
      const alongZ = low === "n" || low === "s"
      const runSpan = (alongZ ? fpD : fpW) + 2 * ov
      const rise = round2(runSpan * Math.tan((roof.slopeDeg * Math.PI) / 180))
      prims.push({
        id: "roof",
        kind: "roof_skillion",
        floorId: topFloorId,
        dir: low,
        pos: [fpCx, roofY + rise / 2, fpCz],
        args: [fpW + 2 * ov, rise, fpD + 2 * ov],
      })
      // Skillion: hanya sisi RENDAH punya eave setinggi roofY (sisi lain
      // menanjak, tak ada tepi bawah untuk digantungi fascia).
      if (roof.fascia) {
        prims.push(
          ...fasciaBands(
            "fascia-roof",
            topFloorId,
            { cx: fpCx, cz: fpCz, w: fpW + 2 * ov, d: fpD + 2 * ov },
            roofY,
            roof.fascia,
            [low]
          )
        )
      }
    } else {
      const ov = roof.overhangM
      // Ridge runs along the longer footprint dimension; span is the shorter
      // one (Global Constraints: widthM >= depthM => ridge on x, span = depthM).
      const span = fpW >= fpD ? fpD : fpW
      const rise = round2((span / 2 + ov) * Math.tan((roof.slopeDeg * Math.PI) / 180))
      const ridgeAlongX = fpW + 2 * ov >= fpD + 2 * ov
      prims.push({
        id: "roof",
        kind: roof.type === "pelana" ? "roof_gable" : "roof_hip",
        floorId: topFloorId,
        pos: [fpCx, roofY + rise / 2, fpCz],
        args: [fpW + 2 * ov, rise, fpD + 2 * ov],
        // Gable asimetris: hanya pelana; absen/0 = simetris (byte-identik).
        ...(roof.type === "pelana" && roof.ridgeOffsetM
          ? { ridgeOffsetM: roof.ridgeOffsetM }
          : {}),
        // Buka end-cap pada ujung ber-sopi-sopi agar infill terlihat.
        ...(roof.type === "pelana"
          ? (() => {
              const oe = openEndsFor(roof.gableEnds, ridgeAlongX)
              return oe ? { openGableEnds: oe } : {}
            })()
          : {}),
      })
      if (roof.type === "pelana") {
        pushGableEnds(
          "roof",
          topFloorId,
          roof.gableEnds,
          { cxM: fpCx, czM: fpCz, wM: fpW, dM: fpD },
          roofY,
          rise,
          ov,
          roof.ridgeOffsetM ?? 0,
        )
      }
      // Lis fascia di tepi bawah bidang atap (eave). Pelana: cuma 2 sisi
      // sejajar bubungan yg punya bidang miring (ujung sopi-sopi tegak, tanpa
      // eave rendah — dibiarkan kosong, ditutup wall_gable/kaca di atas).
      // Limasan: 4 bidang semuanya miring turun ke roofY → 4 sisi.
      if (roof.fascia) {
        const eaveSides: readonly ("n" | "s" | "w" | "e")[] =
          roof.type === "limasan"
            ? FASCIA_SIDES_ALL
            : ridgeAlongX
              ? (["n", "s"] as const)
              : (["w", "e"] as const)
        prims.push(
          ...fasciaBands(
            "fascia-roof",
            topFloorId,
            { cx: fpCx, cz: fpCz, w: fpW + 2 * ov, d: fpD + 2 * ov },
            roofY,
            roof.fascia,
            eaveSides
          )
        )
      }
    }
  }

  if (opts.showRoof && explicitRoofZones) {
    const floorIndexById = new Map(layout.floors.map((floor, index) => [floor.id, index]))
    const zones = effectiveRoofZones(layout)
    for (const zone of zones) {
      const floorId = zone.floorId ?? topFloorId
      const floorIndex =
        floorId && floorIndexById.has(floorId)
          ? floorIndexById.get(floorId)!
          : Math.max(0, topRegIdx)
      const zElev = floorId ? elev.get(floorId) : undefined
      const zoneRoofY =
        (zElev ? zElev.baseY + zElev.index * gap : floorIndex * (floorStep + gap)) +
        SLAB_T +
        (zElev?.wallHM ?? WALL_H)
      const renderRect = roofZoneRenderRect(zone, zones)
      const w = renderRect.widthM
      const d = renderRect.depthM
      const posX = renderRect.x - cx
      const posZ = renderRect.y - cz
      if (zone.type === "datar") {
        // Skylight melubangi zona datar (host per-zona; tanpa skylight =
        // prim tunggal byte-identik).
        const zoneHost = {
          kind: "zone-datar" as const,
          zoneId: zone.id,
          rect: {
            x: zone.x - zone.widthM / 2,
            y: zone.y - zone.depthM / 2,
            width: zone.widthM,
            depth: zone.depthM,
          },
        }
        const zoneSkylights = skylightsOnHost(layout, zoneHost)
        const zoneHoles = roofHoleRectsFor(layout, zoneHost)
        if (zoneHoles.length === 0) {
          prims.push({
            id: `roof-zone-${zone.id}`,
            kind: "roof",
            floorId,
            roofMaterial: zone.materialId,
            pos: [posX, zoneRoofY + SLAB_T / 2, posZ],
            args: [w, SLAB_T, d],
          })
        } else {
          const outer = { x: renderRect.x - w / 2, y: renderRect.y - d / 2, width: w, depth: d }
          for (const [hi, r] of subtractRectHoles(outer, zoneHoles).entries()) {
            prims.push({
              id: `roof-zone-${zone.id}-h${hi}`,
              kind: "roof",
              floorId,
              roofMaterial: zone.materialId,
              pos: [r.x + r.width / 2 - cx, zoneRoofY + SLAB_T / 2, r.y + r.depth / 2 - cz],
              args: [r.width, SLAB_T, r.depth],
            })
          }
          for (const sk of zoneSkylights) {
            prims.push({
              id: `roof-glass-${sk.id}`,
              kind: "roof_glass",
              floorId,
              skylightId: sk.id,
              pos: [
                sk.rect.x + sk.rect.width / 2 - cx,
                zoneRoofY + SLAB_T / 2,
                sk.rect.y + sk.rect.depth / 2 - cz,
              ],
              args: [sk.rect.width, SLAB_T * 0.6, sk.rect.depth],
            })
          }
        }
      } else if (zone.type === "miring") {
        const low = zone.lowSide ?? "s"
        const runSpan = low === "e" || low === "w" ? w : d
        const rise = round2(runSpan * Math.tan((zone.slopeDeg * Math.PI) / 180))
        prims.push({
          id: `roof-zone-${zone.id}`,
          kind: "roof_skillion",
          floorId,
          roofMaterial: zone.materialId,
          dir: low,
          pos: [posX, zoneRoofY + rise / 2, posZ],
          args: [w, rise, d],
        })
      } else {
        const rise = round2((Math.min(w, d) / 2) * Math.tan((zone.slopeDeg * Math.PI) / 180))
        prims.push({
          id: `roof-zone-${zone.id}`,
          kind: zone.type === "pelana" ? "roof_gable" : "roof_hip",
          floorId,
          roofMaterial: zone.materialId,
          pos: [posX, zoneRoofY + rise / 2, posZ],
          args: [w, rise, d],
          // Gable asimetris per-zona (pelana saja); absen/0 = simetris.
          ...(zone.type === "pelana" && zone.ridgeOffsetM
            ? { ridgeOffsetM: zone.ridgeOffsetM }
            : {}),
          // Buka end-cap pada ujung ber-sopi-sopi agar infill terlihat.
          // Sumbu ridge ikut dims PRISMA (renderRect) — harus cocok geometri.
          ...(zone.type === "pelana"
            ? (() => {
                const oe = openEndsFor(zone.gableEnds, w >= d)
                return oe ? { openGableEnds: oe } : {}
              })()
            : {}),
        })
        if (zone.type === "pelana") {
          pushGableEnds(
            `zone-${zone.id}`,
            floorId,
            zone.gableEnds,
            { cxM: posX, czM: posZ, wM: zone.widthM, dM: zone.depthM },
            zoneRoofY,
            rise,
            zone.overhangM,
            zone.ridgeOffsetM ?? 0,
          )
        }
      }
    }
  }

  // Partial rooftop: the footprint minus the deck is covered by roof strips
  // following `layout.roof`. Each expanded strip rect renders as a normal
  // symmetric roof over that rect (GablePrism/HipPyramid pick the ridge along
  // its longer dim). Gated on showRoof so the "Tampilkan atap" toggle controls
  // only the roof (deck + railing always show).
  if (partialRooftop && deck && opts.showRoof && !explicitRoofZones) {
    const roof = effectiveRoof(layout)
    rooftopStrips(footprint, deck).forEach((strip, i) => {
      const ex = expandStripForOverhang(strip, roof.overhangM)
      const exCx = ex.x + ex.width / 2 - cx
      const exCz = ex.y + ex.depth / 2 - cz
      const narrow = Math.min(strip.width, strip.depth) < 1.0
      // Strip miring per-strip tidak bermakna (arah air per strip ambigu) —
      // render sebagai slab datar seperti strip sempit.
      if (roof.type === "datar" || roof.type === "miring" || narrow) {
        prims.push({
          id: `roof-strip-${i}`,
          kind: "roof",
          floorId: topFloorId,
          pos: [exCx, roofY + SLAB_T / 2, exCz],
          args: [ex.width, SLAB_T, ex.depth],
        })
      } else {
        const rise = round2((Math.min(ex.width, ex.depth) / 2) * Math.tan((roof.slopeDeg * Math.PI) / 180))
        // W1 pada strip: gable asimetris + sopi-sopi HANYA pada ujung strip yang
        // berimpit tepi footprint (ujung yang menempel dak tidak diberi infill).
        // Tanpa field baru di layout → spread kondisional (byte-identik legacy).
        const stripRidgeAlongX = ex.width >= ex.depth
        const edgeTol = 0.05
        const stripGableEnds =
          roof.type === "pelana" && roof.gableEnds
            ? (Object.fromEntries(
                Object.entries(roof.gableEnds).filter(([side]) => {
                  if (stripRidgeAlongX && side === "w")
                    return Math.abs(strip.x - footprint.x0) < edgeTol
                  if (stripRidgeAlongX && side === "e")
                    return Math.abs(strip.x + strip.width - (footprint.x0 + footprint.widthM)) < edgeTol
                  if (!stripRidgeAlongX && side === "n")
                    return Math.abs(strip.y - footprint.y0) < edgeTol
                  if (!stripRidgeAlongX && side === "s")
                    return Math.abs(strip.y + strip.depth - (footprint.y0 + footprint.depthM)) < edgeTol
                  return false
                }),
              ) as Partial<Record<"n" | "s" | "w" | "e", "wall" | "glass">>)
            : undefined
        const stripHasGableEnds = stripGableEnds && Object.keys(stripGableEnds).length > 0
        prims.push({
          id: `roof-strip-${i}`,
          kind: roof.type === "pelana" ? "roof_gable" : "roof_hip",
          floorId: topFloorId,
          pos: [exCx, roofY + rise / 2, exCz],
          args: [ex.width, rise, ex.depth],
          ...(roof.type === "pelana" && roof.ridgeOffsetM
            ? { ridgeOffsetM: roof.ridgeOffsetM }
            : {}),
          ...(stripHasGableEnds
            ? (() => {
                const oe = openEndsFor(stripGableEnds, stripRidgeAlongX)
                return oe ? { openGableEnds: oe } : {}
              })()
            : {}),
        })
        if (stripHasGableEnds) {
          pushGableEnds(
            `strip-${i}`,
            topFloorId,
            stripGableEnds,
            {
              cxM: strip.x + strip.width / 2 - cx,
              czM: strip.y + strip.depth / 2 - cz,
              wM: strip.width,
              dM: strip.depth,
            },
            roofY,
            rise,
            roof.overhangM,
            roof.ridgeOffsetM ?? 0,
          )
        }
      }
    })
  }

  // Railing dak digate pada hasRooftopFloor (LAYOUT punya floor-rooftop = dak
  // ADA & ter-render di floor loop), BUKAN project.rooftop (flag level-proyek
  // yang bisa DIVERGEN — mis. Rumah Qyfa: layout punya rooftop tapi flag proyek
  // false, sehingga dulu dak+teras muncul tapi RAILING hilang total). Sekarang
  // railing selalu mengikuti dak seperti slab & teras.
  if (hasRooftopFloor) {
    // Gaya railing dak rooftop — dak bukan Room (bisa penuh, 0 room di
    // floor-rooftop), jadi disimpan di layout (bukan Room.railingStyle) &
    // di-render lewat railSidePrims, sama seperti balkon, TAPI dgn
    // identitas roomId sentinel ROOFTOP_RAIL_ID — sebelumnya prim ini sama
    // sekali tanpa roomId sehingga tidak bisa diklik; klik di dekatnya jatuh
    // ke railing balkon di baliknya (dilaporkan: mengganti gaya rooftop malah
    // mengubah balkon). Sentinel ini membuatnya klik-lebih-pilih sendiri.
    const railH = 1.0
    const rtStyle = layout.rooftopRailingStyle ?? "kaca"
    const baseY = roofY + SLAB_T
    const yC = baseY + railH / 2
    // Railing dak diberi floorId "floor-rooftop" (BUKAN topFloorId lantai
    // reguler) agar IKUT SEMBUNYI saat lantai Rooftop di-hide di FloorToggleBar
    // — konsisten dgn slab dak & fascia. (topFloorId bikin railing nyangkut ke
    // visibilitas lantai reguler teratas.)
    const rtFloorId = "floor-rooftop"
    // Model GLB kustom (rooftopRailingModelUrl) menggantikan VISUAL railing dak
    // — prim gaya bawaan di-SKIP; house-model men-tile GLB keliling perimeter dak
    // (paritas balkon). Slab dak, teras, fascia tetap digambar.
    // Rect dak dalam koordinat SITE (deck parsial atau footprint penuh) —
    // dipakai perimeter, dan railing tepi LUBANG tangga di bawah ini.
    const deckRect =
      partialRooftop && deck
        ? { x: deck.x, y: deck.y, width: deck.width, depth: deck.depth }
        : { x: fpCx + cx - fpW / 2, y: fpCz + cz - fpD / 2, width: fpW, depth: fpD }

    // Tangga lantai teratas yang menembus dak → lubang akses di deck.
    // Simpan juga stairExitCut-nya: sepanjang bentang keluar tangga TIDAK
    // BOLEH ada railing (aturan universal yang sama dgn dinding — kalau
    // tidak, orang naik lalu mentok railing di anak tangga terakhir).
    const belowRooftopId = regularFloors[topRegIdx]?.id ?? null
    const deckHoles = layout.rooms
      .filter(
        (r) =>
          r.floorId === belowRooftopId &&
          r.type === "tangga" &&
          stairPenetratesSlabAbove(elev, r.floorId),
      )
      .map((st) => {
        const hx0 = Math.max(st.x, deckRect.x)
        const hy0 = Math.max(st.y, deckRect.y)
        const hx1 = Math.min(st.x + st.width, deckRect.x + deckRect.width)
        const hy1 = Math.min(st.y + st.depth, deckRect.y + deckRect.depth)
        if (hx1 - hx0 < 0.05 || hy1 - hy0 < 0.05) return null
        return { st, hx0, hy0, hx1, hy1, cut: stairExitCut(st, stairRiseM(elev, st.floorId)) }
      })
      .filter((h): h is NonNullable<typeof h> => h !== null)

    const LINE_TOL = 0.05
    const exitCutsOnLine = (horizontal: boolean, line: number): Span[] =>
      deckHoles
        .map((h) => h.cut)
        .filter(
          (c): c is StairExitCut =>
            !!c && c.horizontal === horizontal && Math.abs(c.line - line) <= LINE_TOL,
        )
        .map((c) => ({ start: c.start, end: c.end }))

    // Satu sisi railing (site coords) minus bentang keluar tangga. Sisi utuh
    // memakai idPrefix default → id byte-identical dgn jalur lama (railrt-n).
    const emitRailSide = (
      side: "n" | "s" | "w" | "e",
      line: number,
      baseSpan: Span,
      cuts: Span[],
      idPrefix?: string,
    ) => {
      const horizontal = side === "n" || side === "s"
      const spans = subtractSpans(baseSpan, cuts)
      const whole =
        spans.length === 1 &&
        Math.abs(spans[0].start - baseSpan.start) < 1e-6 &&
        Math.abs(spans[0].end - baseSpan.end) < 1e-6
      for (const [si, sp] of spans.entries()) {
        const len = sp.end - sp.start
        const mid = (sp.start + sp.end) / 2
        const pos: [number, number, number] = horizontal
          ? [mid - cx, yC, line - cz]
          : [line - cx, yC, mid - cz]
        const prefix = idPrefix
          ? `${idPrefix}${si}-`
          : whole
            ? undefined
            : `railrt-x${si}-`
        prims.push(
          ...railSidePrims(side, rtStyle, pos, len, railH, baseY, rtFloorId, ROOFTOP_RAIL_ID, prefix),
        )
      }
    }

    if (layout.rooftopRailingModelUrl) {
      // (prim gaya bawaan tidak diemit; visual perimeter dari house-model)
    } else {
      // Perimeter dak: full span MINUS bentang keluar tangga yang kebetulan
      // topping-out tepat di tepi dak (exit cut segaris perimeter).
      const x0 = deckRect.x
      const x1 = deckRect.x + deckRect.width
      const y0 = deckRect.y
      const y1 = deckRect.y + deckRect.depth
      emitRailSide("n", y0, { start: x0, end: x1 }, exitCutsOnLine(true, y0))
      emitRailSide("s", y1, { start: x0, end: x1 }, exitCutsOnLine(true, y1))
      emitRailSide("w", x0, { start: y0, end: y1 }, exitCutsOnLine(false, x0))
      emitRailSide("e", x1, { start: y0, end: y1 }, exitCutsOnLine(false, x1))
    }

    // Railing pengaman TEPI LUBANG tangga di permukaan dak — lubang akses di
    // tengah deck adalah drop-off. Rail semua sisi lubang KECUALI (a) bentang
    // keluar tangga (exit cut) dan (b) tepi yang berimpit dgn perimeter dak
    // (railing/exit perimeter sudah menanganinya). Tetap diemit saat GLB
    // kustom aktif — GLB hanya menggantikan visual perimeter.
    for (const h of deckHoles) {
      const onPerimeter = (horizontal: boolean, line: number) =>
        horizontal
          ? Math.abs(line - deckRect.y) <= LINE_TOL ||
            Math.abs(line - (deckRect.y + deckRect.depth)) <= LINE_TOL
          : Math.abs(line - deckRect.x) <= LINE_TOL ||
            Math.abs(line - (deckRect.x + deckRect.width)) <= LINE_TOL
      const sides: Array<{
        side: "n" | "s" | "w" | "e"
        line: number
        span: Span
      }> = [
        { side: "n", line: h.hy0, span: { start: h.hx0, end: h.hx1 } },
        { side: "s", line: h.hy1, span: { start: h.hx0, end: h.hx1 } },
        { side: "w", line: h.hx0, span: { start: h.hy0, end: h.hy1 } },
        { side: "e", line: h.hx1, span: { start: h.hy0, end: h.hy1 } },
      ]
      for (const sd of sides) {
        const horizontal = sd.side === "n" || sd.side === "s"
        if (onPerimeter(horizontal, sd.line)) continue
        const cuts =
          h.cut &&
          h.cut.horizontal === horizontal &&
          Math.abs(h.cut.line - sd.line) <= LINE_TOL
            ? [{ start: h.cut.start, end: h.cut.end }]
            : []
        emitRailSide(sd.side, sd.line, sd.span, cuts, `railhole-${h.st.id}-${sd.side}`)
      }
    }
  }

  // Camera/shadow framing height. The rooftop deck now sits on the top regular
  // floor (not a storey above), so a rooftop house is only `regularFloors.length`
  // storeys tall plus the open deck's railing + a little headroom — unless a
  // pitched partial-rooftop strip rises higher than the railing, in which case
  // the framing must clear the tallest strip. Non-rooftop branch is unchanged.
  const roofForHeight = partialRooftop && deck ? effectiveRoof(layout) : null
  const maxStripRise =
    roofForHeight && deck && roofForHeight.type !== "datar"
      ? rooftopStrips(footprint, deck).reduce((m, s) => {
          if (Math.min(s.width, s.depth) < 1.0) return m
          const ex = expandStripForOverhang(s, roofForHeight.overhangM)
          return Math.max(
            m,
            (Math.min(ex.width, ex.depth) / 2) * Math.tan((roofForHeight.slopeDeg * Math.PI) / 180)
          )
        }, 0)
      : 0
  const height = hasRooftopFloor
    ? regularStackTopM + regularFloors.length * gap + Math.max(SLAB_T + 1.5, maxStripRise + 0.5)
    : regularStackTopM + (regularFloors.length - 1) * gap + 1
  // CANTILEVER (Track B/CB2): geser HORIZONTAL semua prim STRUKTURAL milik
  // lantai ber-offsetM — slab ikut menggeser (muka bawah box = soffit) →
  // massa menjorok. Prim eksterior (gerbang/pagar/aksen di koordinat site)
  // TIDAK ikut. Label ruang ikut agar teks tetap di atas ruangnya. Tanpa
  // offsetM di lantai mana pun → tak ada prim tergeser (byte-identik).
  {
    const offsetByFloor = new Map(
      layout.floors.map((f) => [f.id, floorOffset(f)]),
    )
    const hasAnyOffset = [...offsetByFloor.values()].some(
      (o) => Math.abs(o.dx) > 1e-9 || Math.abs(o.dy) > 1e-9,
    )
    if (hasAnyOffset) {
      for (const prim of prims) {
        if (prim.kind === "exterior") continue
        if (!prim.floorId) continue
        const o = offsetByFloor.get(prim.floorId)
        if (!o || (Math.abs(o.dx) < 1e-9 && Math.abs(o.dy) < 1e-9)) continue
        prim.pos = [prim.pos[0] + o.dx, prim.pos[1], prim.pos[2] + o.dy]
      }
      for (const label of labels) {
        const o = offsetByFloor.get(label.floorId)
        if (!o) continue
        label.pos = [label.pos[0] + o.dx, label.pos[1], label.pos[2] + o.dy]
      }
    }
  }

  assignDepthRanks(prims)
  return { prims, labels, height }
}

/**
 * Z-fight resolver. Room walls are drawn per room with `+t` end inflation so
 * corners close — the price is coplanar overlaps wherever two prims meet on
 * the same line (collinear neighbour walls, corner end-caps against a
 * perpendicular wall, door headers over a shared boundary). Probing the real
 * "Rumah Qyfa" prod layout found 244 such face pairs — each one shimmers while
 * the camera moves because the depth buffer can't order coincident planes.
 *
 * Instead of re-engineering wall geometry (merging would break per-room
 * material attribution), detect every conflicting pair and greedy-colour the
 * conflict graph: adjacent prims get different ranks, and the renderer turns
 * ranks into glPolygonOffset (a depth-only bias — nothing visibly moves).
 * Cluster sizes are small (2–6), so ranks stay tiny and can't reorder
 * genuinely separated surfaces.
 */
const COPLANAR_EPS = 0.003 // faces closer than 3 mm fight at typical view distances
const COPLANAR_MIN_OVERLAP = 0.005 // ignore knife-edge contact overlaps

/** Ukuran sel grid spatial hash (m) untuk deteksi pasangan koplanar. */
const RANK_CELL_M = 4

function assignDepthRanks(prims: Prim[]): void {
  const n = prims.length
  const min = prims.map((p) => [p.pos[0] - p.args[0] / 2, p.pos[1] - p.args[1] / 2, p.pos[2] - p.args[2] / 2])
  const max = prims.map((p) => [p.pos[0] + p.args[0] / 2, p.pos[1] + p.args[1] / 2, p.pos[2] + p.args[2] / 2])
  const adj: number[][] = Array.from({ length: n }, () => [])

  // Spatial bucketing menggantikan scan pasangan O(n²): setiap prim didaftarkan
  // ke semua sel grid 3D (~4 m) yang disentuh AABB-nya (diekspansi EPS). Sebuah
  // pasangan konflik SELALU nyaris beririsan — overlap ≥ MIN_OVERLAP di dua
  // sumbu dan selisih bidang ≤ EPS di sumbu ketiga — sehingga AABB terekspansi
  // keduanya pasti berbagi minimal satu sel. Predikat konflik tidak berubah,
  // jadi adjacency (dan rank hasil pewarnaan) IDENTIK dengan scan penuh,
  // deterministik. Sengaja TIDAK dikelompokkan per floorId: konflik lintas
  // lantai nyata ada (mis. puncak anak tangga rata dengan muka atas slab
  // lantai berikutnya) dan grid-y sudah memisahkan lantai secara alami.
  const cells = new Map<string, number[]>()
  for (let i = 0; i < n; i++) {
    const x0 = Math.floor((min[i][0] - COPLANAR_EPS) / RANK_CELL_M)
    const x1 = Math.floor((max[i][0] + COPLANAR_EPS) / RANK_CELL_M)
    const y0 = Math.floor((min[i][1] - COPLANAR_EPS) / RANK_CELL_M)
    const y1 = Math.floor((max[i][1] + COPLANAR_EPS) / RANK_CELL_M)
    const z0 = Math.floor((min[i][2] - COPLANAR_EPS) / RANK_CELL_M)
    const z1 = Math.floor((max[i][2] + COPLANAR_EPS) / RANK_CELL_M)
    for (let gx = x0; gx <= x1; gx++) {
      for (let gy = y0; gy <= y1; gy++) {
        for (let gz = z0; gz <= z1; gz++) {
          const key = `${gx},${gy},${gz}`
          const bucket = cells.get(key)
          if (bucket) bucket.push(i)
          else cells.set(key, [i])
        }
      }
    }
  }

  const conflicts = (i: number, j: number): boolean => {
    for (let axis = 0; axis < 3; axis++) {
      const a1 = (axis + 1) % 3
      const a2 = (axis + 2) % 3
      if (Math.min(max[i][a1], max[j][a1]) - Math.max(min[i][a1], min[j][a1]) < COPLANAR_MIN_OVERLAP) continue
      if (Math.min(max[i][a2], max[j][a2]) - Math.max(min[i][a2], min[j][a2]) < COPLANAR_MIN_OVERLAP) continue
      if (
        Math.abs(min[i][axis] - min[j][axis]) <= COPLANAR_EPS ||
        Math.abs(max[i][axis] - max[j][axis]) <= COPLANAR_EPS
      ) {
        return true
      }
    }
    return false
  }

  // Uji hanya pasangan sesel; `seen` mencegah pasangan yang berbagi banyak sel
  // diuji/ditambahkan dua kali. Bucket terisi berurutan naik ⇒ i < j.
  const seen = new Set<number>()
  for (const bucket of cells.values()) {
    for (let a = 0; a < bucket.length; a++) {
      for (let b = a + 1; b < bucket.length; b++) {
        const i = bucket[a]
        const j = bucket[b]
        const pairKey = i * n + j
        if (seen.has(pairKey)) continue
        seen.add(pairKey)
        if (conflicts(i, j)) {
          adj[i].push(j)
          adj[j].push(i)
        }
      }
    }
  }

  for (let i = 0; i < n; i++) {
    if (adj[i].length === 0) continue
    const used = new Set<number>()
    for (const nb of adj[i]) if (nb < i) used.add(prims[nb].depthRank ?? 0)
    let rank = 0
    while (used.has(rank)) rank++
    if (rank > 0) prims[i].depthRank = rank
  }
}
