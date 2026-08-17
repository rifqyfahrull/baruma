/**
 * Studi matahari — posisi matahari nyata untuk preview 3D.
 *
 * Menghitung azimut (arah kompas) & elevasi matahari dari tanggal, jam, dan
 * lintang lokasi, lalu memetakannya ke azimut SCENE yang dipakai `sunPosition()`
 * (dan drei `<Sky>`). Murni (tanpa three.js) → mudah diuji.
 *
 * Konvensi denah Baruma (sama dgn modul drawings & FACE_INDEX_BY_SIDE):
 *   utara = dunia −z, selatan = +z, timur = +x, barat = −x. Denah diperlakukan
 *   ber-orientasi kompas sebenarnya (Tampak Utara = sisi utara), sehingga tak
 *   perlu offset orientasi bangunan.
 *
 * Penyederhanaan yang disengaja (tool desain, bukan almanak): waktu jam lokal
 * dianggap = waktu surya (mengabaikan equation-of-time & bujur/zona waktu).
 * Lintasan matahari relatif — arah bayangan pagi/siang/sore — tetap benar; yang
 * diabaikan hanya geseran ± belasan menit yang tak berarti untuk desain rumah.
 */

const DEG = Math.PI / 180
const RAD = 180 / Math.PI

/** Lintang (derajat, selatan negatif) kota-kota utama Indonesia. */
const CITY_LAT: Array<{ match: string; lat: number }> = [
  { match: "jakarta", lat: -6.2 },
  { match: "bekasi", lat: -6.24 },
  { match: "depok", lat: -6.4 },
  { match: "bogor", lat: -6.6 },
  { match: "tangerang", lat: -6.18 },
  { match: "bandung", lat: -6.9 },
  { match: "semarang", lat: -6.97 },
  { match: "yogya", lat: -7.8 },
  { match: "jogja", lat: -7.8 },
  { match: "solo", lat: -7.56 },
  { match: "surakarta", lat: -7.56 },
  { match: "surabaya", lat: -7.26 },
  { match: "sidoarjo", lat: -7.45 },
  { match: "malang", lat: -7.98 },
  { match: "denpasar", lat: -8.65 },
  { match: "bali", lat: -8.4 },
  { match: "medan", lat: 3.6 },
  { match: "pekanbaru", lat: 0.5 },
  { match: "padang", lat: -0.95 },
  { match: "palembang", lat: -2.99 },
  { match: "lampung", lat: -5.4 },
  { match: "pontianak", lat: 0.0 },
  { match: "banjarmasin", lat: -3.32 },
  { match: "balikpapan", lat: -1.24 },
  { match: "samarinda", lat: -0.5 },
  { match: "makassar", lat: -5.15 },
  { match: "manado", lat: 1.49 },
  { match: "jayapura", lat: -2.53 },
  { match: "kupang", lat: -10.18 },
  { match: "mataram", lat: -8.58 },
]

/** Lintang default (Jakarta-ish) bila kota tak dikenal. */
export const DEFAULT_LATITUDE = -6.2

/** Lintang perkiraan dari nama kota (case-insensitive, cocok-sebagian). */
export function cityLatitude(city?: string | null): number {
  if (!city) return DEFAULT_LATITUDE
  const c = city.toLowerCase()
  const hit = CITY_LAT.find((e) => c.includes(e.match))
  return hit ? hit.lat : DEFAULT_LATITUDE
}

export const MONTH_LABELS = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
] as const

/** Hari-ke-dalam-tahun untuk tanggal 15 tiap bulan (0=Jan … 11=Des). */
const DOY_15TH = [15, 46, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349]

/** Deklinasi matahari (derajat) untuk tanggal 15 bulan `month` (0-11). */
export function solarDeclinationDeg(month: number): number {
  const m = Math.max(0, Math.min(11, Math.round(month)))
  const n = DOY_15TH[m]
  return 23.45 * Math.sin(DEG * (360 * (284 + n)) / 365)
}

export type SunAngles = {
  /** Azimut kompas (derajat, dari utara searah jarum jam: U=0, T=90, S=180, B=270). */
  azimuthCompassDeg: number
  /** Elevasi di atas horizon (derajat; negatif = di bawah horizon). */
  elevationDeg: number
}

/**
 * Posisi matahari (azimut kompas + elevasi) untuk lintang, bulan, dan jam
 * (0-24, waktu surya lokal). Rumus horizontal standar; terverifikasi pada
 * kasus fisik (ekuinoks ekuator terbit di timur, siang belahan selatan di
 * utara, dst.) di test.
 */
export function solarPosition(latDeg: number, month: number, hour: number): SunAngles {
  const phi = latDeg * DEG
  const decl = solarDeclinationDeg(month) * DEG
  const H = 15 * (hour - 12) * DEG // sudut jam (rad): <0 pagi, >0 sore

  const sinAlt = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(H)
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)))
  const cosAlt = Math.cos(alt)

  let azFromNorth: number
  if (cosAlt < 1e-6) {
    azFromNorth = 180 // zenit: azimut tak berarti — pakai selatan
  } else {
    const cosAz = (Math.sin(decl) - Math.sin(phi) * sinAlt) / (Math.cos(phi) * cosAlt)
    let a = Math.acos(Math.max(-1, Math.min(1, cosAz))) * RAD // [0,180] dari utara
    if (H > 0) a = 360 - a // sore → separuh barat
    azFromNorth = a
  }
  return { azimuthCompassDeg: azFromNorth, elevationDeg: alt * RAD }
}

export type SceneSunAngles = {
  /** Azimut SCENE utk `sunPosition()` (0°=+z/selatan, 90°=+x/timur). */
  azimuthDeg: number
  /** Elevasi (derajat) — sama dengan elevasi solar. */
  elevationDeg: number
}

/**
 * Sudut matahari siap-pakai untuk scene 3D. Azimut kompas dipetakan ke azimut
 * scene: θ = (180 − azimutKompas) mod 360 (lihat konvensi denah di header).
 */
export function solarSceneAngles(latDeg: number, month: number, hour: number): SceneSunAngles {
  const { azimuthCompassDeg, elevationDeg } = solarPosition(latDeg, month, hour)
  const azimuthDeg = ((180 - azimuthCompassDeg) % 360 + 360) % 360
  return { azimuthDeg, elevationDeg }
}

/** Label arah mata angin (8 arah) dari azimut kompas. */
export function compassLabel(azimuthCompassDeg: number): string {
  const dirs = ["Utara", "Timur Laut", "Timur", "Tenggara", "Selatan", "Barat Daya", "Barat", "Barat Laut"]
  const i = Math.round((((azimuthCompassDeg % 360) + 360) % 360) / 45) % 8
  return dirs[i]
}

/** "07:30" dari jam desimal. */
export function formatHour(hour: number): string {
  const h = Math.floor(hour)
  const m = Math.round((hour - h) * 60)
  const hh = m === 60 ? h + 1 : h
  const mm = m === 60 ? 0 : m
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`
}
