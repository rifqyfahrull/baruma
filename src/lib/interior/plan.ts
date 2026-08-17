import type {
  DesignLayout,
  FurnitureCategory,
  FurnitureItem,
  InteriorBudgetEstimate,
  InteriorBudgetLine,
  InteriorPlan,
  InteriorStyleId,
  InteriorWarning,
  LightingFixture,
  MaterialAssignment,
  InteriorSurface,
  PlacedFurniture,
  PriceRange,
  Room,
  RoomInteriorPlan,
  RoomType,
  SlotType,
  WaterPointType,
} from "@/types"
import type { SavedInterior } from "@/lib/schemas/interior"
import { clamp, rectsOverlap, round2 } from "@/lib/geometry"
import { roomZones, sharesZone } from "@/lib/editor/zones"
import { normalizeAngle } from "@/lib/geometry/angle"
import {
  FURNITURE_LIBRARY,
  MATERIAL_LIBRARY,
  getInteriorStyle,
  getMaterial,
} from "./presets"
import { slotTypeForFurniture } from "./validation-profiles"
import { lightPriceFor, makeLight } from "./lighting"

export const SUPPORTED_INTERIOR_ROOMS: RoomType[] = [
  "ruang_tamu",
  "ruang_keluarga",
  "kamar_tidur",
  "dapur",
  "ruang_makan",
  "kamar_mandi",
  "workspace",
  "rooftop_lounge",
  "area_kumpul",
  "musholla",
  "laundry",
  "balkon",
  // Luar ruangan: furniture outdoor bebas dalam batas tanah (2026-07-12).
  "taman",
  "carport",
]

const TEMPLATE: Partial<Record<RoomType, string[]>> = {
  ruang_tamu: ["sofa-3-seat", "coffee-table", "tv-cabinet", "tv-55", "rug-large"],
  ruang_keluarga: ["sofa-l", "coffee-table", "tv-cabinet", "tv-55", "rug-large"],
  area_kumpul: ["sofa-l", "coffee-table", "rug-large", "planter"],
  kamar_tidur: ["queen-bed", "wardrobe-2m", "side-table", "work-desk"],
  dapur: ["kitchen-linear", "fridge"],
  ruang_makan: ["dining-table-4"],
  kamar_mandi: ["bathroom-shower", "toilet", "bathroom-vanity"],
  workspace: ["work-desk", "side-table"],
  rooftop_lounge: ["outdoor-sofa", "coffee-table", "planter"],
  musholla: ["prayer-rug-area", "quran-shelf"],
  laundry: ["laundry-machine"],
  balkon: ["outdoor-sofa", "planter"],
  taman: ["planter"],
  carport: [],
}

const STYLE_BY_HOUSE: Record<string, InteriorStyleId> = {
  modern_tropis: "modern_tropical",
  minimalis: "warm_minimalist",
  industrial: "industrial",
  japandi: "japandi",
  scandinavian: "scandinavian",
  klasik: "luxury_compact",
}

export function interiorStyleFromHouseStyle(style?: string): InteriorStyleId {
  return style ? STYLE_BY_HOUSE[style] ?? "modern_tropical" : "modern_tropical"
}

export function interiorRooms(layout: DesignLayout): Room[] {
  return layout.rooms.filter((room) => SUPPORTED_INTERIOR_ROOMS.includes(room.type))
}

export function generateInteriorPlan(
  layout: DesignLayout,
  opts: {
    projectId: string
    versionId?: string
    style?: InteriorStyleId
  }
): InteriorPlan {
  const style = opts.style ?? "modern_tropical"
  const rooms = interiorRooms(layout).map((room) =>
    generateRoomInterior(room, layout, style)
  )
  const totalEstimate = combineBudget(rooms.flatMap((room) => room.budgetEstimate.lines))
  const warnings = rooms.flatMap((room) => room.warnings)

  return {
    projectId: opts.projectId,
    versionId: opts.versionId ?? layout.versionId,
    style,
    rooms,
    totalEstimate,
    warnings,
    generatedAt: new Date().toISOString(),
  }
}

/** Serialize the editable interior intent for persistence. */
export function toSavedInterior(plan: InteriorPlan): SavedInterior {
  return {
    schemaVersion: 2,
    versionId: plan.versionId,
    style: plan.style,
    rooms: plan.rooms.map((room) => ({
      roomId: room.roomId,
      furniture: room.furniture,
      materials: room.materials,
      lighting: room.lighting,
    })),
  }
}

/**
 * Rebuild a full InteriorPlan from saved intent: generate the base plan for the
 * current layout/style, then overlay saved furniture per room and recompute
 * warnings + budget so derived data stays consistent with current pricing.
 * Rooms missing from `saved` keep their generated defaults.
 */
export function applySavedInterior(
  layout: DesignLayout,
  saved: SavedInterior,
  opts: { projectId: string }
): InteriorPlan {
  const base = generateInteriorPlan(layout, {
    projectId: opts.projectId,
    versionId: layout.versionId,
    style: saved.style,
  })
  // Legacy (schemaVersion 1) payloads stored swapped dims for 90/270 rotations under
  // the old "rotation swaps dims" model. Normalize exactly once here, before the saved
  // furniture is used to build the plan, so migrated dims are intrinsic going forward.
  const savedByRoom = new Map(
    saved.rooms.map((room) => [
      room.roomId,
      {
        furniture: saved.schemaVersion === 1 ? normalizeLegacyRotation(room.furniture) : room.furniture,
        materials: room.materials,
        lighting: room.lighting,
      },
    ])
  )

  const rooms = base.rooms.map((roomPlan) => {
    const loaded = savedByRoom.get(roomPlan.roomId)
    const room = layout.rooms.find((r) => r.id === roomPlan.roomId)
    if (!loaded || !room) return roomPlan
    // Self-heal positions saved while containment was buggy: re-clamp each item's
    // rotated footprint into the room on load, so nothing renders through walls.
    // Zone-aware so an item legitimately straddling an open-plan boundary is
    // NOT snapped back into its owner room. Also backfill slotType for items
    // saved before every furniture became a GLB-uploadable slot (older saves
    // stored null for uncurated items).
    const siblings = zoneSiblingRooms(room, layout.rooms)
    const savedFurniture = loaded.furniture.map((f) => ({
      ...f,
      slotType: f.slotType ?? slotTypeForFurniture(f.furnitureId),
      ...clampToZoneBounds(f, room, siblings),
    }))
    const materials = mergeSavedMaterials(room, roomPlan.materials, loaded.materials)
    const lighting = loaded.lighting ?? roomPlan.lighting
    return {
      ...roomPlan,
      furniture: savedFurniture,
      materials,
      lighting,
      warnings: validateFurnitureInRoom(room, savedFurniture, siblings),
      budgetEstimate: buildRoomBudget(room, savedFurniture, materials, lighting),
    }
  })

  const totalEstimate = combineBudget(rooms.flatMap((room) => room.budgetEstimate.lines))
  return { ...base, rooms, totalEstimate, warnings: rooms.flatMap((room) => room.warnings) }
}

export function generateRoomInterior(
  room: Room,
  layout: DesignLayout,
  styleId: InteriorStyleId
): RoomInteriorPlan {
  const furniture = placeFurniture(room, styleId)
  const materials = assignMaterials(room, styleId)
  const lighting = suggestLighting(room, styleId)
  const warnings = validateRoomInterior(room, furniture, layout)
  const budgetEstimate = buildRoomBudget(room, furniture, materials, lighting)
  const style = getInteriorStyle(styleId)
  const density = furniture.reduce((sum, item) => sum + item.widthM * item.depthM, 0) / room.areaM2

  return {
    roomId: room.id,
    roomName: room.name,
    roomType: room.type,
    floorId: room.floorId,
    style: styleId,
    furniture,
    materials,
    lighting,
    colorPalette: style.colors,
    warnings,
    budgetEstimate,
    score: {
      clearance: clampScore(100 - warnings.filter((w) => w.category === "circulation").length * 18),
      usability: clampScore(92 - warnings.length * 8),
      styleMatch: 90,
      cost: clampScore(95 - budgetEstimate.midIDR / Math.max(room.areaM2, 1) / 800_000),
      naturalLight: room.requiresNaturalLight ? 82 : 88,
      circulation: clampScore(100 - density * 65),
    },
  }
}

export function supportedFurnitureForRoom(roomType: RoomType): FurnitureItem[] {
  return FURNITURE_LIBRARY.filter((item) => item.roomTypes.includes(roomType))
}

/**
 * Furniture that anchors to a plumbing point ("titik air") placed in the 2D
 * editor (tab Air). The 2D layer is the shell/source of truth: these 3D models
 * can only be installed in a room that already has the matching WaterPoint,
 * and they are placed AT that point so 2D piping and 3D visuals stay in sync
 * (SNI 8153:2015 fixture types).
 */
export const WATER_BOUND_FURNITURE: Record<string, WaterPointType> = {
  toilet: "kloset",
  "bathroom-shower": "shower",
  "bathroom-vanity": "wastafel",
}

/** The WaterPointType a furniture item needs, or null for dry furniture. */
export function requiredWaterPointFor(furnitureId: string): WaterPointType | null {
  return WATER_BOUND_FURNITURE[furnitureId] ?? null
}

export function addFurnitureToRoom(
  room: Room,
  plan: RoomInteriorPlan,
  furniture: FurnitureItem,
  /** Room-local placement override (e.g. snap to a titik air); clamped to the room. */
  at?: { x: number; y: number }
): RoomInteriorPlan {
  const placed = toPlacedFurniture(furniture, room, plan.furniture.length)
  if (at) {
    const snapped = clampToRotatedBounds({ ...placed, x: at.x, y: at.y }, room)
    placed.x = snapped.x
    placed.y = snapped.y
  }
  const nextFurniture = [...plan.furniture, placed]
  const warnings = validateFurnitureInRoom(room, nextFurniture)
  const budgetEstimate = buildRoomBudget(room, nextFurniture, plan.materials, plan.lighting)
  return { ...plan, furniture: nextFurniture, warnings, budgetEstimate }
}

/** Bentuk minimal asset My Library yang dibutuhkan untuk dipasang sebagai furniture. */
export type LibraryAssetInput = {
  id: string
  name: string
  category: string
  modelUrl?: string | null
  widthM?: number
  depthM?: number
  heightM?: number
  /** Harga level aset (Rp, `user_assets.price_idr`) — diwariskan ke setiap
   *  penempatan. Absent/null = furniture berstatus "belum dihargai" sampai
   *  user mengisi override per-instance. */
  priceIDR?: number | null
}

const ASSET_CATEGORY_TO_FURNITURE: Record<string, FurnitureCategory> = {
  sofa: "seating",
  tv: "appliance",
  coffee_table: "table",
  building_reference: "decor",
  generic: "decor",
}

const ASSET_CATEGORY_TO_SLOT: Record<string, SlotType> = {
  sofa: "sofa",
  tv: "tv",
  coffee_table: "coffee_table",
}

/**
 * Adds a My Library asset directly as a NEW furniture item (no pre-existing
 * placeholder needed): a zero-price custom item sized from the asset's
 * metadata, centered in the room, with its GLB attached immediately.
 */
export function addCustomAssetToRoom(
  room: Room,
  plan: RoomInteriorPlan,
  asset: LibraryAssetInput
): RoomInteriorPlan {
  const w = asset.widthM && asset.widthM > 0 ? asset.widthM : 1
  const d = asset.depthM && asset.depthM > 0 ? asset.depthM : 1
  const h = asset.heightM && asset.heightM > 0 ? asset.heightM : 1
  // Harga level aset diwariskan apa adanya (tanpa spread low/high buatan).
  // Tanpa harga → zeros yang oleh buildRoomBudget ditandai `priced: false`
  // (excluded eksplisit), bukan menyumbang Rp 0 diam-diam.
  const price = asset.priceIDR && asset.priceIDR > 0 ? asset.priceIDR : 0
  const item: FurnitureItem = {
    id: `custom-${asset.id}`,
    name: asset.name,
    category: ASSET_CATEGORY_TO_FURNITURE[asset.category] ?? "decor",
    widthM: w,
    depthM: d,
    heightM: h,
    roomTypes: [room.type],
    styleTags: [],
    priceRange: { low: price, mid: price, high: price },
    clearance: { frontM: 0.4, sideM: 0.2 },
  }
  const next = addFurnitureToRoom(room, plan, item, {
    x: (room.width - w) / 2,
    y: (room.depth - d) / 2,
  })
  const lastIndex = next.furniture.length - 1
  const furniture = next.furniture.map((f, i) =>
    i === lastIndex
      ? {
          ...f,
          modelAssetId: asset.id,
          modelUrl: asset.modelUrl ?? null,
          slotType: ASSET_CATEGORY_TO_SLOT[asset.category] ?? "generic",
        }
      : f
  )
  return { ...next, furniture }
}

/**
 * Duplicates a placed furniture item in-room: same dims/rotation/model
 * attachment (GLB stays attached), offset diagonally by 0.3 m so the copy is
 * immediately visible and grabbable, clamped to the open-plan zone like any
 * other move. Warnings + budget recompute. Returns null if the id is unknown.
 */
export function duplicatePlacedFurniture(
  room: Room,
  plan: RoomInteriorPlan,
  furnitureId: string,
  zoneSiblings: Room[] = [],
  site?: { widthM: number; depthM: number } | null
): RoomInteriorPlan | null {
  const source = plan.furniture.find((item) => item.id === furnitureId)
  if (!source) return null
  let id = `${source.id}-copy`
  for (let i = 2; plan.furniture.some((item) => item.id === id); i++) id = `${source.id}-copy${i}`
  const copy: PlacedFurniture = {
    ...source,
    id,
    ...clampToZoneBounds(
      { ...source, x: round2(source.x + 0.3), y: round2(source.y + 0.3) },
      room,
      zoneSiblings,
      site
    ),
  }
  const furniture = [...plan.furniture, copy]
  const warnings = validateFurnitureInRoom(room, furniture, zoneSiblings, site)
  const budgetEstimate = buildRoomBudget(room, furniture, plan.materials, plan.lighting)
  return { ...plan, furniture, warnings, budgetEstimate }
}

export function movePlacedFurniture(
  room: Room,
  plan: RoomInteriorPlan,
  furnitureId: string,
  x: number,
  y: number,
  zoneSiblings: Room[] = [],
  site?: { widthM: number; depthM: number } | null
): RoomInteriorPlan {
  const furniture = plan.furniture.map((item) =>
    item.id === furnitureId
      ? { ...item, ...clampToZoneBounds({ ...item, x, y }, room, zoneSiblings, site) }
      : item
  )
  const warnings = validateFurnitureInRoom(room, furniture, zoneSiblings, site)
  const budgetEstimate = buildRoomBudget(room, furniture, plan.materials, plan.lighting)
  return { ...plan, furniture, warnings, budgetEstimate }
}

/**
 * Re-parent a furniture item from `srcRoom` to `dstRoom` (both in the same
 * open-plan zone), preserving its WORLD position — only the room-local
 * coordinates are translated. Both room plans get their warnings and budgets
 * recomputed. Returns null when the item isn't in `srcPlan`.
 *
 * Called when a cross-room drag settles (pointer released over a zone
 * sibling), so ownership — and with it budget lines, warnings, and the room
 * panel the item appears in — follows the room the item actually occupies.
 */
export function transferFurnitureBetweenRooms(
  srcRoom: Room,
  srcPlan: RoomInteriorPlan,
  dstRoom: Room,
  dstPlan: RoomInteriorPlan,
  furnitureId: string,
  allRooms: Room[]
): { src: RoomInteriorPlan; dst: RoomInteriorPlan } | null {
  const item = srcPlan.furniture.find((f) => f.id === furnitureId)
  if (!item) return null
  const moved = {
    ...item,
    x: round2(srcRoom.x + item.x - dstRoom.x),
    y: round2(srcRoom.y + item.y - dstRoom.y),
  }
  const srcFurniture = srcPlan.furniture.filter((f) => f.id !== furnitureId)
  const dstFurniture = [...dstPlan.furniture, moved]
  return {
    src: {
      ...srcPlan,
      furniture: srcFurniture,
      warnings: validateFurnitureInRoom(srcRoom, srcFurniture, zoneSiblingRooms(srcRoom, allRooms)),
      budgetEstimate: buildRoomBudget(srcRoom, srcFurniture, srcPlan.materials, srcPlan.lighting),
    },
    dst: {
      ...dstPlan,
      furniture: dstFurniture,
      warnings: validateFurnitureInRoom(dstRoom, dstFurniture, zoneSiblingRooms(dstRoom, allRooms)),
      budgetEstimate: buildRoomBudget(dstRoom, dstFurniture, dstPlan.materials, dstPlan.lighting),
    },
  }
}

/**
 * Same-floor rooms sharing at least one open-plan zone with the room
 * (excluding itself). Rooms in a shared zone render with no walls between them
 * (see src/lib/three/build-model.ts `sameZoneOpenSpans`), so furniture may
 * roam across them as one continuous space. Multi-zone aware (`zoneIds`).
 */
export function zoneSiblingRooms(room: Room, allRooms: Room[]): Room[] {
  if (roomZones(room).length === 0) return []
  return allRooms.filter(
    (r) => r.id !== room.id && r.floorId === room.floorId && sharesZone(room, r)
  )
}

/**
 * Whether the item's ROTATED footprint lies inside the open-plan zone: the
 * union of the owner room and its zone siblings. Coordinates are owner-local.
 * The union is sampled at the footprint AABB's corners, edge midpoints, and
 * center — exact for convex unions and effectively right for the rectilinear
 * room unions the editor produces. Each rect is expanded by a small tolerance
 * so hairline seams between adjacent rooms (< the 5 cm the wall-builder
 * already treats as touching) don't read as gaps.
 */
export function footprintInsideZone(
  item: Pick<PlacedFurniture, "x" | "y" | "widthM" | "depthM" | "rotationDeg">,
  room: Pick<Room, "x" | "y" | "width" | "depth">,
  siblings: Room[]
): boolean {
  const aabb = rotatedAABB(item)
  const rects = [
    { x: 0, y: 0, w: room.width, d: room.depth },
    ...siblings.map((s) => ({ x: s.x - room.x, y: s.y - room.y, w: s.width, d: s.depth })),
  ]
  const eps = 0.03
  const midX = (aabb.minX + aabb.maxX) / 2
  const midY = (aabb.minY + aabb.maxY) / 2
  const points: Array<[number, number]> = [
    [aabb.minX, aabb.minY], [midX, aabb.minY], [aabb.maxX, aabb.minY],
    [aabb.minX, midY],      [midX, midY],      [aabb.maxX, midY],
    [aabb.minX, aabb.maxY], [midX, aabb.maxY], [aabb.maxX, aabb.maxY],
  ]
  return points.every(([px, py]) =>
    rects.some(
      (r) => px >= r.x - eps && px <= r.x + r.w + eps && py >= r.y - eps && py <= r.y + r.d + eps
    )
  )
}

/**
 * Zone-aware containment: inside an open-plan zone the footprint may sit
 * anywhere in the union of the zone's rooms (including straddling the shared
 * edge); otherwise it clamps to the single room exactly as before. Falls back
 * to the single-room clamp when a proposed position isn't covered by the zone.
 */
/** Ruang luar di tanah: furniturnya boleh berkeliaran ke SELURUH tapak. */
export const OUTDOOR_ROAM_TYPES: Room["type"][] = ["taman", "carport"]

export function clampToZoneBounds(
  item: Pick<PlacedFurniture, "x" | "y" | "widthM" | "depthM" | "rotationDeg">,
  room: Room,
  siblings: Room[],
  site?: { widthM: number; depthM: number } | null
): { x: number; y: number } {
  // Furniture outdoor (taman/carport) bebas ditempatkan di mana pun selama
  // masih DI DALAM BATAS TANAH (kursi taman di halaman, pot di teras, mobil
  // di sisa lahan) — clamp memakai rect site alih-alih rect ruang.
  if (site && OUTDOOR_ROAM_TYPES.includes(room.type)) {
    const abs = { ...item, x: room.x + item.x, y: room.y + item.y }
    const c = clampToRotatedBounds(abs, { width: site.widthM, depth: site.depthM })
    return { x: round2(c.x - room.x), y: round2(c.y - room.y) }
  }
  if (siblings.length && footprintInsideZone(item, room, siblings)) {
    return { x: round2(item.x), y: round2(item.y) }
  }
  return clampToRotatedBounds(item, room)
}

/**
 * Clamp a furniture item's position so its ROTATED footprint stays inside the
 * room — not the unrotated corner box. `x,y` is the min-corner of the intrinsic
 * rect while the visual rotates about the center, so for rotated items the
 * corner may legitimately go negative; the visible box never leaves the room.
 * Items larger than the room pin their center to the room center. This is the
 * single containment rule for every path that positions furniture (move,
 * rotate, load).
 */
export function clampToRotatedBounds(
  item: Pick<PlacedFurniture, "x" | "y" | "widthM" | "depthM" | "rotationDeg">,
  room: Pick<Room, "width" | "depth">
): { x: number; y: number } {
  const hw = item.widthM / 2
  const hd = item.depthM / 2
  const th = (item.rotationDeg * Math.PI) / 180
  const c = Math.abs(Math.cos(th))
  const s = Math.abs(Math.sin(th))
  const ex = hw * c + hd * s
  const ey = hw * s + hd * c
  const ncx = ex * 2 > room.width ? room.width / 2 : Math.min(Math.max(item.x + hw, ex), room.width - ex)
  const ncy = ey * 2 > room.depth ? room.depth / 2 : Math.min(Math.max(item.y + hd, ey), room.depth - ey)
  return { x: round2(ncx - hw), y: round2(ncy - hd) }
}

// ── Snap ke dinding ─────────────────────────────────────────────────────────

export type WallSideId = "n" | "s" | "w" | "e"

/** Setengah-ekstien AABB TERputar item (tentang pusatnya). */
function rotatedHalfExtents(
  item: Pick<PlacedFurniture, "widthM" | "depthM" | "rotationDeg">
): { ex: number; ey: number } {
  const th = (item.rotationDeg * Math.PI) / 180
  const c = Math.abs(Math.cos(th))
  const s = Math.abs(Math.sin(th))
  return {
    ex: (item.widthM / 2) * c + (item.depthM / 2) * s,
    ey: (item.widthM / 2) * s + (item.depthM / 2) * c,
  }
}

/** Sisi dinding TERDEKAT dari item (jarak tepi AABB terputar ke tepi ruang). */
export function nearestWallSide(
  item: Pick<PlacedFurniture, "x" | "y" | "widthM" | "depthM" | "rotationDeg">,
  room: Pick<Room, "width" | "depth">
): { side: WallSideId; distM: number } {
  const { ex, ey } = rotatedHalfExtents(item)
  const cx = item.x + item.widthM / 2
  const cy = item.y + item.depthM / 2
  const dists: Array<{ side: WallSideId; distM: number }> = [
    { side: "n", distM: cy - ey },
    { side: "s", distM: room.depth - (cy + ey) },
    { side: "w", distM: cx - ex },
    { side: "e", distM: room.width - (cx + ex) },
  ]
  return dists.reduce((m, d) => (d.distM < m.distM ? d : m))
}

/**
 * Setengah tebal dinding (m). Batas ruang (room.x/y/…) adalah GARIS TENGAH
 * dinding; muka DALAM dinding berada `WALL_T/2` ke dalam ruang. Furniture
 * ditempel ke muka dalam ini, BUKAN ke garis tengah — kalau tidak, item tipis
 * (jam dinding, TV, cermin) terkubur di dalam tebal dinding dan tertutup
 * (bug "jam dinding hilang saat ditempel"). WALL_T = 0.12 di build-model.ts.
 */
const WALL_FACE_INSET_M = 0.06

/**
 * Posisi FLUSH (menempel presisi) ke MUKA DALAM dinding `side`: pusat digeser
 * hingga tepi AABB terputar menyentuh muka dalam dinding (garis batas + inset
 * setengah tebal dinding ke dalam ruang); sumbu sejajar dinding tidak diubah.
 * `x,y` tetap pojok-min rect intrinsik (konvensi penempatan furniture).
 */
export function snapPositionToWall(
  item: Pick<PlacedFurniture, "x" | "y" | "widthM" | "depthM" | "rotationDeg">,
  room: Pick<Room, "width" | "depth">,
  side: WallSideId
): { x: number; y: number } {
  const { ex, ey } = rotatedHalfExtents(item)
  const hw = item.widthM / 2
  const hd = item.depthM / 2
  const inset = WALL_FACE_INSET_M
  if (side === "n") return { x: round2(item.x), y: round2(inset + ey - hd) }
  if (side === "s") return { x: round2(item.x), y: round2(room.depth - inset - ey - hd) }
  if (side === "w") return { x: round2(inset + ex - hw), y: round2(item.y) }
  return { x: round2(room.width - inset - ex - hw), y: round2(item.y) }
}

/**
 * Sudut agar sumbu KEDALAMAN item tegak lurus dinding (punggung ke dinding):
 * dinding n/s → kandidat 0°/180°; w/e → 90°/270°. Pilih yang PALING DEKAT
 * dengan sudut sekarang supaya arah hadap pilihan user tidak dibalik paksa.
 */
export function alignRotationToWall(currentDeg: number, side: WallSideId): number {
  const cands = side === "n" || side === "s" ? [0, 180] : [90, 270]
  const cur = ((currentDeg % 360) + 360) % 360
  const diff = (a: number) => Math.min(Math.abs(cur - a), 360 - Math.abs(cur - a))
  return cands.reduce((m, c) => (diff(c) < diff(m) ? c : m))
}

/**
 * Benda GANTUNG-DINDING (jam dinding, lukisan, cermin, TV gantung): tipis di
 * satu sumbu, berdiri, footprint kecil. Saat ditempel ke dinding, benda begini
 * seharusnya NAIK ke ketinggian dinding, bukan menempel di lantai.
 */
export function isWallHangingItem(
  item: Pick<PlacedFurniture, "widthM" | "depthM" | "heightM">
): boolean {
  const minDim = Math.min(item.widthM, item.depthM)
  const maxDim = Math.max(item.widthM, item.depthM)
  return minDim <= 0.12 && item.heightM >= 0.2 && maxDim <= 1.4
}

/** Tinggi pasang default agar PUSAT benda gantung ~1.5 m (setinggi mata). */
export function defaultWallMountHeight(heightM: number): number {
  return round2(Math.max(0, Math.min(2.6, 1.5 - heightM / 2)))
}

/**
 * Tempelkan item ke dinding: posisi flush + (default) luruskan sudut ke
 * kelipatan 90° yang sejajar dinding. `side` absen = dinding TERDEKAT.
 * User selama ini harus mengira-ngira posisi dinding (jam dinding/TV/lemari
 * tidak pernah presisi menempel) — ini membuatnya satu klik.
 *
 * `opts.lift` (default = align): utk benda gantung-dinding yang belum diberi
 * `mountHeightM`, naikkan otomatis ke ketinggian dinding wajar — dulu jam
 * dinding "ditempel" malah nempel di lantai (keluhan: tak bisa ke atas dinding).
 */
export function snapFurnitureToWallInRoom(
  room: Room,
  plan: RoomInteriorPlan,
  furnitureId: string,
  side?: WallSideId,
  zoneSiblings: Room[] = [],
  site?: { widthM: number; depthM: number } | null,
  opts: { align?: boolean; lift?: boolean } = {}
): RoomInteriorPlan {
  const align = opts.align ?? true
  const lift = opts.lift ?? align
  const furniture = plan.furniture.map((item) => {
    if (item.id !== furnitureId) return item
    const target = side ?? nearestWallSide(item, room).side
    const rotated = align
      ? { ...item, rotationDeg: alignRotationToWall(item.rotationDeg, target) }
      : item
    const pos = snapPositionToWall(rotated, room, target)
    // Auto-naik benda gantung-dinding yang belum punya tinggi pasang eksplisit.
    const alreadyMounted = typeof item.mountHeightM === "number" && item.mountHeightM > 0.05
    const mount =
      lift && isWallHangingItem(item) && !alreadyMounted
        ? defaultWallMountHeight(item.heightM)
        : undefined
    // Clamp menjaga sumbu sejajar dinding tetap di dalam ruang.
    return {
      ...rotated,
      ...clampToZoneBounds({ ...rotated, ...pos }, room, zoneSiblings, site),
      ...(mount !== undefined ? { mountHeightM: mount } : {}),
    }
  })
  const warnings = validateFurnitureInRoom(room, furniture, zoneSiblings, site)
  const budgetEstimate = buildRoomBudget(room, furniture, plan.materials, plan.lighting)
  return { ...plan, furniture, warnings, budgetEstimate }
}

/** Ambang magnet saat drag DILEPAS: tepi ≤ 20 cm dari dinding → rapatkan. */
export const WALL_SNAP_THRESHOLD_M = 0.2

/**
 * Rotate a furniture item's visual angle. Dims are the object's intrinsic size and
 * NEVER swap on rotation — the free-angle visual rotation is handled by the renderer.
 * The position is re-clamped so the newly rotated footprint stays inside the room
 * (rotating an item flush against a wall slides it inward instead of through the wall).
 */
export function rotatePlacedFurniture(
  room: Room,
  plan: RoomInteriorPlan,
  furnitureId: string,
  zoneSiblings: Room[] = [],
  site?: { widthM: number; depthM: number } | null
): RoomInteriorPlan {
  const furniture = plan.furniture.map((item) => {
    if (item.id !== furnitureId) return item
    const rotated = { ...item, rotationDeg: (item.rotationDeg + 90) % 360 }
    return { ...rotated, ...clampToZoneBounds(rotated, room, zoneSiblings, site) }
  })
  const warnings = validateFurnitureInRoom(room, furniture, zoneSiblings)
  const budgetEstimate = buildRoomBudget(room, furniture, plan.materials, plan.lighting)
  return { ...plan, furniture, warnings, budgetEstimate }
}

/**
 * Set a furniture item's visual angle to an arbitrary value (normalized into
 * [0,360)). Mirrors `rotatePlacedFurniture` but takes a free degree value
 * instead of stepping by 90°. Dims are intrinsic and never swap.
 */
export function setFurnitureRotationInRoom(
  room: Room,
  plan: RoomInteriorPlan,
  furnitureId: string,
  deg: number,
  zoneSiblings: Room[] = [],
  site?: { widthM: number; depthM: number } | null
): RoomInteriorPlan {
  const furniture = plan.furniture.map((item) => {
    if (item.id !== furnitureId) return item
    const rotated = { ...item, rotationDeg: normalizeAngle(deg) }
    return { ...rotated, ...clampToZoneBounds(rotated, room, zoneSiblings, site) }
  })
  const warnings = validateFurnitureInRoom(room, furniture, zoneSiblings)
  const budgetEstimate = buildRoomBudget(room, furniture, plan.materials, plan.lighting)
  return { ...plan, furniture, warnings, budgetEstimate }
}

/**
 * Set/clear override harga per-instance (Rp). `null` menghapus override —
 * furniture kembali ke harga item/aset (atau status "belum dihargai" bila
 * tidak ada). Budget di-recompute agar `priced`/`unpricedCount` selalu sinkron.
 */
export function setFurniturePriceInRoom(
  room: Room,
  plan: RoomInteriorPlan,
  furnitureId: string,
  priceIDR: number | null
): RoomInteriorPlan {
  const furniture = plan.furniture.map((item) =>
    item.id === furnitureId
      ? {
          ...item,
          priceOverrideIDR:
            priceIDR != null && Number.isFinite(priceIDR) && priceIDR > 0
              ? Math.round(priceIDR)
              : null,
        }
      : item
  )
  const budgetEstimate = buildRoomBudget(room, furniture, plan.materials, plan.lighting)
  return { ...plan, furniture, budgetEstimate }
}

/**
 * Legacy (schemaVersion 1) stored swapped dims for 90/270 rotations. Restore intrinsic
 * dims AND preserve the item's center — `x,y` is the min-corner, so un-swapping the
 * dims without shifting the corner would move the center by ((D−W)/2,(W−D)/2) and
 * shift rotated furniture off the wall / through walls after migration.
 */
export function normalizeLegacyRotation(furniture: PlacedFurniture[]): PlacedFurniture[] {
  return furniture.map((f) =>
    f.rotationDeg === 90 || f.rotationDeg === 270
      ? {
          ...f,
          widthM: f.depthM,
          depthM: f.widthM,
          x: f.x + (f.widthM - f.depthM) / 2,
          y: f.y + (f.depthM - f.widthM) / 2,
        }
      : f
  )
}

export function removePlacedFurniture(
  room: Room,
  plan: RoomInteriorPlan,
  furnitureId: string
): RoomInteriorPlan {
  const furniture = plan.furniture.filter((item) => item.id !== furnitureId)
  const warnings = validateFurnitureInRoom(room, furniture)
  const budgetEstimate = buildRoomBudget(room, furniture, plan.materials, plan.lighting)
  return { ...plan, furniture, warnings, budgetEstimate }
}

export function updateMaterialInRoom(
  room: Room,
  plan: RoomInteriorPlan,
  surface: InteriorSurface,
  materialId: string
): RoomInteriorPlan {
  const existing = plan.materials.find((item) => item.surface === surface)
  const replacement = materialAssignment(
    room.id,
    surface,
    materialId,
    existing?.areaM2 ?? materialAreaForSurface(room, surface)
  )
  const materials = existing
    ? plan.materials.map((item) => (item.surface === surface ? replacement : item))
    : [...plan.materials, replacement]

  return {
    ...plan,
    materials,
    budgetEstimate: buildRoomBudget(room, plan.furniture, materials, plan.lighting),
  }
}

export function addLightToRoom(
  room: Room,
  plan: RoomInteriorPlan,
  type: LightingFixture["type"],
  colorTemp?: LightingFixture["colorTemperature"]
): RoomInteriorPlan {
  const light = makeLight(type, room, colorTemp ?? plan.lighting[0]?.colorTemperature ?? "warm")
  const lighting = [...plan.lighting, light]
  return { ...plan, lighting, budgetEstimate: buildRoomBudget(room, plan.furniture, plan.materials, lighting) }
}

export function moveLightInRoom(
  room: Room,
  plan: RoomInteriorPlan,
  lightId: string,
  x: number,
  y: number
): RoomInteriorPlan {
  const lighting = plan.lighting.map((l) =>
    l.id === lightId ? { ...l, x: clamp(x, 0, room.width), y: clamp(y, 0, room.depth) } : l
  )
  return { ...plan, lighting, budgetEstimate: buildRoomBudget(room, plan.furniture, plan.materials, lighting) }
}

export function updateLightInRoom(
  room: Room,
  plan: RoomInteriorPlan,
  lightId: string,
  patch: Partial<Pick<LightingFixture, "type" | "colorTemperature" | "qty" | "heightM" | "watt">>
): RoomInteriorPlan {
  const lighting = plan.lighting.map((l) => {
    if (l.id !== lightId) return l
    const type = patch.type ?? l.type
    const qty = patch.qty != null ? Math.max(1, Math.round(patch.qty)) : l.qty
    return {
      ...l, type, qty,
      colorTemperature: patch.colorTemperature ?? l.colorTemperature,
      heightM: patch.heightM != null && patch.heightM > 0 ? patch.heightM : l.heightM,
      // Watt per unit (beban listrik & harga lampu) — clamp 1..200 W.
      watt: patch.watt != null && patch.watt > 0 ? Math.min(200, Math.round(patch.watt)) : l.watt,
      priceRange: lightPriceFor(type, qty),
    }
  })
  return { ...plan, lighting, budgetEstimate: buildRoomBudget(room, plan.furniture, plan.materials, lighting) }
}

export function removeLightFromRoom(
  room: Room,
  plan: RoomInteriorPlan,
  lightId: string
): RoomInteriorPlan {
  const lighting = plan.lighting.filter((l) => l.id !== lightId)
  return { ...plan, lighting, budgetEstimate: buildRoomBudget(room, plan.furniture, plan.materials, lighting) }
}

function placeFurniture(room: Room, style: InteriorStyleId): PlacedFurniture[] {
  const ids = TEMPLATE[room.type] ?? []
  const items = ids
    .map((id) => FURNITURE_LIBRARY.find((item) => item.id === id))
    .filter(Boolean) as FurnitureItem[]

  return items
    .map((item, index) => toPlacedFurniture(item, room, index, style))
    .filter((item) => item.widthM <= room.width + 0.2 && item.depthM <= room.depth + 0.2)
}

function toPlacedFurniture(
  item: FurnitureItem,
  room: Room,
  index: number,
  style?: InteriorStyleId
): PlacedFurniture {
  const primary = index === 0
  const width = Math.min(item.widthM, Math.max(0.8, room.width - 0.4))
  const depth = Math.min(item.depthM, Math.max(0.6, room.depth - 0.4))
  let x = 0.35
  let y = 0.35

  if (["ruang_tamu", "ruang_keluarga", "area_kumpul"].includes(room.type)) {
    if (item.category === "seating") {
      x = Math.max(0.35, (room.width - width) / 2)
      y = 0.45
    } else if (item.id === "coffee-table") {
      x = Math.max(0.35, (room.width - width) / 2)
      y = Math.min(room.depth - depth - 0.35, 1.55)
    } else if (item.id === "rug-large") {
      x = Math.max(0.35, (room.width - width) / 2)
      y = Math.min(room.depth - depth - 0.35, 1.25)
    } else if (item.id === "tv-cabinet") {
      x = Math.max(0.35, (room.width - width) / 2)
      y = Math.max(0.35, room.depth - depth - 0.35)
    } else if (item.id === "tv-55") {
      x = Math.max(0.35, (room.width - width) / 2)
      y = Math.max(0.35, room.depth - depth - 1.0)
    } else if (!primary) {
      x = Math.min(room.width - width - 0.25, 0.45 + index * 0.55)
      y = Math.max(0.35, room.depth - depth - 0.45)
    }
  } else if (room.type === "kamar_tidur") {
    if (item.category === "bed") {
      x = Math.max(0.35, (room.width - width) / 2)
      y = 0.35
    } else if (item.category === "wardrobe") {
      x = Math.max(0.25, room.width - width - 0.25)
      y = Math.max(0.35, room.depth - depth - 0.35)
    } else {
      x = 0.35 + index * 0.65
      y = Math.max(0.35, room.depth - depth - 0.35)
    }
  } else if (room.type === "dapur") {
    x = 0.25 + index * 0.85
    y = 0.25
  } else if (room.type === "kamar_mandi") {
    x = 0.25 + index * 0.85
    y = index === 0 ? 0.25 : Math.max(0.25, room.depth - depth - 0.25)
  } else if (room.type === "ruang_makan") {
    x = Math.max(0.35, (room.width - width) / 2)
    y = Math.max(0.35, (room.depth - depth) / 2)
  } else if (room.type === "rooftop_lounge" || room.type === "balkon") {
    x = 0.45 + index * 0.7
    y = primary ? 0.45 : Math.max(0.35, room.depth - depth - 0.45)
  } else if (item.id === "coffee-table") {
    x = Math.max(0.35, (room.width - width) / 2)
    y = Math.min(room.depth - depth - 0.35, 1.45)
  } else if (item.id === "tv-55") {
    x = Math.max(0.35, (room.width - width) / 2)
    y = Math.max(0.35, room.depth - depth - 0.75)
  } else if (item.id === "tv-cabinet") {
    x = Math.max(0.35, (room.width - width) / 2)
    y = Math.max(0.35, room.depth - depth - 0.25)
  } else if (!primary) {
    x = Math.min(room.width - width - 0.25, 0.45 + index * 0.55)
    y = Math.max(0.35, room.depth - depth - 0.4)
  }

  return {
    id: `placed-${room.id}-${item.id}-${index}`,
    furnitureId: item.id,
    roomId: room.id,
    name: item.name,
    category: item.category,
    x: round2(Math.max(0.05, Math.min(x, Math.max(0.05, room.width - width - 0.05)))),
    y: round2(Math.max(0.05, Math.min(y, Math.max(0.05, room.depth - depth - 0.05)))),
    rotationDeg: 0,
    widthM: round2(width),
    depthM: round2(depth),
    heightM: item.heightM,
    locked: false,
    priceRange: {
      low: style === "luxury_compact" ? Math.round(item.priceRange.low * 1.25) : item.priceRange.low,
      mid: style === "luxury_compact" ? Math.round(item.priceRange.mid * 1.25) : item.priceRange.mid,
      high: style === "luxury_compact" ? Math.round(item.priceRange.high * 1.25) : item.priceRange.high,
    },
    slotType: slotTypeForFurniture(item.id),
    modelAssetId: null,
    modelUrl: null,
    fitMode: null,
    materialMode: null,
    scaleFactor: null,
  }
}

function assignMaterials(room: Room, styleId: InteriorStyleId): MaterialAssignment[] {
  const floor = chooseMaterial("floor", room.type, styleId)
  const wall = chooseMaterial("wall", room.type, styleId)
  const ceilingArea = room.areaM2
  const wallArea = round2((room.width + room.depth) * 2 * 2.8)
  const accentArea = round2(Math.min(wallArea * 0.18, room.width * 2.4))
  const assignments: MaterialAssignment[] = []

  if (floor) assignments.push(materialAssignment(room.id, "floor", floor.id, room.areaM2))
  if (wall) assignments.push(materialAssignment(room.id, "wall", wall.id, wallArea))
  assignments.push({
    id: `mat-${room.id}-ceiling`,
    roomId: room.id,
    surface: "ceiling",
    materialId: "ceiling-gypsum",
    name: "Plafon gypsum putih",
    areaM2: ceilingArea,
    priceRange: { low: 95_000, mid: 150_000, high: 260_000 },
  })
  if (!["kamar_mandi", "laundry"].includes(room.type)) {
    const panel = getMaterial("panel-wood")
    if (panel) assignments.push(materialAssignment(room.id, "accent", panel.id, accentArea))
  }
  return assignments
}

function materialAssignment(
  roomId: string,
  surface: MaterialAssignment["surface"],
  materialId: string,
  areaM2: number
): MaterialAssignment {
  const material = getMaterial(materialId)
  return {
    id: `mat-${roomId}-${surface}`,
    roomId,
    surface,
    materialId,
    name: material?.name ?? materialId,
    areaM2: round2(areaM2),
    priceRange: material?.priceRange ?? { low: 0, mid: 0, high: 0 },
  }
}

function mergeSavedMaterials(
  room: Room,
  base: MaterialAssignment[],
  saved?: MaterialAssignment[]
): MaterialAssignment[] {
  if (!saved?.length) return base
  return base.map((assignment) => {
    const savedAssignment = saved.find((item) => item.surface === assignment.surface)
    if (!savedAssignment || !getMaterial(savedAssignment.materialId)) return assignment
    return materialAssignment(room.id, assignment.surface, savedAssignment.materialId, assignment.areaM2)
  })
}

function materialAreaForSurface(room: Room, surface: InteriorSurface): number {
  if (surface === "floor" || surface === "ceiling") return room.areaM2
  const wallArea = round2((room.width + room.depth) * 2 * 2.8)
  if (surface === "accent") return round2(Math.min(wallArea * 0.18, room.width * 2.4))
  return wallArea
}

function chooseMaterial(
  surface: "floor" | "wall",
  roomType: RoomType,
  styleId: InteriorStyleId
) {
  if (roomType === "kamar_mandi" || roomType === "laundry") {
    return MATERIAL_LIBRARY.find((m) => m.id === "bathroom-tile")
  }
  if (roomType === "rooftop_lounge" || roomType === "balkon") {
    return MATERIAL_LIBRARY.find((m) => m.id === "outdoor-deck")
  }
  if (surface === "wall") {
    return MATERIAL_LIBRARY.find(
      (m) => m.category === "wall_paint" && m.styleTags.includes(styleId)
    )
  }
  return MATERIAL_LIBRARY.find(
    (m) => m.category === "floor" && m.suitableRooms.includes(roomType) && m.styleTags.includes(styleId)
  ) ?? MATERIAL_LIBRARY.find((m) => m.category === "floor")
}

function suggestLighting(room: Room, styleId: InteriorStyleId): LightingFixture[] {
  const count = Math.max(1, Math.ceil(room.areaM2 / 7))
  const fixtures: LightingFixture[] = [
    {
      id: `light-${room.id}-downlight`,
      roomId: room.id,
      type: room.type === "rooftop_lounge" || room.type === "balkon" ? "outdoor" : "downlight",
      x: round2(room.width / 2),
      y: round2(room.depth / 2),
      heightM: 2.8,
      colorTemperature: styleId === "scandinavian" ? "neutral" : "warm",
      qty: count,
      priceRange: { low: 180_000 * count, mid: 350_000 * count, high: 900_000 * count },
    },
  ]
  if (["dapur", "workspace", "ruang_makan"].includes(room.type)) {
    fixtures.push({
      id: `light-${room.id}-task`,
      roomId: room.id,
      type: room.type === "ruang_makan" ? "pendant" : "task",
      x: round2(room.width * 0.55),
      y: round2(room.depth * 0.45),
      heightM: 2.6,
      colorTemperature: room.type === "workspace" ? "neutral" : "warm",
      qty: 1,
      priceRange: { low: 350_000, mid: 900_000, high: 2_800_000 },
    })
  }
  return fixtures
}

function validateRoomInterior(
  room: Room,
  furniture: PlacedFurniture[],
  layout: DesignLayout
): InteriorWarning[] {
  const warnings = validateFurnitureInRoom(room, furniture)
  const openings = layout.openings.filter((op) => op.wallId.startsWith(`${room.id}:`))
  if (openings.length === 0 && ["kamar_tidur", "ruang_tamu", "ruang_keluarga", "dapur"].includes(room.type)) {
    warnings.push({
      id: `opening-none-${room.id}`,
      level: "info",
      category: "opening",
      title: "Bukaan belum terbaca",
      message: `${room.name} sebaiknya dicek ulang posisi pintu/jendela sebelum belanja furniture.`,
    })
  }
  if (room.type === "rooftop_lounge" || room.type === "balkon") {
    warnings.push({
      id: `outdoor-${room.id}`,
      level: "warning",
      category: "material",
      title: "Material outdoor",
      message: "Furniture area luar perlu material tahan cuaca dan tidak menutup jalur drainase.",
    })
  }
  if (room.type === "rooftop_lounge") {
    warnings.push({
      id: `structure-${room.id}`,
      level: "warning",
      category: "structure",
      title: "Beban rooftop",
      message: "Furniture rooftop dan pergola perlu ditinjau bersama engineer struktur.",
    })
  }
  return warnings
}

/**
 * Axis-aligned bounding box of a furniture item's real (rotated) footprint.
 * Rotation never swaps the intrinsic `widthM`/`depthM` — the visual rotation happens
 * around the item's center, so a rotated rectangle's footprint on the axes can be
 * bigger (or smaller, per-axis) than its unrotated `widthM x depthM` box.
 */
export function rotatedAABB(item: {
  x: number
  y: number
  widthM: number
  depthM: number
  rotationDeg: number
}): { minX: number; minY: number; maxX: number; maxY: number } {
  const hw = item.widthM / 2
  const hd = item.depthM / 2
  const cx = item.x + hw
  const cy = item.y + hd
  const th = (item.rotationDeg * Math.PI) / 180
  const c = Math.abs(Math.cos(th))
  const s = Math.abs(Math.sin(th))
  const ex = hw * c + hd * s
  const ey = hw * s + hd * c
  return { minX: cx - ex, minY: cy - ey, maxX: cx + ex, maxY: cy + ey }
}

export function validateFurnitureInRoom(
  room: Room,
  furniture: PlacedFurniture[],
  zoneSiblings: Room[] = [],
  site?: { widthM: number; depthM: number } | null
): InteriorWarning[] {
  const warnings: InteriorWarning[] = []
  for (const item of furniture) {
    const aabb = rotatedAABB(item)
    const outsideRoom =
      aabb.minX < 0 || aabb.minY < 0 || aabb.maxX > room.width || aabb.maxY > room.depth
    // Item outdoor (taman/carport) sah berada di mana pun dalam batas tanah.
    if (outsideRoom && site && OUTDOOR_ROAM_TYPES.includes(room.type)) {
      const withinSite =
        room.x + aabb.minX >= -0.01 && room.y + aabb.minY >= -0.01 &&
        room.x + aabb.maxX <= site.widthM + 0.01 && room.y + aabb.maxY <= site.depthM + 0.01
      if (withinSite) continue
    }
    // In an open-plan zone the footprint may straddle into a sibling room —
    // only warn when it actually escapes the zone union.
    if (outsideRoom && !(zoneSiblings.length && footprintInsideZone(item, room, zoneSiblings))) {
      warnings.push({
        id: `inside-${item.id}`,
        level: "danger",
        category: "ergonomic",
        title: "Furniture keluar ruang",
        message: `${item.name} tidak sepenuhnya masuk ke ${room.name}.`,
        furnitureId: item.id,
      })
    }
  }
  for (let i = 0; i < furniture.length; i++) {
    for (let j = i + 1; j < furniture.length; j++) {
      if (rectsOverlap(toRect(furniture[i]), toRect(furniture[j]), 0.03)) {
        warnings.push({
          id: `overlap-${furniture[i].id}-${furniture[j].id}`,
          level: "warning",
          category: "ergonomic",
          title: "Furniture bertumpuk",
          message: `${furniture[i].name} dan ${furniture[j].name} saling bertabrakan.`,
          furnitureId: furniture[i].id,
        })
      }
    }
  }

  const furnitureArea = furniture.reduce((sum, item) => sum + item.widthM * item.depthM, 0)
  if (furnitureArea / Math.max(room.areaM2, 1) > 0.55) {
    warnings.push({
      id: `density-${room.id}`,
      level: "warning",
      category: "circulation",
      title: "Sirkulasi padat",
      message: "Furniture mengambil lebih dari separuh luas ruang. Pertahankan jalur gerak minimal 70 cm.",
    })
  }

  const bed = furniture.find((item) => item.category === "bed")
  if (bed) {
    const left = bed.x
    const right = room.width - (bed.x + bed.widthM)
    if (Math.max(left, right) < 0.6) {
      warnings.push({
        id: `bed-side-${bed.id}`,
        level: "warning",
        category: "circulation",
        title: "Akses samping kasur sempit",
        message: "Kasur sebaiknya punya akses samping minimal sekitar 60-70 cm bila memungkinkan.",
        furnitureId: bed.id,
      })
    }
  }

  const dining = furniture.find((item) => item.furnitureId === "dining-table-4")
  if (dining) {
    const clearX = Math.min(dining.x, room.width - dining.x - dining.widthM)
    const clearY = Math.min(dining.y, room.depth - dining.y - dining.depthM)
    if (Math.max(clearX, clearY) < 0.75) {
      warnings.push({
        id: `dining-clearance-${dining.id}`,
        level: "warning",
        category: "circulation",
        title: "Tarikan kursi sempit",
        message: "Meja makan perlu ruang sekitar 75-90 cm agar kursi nyaman ditarik.",
        furnitureId: dining.id,
      })
    }
  }

  return warnings
}

/**
 * Harga efektif sebuah furniture: override per-instance (bila diisi) menang
 * atas priceRange item/aset. Satu-satunya resolver — dipakai budget interior
 * dan RAB agar angkanya tidak pernah berbeda.
 */
export function resolvedFurniturePriceRange(item: PlacedFurniture): PriceRange {
  if (item.priceOverrideIDR != null && item.priceOverrideIDR > 0) {
    const v = item.priceOverrideIDR
    return { low: v, mid: v, high: v }
  }
  return item.priceRange
}

/** Furniture "belum dihargai" = harga efektif 0 (custom tanpa harga aset/override). */
export function isUnpricedFurniture(item: PlacedFurniture): boolean {
  return resolvedFurniturePriceRange(item).mid <= 0
}

export function buildRoomBudget(
  room: Room,
  furniture: PlacedFurniture[],
  materials: MaterialAssignment[],
  lighting: LightingFixture[]
): InteriorBudgetEstimate {
  const lines: InteriorBudgetLine[] = [
    ...furniture.map((item) => {
      const price = resolvedFurniturePriceRange(item)
      return {
        id: `budget-${item.id}`,
        roomId: room.id,
        category: item.category === "wardrobe" || item.category === "kitchen" || item.category === "cabinet" ? "built_in" as const : item.category === "decor" ? "decor" as const : "furniture" as const,
        item: item.name,
        qty: 1,
        unit: "unit",
        lowIDR: price.low,
        midIDR: price.mid,
        highIDR: price.high,
        priced: price.mid > 0,
      }
    }),
    ...materials.map((material) => ({
      id: `budget-${material.id}`,
      roomId: room.id,
      category: "material" as const,
      item: `${material.name} (${surfaceLabel(material.surface)})`,
      qty: material.areaM2,
      unit: "m2",
      lowIDR: Math.round(material.areaM2 * material.priceRange.low),
      midIDR: Math.round(material.areaM2 * material.priceRange.mid),
      highIDR: Math.round(material.areaM2 * material.priceRange.high),
    })),
    ...lighting.map((light) => ({
      id: `budget-${light.id}`,
      roomId: room.id,
      category: "lighting" as const,
      item: lightingLabel(light.type),
      qty: light.qty,
      unit: "titik",
      lowIDR: light.priceRange.low,
      midIDR: light.priceRange.mid,
      highIDR: light.priceRange.high,
    })),
  ]
  // Baseline jasa instalasi 12% HANYA dari line yang priced — item "belum
  // dihargai" tidak boleh menggeser baseline (harga efektifnya belum diketahui).
  const installMid = Math.max(
    750_000,
    Math.round(
      lines.reduce((s, l) => s + (l.priced === false ? 0 : l.midIDR), 0) * 0.12
    )
  )
  lines.push({
    id: `budget-install-${room.id}`,
    roomId: room.id,
    category: "installation",
    item: "Jasa instalasi & finishing interior",
    qty: 1,
    unit: "ls",
    lowIDR: Math.round(installMid * 0.65),
    midIDR: installMid,
    highIDR: Math.round(installMid * 1.45),
  })
  return combineBudget(lines)
}

export function combineBudget(lines: InteriorBudgetLine[]): InteriorBudgetEstimate {
  return {
    lowIDR: roundMoney(lines.reduce((sum, line) => sum + line.lowIDR, 0)),
    midIDR: roundMoney(lines.reduce((sum, line) => sum + line.midIDR, 0)),
    highIDR: roundMoney(lines.reduce((sum, line) => sum + line.highIDR, 0)),
    lines,
    unpricedCount: lines.filter((line) => line.priced === false).length,
  }
}

function toRect(item: PlacedFurniture) {
  return { x: item.x, y: item.y, width: item.widthM, depth: item.depthM }
}

function roundMoney(n: number): number {
  return Math.round(n / 1000) * 1000
}

function clampScore(n: number): number {
  return Math.max(45, Math.min(100, Math.round(n)))
}

function surfaceLabel(surface: MaterialAssignment["surface"]): string {
  if (surface === "floor") return "lantai"
  if (surface === "wall") return "dinding"
  if (surface === "ceiling") return "plafon"
  return "aksen"
}

function lightingLabel(type: LightingFixture["type"]): string {
  const labels: Record<LightingFixture["type"], string> = {
    downlight: "Downlight",
    pendant: "Pendant lamp",
    wall_lamp: "Wall lamp",
    indirect: "Indirect light",
    task: "Task lighting",
    outdoor: "Outdoor light",
  }
  return labels[type]
}
