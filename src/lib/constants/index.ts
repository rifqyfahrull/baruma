/**
 * Pure data constants — labels, copy, presets. No React imports, safe to use
 * from both server and client components.
 */
import type {
  AlternativeType,
  CostCategory,
  ElectricalPointType,
  ExportFormat,
  FinishingLevel,
  HouseStyle,
  OpeningFrameMaterial,
  OpeningKind,
  OpeningOperation,
  OpeningPrivacyLevel,
  OpeningPurpose,
  OpeningShading,
  Opening,
  Plan,
  Priority,
  ProjectStatus,
  ReadinessStatus,
  ReviewRole,
  RoofMaterial,
  RoofType,
  RoomType,
  Severity,
  WaterPointType,
} from "@/types"

export const APP = {
  name: "Baruma",
  tagline: "Bikin konsep rumah terukur dari ide sederhana.",
  description:
    "Dapatkan denah, 3D preview, RAB awal, dan paket diskusi kontraktor dalam satu workspace.",
} as const

/* ----- Readiness (PRD §19) ----- */

export type ReadinessTone =
  | "info"
  | "success"
  | "warning"
  | "emerald"
  | "danger"

export const READINESS: Record<
  ReadinessStatus,
  { label: string; tone: ReadinessTone; description: string }
> = {
  concept_ready: {
    label: "Konsep Siap",
    tone: "info",
    description:
      "Ide sudah berbentuk konsep. Cocok untuk eksplorasi awal sebelum dibahas lebih lanjut.",
  },
  contractor_discussion_ready: {
    label: "Siap Diskusi Kontraktor",
    tone: "success",
    description:
      "Denah, visual, dan estimasi sudah cukup jelas untuk dibawa berdiskusi dengan kontraktor.",
  },
  engineer_review_required: {
    label: "Perlu Review Engineer",
    tone: "warning",
    description:
      "Ada elemen yang perlu ditinjau engineer struktur sebelum dibangun.",
  },
  engineer_approved: {
    label: "Disetujui Engineer",
    tone: "emerald",
    description: "Telah ditinjau dan disetujui oleh tenaga ahli.",
  },
  invalid: {
    label: "Belum Valid",
    tone: "danger",
    description: "Masih ada masalah pada layout yang harus diperbaiki.",
  },
}

export const PROJECT_STATUS: Record<ProjectStatus, string> = {
  draft: "Draft",
  brief: "Brief",
  alternatives: "Alternatif",
  editing: "Editing",
  review: "Review",
  archived: "Arsip",
}

/* ----- House styles ----- */

export const HOUSE_STYLES: Record<HouseStyle, string> = {
  modern_tropis: "Modern Tropis",
  minimalis: "Minimalis",
  industrial: "Industrial",
  japandi: "Japandi",
  klasik: "Klasik",
  scandinavian: "Scandinavian",
}

/* ----- Priorities (PRD §10.3 step 3) ----- */

export const PRIORITIES: Record<Priority, string> = {
  hemat_biaya: "Hemat biaya",
  banyak_kamar: "Banyak kamar",
  terasa_lega: "Terasa lega",
  keluarga_besar: "Cocok keluarga besar",
  ada_kolam: "Ada kolam",
  ada_rooftop: "Ada rooftop",
  banyak_cahaya: "Banyak cahaya",
  ventilasi: "Adem / ventilasi",
  tampilan_mewah: "Tampilan mewah",
}

export const PRIORITY_ORDER: Priority[] = [
  "hemat_biaya",
  "terasa_lega",
  "banyak_kamar",
  "keluarga_besar",
  "banyak_cahaya",
  "ventilasi",
  "ada_kolam",
  "ada_rooftop",
  "tampilan_mewah",
]

/* ----- Finishing levels ----- */

export const FINISHING_LEVELS: Record<
  FinishingLevel,
  { label: string; description: string; perM2IDR: number }
> = {
  standar: {
    label: "Standar",
    description: "Material fungsional, hemat, layak huni.",
    perM2IDR: 3_500_000,
  },
  menengah: {
    label: "Menengah",
    description: "Keseimbangan kualitas dan biaya.",
    perM2IDR: 5_000_000,
  },
  premium: {
    label: "Premium",
    description: "Material kelas atas, detail finishing rapi.",
    perM2IDR: 7_500_000,
  },
}

/* ----- Room types (PRD §10.3 step 4) ----- */

export const ROOM_TYPES: Record<
  RoomType,
  { label: string; defaultAreaM2: number; outdoor?: boolean }
> = {
  kamar_tidur: { label: "Kamar tidur", defaultAreaM2: 12 },
  kamar_mandi: { label: "Kamar mandi", defaultAreaM2: 4 },
  ruang_tamu: { label: "Ruang tamu", defaultAreaM2: 14 },
  ruang_keluarga: { label: "Ruang keluarga", defaultAreaM2: 16 },
  dapur: { label: "Dapur", defaultAreaM2: 9 },
  ruang_makan: { label: "Ruang makan", defaultAreaM2: 10 },
  musholla: { label: "Musholla", defaultAreaM2: 6 },
  laundry: { label: "Laundry", defaultAreaM2: 4 },
  gudang: { label: "Gudang", defaultAreaM2: 4 },
  balkon: { label: "Balkon", defaultAreaM2: 6, outdoor: true },
  rooftop_lounge: { label: "Rooftop lounge", defaultAreaM2: 18, outdoor: true },
  area_kumpul: { label: "Area kumpul keluarga", defaultAreaM2: 20 },
  kolam: { label: "Kolam", defaultAreaM2: 12, outdoor: true },
  taman: { label: "Taman", defaultAreaM2: 10, outdoor: true },
  workspace: { label: "Workspace", defaultAreaM2: 8 },
  carport: { label: "Carport", defaultAreaM2: 15, outdoor: true },
  void: { label: "Void", defaultAreaM2: 6 },
  tangga: { label: "Tangga", defaultAreaM2: 6 },
  koridor: { label: "Koridor", defaultAreaM2: 4 },
}

/**
 * Room-type conventions used both when generating an initial layout from a
 * brief (`lib/mock/layout.ts`) and when the editor AI assistant places/moves
 * rooms on its own (`lib/assistant/deterministic.ts`) — single source of
 * truth so the two never silently disagree on "which rooms need a window".
 */
/** Room types that need fresh-air ventilation (an operable window). */
export const VENT_ROOM_TYPES: readonly RoomType[] = ["kamar_mandi"]
/** Room types that need daylight (a window, not necessarily operable). */
export const LIGHT_ROOM_TYPES: readonly RoomType[] = ["kamar_tidur", "ruang_keluarga", "ruang_tamu"]
/** "Wet" room types worth keeping vertically stacked across floors so their
 *  plumbing shares one riser instead of routing separate drain runs. */
export const WET_ROOM_TYPES: readonly RoomType[] = ["kamar_mandi", "dapur", "laundry"]

/** Rooms offered in the wizard room selector (ordered). */
export const SELECTABLE_ROOMS: RoomType[] = [
  "kamar_tidur",
  "kamar_mandi",
  "ruang_tamu",
  "ruang_keluarga",
  "dapur",
  "ruang_makan",
  "musholla",
  "laundry",
  "gudang",
  "balkon",
  "rooftop_lounge",
  "area_kumpul",
  "kolam",
  "taman",
  "workspace",
]

/* ----- Openings (2D editor) ----- */

export const OPENING_PURPOSES: Record<OpeningPurpose, string> = {
  vision: "Cahaya & pandangan",
  ventilation: "Ventilasi",
  access: "Akses",
  facade: "Fasad / struktural",
}

export const OPENING_OPERATIONS: Record<OpeningOperation, string> = {
  fixed: "Fixed / kaca mati",
  swing: "Ayun",
  sliding: "Geser",
  folding: "Lipat",
  pivot: "Pivot",
  louvre: "Louvre / jalousie",
  perforated: "Berlubang / roster",
  roof: "Bukaan atap",
}

export const OPENING_FRAME_MATERIALS: Record<OpeningFrameMaterial, string> = {
  aluminium: "Aluminium",
  wood: "Kayu",
  upvc: "uPVC",
  steel: "Baja",
  frameless: "Frameless",
  concrete: "Beton / bata",
  grc: "GRC",
}

export const OPENING_PRIVACY_LEVELS: Record<OpeningPrivacyLevel, string> = {
  low: "Rendah",
  medium: "Sedang",
  high: "Tinggi",
}

export const OPENING_SHADINGS: Record<OpeningShading, string> = {
  none: "Tanpa shading",
  overhang: "Overhang",
  vertical_fin: "Vertical fin",
  screen: "Screen",
  secondary_skin: "Secondary skin",
}

export const OPENING_KIND_META: Record<
  OpeningKind,
  {
    label: string
    type: "door" | "window"
    purpose: OpeningPurpose
    operation: OpeningOperation
    defaultWidthM: number
    defaultHeightM: number
    defaultSillHeightM: number
    frameMaterial: OpeningFrameMaterial
    privacyLevel: OpeningPrivacyLevel
    shading: OpeningShading
  }
> = {
  fixed_window: {
    label: "Fixed window",
    type: "window",
    purpose: "vision",
    operation: "fixed",
    defaultWidthM: 1.2,
    defaultHeightM: 1.2,
    defaultSillHeightM: 0.8,
    frameMaterial: "aluminium",
    privacyLevel: "medium",
    shading: "overhang",
  },
  casement_window: {
    label: "Casement window",
    type: "window",
    purpose: "ventilation",
    operation: "swing",
    defaultWidthM: 0.8,
    defaultHeightM: 1.2,
    defaultSillHeightM: 0.8,
    frameMaterial: "aluminium",
    privacyLevel: "medium",
    shading: "overhang",
  },
  sliding_window: {
    label: "Sliding window",
    type: "window",
    purpose: "ventilation",
    operation: "sliding",
    defaultWidthM: 1.2,
    defaultHeightM: 1.2,
    defaultSillHeightM: 0.8,
    frameMaterial: "aluminium",
    privacyLevel: "medium",
    shading: "overhang",
  },
  awning_window: {
    label: "Awning window",
    type: "window",
    purpose: "ventilation",
    operation: "swing",
    defaultWidthM: 0.8,
    defaultHeightM: 0.8,
    defaultSillHeightM: 1,
    frameMaterial: "aluminium",
    privacyLevel: "medium",
    shading: "none",
  },
  clerestory_window: {
    label: "Clerestory window",
    type: "window",
    purpose: "vision",
    operation: "fixed",
    defaultWidthM: 1.2,
    defaultHeightM: 0.5,
    defaultSillHeightM: 2.1,
    frameMaterial: "aluminium",
    privacyLevel: "high",
    shading: "none",
  },
  curtain_wall: {
    label: "Curtain wall / kaca penuh",
    type: "window",
    purpose: "vision",
    operation: "fixed",
    defaultWidthM: 2.4,
    defaultHeightM: 2.7,
    defaultSillHeightM: 0,
    frameMaterial: "frameless",
    privacyLevel: "low",
    shading: "secondary_skin",
  },
  skylight: {
    // Dulu berlabel "Void / skylight" — MENYESATKAN: kind ini adalah jendela
    // DINDING sill tinggi (clerestory), bukan bukaan atap. Skylight bidang
    // atap sungguhan = layout.skylights (fitur terpisah). Key dipertahankan
    // agar data lama valid.
    label: "Jendela clerestory",
    type: "window",
    purpose: "vision",
    operation: "roof",
    defaultWidthM: 1.2,
    defaultHeightM: 1.2,
    defaultSillHeightM: 2.6,
    frameMaterial: "aluminium",
    privacyLevel: "high",
    shading: "none",
  },
  jalousie_window: {
    label: "Jalousie / louvre window",
    type: "window",
    purpose: "ventilation",
    operation: "louvre",
    defaultWidthM: 0.8,
    defaultHeightM: 1.2,
    defaultSillHeightM: 0.8,
    frameMaterial: "aluminium",
    privacyLevel: "high",
    shading: "overhang",
  },
  roster: {
    label: "Roster / breeze block",
    type: "window",
    purpose: "ventilation",
    operation: "perforated",
    defaultWidthM: 1.2,
    defaultHeightM: 1.8,
    defaultSillHeightM: 0.6,
    frameMaterial: "concrete",
    privacyLevel: "high",
    shading: "none",
  },
  krawangan: {
    label: "Krawangan",
    type: "window",
    purpose: "ventilation",
    operation: "perforated",
    defaultWidthM: 1.2,
    defaultHeightM: 1.8,
    defaultSillHeightM: 0.6,
    frameMaterial: "grc",
    privacyLevel: "high",
    shading: "none",
  },
  porthole: {
    // MVP Gap 1 Track A: jendela aksen bundar kecil; diameter efektif =
    // min(widthM, heightM). Lubang dinding tetap persegi (kompromi sadar).
    label: "Jendela bulat (porthole)",
    type: "window",
    purpose: "vision",
    operation: "fixed",
    defaultWidthM: 0.6,
    defaultHeightM: 0.6,
    defaultSillHeightM: 1.2,
    frameMaterial: "aluminium",
    privacyLevel: "high",
    shading: "none",
  },
  hinged_door: {
    label: "Pintu ayun",
    type: "door",
    purpose: "access",
    operation: "swing",
    defaultWidthM: 0.9,
    defaultHeightM: 2.1,
    defaultSillHeightM: 0,
    frameMaterial: "wood",
    privacyLevel: "high",
    shading: "none",
  },
  sliding_glass_door: {
    label: "Sliding glass door",
    type: "door",
    purpose: "access",
    operation: "sliding",
    defaultWidthM: 1.8,
    defaultHeightM: 2.2,
    defaultSillHeightM: 0,
    frameMaterial: "aluminium",
    privacyLevel: "low",
    shading: "overhang",
  },
  pocket_door: {
    label: "Pocket door",
    type: "door",
    purpose: "access",
    operation: "sliding",
    defaultWidthM: 0.9,
    defaultHeightM: 2.1,
    defaultSillHeightM: 0,
    frameMaterial: "wood",
    privacyLevel: "medium",
    shading: "none",
  },
  folding_door: {
    label: "Folding / bi-fold door",
    type: "door",
    purpose: "access",
    operation: "folding",
    defaultWidthM: 2.4,
    defaultHeightM: 2.2,
    defaultSillHeightM: 0,
    frameMaterial: "aluminium",
    privacyLevel: "low",
    shading: "overhang",
  },
  pivot_door: {
    label: "Pivot door",
    type: "door",
    purpose: "access",
    operation: "pivot",
    defaultWidthM: 1.2,
    defaultHeightM: 2.4,
    defaultSillHeightM: 0,
    frameMaterial: "wood",
    privacyLevel: "high",
    shading: "none",
  },
  garage_door: {
    label: "Pintu garasi (sectional)",
    type: "door",
    purpose: "access",
    operation: "sliding",
    defaultWidthM: 2.7,
    defaultHeightM: 2.2,
    defaultSillHeightM: 0,
    frameMaterial: "steel",
    privacyLevel: "high",
    shading: "none",
  },
  open_passage: {
    label: "Bukaan tanpa pintu",
    type: "door",
    purpose: "access",
    operation: "fixed",
    defaultWidthM: 1.2,
    defaultHeightM: 2.1,
    defaultSillHeightM: 0,
    frameMaterial: "frameless",
    privacyLevel: "low",
    shading: "none",
  },
  facade_cutout: {
    label: "Void fasad / facade cut-out",
    type: "window",
    purpose: "facade",
    operation: "fixed",
    defaultWidthM: 2,
    defaultHeightM: 2,
    defaultSillHeightM: 0.6,
    frameMaterial: "concrete",
    privacyLevel: "medium",
    shading: "secondary_skin",
  },
  cantilever_opening: {
    label: "Cantilever opening",
    type: "window",
    purpose: "facade",
    operation: "fixed",
    defaultWidthM: 1.8,
    defaultHeightM: 1.2,
    defaultSillHeightM: 0.8,
    frameMaterial: "steel",
    privacyLevel: "medium",
    shading: "vertical_fin",
  },
}

export function openingDefaultsForKind(kind: OpeningKind): Pick<
  Opening,
  | "type"
  | "kind"
  | "purpose"
  | "operation"
  | "frameMaterial"
  | "privacyLevel"
  | "shading"
  | "widthM"
  | "heightM"
  | "sillHeightM"
  | "headHeightM"
> {
  const meta = OPENING_KIND_META[kind]
  return {
    type: meta.type,
    kind,
    purpose: meta.purpose,
    operation: meta.operation,
    frameMaterial: meta.frameMaterial,
    privacyLevel: meta.privacyLevel,
    shading: meta.shading,
    widthM: meta.defaultWidthM,
    heightM: meta.defaultHeightM,
    sillHeightM: meta.defaultSillHeightM,
    headHeightM: Math.round((meta.defaultSillHeightM + meta.defaultHeightM) * 100) / 100,
  }
}

/* ----- Alternatives ----- */

export const ALTERNATIVE_TYPES: Record<AlternativeType, string> = {
  hemat_biaya: "Hemat biaya",
  terasa_lega: "Terasa lega",
  fitur_maksimal: "Fitur maksimal",
  keluarga_besar: "Keluarga besar",
  premium_compact: "Premium compact",
}

/* ----- Cost categories ----- */

export const COST_CATEGORIES: Record<CostCategory, string> = {
  struktur: "Struktur",
  arsitektur: "Arsitektur",
  plumbing: "Plumbing",
  listrik: "Listrik",
  finishing: "Finishing",
  kolam: "Kolam",
  rooftop: "Rooftop",
  furnishing: "Furnishing (Opsional)",
}

/* ----- Review roles ----- */

export const REVIEW_ROLES: Record<ReviewRole, string> = {
  arsitek: "Arsitek",
  engineer_struktur: "Engineer struktur",
  mep: "MEP / Plumbing",
  kontraktor: "Kontraktor",
  pbg_legal: "PBG / Legal",
}

/* ----- Exports (PRD §10.9, §21.4) ----- */

export const EXPORT_META: Record<
  ExportFormat,
  {
    title: string
    description: string
    audience: string
    opensWith: string
    whenToUse: string
    limitation: string
    proOnly: boolean
  }
> = {
  contractor_pack: {
    title: "Contractor Pack PDF",
    description: "Paket dokumen diskusi: denah, 3D, RAB ringkas, catatan.",
    audience: "Kontraktor & tukang",
    opensWith: "PDF viewer apa pun",
    whenToUse: "Saat mulai berdiskusi dengan kontraktor.",
    limitation: "Draft awal, bukan gambar kerja final.",
    proOnly: false,
  },
  interior_pack: {
    title: "Interior Pack PDF",
    description: "Konsep interior, furniture, material, lighting, dan budget.",
    audience: "Vendor interior & kontraktor",
    opensWith: "PDF viewer apa pun",
    whenToUse: "Saat berdiskusi dengan vendor interior atau tukang finishing.",
    limitation: "Konsep interior awal, perlu ukur ulang di lapangan.",
    proOnly: false,
  },
  drawings_pack: {
    title: "Gambar Kerja (PDF)",
    description: "Tampak, potongan, kusen, pola lantai, plafon & detail atap berdimensi.",
    audience: "Kontraktor & tukang",
    opensWith: "PDF viewer apa pun",
    whenToUse: "Saat butuh tampak & potongan berdimensi untuk pelaksanaan.",
    limitation: "Draft awal, perlu ditinjau tenaga ahli sebelum dieksekusi.",
    proOnly: false,
  },
  dxf: {
    title: "DXF CAD",
    description: "Denah dalam format CAD untuk drafter/arsitek.",
    audience: "Drafter / arsitek",
    opensWith: "AutoCAD, LibreCAD, software CAD lain",
    whenToUse: "Saat denah perlu dilanjutkan di software CAD.",
    limitation: "Geometri awal, perlu dirapikan drafter.",
    proOnly: true,
  },
  ifc: {
    title: "IFC BIM Basic",
    description: "Model BIM dasar untuk koordinasi antar-disiplin.",
    audience: "Konsultan BIM / MEP",
    opensWith: "Revit, ArchiCAD, BIM viewer",
    whenToUse: "Saat butuh koordinasi BIM dasar.",
    limitation: "BIM tingkat konsep, belum detail teknis.",
    proOnly: true,
  },
  glb: {
    title: "GLB 3D",
    description: "Model 3D ringan untuk dilihat/dibagikan.",
    audience: "Klien & tim",
    opensWith: "Viewer 3D, browser, Blender",
    whenToUse: "Saat ingin membagikan visual 3D.",
    limitation: "Visual konsep, bukan model produksi.",
    proOnly: false,
  },
  rab_excel: {
    title: "RAB Excel",
    description: "Rincian estimasi biaya dalam spreadsheet.",
    audience: "Kontraktor & QS",
    opensWith: "Excel, Google Sheets, LibreOffice",
    whenToUse: "Saat menyusun anggaran awal.",
    limitation: "Estimasi awal, harga perlu diverifikasi lokal.",
    proOnly: false,
  },
  zip_all: {
    title: "ZIP All Files",
    description: "Seluruh file ekspor dalam satu paket.",
    audience: "Semua pihak",
    opensWith: "Pengelola arsip (ZIP)",
    whenToUse: "Saat ingin membagikan semuanya sekaligus.",
    limitation: "Berisi file draft, bukan dokumen final.",
    proOnly: true,
  },
}

/* ----- Plans ----- */

// priceLabel retired (dead code — Task 2 memindahkan tampilan harga ke
// formatPlanPrice() dari DB plans); .label masih dipakai user-menu.tsx.
export const PLANS: Record<Plan, { label: string }> = {
  free: { label: "Free" },
  pro: { label: "Pro" },
  studio: { label: "Studio" },
}

/* ----- Budget presets (IDR) ----- */

export const BUDGET_PRESETS: { label: string; value: BudgetPreset }[] = [
  { label: "< 500 jt", value: { minIDR: 0, maxIDR: 500_000_000 } },
  { label: "500 jt – 1 M", value: { minIDR: 500_000_000, maxIDR: 1_000_000_000 } },
  { label: "1 M – 2 M", value: { minIDR: 1_000_000_000, maxIDR: 2_000_000_000 } },
  { label: "> 2 M", value: { minIDR: 2_000_000_000, maxIDR: 4_000_000_000 } },
]
export type BudgetPreset = { minIDR: number; maxIDR: number }

/* ----- Legal & risk copy (PRD §10.9, §21.2, §21.3) ----- */

export const COPY = {
  exportWarning:
    "Dokumen ini adalah draft desain awal untuk diskusi. Belum dapat digunakan sebagai gambar kerja final sebelum ditinjau tenaga ahli.",
  draftNotice:
    "File ini adalah draft awal untuk diskusi. Belum dapat digunakan sebagai gambar kerja final.",
  structuralWarning:
    "Desain ini perlu ditinjau engineer struktur sebelum dibangun.",
  honestPositioning:
    "Sekarang kamu punya brief, denah, visual, dan dokumen awal yang jauh lebih jelas untuk dibawa ke kontraktor/arsitek/engineer.",
} as const

export const SEVERITY_LABEL: Record<Severity, string> = {
  info: "Saran",
  warning: "Perhatian",
  danger: "Risiko",
}

/* ----- Roof (SP3) ----- */

export const ROOF_TYPES: Record<RoofType, string> = {
  datar: "Datar",
  pelana: "Pelana",
  limasan: "Limasan",
  miring: "Miring (skillion)",
}

export const ROOF_MATERIALS: Record<RoofMaterial, string> = {
  genteng_beton: "Genteng Beton",
  genteng_keramik: "Genteng Keramik",
  metal: "Metal",
  aspal: "Aspal",
}

/** Installed roof price (rangka + penutup) per m² of roof area, IDR — flat
 *  rates pinned by the SP3 plan's Global Constraints. */
export const ROOF_PRICES: Record<RoofMaterial, number> = {
  genteng_beton: 400_000,
  genteng_keramik: 500_000,
  metal: 350_000,
  aspal: 550_000,
}

/* ----- Electrical (SP4) ----- */

export const ELECTRICAL_POINT_TYPES: Record<ElectricalPointType, string> = {
  stopkontak: "Stopkontak",
  stopkontak_daya: "Stopkontak Daya",
  saklar_tunggal: "Saklar Tunggal",
  saklar_ganda: "Saklar Ganda",
  panel: "Panel Listrik",
  data: "Titik Data/TV",
}

/** Default electrical points auto-generated per room type. Quantities;
 *  an absent field means 0. Pinned by the SP4 plan's Global Constraints.
 *  `void` is skipped entirely by the generator; unknown room types fall
 *  back to `{ stopkontak: 1, saklar: "tunggal" }` (see electrical/plan.ts). */
export const ELECTRICAL_DEFAULTS: Record<
  RoomType,
  { stopkontak?: number; stopkontak_daya?: number; saklar?: "tunggal" | "ganda"; data?: number }
> = {
  kamar_tidur: { stopkontak: 2, saklar: "tunggal" },
  kamar_mandi: { stopkontak: 1, stopkontak_daya: 1, saklar: "tunggal" },
  ruang_tamu: { stopkontak: 2, saklar: "tunggal", data: 1 },
  ruang_keluarga: { stopkontak: 3, saklar: "ganda", data: 1 },
  dapur: { stopkontak: 3, stopkontak_daya: 1, saklar: "tunggal" },
  ruang_makan: { stopkontak: 2, saklar: "tunggal" },
  musholla: { stopkontak: 1, saklar: "tunggal" },
  laundry: { stopkontak: 2, stopkontak_daya: 1, saklar: "tunggal" },
  gudang: { stopkontak: 1, saklar: "tunggal" },
  balkon: { stopkontak: 1, saklar: "tunggal" },
  rooftop_lounge: { stopkontak: 2, saklar: "tunggal", data: 1 },
  area_kumpul: { stopkontak: 2, saklar: "tunggal" },
  kolam: { stopkontak_daya: 1, saklar: "tunggal" },
  taman: { stopkontak: 1, saklar: "tunggal" },
  workspace: { stopkontak: 2, saklar: "tunggal", data: 1 },
  carport: { stopkontak: 1, saklar: "tunggal" },
  tangga: { saklar: "ganda" },
  koridor: { saklar: "ganda" },
  void: {},
}

/* ----- Water fixtures (SP5) ----- */

export const WATER_POINT_TYPES: Record<WaterPointType, string> = {
  kloset: "Kloset",
  wastafel: "Wastafel",
  shower: "Shower",
  kran: "Kran",
  kran_taman: "Kran Taman",
  floor_drain: "Floor Drain",
  sink_dapur: "Sink Dapur",
  kran_wudhu: "Kran Wudhu",
}

/** Default water fixtures auto-generated per room type — ordered lists placed
 *  along the room's bottom wall. Pinned by the SP5 plan's Global Constraints.
 *  `void` is skipped entirely by the generator; dry room types (and any
 *  unknown type) fall back to `[]` (see water/plan.ts). */
export const WATER_DEFAULTS: Record<RoomType, WaterPointType[]> = {
  kamar_tidur: [],
  kamar_mandi: ["kloset", "wastafel", "shower", "floor_drain"],
  ruang_tamu: [],
  ruang_keluarga: [],
  koridor: [],
  dapur: ["sink_dapur", "floor_drain"],
  ruang_makan: [],
  musholla: ["kran_wudhu"],
  laundry: ["kran", "floor_drain"],
  gudang: [],
  balkon: [],
  rooftop_lounge: [],
  area_kumpul: [],
  kolam: [],
  taman: ["kran_taman"],
  workspace: [],
  carport: [],
  void: [],
  tangga: [],
}
