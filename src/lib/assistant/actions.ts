/**
 * Shared contract for the agentic editor AI assistant.
 *
 * Defines the structured "actions" the assistant may propose, the compact scene
 * snapshots the client sends as grounding, and the request/response envelope.
 * The zod schemas are the single source of truth — TS types are inferred from
 * them so the server validation and the client typing never drift.
 *
 * Isomorphic: imported by the API route (server) AND the panel/apply helpers
 * (client). Must not import anything server-only (no db, no fetch).
 */
import { z } from "zod"

import type {
  ElectricalPointType,
  ExteriorElementKind,
  FacadeElementKind,
  FacadeElementFinish,
  InteriorStyleId,
  OpeningKind,
  RoofMaterial,
  RoofType,
  Room,
  RoomType,
  WaterPointType,
} from "@/types"
import { ELECTRICAL_POINT_TYPES, OPENING_KIND_META, ROOF_MATERIALS, ROOM_TYPES, WATER_POINT_TYPES } from "@/lib/constants"
import { FACADE_CLADDINGS, facadeCladdingById } from "@/lib/three/facade-claddings"
import { INTERIOR_STYLES, getFurniture } from "@/lib/interior/presets"
import { FACADE_COMPOSER_TEMPLATE_IDS } from "@/lib/exterior/facade-templates"
import { CANTILEVER_MAX_M } from "@/lib/editor/floors"

/* ------------------------------------------------------------------ */
/* Enums (kept in sync with the domain unions via `satisfies`)         */
/* ------------------------------------------------------------------ */

const ROOM_TYPE_VALUES = [
  "kamar_tidur", "kamar_mandi", "ruang_tamu", "ruang_keluarga", "dapur",
  "ruang_makan", "musholla", "laundry", "gudang", "balkon", "rooftop_lounge",
  "area_kumpul", "kolam", "taman", "workspace", "carport", "void", "tangga",
  "koridor",
] as const satisfies readonly RoomType[]

const INTERIOR_STYLE_VALUES = [
  "modern_tropical", "warm_minimalist", "japandi", "scandinavian",
  "industrial", "luxury_compact", "family_cozy",
] as const satisfies readonly InteriorStyleId[]

const ROOF_TYPE_VALUES = [
  "datar", "pelana", "limasan", "miring",
] as const satisfies readonly RoofType[]

const ROOF_MATERIAL_VALUES = [
  "genteng_beton", "genteng_keramik", "metal", "aspal",
] as const satisfies readonly RoofMaterial[]

const ELECTRICAL_POINT_TYPE_VALUES = [
  "stopkontak", "stopkontak_daya", "saklar_tunggal", "saklar_ganda", "panel", "data",
] as const satisfies readonly ElectricalPointType[]

const WATER_POINT_TYPE_VALUES = [
  "kloset", "wastafel", "shower", "kran", "kran_taman", "floor_drain", "sink_dapur", "kran_wudhu",
] as const satisfies readonly WaterPointType[]

const OPENING_KIND_VALUES = [
  "fixed_window", "casement_window", "sliding_window", "awning_window", "clerestory_window",
  "curtain_wall", "skylight", "jalousie_window", "roster", "krawangan",
  "hinged_door", "sliding_glass_door", "pocket_door", "folding_door", "pivot_door",
  "garage_door", "open_passage", "facade_cutout", "cantilever_opening",
] as const satisfies readonly OpeningKind[]

const RAILING_STYLE_VALUES = [
  "kaca", "besi", "tembok", "kayu",
] as const satisfies readonly NonNullable<Room["railingStyle"]>[]

const FACADE_FINISH_VALUES = [
  "kayu", "aluminium_gelap", "putih",
] as const satisfies readonly FacadeElementFinish[]

const FACADE_ELEMENT_KIND_VALUES = [
  "louver_band", "slat_horizontal", "roster_screen",
] as const satisfies readonly FacadeElementKind[]

const EXTERIOR_ELEMENT_KIND_VALUES = [
  "boundary_wall", "fence", "sliding_gate", "swing_gate", "pedestrian_gate",
  "solid_wall", "facade_panel", "column", "chimney", "beam", "slab", "canopy", "overhang_slab", "planter", "pergola",
  "portal_frame", "gable_frame", "exterior_stair", "driveway", "walkway", "terrace_surface",
  "garden_bed", "asset", "plant", "tree", "exterior_decor", "vehicle",
] as const satisfies readonly ExteriorElementKind[]

/** 11 id cladding fasad — diturunkan langsung dari katalog agar tidak drift. */
const FACADE_CLADDING_ID_VALUES = FACADE_CLADDINGS.map((c) => c.id) as [string, ...string[]]

const roomTypeSchema = z.enum(ROOM_TYPE_VALUES)
const interiorStyleSchema = z.enum(INTERIOR_STYLE_VALUES)
const sideSchema = z.enum(["n", "e", "s", "w"])
const lightTypeSchema = z.enum(["downlight", "pendant", "wall_lamp", "indirect", "task", "outdoor"])
const colorTempSchema = z.enum(["warm", "neutral", "cool"])
const roofTypeSchema = z.enum(ROOF_TYPE_VALUES)
const roofMaterialSchema = z.enum(ROOF_MATERIAL_VALUES)
const electricalPointTypeSchema = z.enum(ELECTRICAL_POINT_TYPE_VALUES)
const waterPointTypeSchema = z.enum(WATER_POINT_TYPE_VALUES)
const sanitationKindSchema = z.enum(["septicTank", "soakwell", "controlBox"])
const openingKindSchema = z.enum(OPENING_KIND_VALUES)
const railingStyleSchema = z.enum(RAILING_STYLE_VALUES)
const facadeFinishSchema = z.enum(FACADE_FINISH_VALUES)
const facadeElementKindSchema = z.enum(FACADE_ELEMENT_KIND_VALUES)
const facadeCladdingIdSchema = z.enum(FACADE_CLADDING_ID_VALUES)
const facadeFaceSchema = z.enum(["outer", "inner"])
const exteriorElementKindSchema = z.enum(EXTERIOR_ELEMENT_KIND_VALUES)
const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "warna hex #rrggbb")
/** Model GLB library: string = pasang, null = lepas. */
const modelRefSchema = z.string().min(1).max(500).nullable()

export type EditorAssistantMode = "floorplan" | "interior"
export type AssistantMode = "brief" | EditorAssistantMode
export const ASSISTANT_SURFACES = [
  "project",
  "brief",
  "alternatives",
  "editor",
  "preview-3d",
  "rab",
  "drawings",
  "exports",
  "review",
  "furniture",
  "materials",
] as const
export type AssistantSurface = (typeof ASSISTANT_SURFACES)[number]

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

const openingPatchSchema = z.object({
  positionM: z.number().finite().nonnegative().optional(),
  widthM: z.number().finite().positive().optional(),
  heightM: z.number().finite().positive().optional(),
  openingType: z.enum(["door", "window"]).optional(),
  /** Jenis spesifik (garage_door, sliding_glass_door, roster, …). Mengubah kind
   *  me-reset metadata + dimensi ke default kind (pola QuickEditor); field
   *  eksplisit lain di patch yang sama menimpa default itu. */
  kind: openingKindSchema.optional(),
  /** Warna kusen custom (hex) — menang atas warna bawaan frameMaterial. */
  frameColor: hexColorSchema.optional(),
  sillHeightM: z.number().finite().nonnegative().optional(),
  headHeightM: z.number().finite().positive().optional(),
  /** Bingkai MENONJOL (extruded frame) keluar muka dinding, m (0 = flush). */
  frameDepthM: z.number().finite().min(0).max(0.8).optional(),
  /** Siluet LENGKUNG (fasad mediterania): "arch" = setengah lingkaran di
   *  atas, "capsule" = setengah lingkaran di kedua ujung (pill). Lubang
   *  dinding tetap persegi; store meng-clamp widthM/heightM agar radiusnya
   *  muat (arch butuh heightM ≥ widthM/2 + 0.2). Absen = persegi biasa. */
  archShape: z.enum(["arch", "capsule"]).optional(),
  /** Tepi ATAS miring (bukaan TRAPESIUM mengikuti kemiringan atap/gable):
   *  beda tinggi (m) tepi atas sisi along+ vs along− (± = arah, lihat
   *  Opening.topSlopeM). Lubang dinding tetap persegi setinggi heightM
   *  (sisi tinggi); store meng-clamp ±3 m & jaga sisi rendah ≥ 0.3 m.
   *  0/absen = persegi biasa. */
  topSlopeM: z.number().finite().min(-3).max(3).optional(),
  /** Daun/panel GLB kustom dari library; null = lepas kembali ke prosedural. */
  modelUrl: modelRefSchema.optional(),
  modelAssetId: modelRefSchema.optional(),
})

const roofPatchSchema = z.object({
  type: roofTypeSchema.optional(),
  slopeDeg: z.number().finite().optional(),
  overhangM: z.number().finite().optional(),
  material: roofMaterialSchema.optional(),
  /** Skillion (type "miring"): sisi rendah — arah air. */
  lowSide: sideSchema.optional(),
  /** Gable asimetris (pelana): geser bubungan dari tengah (m, ± = +x/+y site). */
  ridgeOffsetM: z.number().finite().optional(),
  /** Sopi-sopi (pelana): isi ujung bubungan per sisi — "wall" | "glass";
   *  kirim {} utk menghapus semua. */
  gableEnds: z
    .object({
      n: z.enum(["wall", "glass"]).optional(),
      s: z.enum(["wall", "glass"]).optional(),
      w: z.enum(["wall", "glass"]).optional(),
      e: z.enum(["wall", "glass"]).optional(),
    })
    .optional(),
  /** Lis fascia band tepi atap datar/dak; undefined = tidak diubah,
   *  null = MATIKAN lis (apply mengirim kunci eksplisit ke store). */
  fascia: z
    .object({ heightM: z.number().finite().min(0.1).max(0.8), color: hexColorSchema })
    .nullable()
    .optional(),
})

const roofZonePatchSchema = z.object({
  type: roofTypeSchema.optional(),
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  widthM: z.number().finite().positive().optional(),
  depthM: z.number().finite().positive().optional(),
  slopeDeg: z.number().finite().optional(),
  overhangM: z.number().finite().optional(),
  materialId: roofMaterialSchema.optional(),
  lowSide: sideSchema.optional(),
  /** Gable asimetris (pelana): geser bubungan dari tengah (m). */
  ridgeOffsetM: z.number().finite().optional(),
  /** Sopi-sopi (pelana): isi ujung bubungan per sisi. */
  gableEnds: z
    .object({
      n: z.enum(["wall", "glass"]).optional(),
      s: z.enum(["wall", "glass"]).optional(),
      w: z.enum(["wall", "glass"]).optional(),
      e: z.enum(["wall", "glass"]).optional(),
    })
    .optional(),
  floorId: z.string().min(1).optional(),
})

const roofZoneDraftSchema = roofZonePatchSchema.extend({
  type: roofTypeSchema,
  x: z.number().finite(),
  y: z.number().finite(),
  widthM: z.number().finite().positive(),
  depthM: z.number().finite().positive(),
}).refine((v) => v.widthM > 0 && v.depthM > 0)

/** ComponentPatternSpec — pola kisi/roster kustom (fasad & pergola). Clamp
 *  di sini WAJIB sinkron dengan resolver runtime (`lib/three/component-pattern.ts`)
 *  dan tipe domain (`types/exterior.ts`). */
const componentPatternSchema = z.object({
  orientation: z.enum(["v", "h", "grid", "cross"]).optional(),
  pitchM: z.number().finite().min(0.05).max(1.5).optional(),
  barWidthM: z.number().finite().min(0.02).max(0.5).optional(),
  // Batas bawah 0.01 (bukan 0.02) supaya preset "Nat beton / reveal line"
  // (barDepthM 0.012) tidak ditolak — sinkron dgn BAR_DEPTH_RANGE di
  // lib/three/component-pattern.ts.
  barDepthM: z.number().finite().min(0.01).max(0.6).optional(),
  rhythm: z.array(z.number().finite().min(1).max(10)).max(8).optional(),
  frame: z.boolean().optional(),
  // Reveal line/nat beton: batang tenggelam di muka dinding (bukan
  // menonjol keluar). Hanya berefek pada elemen fasad (konteks WALL_T).
  inset: z.boolean().optional(),
})

const facadeElementPatchSchema = z.object({
  positionM: z.number().finite().nonnegative().optional(),
  widthM: z.number().finite().positive().optional(),
  sillHeightM: z.number().finite().nonnegative().optional(),
  heightM: z.number().finite().positive().optional(),
  kind: facadeElementKindSchema.optional(),
  finish: facadeFinishSchema.optional(),
  modelUrl: modelRefSchema.optional(),
  modelAssetId: modelRefSchema.optional(),
  /** Pola kisi/roster kustom — menggantikan konstanta pitch/lebar/kedalaman
   *  bawaan `kind`; absen = jalur numerik lama. */
  pattern: componentPatternSchema.optional(),
  /** Warna bilah custom (hex) — menang atas warna bawaan `finish`, mis.
   *  cocokkan dengan cladding kayu gelap "#6f4e37". */
  colorHex: hexColorSchema.optional(),
})

const lampPatchSchema = z.object({
  /** Warna cahaya (hex). */
  color: hexColorSchema.optional(),
  /** Skala intensitas 0–2 (0 = mati); nilai lebih besar di-clamp sanitizer. */
  intensity: z.number().finite().min(0).optional(),
  /** Daya (Watt). */
  watt: z.number().finite().positive().optional(),
  /** Tinggi tumpu fixture dari lantai (meter). */
  mountH: z.number().finite().nonnegative().optional(),
  /** Model GLB kustom dari library; null = kembali ke fixture prosedural. */
  modelUrl: modelRefSchema.optional(),
  modelAssetId: modelRefSchema.optional(),
})

const exteriorMaterialSurfaceSchema = z.object({
  materialId: z.string().min(1).max(100).optional(),
  color: hexColorSchema.optional(),
  finish: z.string().min(1).max(100).optional(),
})

const exteriorMaterialSchema = exteriorMaterialSurfaceSchema.extend({
  surfaces: z.object({
    top: exteriorMaterialSurfaceSchema.optional(),
    side: exteriorMaterialSurfaceSchema.optional(),
    underside: exteriorMaterialSurfaceSchema.optional(),
  }).optional(),
}).optional()

const exteriorDraftSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.enum(["boundary_wall", "fence", "sliding_gate", "swing_gate", "pedestrian_gate"]),
    floorId: z.string().min(1).optional(),
    label: z.string().max(100).optional(),
    start: z.object({ x: z.number().finite(), y: z.number().finite() }),
    end: z.object({ x: z.number().finite(), y: z.number().finite() }),
    heightM: z.number().finite().positive(),
    thicknessM: z.number().finite().positive().optional(),
    material: exteriorMaterialSchema,
  }),
  z.object({
    kind: z.enum(["solid_wall", "facade_panel", "column", "chimney", "beam", "slab", "canopy", "overhang_slab", "planter", "pergola"]),
    floorId: z.string().min(1).optional(),
    label: z.string().max(100).optional(),
    x: z.number().finite(),
    y: z.number().finite(),
    zM: z.number().finite().nonnegative().optional(),
    widthM: z.number().finite().positive(),
    depthM: z.number().finite().positive(),
    heightM: z.number().finite().positive(),
    rotationDeg: z.number().finite().optional(),
    material: exteriorMaterialSchema,
    /** Hanya kind "pergola": pola kisi silang & kolom penyangga. */
    pattern: componentPatternSchema.optional(),
    posts: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("portal_frame"),
    floorId: z.string().min(1).optional(),
    label: z.string().max(100).optional(),
    x: z.number().finite(),
    y: z.number().finite(),
    widthM: z.number().finite().positive(),
    heightM: z.number().finite().positive(),
    depthM: z.number().finite().positive().optional(),
    memberSizeM: z.number().finite().positive(),
    rotationDeg: z.number().finite().optional(),
    material: exteriorMaterialSchema,
  }),
  z.object({
    kind: z.literal("gable_frame"),
    floorId: z.string().min(1).optional(),
    label: z.string().max(100).optional(),
    x: z.number().finite(),
    y: z.number().finite(),
    zM: z.number().finite().nonnegative().optional(),
    widthM: z.number().finite().positive(),
    heightM: z.number().finite().positive(),
    eaveLeftM: z.number().finite().positive(),
    eaveRightM: z.number().finite().positive(),
    apexOffsetM: z.number().finite().optional(),
    depthM: z.number().finite().positive().optional(),
    memberSizeM: z.number().finite().positive(),
    rotationDeg: z.number().finite().optional(),
    material: exteriorMaterialSchema,
  }),
  z.object({
    kind: z.literal("exterior_stair"),
    floorId: z.string().min(1).optional(),
    label: z.string().max(100).optional(),
    x: z.number().finite(),
    y: z.number().finite(),
    widthM: z.number().finite().positive(),
    lengthM: z.number().finite().positive(),
    riseM: z.number().finite().positive(),
    direction: z.enum(["n", "s", "w", "e"]),
    material: exteriorMaterialSchema,
  }),
  z.object({
    kind: z.enum(["driveway", "walkway", "terrace_surface", "garden_bed"]),
    floorId: z.string().min(1).optional(),
    label: z.string().max(100).optional(),
    points: z.array(z.object({ x: z.number().finite(), y: z.number().finite() })).min(3).max(16),
    thicknessM: z.number().finite().positive().optional(),
    scatterSeed: z.number().int().nonnegative().optional(),
    material: exteriorMaterialSchema,
  }),
  z.object({
    kind: z.enum(["asset", "plant", "tree", "exterior_decor", "vehicle"]),
    floorId: z.string().min(1).optional(),
    label: z.string().max(100).optional(),
    x: z.number().finite(),
    y: z.number().finite(),
    zM: z.number().finite().nonnegative().optional(),
    widthM: z.number().finite().positive(),
    depthM: z.number().finite().positive(),
    heightM: z.number().finite().positive(),
    rotationDeg: z.number().finite().optional(),
    modelUrl: z.string().min(1).max(500),
    material: exteriorMaterialSchema,
  }),
])

const exteriorPatchSchema = z.object({
  floorId: z.string().min(1).optional(),
  label: z.string().max(100).optional(),
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  zM: z.number().finite().nonnegative().optional(),
  widthM: z.number().finite().positive().optional(),
  depthM: z.number().finite().positive().optional(),
  heightM: z.number().finite().positive().optional(),
  lengthM: z.number().finite().positive().optional(),
  riseM: z.number().finite().positive().optional(),
  memberSizeM: z.number().finite().positive().optional(),
  thicknessM: z.number().finite().positive().optional(),
  rotationDeg: z.number().finite().optional(),
  direction: z.enum(["n", "s", "w", "e"]).optional(),
  start: z.object({ x: z.number().finite(), y: z.number().finite() }).optional(),
  end: z.object({ x: z.number().finite(), y: z.number().finite() }).optional(),
  points: z.array(z.object({ x: z.number().finite(), y: z.number().finite() })).min(3).max(16).optional(),
  material: exteriorMaterialSchema,
  /** Hanya kind "pergola": pola kisi silang & kolom penyangga. */
  pattern: componentPatternSchema.optional(),
  posts: z.boolean().optional(),
})

const rooftopAreaSchema = z.object({
  x: z.number().finite(), y: z.number().finite(),
  width: z.number().finite().positive(), depth: z.number().finite().positive(),
})

const electricalPatchSchema = z.object({
  type: electricalPointTypeSchema.optional(),
  roomId: z.string().min(1).optional(),
  note: z.string().max(200).optional(),
})

const waterPatchSchema = z.object({
  type: waterPointTypeSchema.optional(),
  roomId: z.string().min(1).optional(),
  note: z.string().max(200).optional(),
})

const roomPatchSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  type: roomTypeSchema.optional(),
  floorId: z.string().min(1).optional(), // move the room to another floor
  zoneId: z.string().min(1).max(40).optional(),
  levelOffsetM: z.number().finite().min(-0.9).max(0.9).optional(),
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  width: z.number().finite().positive().optional(),
  depth: z.number().finite().positive().optional(),
  locked: z.boolean().optional(),
  requiresNaturalLight: z.boolean().optional(),
  requiresVentilation: z.boolean().optional(),
  /** Ruang tipe "tangga": arah NAIK anak tangga. */
  stairDirection: sideSchema.optional(),
  /** Ruang tipe "tangga": target tinggi tanjakan (riser, m); null/absent = auto 0.18. */
  stairRiserM: z.number().nullable().optional(),
  stairShape: z.enum(["lurus", "L", "U"]).nullable().optional(),
  stairTurn: z.enum(["kiri", "kanan"]).nullable().optional(),
  poolShallowM: z.number().nullable().optional(),
  poolDeepM: z.number().nullable().optional(),
  poolEntrySide: z.enum(["n", "s", "w", "e"]).nullable().optional(),
  poolCirculationType: z.enum(["skimmer", "overflow"]).nullable().optional(),
  poolHasJets: z.boolean().nullable().optional(),
  poolHeater: z.boolean().nullable().optional(),
  poolSaltChlorinator: z.boolean().nullable().optional(),
  /** Ruang tipe "balkon": model railing sisi terbuka. */
  railingStyle: railingStyleSchema.optional(),
  /** Model railing GLB kustom dari library; null = lepas (kembali ke railingStyle). */
  railingModelUrl: modelRefSchema.optional(),
  railingModelAssetId: modelRefSchema.optional(),
  /** Ruang tipe "balkon": tonjolan busur (m) tepi depan; 0/absen = lurus. */
  edgeBowM: z.number().finite().min(0).max(1.5).optional(),
})

/**
 * Patch lantai (bukan ruang) — heightM/name/baseOffsetM sudah ada di store
 * `updateFloor` (editor-store.ts) sejak lama (dipakai UI editor-inspector.tsx);
 * `offsetM` (CANTILEVER, CB3) menggeser massa lantai horizontal (dx/dy, m,
 * koordinat site) untuk kesan massa menjorok/berundak — dibatasi ±CANTILEVER_MAX_M
 * per sumbu di sini (sama seperti `levelOffsetM` split-level di roomPatchSchema);
 * aksi dengan offsetM di luar batas ditolak zod (tidak sampai ke store). Store
 * `updateFloor` DAN sanitizer server (editor-assistant.ts) tetap meng-clamp
 * ulang secara independen (defense in depth, bukan satu-satunya penjaga).
 */
const floorPatchSchema = z.object({
  heightM: z.number().finite().positive().optional(),
  name: z.string().trim().min(1).max(60).optional(),
  baseOffsetM: z.number().finite().optional(),
  /** CANTILEVER: geser massa lantai, ±CANTILEVER_MAX_M per sumbu. */
  offsetM: z
    .object({
      dx: z.number().finite().min(-CANTILEVER_MAX_M).max(CANTILEVER_MAX_M),
      dy: z.number().finite().min(-CANTILEVER_MAX_M).max(CANTILEVER_MAX_M),
    })
    .optional(),
})

export const floorplanActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("updateRoom"), roomId: z.string().min(1), patch: roomPatchSchema }),
  z.object({
    type: z.literal("addOpening"),
    roomId: z.string().min(1),
    side: sideSchema,
    positionM: z.number().finite().nonnegative(),
    openingType: z.enum(["door", "window"]),
    /** Jenis spesifik opsional (mis. "garage_door" 2.7×2.2) — dipasang setelah
     *  bukaan dibuat; openingType diturunkan dari kind bila keduanya bentrok. */
    kind: openingKindSchema.optional(),
  }),
  z.object({ type: z.literal("deleteRoom"), roomId: z.string().min(1) }),
  z.object({ type: z.literal("addRoom"), roomType: roomTypeSchema, floorId: z.string().min(1).optional(), x: z.number().finite().optional(), y: z.number().finite().optional(), width: z.number().finite().positive().optional(), depth: z.number().finite().positive().optional() }),
  z.object({ type: z.literal("addFloor") }),
  z.object({ type: z.literal("removeFloor"), floorId: z.string().min(1) }),
  /** Ubah lantai (bukan ruang): tinggi/nama/elevasi mezzanine/geser massa
   *  cantilever (offsetM). Lihat `floorPatchSchema`. */
  z.object({ type: z.literal("updateFloor"), floorId: z.string().min(1), patch: floorPatchSchema }),
  z.object({ type: z.literal("updateOpening"), openingId: z.string().min(1), patch: openingPatchSchema }),
  z.object({ type: z.literal("deleteOpening"), openingId: z.string().min(1) }),
  z.object({ type: z.literal("setRoof"), patch: roofPatchSchema }),
  z.object({ type: z.literal("addRoofZone"), zone: roofZoneDraftSchema }),
  z.object({ type: z.literal("updateRoofZone"), id: z.string().min(1), patch: roofZonePatchSchema }),
  z.object({ type: z.literal("removeRoofZone"), id: z.string().min(1) }),
  /** Aktif/nonaktifkan lantai dak rooftop ("floor-rooftop"). */
  z.object({ type: z.literal("setRooftop"), enabled: z.boolean() }),
  z.object({ type: z.literal("setRooftopArea"), area: rooftopAreaSchema }),
  z.object({ type: z.literal("clearRooftopArea") }),
  /** Cladding per dinding (`roomId:side`); claddingId null = kembali polos. */
  z.object({
    type: z.literal("setWallCladding"),
    wallId: z.string().min(1),
    claddingId: facadeCladdingIdSchema.nullable(),
    face: facadeFaceSchema.optional(),
  }),
  /** Louver band selebar dinding host (default sill 0.3 m, tinggi 2.2 m). */
  z.object({ type: z.literal("addFacadeElement"), wallId: z.string().min(1) }),
  z.object({ type: z.literal("updateFacadeElement"), id: z.string().min(1), patch: facadeElementPatchSchema }),
  z.object({ type: z.literal("removeFacadeElement"), id: z.string().min(1) }),
  z.object({ type: z.literal("addExteriorElement"), element: exteriorDraftSchema }),
  z.object({ type: z.literal("updateExteriorElement"), id: z.string().min(1), patch: exteriorPatchSchema }),
  z.object({ type: z.literal("removeExteriorElement"), id: z.string().min(1) }),
  z.object({ type: z.literal("applyFacadeTemplate"), templateId: z.enum(FACADE_COMPOSER_TEMPLATE_IDS) }),
  /** Lampu eksterior (copy-on-write dari penempatan otomatis). */
  z.object({ type: z.literal("addWallLamp"), wallId: z.string().min(1) }),
  z.object({ type: z.literal("updateLamp"), id: z.string().min(1), patch: lampPatchSchema }),
  z.object({ type: z.literal("removeLamp"), id: z.string().min(1) }),
  z.object({ type: z.literal("setSoilBearing"), soilBearingKPa: z.number() }),
  z.object({
    type: z.literal("addElectricalPoint"),
    roomId: z.string().min(1),
    pointType: electricalPointTypeSchema,
    x: z.number().finite(),
    y: z.number().finite(),
  }),
  z.object({
    type: z.literal("moveElectricalPoint"),
    id: z.string().min(1),
    x: z.number().finite(),
    y: z.number().finite(),
  }),
  z.object({ type: z.literal("updateElectricalPoint"), id: z.string().min(1), patch: electricalPatchSchema }),
  z.object({ type: z.literal("removeElectricalPoint"), id: z.string().min(1) }),
  z.object({ type: z.literal("autoGenerateElectrical"), floorId: z.string().min(1).optional() }),
  z.object({
    type: z.literal("addWaterPoint"),
    roomId: z.string().min(1),
    waterType: waterPointTypeSchema,
    x: z.number().finite(),
    y: z.number().finite(),
  }),
  z.object({
    type: z.literal("moveWaterPoint"),
    id: z.string().min(1),
    x: z.number().finite(),
    y: z.number().finite(),
  }),
  z.object({ type: z.literal("updateWaterPoint"), id: z.string().min(1), patch: waterPatchSchema }),
  z.object({ type: z.literal("removeWaterPoint"), id: z.string().min(1) }),
  z.object({ type: z.literal("autoGenerateWater"), floorId: z.string().min(1).optional() }),
  z.object({
    type: z.literal("moveSanitationObject"),
    kind: sanitationKindSchema,
    ref: z.number().int().nonnegative().optional(),
    x: z.number().finite(),
    y: z.number().finite(),
  }),
  z.object({ type: z.literal("autoSizeSanitation") }),
])

export const interiorActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("addFurniture"), roomId: z.string().min(1), furnitureId: z.string().min(1) }),
  z.object({
    type: z.literal("moveFurniture"),
    roomId: z.string().min(1),
    furnitureId: z.string().min(1),
    x: z.number().finite(),
    y: z.number().finite(),
  }),
  z.object({ type: z.literal("rotateFurniture"), roomId: z.string().min(1), furnitureId: z.string().min(1) }),
  z.object({ type: z.literal("removeFurniture"), roomId: z.string().min(1), furnitureId: z.string().min(1) }),
  z.object({ type: z.literal("setStyle"), style: interiorStyleSchema }),
  z.object({ type: z.literal("resetRoom"), roomId: z.string().min(1) }),
  z.object({ type: z.literal("addLight"), roomId: z.string().min(1), lightType: lightTypeSchema }),
  z.object({ type: z.literal("moveLight"), roomId: z.string().min(1), lightId: z.string().min(1), x: z.number().finite(), y: z.number().finite() }),
  z.object({ type: z.literal("updateLight"), roomId: z.string().min(1), lightId: z.string().min(1),
    patch: z.object({ lightType: lightTypeSchema.optional(), colorTemperature: colorTempSchema.optional(), qty: z.number().int().positive().optional(), heightM: z.number().finite().positive().optional(), watt: z.number().finite().positive().optional() }) }),
  z.object({ type: z.literal("removeLight"), roomId: z.string().min(1), lightId: z.string().min(1) }),
])

export type FloorplanAction = z.infer<typeof floorplanActionSchema>
export type InteriorAction = z.infer<typeof interiorActionSchema>
export type AssistantAction = FloorplanAction | InteriorAction

/* ------------------------------------------------------------------ */
/* Scene snapshots (client-built grounding, kept compact)              */
/* ------------------------------------------------------------------ */

const sanitationObjectSchema = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  widthM: z.number(),
  lengthM: z.number(),
  depthM: z.number(),
  capacity: z.number().optional(),
})

export const floorplanSceneSchema = z.object({
  site: z.object({ widthM: z.number(), depthM: z.number() }),
  floors: z.array(z.object({ id: z.string(), name: z.string(), level: z.number() })),
  selectedFloorId: z.string().nullable().optional(),
  selectedRoomId: z.string().nullable().optional(),
  rooms: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      type: z.string(),
      floorId: z.string(),
      x: z.number(),
      y: z.number(),
      width: z.number(),
      depth: z.number(),
      areaM2: z.number(),
      locked: z.boolean().optional(),
      requiresNaturalLight: z.boolean().optional(),
      requiresVentilation: z.boolean().optional(),
      zoneId: z.string().optional(),
      levelOffsetM: z.number().optional(),
      railingStyle: z.string().optional(),
      stairDirection: z.string().optional(),
      stairRiserM: z.number().nullable().optional(),
      stairShape: z.enum(["lurus", "L", "U"]).nullable().optional(),
      stairTurn: z.enum(["kiri", "kanan"]).nullable().optional(),
      poolShallowM: z.number().nullable().optional(),
      poolDeepM: z.number().nullable().optional(),
      poolEntrySide: z.enum(["n", "s", "w", "e"]).nullable().optional(),
      poolCirculationType: z.enum(["skimmer", "overflow"]).nullable().optional(),
      poolHasJets: z.boolean().nullable().optional(),
      poolHeater: z.boolean().nullable().optional(),
      poolSaltChlorinator: z.boolean().nullable().optional(),
    })
  ),
  openings: z.array(
    z.object({
      id: z.string(),
      roomId: z.string(),
      side: z.string(),
      type: z.string(),
      positionM: z.number(),
      kind: z.string().optional(),
      widthM: z.number().optional(),
      heightM: z.number().optional(),
    })
  ),
  /** Atap saat ini (absent = datar legacy). */
  roof: z
    .object({
      type: z.string(),
      slopeDeg: z.number(),
      overhangM: z.number(),
      material: z.string(),
      lowSide: z.string().optional(),
      fascia: z.object({ heightM: z.number(), color: z.string() }).optional(),
    })
    .optional(),
  roofZones: z
    .array(
      z.object({
        id: z.string(),
        type: roofTypeSchema,
        x: z.number(),
        y: z.number(),
        widthM: z.number(),
        depthM: z.number(),
        slopeDeg: z.number(),
        overhangM: z.number(),
        materialId: roofMaterialSchema.optional(),
        lowSide: sideSchema.optional(),
        floorId: z.string().optional(),
      })
    )
    .optional()
    .default([]),
  /** True bila lantai dak "floor-rooftop" ada. */
  rooftopEnabled: z.boolean().optional(),
  rooftopArea: z
    .object({ x: z.number(), y: z.number(), width: z.number(), depth: z.number() })
    .optional(),
  /** wallId (`roomId:side`) → id cladding; muka luar / muka dalam. */
  facade: z.record(z.string(), z.string()).optional(),
  facadeInner: z.record(z.string(), z.string()).optional(),
  facadeElements: z
    .array(
      z.object({
        id: z.string(),
        wallId: z.string(),
        kind: z.string().optional(),
        positionM: z.number(),
        widthM: z.number(),
        sillHeightM: z.number(),
        heightM: z.number(),
        finish: z.string(),
        modelUrl: z.string().nullable().optional(),
        modelAssetId: z.string().nullable().optional(),
      })
    )
    .optional()
    .default([]),
  exteriorElements: z
    .array(
      z.object({
        id: z.string(),
        kind: exteriorElementKindSchema,
        floorId: z.string().optional(),
        label: z.string().optional(),
      }).passthrough(),
    )
    .optional()
    .default([]),
  /** Lampu eksterior EFEKTIF (materialisasi penempatan otomatis bila belum diedit). */
  exteriorLamps: z
    .array(
      z.object({
        id: z.string(),
        kind: z.string(),
        x: z.number(),
        y: z.number(),
        mountH: z.number(),
        side: z.string().optional(),
        color: z.string().optional(),
        intensity: z.number().optional(),
        watt: z.number().optional(),
      })
    )
    .optional()
    .default([]),
  electrical: z
    .array(
      z.object({
        id: z.string(),
        type: z.string(),
        roomId: z.string(),
        x: z.number(),
        y: z.number(),
      })
    )
    .optional()
    .default([]),
  water: z
    .array(
      z.object({
        id: z.string(),
        type: z.string(),
        roomId: z.string(),
        x: z.number(),
        y: z.number(),
      })
    )
    .optional()
    .default([]),
  sanitation: z
    .object({
      septicTank: sanitationObjectSchema.optional(),
      soakwell: sanitationObjectSchema.optional(),
      controlBoxes: z.array(sanitationObjectSchema).optional().default([]),
    })
    .optional(),
})

export const interiorSceneSchema = z.object({
  style: z.string(),
  selectedRoomId: z.string().nullable().optional(),
  rooms: z.array(
    z.object({
      roomId: z.string(),
      name: z.string(),
      type: z.string(),
      widthM: z.number(),
      depthM: z.number(),
      furniture: z.array(
        z.object({
          id: z.string(),
          furnitureId: z.string(),
          name: z.string(),
          category: z.string(),
          x: z.number(),
          y: z.number(),
          rotationDeg: z.number(),
        })
      ),
      lighting: z.array(
        z.object({
          id: z.string(),
          roomId: z.string(),
          type: z.string(),
          x: z.number(),
          y: z.number(),
          heightM: z.number(),
          colorTemperature: z.string(),
          qty: z.number(),
          watt: z.number().optional(),
        })
      ).optional().default([]),
    })
  ),
})

export type FloorplanScene = z.infer<typeof floorplanSceneSchema>
export type InteriorScene = z.infer<typeof interiorSceneSchema>
export type AssistantScene = FloorplanScene | InteriorScene

/** Validate & narrow a raw scene by mode. Returns null on shape mismatch. */
export function parseScene(mode: EditorAssistantMode, raw: unknown): AssistantScene | null {
  const res =
    mode === "floorplan"
      ? floorplanSceneSchema.safeParse(raw)
      : interiorSceneSchema.safeParse(raw)
  return res.success ? res.data : null
}

/* ------------------------------------------------------------------ */
/* Request / response envelope                                         */
/* ------------------------------------------------------------------ */

export const assistantTurnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(4000),
})
export type AssistantTurn = z.infer<typeof assistantTurnSchema>

export const editorAssistantRequestSchema = z.object({
  mode: z.enum(["floorplan", "interior"]),
  instruction: z.string().trim().min(1, "Perintah tidak boleh kosong").max(1000),
  scene: z.unknown(),
})
export type EditorAssistantRequest = z.infer<typeof editorAssistantRequestSchema> & {
  scene: AssistantScene
}

export interface EditorAssistantResponse {
  reply: string
  actions: AssistantAction[]
}

export type AssistantMessageStatus = "proposed" | "applied" | "dismissed"
export type AssistantRequestState = "pending" | "completed" | "failed"

export interface AssistantMessage {
  id: string
  projectId: string
  mode: AssistantMode
  surface?: AssistantSurface
  turnId?: string
  clientRequestId?: string
  requestState?: AssistantRequestState | null
  processingStartedAt?: string | null
  role: "user" | "assistant"
  content: string
  /** Rencana singkat dari AGENT UTAMA (baruma-assistant) sebelum eksekusi —
   *  hanya terisi pada pesan floorplan yang lewat runFloorplanAgentPass. */
  plannerNote?: string
  actions?: AssistantAction[]
  actionLabels?: string[]
  options?: string[]
  needsClarify?: Array<{ question: string; suggestions: string[] }>
  status?: AssistantMessageStatus | null
  createdAt: string
}

export interface SendAssistantMessageInput {
  mode: EditorAssistantMode
  instruction: string
  scene: AssistantScene
}

const assistantSurfaceSchema = z.enum(ASSISTANT_SURFACES)
const projectAgentModeSchema = z.enum(["auto", "brief", "floorplan", "interior"])
const liveSceneSchema = z.object({
  mode: z.enum(["floorplan", "interior"]),
  versionId: z.string().min(1).max(200),
  payload: z.unknown(),
})

export const projectAgentRequestSchema = z.object({
  surface: assistantSurfaceSchema,
  requestedMode: projectAgentModeSchema.default("auto"),
  instruction: z.string().trim().min(1, "Perintah tidak boleh kosong").max(1000),
  liveScene: liveSceneSchema.optional(),
  clientRequestId: z.string().min(8).max(100).regex(/^[A-Za-z0-9_-]+$/),
})

export type ProjectAgentRequest = z.infer<typeof projectAgentRequestSchema>

/* ------------------------------------------------------------------ */
/* Human-readable description (for the preview card) — names from the   */
/* request-time scene, never fabricated by the model.                  */
/* ------------------------------------------------------------------ */

const SIDE_LABELS: Record<string, string> = { n: "atas", s: "bawah", w: "kiri", e: "kanan" }

/** "roomId:side" → "Ruang Tamu sisi kiri" (nama dari scene, bukan karangan model). */
function describeWall(wallId: string, scene: AssistantScene): string {
  const idx = wallId.lastIndexOf(":")
  const roomId = idx >= 0 ? wallId.slice(0, idx) : wallId
  const side = idx >= 0 ? wallId.slice(idx + 1) : ""
  const room = (scene as FloorplanScene).rooms?.find((r) => r.id === roomId)
  const sideLabel = SIDE_LABELS[side] ? ` sisi ${SIDE_LABELS[side]}` : ""
  return `${room?.name ?? "ruang"}${sideLabel}`
}

export function describeAction(action: AssistantAction, scene: AssistantScene): string {
  switch (action.type) {
    case "updateRoom": {
      const fp = scene as FloorplanScene
      const room = fp.rooms.find((r) => r.id === action.roomId)
      const name = room?.name ?? "ruang"
      const p = action.patch
      const parts: string[] = []
      if (p.name) parts.push(`nama → "${p.name}"`)
      if (p.type) parts.push(`tipe → ${ROOM_TYPES[p.type]?.label ?? p.type}`)
      if (p.floorId) parts.push(`pindah ke ${fp.floors.find((f) => f.id === p.floorId)?.name ?? p.floorId}`)
      if (p.width != null || p.depth != null)
        parts.push(`ukuran → ${p.width ?? room?.width ?? "?"}×${p.depth ?? room?.depth ?? "?"} m`)
      if (p.x != null || p.y != null) parts.push("posisi")
      if (p.locked != null) parts.push(p.locked ? "dikunci" : "buka kunci")
      if (p.requiresNaturalLight != null) parts.push(`cahaya alami: ${p.requiresNaturalLight ? "ya" : "tidak"}`)
      if (p.requiresVentilation != null) parts.push(`ventilasi: ${p.requiresVentilation ? "ya" : "tidak"}`)
      if (p.zoneId) parts.push(`zona → ${p.zoneId}`)
      if (p.levelOffsetM != null) parts.push(`elevasi → ${p.levelOffsetM} m`)
      if (p.stairDirection) parts.push(`arah tangga → ${SIDE_LABELS[p.stairDirection] ?? p.stairDirection}`)
      if (p.railingStyle) parts.push(`railing → ${p.railingStyle}`)
      if (p.railingModelUrl !== undefined || p.railingModelAssetId !== undefined)
        parts.push(p.railingModelUrl || p.railingModelAssetId ? "pasang model railing library" : "lepas model railing")
      if (p.edgeBowM != null) parts.push(`lengkung tepi → ${p.edgeBowM} m`)
      return `Ubah ${name}: ${parts.join(", ") || "—"}`
    }
    case "addOpening": {
      const room = (scene as FloorplanScene).rooms.find((r) => r.id === action.roomId)
      const label = action.kind
        ? OPENING_KIND_META[action.kind]?.label ?? action.kind
        : action.openingType === "door" ? "pintu" : "jendela"
      return `Tambah ${label} di ${room?.name ?? "ruang"}`
    }
    case "deleteRoom": {
      const room = (scene as FloorplanScene).rooms.find((r) => r.id === action.roomId)
      return `Hapus ruang ${room?.name ?? action.roomId}`
    }
    case "addFurniture": {
      const f = getFurniture(action.furnitureId)
      const room = (scene as InteriorScene).rooms.find((r) => r.roomId === action.roomId)
      return `Tambah ${f?.name ?? action.furnitureId} ke ${room?.name ?? "ruang"}`
    }
    case "moveFurniture":
    case "rotateFurniture":
    case "removeFurniture": {
      const room = (scene as InteriorScene).rooms.find((r) => r.roomId === action.roomId)
      const f = room?.furniture.find((x) => x.id === action.furnitureId)
      const verb =
        action.type === "moveFurniture" ? "Pindahkan" : action.type === "rotateFurniture" ? "Putar" : "Hapus"
      return `${verb} ${f?.name ?? "furnitur"}${room ? ` di ${room.name}` : ""}`
    }
    case "setStyle": {
      const s = INTERIOR_STYLES.find((x) => x.id === action.style)
      return `Ganti gaya interior → ${s?.name ?? action.style}`
    }
    case "resetRoom": {
      const room = (scene as InteriorScene).rooms.find((r) => r.roomId === action.roomId)
      return `Tata ulang interior ${room?.name ?? "ruang"}`
    }
    case "addRoom":
      return `Tambah ruang ${ROOM_TYPES[action.roomType]?.label ?? action.roomType}`
    case "addFloor":
      return "Tambah lantai baru"
    case "removeFloor": {
      const f = (scene as FloorplanScene).floors.find((x) => x.id === action.floorId)
      return `Hapus lantai ${f?.name ?? action.floorId}`
    }
    case "updateFloor": {
      const f = (scene as FloorplanScene).floors.find((x) => x.id === action.floorId)
      const p = action.patch
      const parts: string[] = []
      if (p.heightM != null) parts.push(`tinggi → ${p.heightM} m`)
      if (p.name) parts.push(`nama → "${p.name}"`)
      if (p.baseOffsetM != null) parts.push(`elevasi dasar → ${p.baseOffsetM} m`)
      if (p.offsetM) parts.push(`geser massa (kantilever) → dx ${p.offsetM.dx} m, dy ${p.offsetM.dy} m`)
      return `Ubah lantai ${f?.name ?? action.floorId}: ${parts.join(", ") || "—"}`
    }
    case "updateOpening": {
      const p = action.patch
      const parts: string[] = []
      if (p.kind) parts.push(`jenis → ${OPENING_KIND_META[p.kind]?.label ?? p.kind}`)
      else if (p.openingType) parts.push(`tipe → ${p.openingType === "door" ? "pintu" : "jendela"}`)
      if (p.widthM != null || p.heightM != null) parts.push(`ukuran ${p.widthM ?? "?"}×${p.heightM ?? "?"} m`)
      if (p.positionM != null) parts.push("posisi")
      if (p.sillHeightM != null) parts.push(`sill ${p.sillHeightM} m`)
      if (p.headHeightM != null) parts.push(`head ${p.headHeightM} m`)
      if (p.frameColor) parts.push(`kusen ${p.frameColor}`)
      if (p.modelUrl !== undefined || p.modelAssetId !== undefined)
        parts.push(p.modelUrl || p.modelAssetId ? "pasang model library" : "lepas model library")
      return `Ubah bukaan (pintu/jendela)${parts.length ? `: ${parts.join(", ")}` : ""}`
    }
    case "deleteOpening":
      return "Hapus bukaan"
    case "setRoof": {
      const p = action.patch
      const parts: string[] = []
      if (p.type) parts.push(p.type)
      if (p.slopeDeg != null) parts.push(`${p.slopeDeg}°`)
      if (p.overhangM != null) parts.push(`overhang ${p.overhangM} m`)
      if (p.material) parts.push(ROOF_MATERIALS[p.material])
      if (p.lowSide) parts.push(`sisi rendah ${SIDE_LABELS[p.lowSide] ?? p.lowSide}`)
      if (p.fascia !== undefined)
        parts.push(p.fascia === null ? "lis fascia dimatikan" : `lis fascia ${p.fascia.heightM} m`)
      return `Ubah atap${parts.length ? ` → ${parts.join(" ")}` : ""}`
    }
    case "addRoofZone":
      return `Tambah zona atap ${action.zone.widthM}×${action.zone.depthM} m`
    case "updateRoofZone": {
      const p = action.patch
      const parts: string[] = []
      if (p.type) parts.push(p.type)
      if (p.widthM != null || p.depthM != null) parts.push(`ukuran ${p.widthM ?? "?"}×${p.depthM ?? "?"} m`)
      if (p.x != null || p.y != null) parts.push("posisi")
      if (p.slopeDeg != null) parts.push(`${p.slopeDeg}°`)
      if (p.materialId) parts.push(ROOF_MATERIALS[p.materialId])
      return `Ubah zona atap${parts.length ? `: ${parts.join(", ")}` : ""}`
    }
    case "removeRoofZone":
      return "Hapus zona atap"
    case "setRooftop":
      return action.enabled ? "Aktifkan lantai rooftop (dak)" : "Hapus lantai rooftop"
    case "setRooftopArea":
      return `Atur area deck rooftop (${action.area.width}×${action.area.depth} m)`
    case "clearRooftopArea":
      return "Deck rooftop penuh (hapus area parsial)"
    case "setWallCladding": {
      const wall = describeWall(action.wallId, scene)
      if (action.claddingId === null) return `Hapus cladding dinding ${wall}`
      const label = facadeCladdingById(action.claddingId)?.label ?? action.claddingId
      return `Cladding ${label} di dinding ${wall}${action.face === "inner" ? " (muka dalam)" : ""}`
    }
    case "addFacadeElement":
      return `Tambah louver band di dinding ${describeWall(action.wallId, scene)}`
    case "updateFacadeElement": {
      const p = action.patch
      const parts: string[] = []
      if (p.finish) parts.push(`finish → ${p.finish}`)
      if (p.widthM != null || p.heightM != null) parts.push(`ukuran ${p.widthM ?? "?"}×${p.heightM ?? "?"} m`)
      if (p.positionM != null) parts.push("posisi")
      if (p.sillHeightM != null) parts.push(`sill ${p.sillHeightM} m`)
      return `Ubah louver band${parts.length ? `: ${parts.join(", ")}` : ""}`
    }
    case "removeFacadeElement":
      return "Hapus louver band"
    case "addExteriorElement":
      return `Tambah elemen eksterior ${action.element.kind.replaceAll("_", " ")}`
    case "updateExteriorElement":
      return `Ubah elemen eksterior ${action.id}`
    case "removeExteriorElement":
      return `Hapus elemen eksterior ${action.id}`
    case "applyFacadeTemplate":
      return `Terapkan template tampak depan ${action.templateId.replaceAll("_", " ")}`
    case "addWallLamp":
      return `Tambah lampu dinding eksterior di ${describeWall(action.wallId, scene)}`
    case "updateLamp": {
      const p = action.patch
      const parts: string[] = []
      if (p.color) parts.push(`warna ${p.color}`)
      if (p.intensity != null) parts.push(`intensitas ${p.intensity}`)
      if (p.watt != null) parts.push(`${p.watt} W`)
      if (p.mountH != null) parts.push(`tinggi ${p.mountH} m`)
      if (p.modelUrl !== undefined || p.modelAssetId !== undefined)
        parts.push(p.modelUrl || p.modelAssetId ? "pasang model library" : "lepas model library")
      return `Ubah lampu eksterior${parts.length ? `: ${parts.join(", ")}` : ""}`
    }
    case "removeLamp":
      return "Hapus lampu eksterior"
    case "setSoilBearing":
      return `Set daya dukung tanah → ${action.soilBearingKPa} kPa`
    case "addElectricalPoint":
      return `Tambah titik listrik: ${ELECTRICAL_POINT_TYPES[action.pointType] ?? action.pointType}`
    case "moveElectricalPoint":
      return "Pindahkan titik listrik"
    case "updateElectricalPoint": {
      const p = action.patch
      const parts: string[] = []
      if (p.type) parts.push(`tipe → ${ELECTRICAL_POINT_TYPES[p.type] ?? p.type}`)
      if (p.roomId) parts.push("pindah ruang")
      if (p.note != null) parts.push("catatan")
      return `Ubah titik listrik${parts.length ? `: ${parts.join(", ")}` : ""}`
    }
    case "removeElectricalPoint":
      return "Hapus titik listrik"
    case "autoGenerateElectrical":
      return "Auto-generate titik listrik"
    case "addWaterPoint":
      return `Tambah titik air: ${WATER_POINT_TYPES[action.waterType] ?? action.waterType}`
    case "moveWaterPoint":
      return "Pindahkan titik air"
    case "updateWaterPoint": {
      const p = action.patch
      const parts: string[] = []
      if (p.type) parts.push(`tipe → ${WATER_POINT_TYPES[p.type] ?? p.type}`)
      if (p.roomId) parts.push("pindah ruang")
      if (p.note != null) parts.push("catatan")
      return `Ubah titik air${parts.length ? `: ${parts.join(", ")}` : ""}`
    }
    case "removeWaterPoint":
      return "Hapus titik air"
    case "autoGenerateWater":
      return "Auto-generate titik air"
    case "moveSanitationObject":
      return "Pindahkan objek sanitasi"
    case "autoSizeSanitation":
      return "Auto-size sanitasi (SNI)"
    case "addLight": return `Tambah lampu ${action.lightType}`
    case "moveLight": return "Pindahkan lampu"
    case "updateLight": return "Ubah lampu"
    case "removeLight": return "Hapus lampu"
  }
}
