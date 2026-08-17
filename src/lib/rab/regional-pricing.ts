/**
 * Per-region unit-price resolution for the RAB/BOQ engine.
 *
 * SOURCE OF TRUTH: BPS — Indeks Kemahalan Konstruksi (IKK) provinsi 2024
 * (Survei Harga Kemahalan Konstruksi; kota acuan nasional = Banjarmasin = 100).
 * https://www.bps.go.id/id/publication/2024/10/01/.../indeks-kemahalan-konstruksi-provinsi-dan-kabupaten-kota-2024.html
 *
 * IKK is a *relative* spatial price index blending building-material prices,
 * heavy-equipment rental, and construction labour wages in a region vs. the
 * reference city. That is exactly the right multiplier for a per-region RAB:
 * the BOQ engine already computes real quantities × Jakarta-baseline unit
 * prices; here we scale those unit prices to the project's region by the ratio
 * of its IKK to Jakarta's.
 *
 * HONESTY: this is an INDICATIVE regional adjustment, not a local quote. IKK is
 * provincial (a specific city varies within its province), and material/labour
 * mixes differ per trade. We therefore return an explicit uncertainty band that
 * widens when we only matched a province (not a city) or for high-IKK remote
 * regions with volatile logistics. Always verify against a local contractor.
 */

/** BPS IKK 2024 per province (reference city Banjarmasin = 100). */
export const IKK_2024: Record<string, number> = {
  aceh: 96.61,
  sumatera_utara: 97.45,
  sumatera_barat: 93.06,
  riau: 96.1,
  jambi: 95.32,
  sumatera_selatan: 90.62,
  bengkulu: 94.2,
  lampung: 89.12,
  kepulauan_bangka_belitung: 105.37,
  kepulauan_riau: 111.94,
  dki_jakarta: 114.79,
  jawa_barat: 105.3,
  jawa_tengah: 102.08,
  di_yogyakarta: 104.88,
  jawa_timur: 96.29,
  banten: 94.18,
  bali: 107.46,
  nusa_tenggara_barat: 104.09,
  nusa_tenggara_timur: 92.42,
  kalimantan_barat: 107.34,
  kalimantan_tengah: 106.56,
  kalimantan_selatan: 100.7,
  kalimantan_timur: 118.3,
  kalimantan_utara: 107.52,
  sulawesi_utara: 100.77,
  sulawesi_tengah: 91.82,
  sulawesi_selatan: 95.91,
  sulawesi_tenggara: 94.71,
  gorontalo: 96.51,
  sulawesi_barat: 91.63,
  maluku: 106.52,
  maluku_utara: 114.09,
  papua_barat: 124.71,
  papua_barat_daya: 122.21,
  papua: 134.96,
  papua_selatan: 142.98,
  papua_tengah: 209.28,
  papua_pegunungan: 249.12,
}

/**
 * Baseline province the RAB's hardcoded unit prices are calibrated to. The
 * per-line prices in generateRAB reflect a Jabodetabek 2026 market, so DKI
 * Jakarta's IKK is the denominator: a Jakarta project keeps the baseline prices
 * (factor = 1.0), cheaper provinces scale down, Papua scales up.
 */
export const BASELINE_PROVINCE_KEY = "dki_jakarta"
export const BASELINE_IKK = IKK_2024[BASELINE_PROVINCE_KEY]

const PROVINCE_LABELS: Record<string, string> = {
  aceh: "Aceh",
  sumatera_utara: "Sumatera Utara",
  sumatera_barat: "Sumatera Barat",
  riau: "Riau",
  jambi: "Jambi",
  sumatera_selatan: "Sumatera Selatan",
  bengkulu: "Bengkulu",
  lampung: "Lampung",
  kepulauan_bangka_belitung: "Kepulauan Bangka Belitung",
  kepulauan_riau: "Kepulauan Riau",
  dki_jakarta: "DKI Jakarta",
  jawa_barat: "Jawa Barat",
  jawa_tengah: "Jawa Tengah",
  di_yogyakarta: "DI Yogyakarta",
  jawa_timur: "Jawa Timur",
  banten: "Banten",
  bali: "Bali",
  nusa_tenggara_barat: "Nusa Tenggara Barat",
  nusa_tenggara_timur: "Nusa Tenggara Timur",
  kalimantan_barat: "Kalimantan Barat",
  kalimantan_tengah: "Kalimantan Tengah",
  kalimantan_selatan: "Kalimantan Selatan",
  kalimantan_timur: "Kalimantan Timur",
  kalimantan_utara: "Kalimantan Utara",
  sulawesi_utara: "Sulawesi Utara",
  sulawesi_tengah: "Sulawesi Tengah",
  sulawesi_selatan: "Sulawesi Selatan",
  sulawesi_tenggara: "Sulawesi Tenggara",
  gorontalo: "Gorontalo",
  sulawesi_barat: "Sulawesi Barat",
  maluku: "Maluku",
  maluku_utara: "Maluku Utara",
  papua_barat: "Papua Barat",
  papua_barat_daya: "Papua Barat Daya",
  papua: "Papua",
  papua_selatan: "Papua Selatan",
  papua_tengah: "Papua Tengah",
  papua_pegunungan: "Papua Pegunungan",
}

/**
 * City/kabupaten-level IKK overrides — consulted BEFORE the provincial value
 * when the project city is known, so a COSTLY SMALL KABUPATEN inside an
 * otherwise-cheap province is priced correctly (e.g. Papua-highland kabupaten,
 * remote islands). Keyed by normalized (lowercased, spaced) city/kab name.
 *
 * PROVENANCE: the seeded highland-Papua + Mentawai values are APPROXIMATE — they
 * come from BPS's 2025 kab/kota ranking (acuan Banjarmasin=100) pending the exact
 * 2024 kab/kota table (locked in the BPS PDF, not machine-readable). They are
 * flagged `approx` → low confidence + a wider uncertainty band, and are still far
 * closer to reality than the provincial average for these regions. Extend this
 * map (ideally from a loaded BPS data file) to raise city coverage; anything not
 * listed falls back to the reliable provincial IKK below.
 */
const IKK_CITY_2024: Record<string, { ikk: number; label: string; approx?: boolean }> = {
  puncak: { ikk: 361.36, label: "Kab. Puncak (Papua Tengah)", approx: true },
  "intan jaya": { ikk: 342.92, label: "Kab. Intan Jaya (Papua Tengah)", approx: true },
  "puncak jaya": { ikk: 340.84, label: "Kab. Puncak Jaya (Papua Tengah)", approx: true },
  "pegunungan bintang": { ikk: 299.88, label: "Kab. Pegunungan Bintang (Papua Pegunungan)", approx: true },
  nduga: { ikk: 295.0, label: "Kab. Nduga (Papua Pegunungan)", approx: true },
  "kepulauan mentawai": { ikk: 117.65, label: "Kab. Kepulauan Mentawai (Sumbar)", approx: true },
}

/**
 * Baseline price-book provenance stamped onto every RAB. Baseline unit prices
 * (DKI Jakarta) are AHSP-coefficient × 2024 market rates; the regional factor
 * (BPS IKK 2024) then spatially adjusts them. `effectiveDate` is surfaced in the
 * RAB assumptions so each estimate carries the date its prices were valid.
 */
export const PRICE_BOOK_META = {
  version: "2024.1",
  effectiveDate: "2024-07-01",
  baselineRegion: "DKI Jakarta",
  standard:
    "AHSP Bidang Cipta Karya & Perumahan 2024 (SE Dirjen Bina Konstruksi No. 68/SE/Dk/2024) — koefisien × harga pasar 2024",
  regionalIndex: "BPS Indeks Kemahalan Konstruksi (IKK) 2024",
} as const

/** Free-text province aliases → canonical key. */
const PROVINCE_ALIASES: Record<string, string> = {
  jakarta: "dki_jakarta",
  "dki": "dki_jakarta",
  "dki jakarta": "dki_jakarta",
  jabar: "jawa_barat",
  "jawa barat": "jawa_barat",
  jateng: "jawa_tengah",
  "jawa tengah": "jawa_tengah",
  jatim: "jawa_timur",
  "jawa timur": "jawa_timur",
  yogyakarta: "di_yogyakarta",
  yogya: "di_yogyakarta",
  jogja: "di_yogyakarta",
  diy: "di_yogyakarta",
  "di yogyakarta": "di_yogyakarta",
  "daerah istimewa yogyakarta": "di_yogyakarta",
  sumut: "sumatera_utara",
  sumbar: "sumatera_barat",
  sumsel: "sumatera_selatan",
  sulsel: "sulawesi_selatan",
  sulut: "sulawesi_utara",
  kaltim: "kalimantan_timur",
  kalsel: "kalimantan_selatan",
  kalbar: "kalimantan_barat",
  kalteng: "kalimantan_tengah",
  kaltara: "kalimantan_utara",
  ntb: "nusa_tenggara_barat",
  ntt: "nusa_tenggara_timur",
  babel: "kepulauan_bangka_belitung",
  kepri: "kepulauan_riau",
}

/** Major cities → province key (used when only a city is provided). */
const CITY_TO_PROVINCE: Record<string, string> = {
  jakarta: "dki_jakarta",
  "jakarta pusat": "dki_jakarta",
  "jakarta selatan": "dki_jakarta",
  "jakarta barat": "dki_jakarta",
  "jakarta timur": "dki_jakarta",
  "jakarta utara": "dki_jakarta",
  depok: "jawa_barat",
  bekasi: "jawa_barat",
  bogor: "jawa_barat",
  bandung: "jawa_barat",
  cimahi: "jawa_barat",
  tangerang: "banten",
  "tangerang selatan": "banten",
  serang: "banten",
  cilegon: "banten",
  semarang: "jawa_tengah",
  solo: "jawa_tengah",
  surakarta: "jawa_tengah",
  magelang: "jawa_tengah",
  tegal: "jawa_tengah",
  yogyakarta: "di_yogyakarta",
  jogja: "di_yogyakarta",
  sleman: "di_yogyakarta",
  bantul: "di_yogyakarta",
  surabaya: "jawa_timur",
  malang: "jawa_timur",
  sidoarjo: "jawa_timur",
  gresik: "jawa_timur",
  kediri: "jawa_timur",
  denpasar: "bali",
  badung: "bali",
  gianyar: "bali",
  medan: "sumatera_utara",
  "binjai": "sumatera_utara",
  padang: "sumatera_barat",
  bukittinggi: "sumatera_barat",
  pekanbaru: "riau",
  dumai: "riau",
  jambi: "jambi",
  palembang: "sumatera_selatan",
  "bandar lampung": "lampung",
  bengkulu: "bengkulu",
  "pangkal pinang": "kepulauan_bangka_belitung",
  batam: "kepulauan_riau",
  "tanjung pinang": "kepulauan_riau",
  "banda aceh": "aceh",
  lhokseumawe: "aceh",
  makassar: "sulawesi_selatan",
  parepare: "sulawesi_selatan",
  manado: "sulawesi_utara",
  bitung: "sulawesi_utara",
  palu: "sulawesi_tengah",
  kendari: "sulawesi_tenggara",
  gorontalo: "gorontalo",
  mamuju: "sulawesi_barat",
  balikpapan: "kalimantan_timur",
  samarinda: "kalimantan_timur",
  bontang: "kalimantan_timur",
  banjarmasin: "kalimantan_selatan",
  banjarbaru: "kalimantan_selatan",
  pontianak: "kalimantan_barat",
  "palangka raya": "kalimantan_tengah",
  "palangkaraya": "kalimantan_tengah",
  tarakan: "kalimantan_utara",
  mataram: "nusa_tenggara_barat",
  kupang: "nusa_tenggara_timur",
  ambon: "maluku",
  ternate: "maluku_utara",
  sofifi: "maluku_utara",
  manokwari: "papua_barat",
  sorong: "papua_barat_daya",
  jayapura: "papua",
  merauke: "papua_selatan",
  nabire: "papua_tengah",
  wamena: "papua_pegunungan",
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/^provinsi\s+/, "")
    .replace(/^kota\s+/, "")
    .replace(/^kab(?:upaten)?\.?\s+/, "")
    .replace(/\bd\.?i\.?\s+/, "di ")
    .replace(/\s+/g, " ")
}

export type RegionResolution = {
  /** Canonical province key, or null when nothing matched. */
  provinceKey: string | null
  /** Human label for the resolved province, or "Nasional (baseline)". */
  regionLabel: string
  /** BPS IKK 2024 for the resolved province (baseline IKK on fallback). */
  ikk: number
  /** Multiplier applied to every baseline unit price (ikk / Jakarta IKK). */
  factor: number
  /** How the region was resolved. */
  matchLevel: "city" | "province" | "none"
  /** Fractional uncertainty band, e.g. 0.15 → ±15%. */
  uncertaintyPct: number
  /** Confidence label for the regional adjustment. */
  confidence: "low" | "medium" | "high"
  /** Provenance string for the RAB assumptions list. */
  source: string
}

/**
 * Resolve a region from a project's free-text city/province into an IKK-based
 * unit-price factor + uncertainty band. Never throws; falls back to the
 * national baseline (factor 1.0, widest band) when nothing matches.
 */
export function resolveRegion(
  city?: string | null,
  province?: string | null,
): RegionResolution {
  // 0) city/kabupaten-level IKK override — most precise where we have it.
  if (city) {
    const hit = IKK_CITY_2024[normalize(city)]
    if (hit) {
      const factor = round4(hit.ikk / BASELINE_IKK)
      const uncertaintyPct = hit.approx ? 0.28 : 0.12
      return {
        provinceKey: null,
        regionLabel: hit.label,
        ikk: hit.ikk,
        factor,
        matchLevel: "city",
        uncertaintyPct,
        confidence: hit.approx ? "low" : "high",
        source: `BPS IKK kabupaten/kota — ${hit.label} IKK ${hit.ikk}${hit.approx ? " (perkiraan, basis 2025; tabel kab/kota 2024 belum dirilis mesin-terbaca)" : ""}. Faktor regional ×${factor} (baseline DKI Jakarta IKK ${BASELINE_IKK}).`,
      }
    }
  }

  let provinceKey: string | null = null
  let matchLevel: RegionResolution["matchLevel"] = "none"

  // 1) explicit province (most reliable for an IKK that IS provincial)
  if (province) {
    const p = normalize(province)
    provinceKey = IKK_2024[p.replace(/\s+/g, "_")]
      ? p.replace(/\s+/g, "_")
      : (PROVINCE_ALIASES[p] ?? null)
    if (provinceKey) matchLevel = "province"
  }

  // 2) infer province from a known city
  if (!provinceKey && city) {
    const c = normalize(city)
    provinceKey = CITY_TO_PROVINCE[c] ?? PROVINCE_ALIASES[c] ?? null
    if (provinceKey) matchLevel = "city"
  }

  if (!provinceKey) {
    return {
      provinceKey: null,
      regionLabel: "Nasional (baseline DKI Jakarta)",
      ikk: BASELINE_IKK,
      factor: 1,
      matchLevel: "none",
      uncertaintyPct: 0.2,
      confidence: "low",
      source:
        "Wilayah tidak dikenali — memakai harga baseline DKI Jakarta 2026 (BPS IKK 2024).",
    }
  }

  const ikk = IKK_2024[provinceKey]
  const factor = round4(ikk / BASELINE_IKK)
  const label = PROVINCE_LABELS[provinceKey] ?? provinceKey

  // Uncertainty: tighter when we matched a specific city, wider for a bare
  // province, widest for high-IKK remote provinces (volatile logistics).
  let uncertaintyPct = matchLevel === "city" ? 0.12 : 0.15
  if (ikk >= 140) uncertaintyPct += 0.05
  const confidence: RegionResolution["confidence"] =
    ikk >= 140 ? "low" : matchLevel === "city" ? "medium" : "medium"

  return {
    provinceKey,
    regionLabel: label,
    ikk,
    factor,
    matchLevel,
    uncertaintyPct,
    confidence,
    source: `BPS Indeks Kemahalan Konstruksi 2024 — ${label} IKK ${ikk} (acuan Banjarmasin=100; baseline harga = DKI Jakarta IKK ${BASELINE_IKK}). Faktor regional ×${factor}.`,
  }
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000
}
