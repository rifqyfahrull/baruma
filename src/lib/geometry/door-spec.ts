/**
 * Pemilihan JENIS & LEBAR pintu per fungsi ruang — tabel keputusan, bukan
 * kalimat di prompt.
 *
 * AKAR MASALAH yang ditutup: generator memasang 0,9 m `hinged_door` untuk
 * SEMUA ruang (connect-rooms.ts `DOOR_W`, tanpa field `kind`), sementara jalur
 * LLM diberi daftar 19 nama `OpeningKind` tanpa satu pun kriteria pemilihan.
 * Keluhan produksi: "agent masih belum pintar memilih jenis pintu yang
 * efisien". Keputusan seperti ini deterministik — sama seperti biaya/luas di
 * Baruma yang dihitung kode, bukan dikarang model.
 *
 * SUMBER ATURAN: domain-knowledge/domain-knowledge-pintu.md
 *   §1 prioritas keputusan: keselamatan > lalu-lintas furnitur > clearance >
 *      privasi.
 *   §2 tabel cepat jenis & ukuran per fungsi ruang.
 *   §3.1 ruang basah tidak boleh swing-ke-dalam murni (tubuh yang jatuh
 *      mengganjal daun pintu dari dalam).
 *   §3.3 dapur–ruang makan default terbuka (tren broken-plan).
 *   §4 aksesibilitas: bukaan bersih >= 80 cm pada jalur sirkulasi utama.
 */
import type { OpeningKind } from "@/types"

/** Arah ayun relatif ruang host. `null` = tak berdaun (open passage/geser). */
export type DoorSwing = "ke_dalam" | "keluar" | null

export interface DoorSpec {
  kind: OpeningKind
  widthM: number
  heightM: number
  swing: DoorSwing
  /** Kenapa jenis ini dipilih — dipakai agent saat menjelaskan ke user. */
  reason: string
}

export interface DoorContext {
  /** Luas ruang host (m²) — menentukan kelayakan ruang ayun. */
  areaM2?: number
  /** Tipe ruang di seberang pintu, bila diketahui. */
  neighborType?: string
  /** Pintu masuk utama rumah. */
  isMainEntrance?: boolean
}

/** §3.1: di bawah ini kamar mandi tak punya ruang ayun yang sehat. */
const WET_ROOM_SWING_MIN_AREA_M2 = 3

const WET_ROOMS = new Set(["kamar_mandi", "toilet", "wc"])
/** Ruang sosial: §2 "minim sekat untuk kesan luas". */
const SOCIAL = new Set(["ruang_tamu", "ruang_keluarga", "ruang_makan", "koridor", "foyer"])
/** Akses ke luar ruangan → sliding, hemat ruang ayun (§2 balkon/teras). */
const OUTDOOR = new Set(["balkon", "teras", "taman", "area_jemur"])
/** Ruang servis kecil: §2 gudang/pantry 60–70 cm. */
const SERVICE = new Set(["gudang", "pantry", "laundry", "kamar_art"])

/**
 * Spesifikasi pintu untuk `roomType`, mempertimbangkan konteksnya.
 * Selalu mengembalikan spesifikasi yang sah — tipe ruang tak dikenal jatuh ke
 * pintu ayun standar 0,8 m, bukan melempar error.
 */
export function doorSpecFor(roomType: string, ctx: DoorContext = {}): DoorSpec {
  const { areaM2 = 0, neighborType, isMainEntrance } = ctx

  // Carport/garasi — pintu sectional, satu-satunya bukaan selebar itu.
  if (roomType === "carport" || roomType === "garasi") {
    return {
      kind: "garage_door",
      widthM: 2.7,
      heightM: 2.2,
      swing: null,
      reason: "Akses kendaraan butuh bukaan selebar mobil.",
    }
  }

  // Pintu masuk utama — §2: 80–90 cm, §4: >= 80 cm bukaan bersih.
  if (isMainEntrance) {
    return {
      kind: "hinged_door",
      widthM: 0.9,
      heightM: 2.1,
      swing: "ke_dalam",
      reason: "Pintu utama: lebar untuk barang besar, konvensi Indonesia membuka ke dalam.",
    }
  }

  // Akses ke ruang luar — geser, tak memakan ruang ayun di teras/balkon.
  if (neighborType && OUTDOOR.has(neighborType)) {
    return {
      kind: "sliding_glass_door",
      widthM: 1.8,
      heightM: 2.2,
      swing: null,
      reason: "Transisi indoor–outdoor lebar tanpa memakan ruang ayun.",
    }
  }

  // KESELAMATAN dulu (§1 prioritas 1): ruang basah tak boleh swing ke dalam.
  if (WET_ROOMS.has(roomType)) {
    if (areaM2 < WET_ROOM_SWING_MIN_AREA_M2) {
      return {
        kind: "pocket_door",
        widthM: 0.7,
        heightM: 2.0,
        swing: null,
        reason:
          "Kamar mandi sempit: pintu geser nol ruang ayun dan aman saat darurat " +
          "(tubuh yang jatuh tidak mengganjal daun pintu).",
      }
    }
    return {
      kind: "hinged_door",
      widthM: 0.7,
      heightM: 2.0,
      swing: "keluar",
      reason:
        "Pintu ruang basah membuka keluar agar bisa dibuka dari luar bila " +
        "penghuni jatuh/pingsan di dalam.",
    }
  }

  // Dapur ↔ ruang makan/keluarga — §3.3: default terbuka (broken-plan).
  if (roomType === "dapur" && neighborType && SOCIAL.has(neighborType)) {
    return {
      kind: "open_passage",
      widthM: 1.2,
      heightM: 2.1,
      swing: null,
      reason: "Dapur–ruang makan dibiarkan terbuka mengikuti tata ruang modern.",
    }
  }

  // Antar ruang sosial — bukaan lebar tanpa daun.
  if (SOCIAL.has(roomType) && neighborType && SOCIAL.has(neighborType)) {
    return {
      kind: "open_passage",
      widthM: 1.5,
      heightM: 2.1,
      swing: null,
      reason: "Ruang sosial saling terhubung tanpa sekat agar terasa lega.",
    }
  }

  // Ruang servis kecil — §2: 60–70 cm.
  if (SERVICE.has(roomType)) {
    return {
      kind: "hinged_door",
      widthM: 0.7,
      heightM: 2.1,
      swing: "ke_dalam",
      reason: "Ruang servis jarang dilalui furnitur besar, pintu sempit memadai.",
    }
  }

  // Kamar tidur & musholla — §3.2: membuka KE DALAM, jaga sirkulasi koridor.
  if (roomType === "kamar_tidur" || roomType === "musholla") {
    return {
      kind: "hinged_door",
      widthM: 0.8,
      heightM: 2.1,
      swing: "ke_dalam",
      reason: "Membuka ke dalam kamar agar tidak mengganggu sirkulasi koridor.",
    }
  }

  // Default aman: pintu ayun standar sesuai ambang aksesibilitas (§4).
  return {
    kind: "hinged_door",
    widthM: 0.8,
    heightM: 2.1,
    swing: "ke_dalam",
    reason: "Pintu ayun standar.",
  }
}
