import { z } from "zod"

/**
 * Create-project wizard schema (PRD §10.3). Split into per-step schemas so the
 * wizard can validate one step at a time, plus a merged schema for final submit.
 */

export const houseStyleEnum = z.enum([
  "modern_tropis",
  "minimalis",
  "industrial",
  "japandi",
  "klasik",
  "scandinavian",
])

export const orientationEnum = z.enum([
  "north",
  "east",
  "south",
  "west",
  "unknown",
])

export const priorityEnum = z.enum([
  "hemat_biaya",
  "banyak_kamar",
  "terasa_lega",
  "keluarga_besar",
  "ada_kolam",
  "ada_rooftop",
  "banyak_cahaya",
  "ventilasi",
  "tampilan_mewah",
])

export const finishingLevelEnum = z.enum(["standar", "menengah", "premium"])

export const roomTypeEnum = z.enum([
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
])

export const sizePreferenceEnum = z.enum(["small", "standard", "large"])

/** Override manual regulasi Perda setempat (Tier 1 lahan terbatas). Semua
 *  field opsional; rentang cek "angka wajar" saja — validasi hukum
 *  sebenarnya tetap tanggung jawab Perda setempat. */
export const siteRegulationSchema = z.object({
  maxKdb: z.number().min(0.05, "Minimal 5%").max(1, "Maksimal 100%").optional(),
  maxKlb: z.number().min(0.1, "Minimal 0.1").max(10, "Maksimal 10").optional(),
  gsbM: z.number().min(0, "Minimal 0 m").max(20, "Maksimal 20 m").optional(),
  minKdh: z.number().min(0.05, "Minimal 5%").max(1, "Maksimal 100%").optional(),
})

/* Step 1 — Basic info */
export const basicInfoSchema = z.object({
  name: z.string().min(2, "Nama project minimal 2 karakter"),
  city: z.string().min(1, "Lokasi wajib diisi"),
  projectType: z.enum(["new", "renovation"]),
  style: houseStyleEnum,
})

/* Step 2 — Data tanah */
export const siteStepSchema = z.object({
  widthM: z
    .number({ message: "Lebar tanah wajib diisi" })
    .min(3, "Minimal 3 m")
    .max(50, "Maksimal 50 m"),
  depthM: z
    .number({ message: "Panjang tanah wajib diisi" })
    .min(3, "Minimal 3 m")
    .max(100, "Maksimal 100 m"),
  frontOrientation: orientationEnum,
  sidesAttached: z.number().int().min(0).max(4),
  frontRoadWidthM: z.number().min(0).max(30).optional(),
  carport: z.boolean(),
  siteNotes: z.string().max(500).optional(),
  /** Angka Perda lokasimu — opsional, menggantikan default nasional saat diisi. */
  regulation: siteRegulationSchema.optional(),
})

/* Step 3 — Bangunan */
export const buildingStepSchema = z.object({
  floors: z.number().int().min(1, "Minimal 1 lantai").max(4, "Maksimal 4 lantai"),
  rooftop: z.boolean(),
  budgetMinIDR: z.number().min(0),
  budgetMaxIDR: z.number().min(0),
  finishingLevel: finishingLevelEnum,
  priorities: z.array(priorityEnum).min(1, "Pilih minimal satu prioritas"),
})

/* Step 4 — Kebutuhan ruang */
export const roomRequirementSchema = z.object({
  roomType: roomTypeEnum,
  name: z.string().min(1),
  required: z.boolean(),
  quantity: z.number().int().min(1).max(10),
  preferredFloor: z.number().int().min(1).max(4).optional(),
  sizePreference: sizePreferenceEnum.optional(),
  notes: z.string().max(300).optional(),
})

export const roomsStepSchema = z.object({
  rooms: z.array(roomRequirementSchema).min(1, "Pilih minimal satu ruang"),
})

/* Full wizard */
export const createProjectSchema = basicInfoSchema
  .and(siteStepSchema)
  .and(buildingStepSchema)
  .and(roomsStepSchema)

export type CreateProjectInput = z.infer<typeof createProjectSchema>
export type RoomRequirementInput = z.infer<typeof roomRequirementSchema>

/** Field groups used by the wizard to validate per step with RHF `trigger`. */
export const WIZARD_STEP_FIELDS = {
  basic: ["name", "city", "projectType", "style"],
  site: [
    "widthM",
    "depthM",
    "frontOrientation",
    "sidesAttached",
    "frontRoadWidthM",
    "carport",
    "siteNotes",
    "regulation",
  ],
  building: [
    "floors",
    "rooftop",
    "budgetMinIDR",
    "budgetMaxIDR",
    "finishingLevel",
    "priorities",
  ],
  rooms: ["rooms"],
} as const

/** Body PATCH /projects/[id] — ganti nama project. */
export const renameProjectSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Nama project minimal 2 karakter")
    .max(120, "Nama project maksimal 120 karakter"),
})
export type RenameProjectInput = z.infer<typeof renameProjectSchema>
