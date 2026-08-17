/**
 * Indonesian residential design standards, encoded as data so the design-audit
 * engine (and, later, the AI assistant that speaks from it) can check a layout
 * against real norms instead of vibes. Every threshold cites its source so a
 * finding can tell a layperson WHY, not just WHAT.
 *
 * Sources:
 *  - SNI 03-1733-2004 "Tata cara perencanaan lingkungan perumahan di perkotaan"
 *    — minimum habitable floor area (9 m²/jiwa; rumah sederhana sehat ≥ 36 m²),
 *    per-room minimums.
 *  - SNI 03-6572-2001 "Tata cara perancangan sistem ventilasi & pengkondisian
 *    udara" + building-code daylight rule — window ≥ 10% of floor area for
 *    light, ≥ 5% openable for ventilation.
 *  - Permen PU / typical perda: KDB (koefisien dasar bangunan) ≤ 60% for
 *    residential kavling, GSB (garis sempadan bangunan) ≥ ½ road width.
 *  - Ergonomics: clear door width ≥ 0.8 m (main entry 0.9 m), circulation 0.9 m.
 *  - Kepmen PU No. 441/KPTS/1998 + Perda praktik umum — KDH (10–64%, 20%
 *    dipakai sbg lantai advisory nasional), 0-lot-line (tanpa bukaan di
 *    dinding batas), ceiling/mezzanine clearance, tangga (riser 15–19 cm,
 *    lebar ≥ 90 cm nyaman) — lihat domain-knowledge-regulasi-tapak-
 *    lahan-sempit.md untuk detail & sumber lengkap.
 *
 * All values are conservative, widely-cited defaults; local perda overrides
 * exist, so regulatory findings are advisory unless clearly violated.
 */
import type { RoomType } from "@/types"

export type RoomStandard = {
  /** Minimum floor area (m²) for the room to function per SNI/ergonomics. */
  minAreaM2: number
  /** Minimum clear width on the shorter side (m). */
  minWidthM: number
  /** Habitable = needs daylight + ventilation (bedrooms, living, kitchen…). */
  habitable: boolean
  /** Human label used in findings. */
  label: string
}

/** Per-room-type minimums. Types absent here carry no hard area/width rule
 *  (gudang, balkon, taman, kolam, void, tangga, rooftop_lounge, area_kumpul). */
export const ROOM_STANDARDS: Partial<Record<RoomType, RoomStandard>> = {
  kamar_tidur: { minAreaM2: 9, minWidthM: 3.0, habitable: true, label: "Kamar tidur" },
  kamar_mandi: { minAreaM2: 2.0, minWidthM: 1.5, habitable: false, label: "Kamar mandi" },
  ruang_tamu: { minAreaM2: 9, minWidthM: 3.0, habitable: true, label: "Ruang tamu" },
  ruang_keluarga: { minAreaM2: 9, minWidthM: 3.0, habitable: true, label: "Ruang keluarga" },
  dapur: { minAreaM2: 4, minWidthM: 1.5, habitable: true, label: "Dapur" },
  ruang_makan: { minAreaM2: 6, minWidthM: 2.4, habitable: true, label: "Ruang makan" },
  musholla: { minAreaM2: 2.5, minWidthM: 1.2, habitable: true, label: "Musholla" },
  workspace: { minAreaM2: 4, minWidthM: 1.8, habitable: true, label: "Ruang kerja" },
  laundry: { minAreaM2: 2.0, minWidthM: 1.2, habitable: false, label: "Laundry" },
  carport: { minAreaM2: 12.5, minWidthM: 2.5, habitable: false, label: "Carport" },
}

/** SNI 03-1733: a healthy simple house needs ≥ 9 m² of building floor per
 *  occupant, and ≥ 36 m² total for a standard household. */
export const MIN_FLOOR_AREA_PER_OCCUPANT_M2 = 9
export const MIN_HEALTHY_HOUSE_AREA_M2 = 36

/** Daylight: window glazing ≥ 10% of the room's floor area; ventilation ≥ 5%. */
export const MIN_WINDOW_TO_FLOOR_RATIO = 0.1
export const MIN_VENT_TO_FLOOR_RATIO = 0.05

/** Clear widths (m). */
export const MIN_DOOR_WIDTH_M = 0.8
export const MIN_MAIN_DOOR_WIDTH_M = 0.9

/** Regulatory defaults (advisory — perda overrides). */
export const MAX_KDB = 0.6 // building footprint / lot area
export const MAX_KLB = 1.8 // total floor area / lot area (2-storey typical ceiling)
/** GSB (front setback) ≥ this fraction of the fronting road width. */
export const GSB_ROAD_FRACTION = 0.5

/** KDH (Koefisien Dasar Hijau) — minimum fraction of the lot that must stay
 *  open/green for water absorption (competes directly with KDB on narrow
 *  lots). Perda values vary widely (10–64%); 20% is a conservative national
 *  advisory floor used when `Site.regulation.minKdh` is not set. */
export const MIN_KDH = 0.2

/** Clear ceiling height (m) — comfort/ventilation minimum for habitable
 *  rooms (typical building-code / ergonomics floor). */
export const MIN_CEILING_M = 2.4
/** Mezzanine: minimum TOTAL height (clearance below + platform + clearance
 *  above) for the bay hosting it to feel usable, not a crawlspace. */
export const MIN_MEZZANINE_TOTAL_M = 4.4
/** Mezzanine: minimum clear height on EITHER side of the platform (below
 *  it, to walk/stand under; above it, to stand on the mezzanine itself). */
export const MIN_MEZZANINE_CLEAR_M = 2.1

/** Kavling lebar ≤ ini, diapit bangunan tetangga di kedua sisi (0-lot-line):
 *  domain-knowledge lahan sempit §3/§5 mewajibkan sumber cahaya tengah
 *  (void/courtyard/skylight) karena dinding samping tak boleh berbukaan. */
export const NARROW_ATTACHED_WIDTH_M = 8

/** Tangga interior — lebar bersih dianjurkan (SNI/ergonomi: dua orang
 *  berpapasan dengan aman). Catatan: `lib/stairs/geometry.ts` juga punya
 *  STAIR_MIN_WIDTH_M=0.8 — itu batas keselamatan MUTLAK dipakai kartu
 *  ruang tangga (room-inspector); MIN_STAIR_WIDTH_M di sini (0.9) adalah
 *  ambang KENYAMANAN yang dipakai audit engine — keduanya sengaja beda,
 *  bukan duplikasi. */
export const MIN_STAIR_WIDTH_M = 0.9
/** Rentang tanjakan (riser) nyaman & aman — sama dengan
 *  STAIR_RISER_COMFORT_M di lib/stairs/geometry.ts (satu-satunya tempat
 *  lain angka ini boleh hidup); disalin di sini agar design-audit.ts tetap
 *  bersumber dari standards.ts seperti ambang lain di file ini. */
export const STAIR_RISER_MIN_M = 0.15
export const STAIR_RISER_MAX_M = 0.19
/** Tangga lurus tanpa bordes (landing) di atas ini jadi melelahkan &
 *  berisiko jatuh panjang — sarankan bentuk L/U. */
export const STAIR_MAX_STEPS_NO_LANDING = 12

/** Sanitation clearances (SNI 2398:2017 / 03-2916): septic tank distance. */
export const SEPTIC_MIN_DIST_TO_BUILDING_M = 1.5
export const SEPTIC_MIN_DIST_TO_WELL_M = 10
