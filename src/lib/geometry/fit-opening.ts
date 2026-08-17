/**
 * Memuat sebuah bukaan pada dinding dengan clearance yang sah — dipakai
 * generator/importer template aset agar denah BARU tidak lahir cacat.
 *
 * AKAR MASALAH yang ditutup (docs/AUDIT_BUKAAN_2026-08.md): template aset
 * menaruh bukaan dengan pola `positionM = min(1.2, dim/2)` dan
 * `widthM = min(W, dim)`. Saat dinding lebih sempit dari W, lebar menjadi
 * SELURUH panjang dinding dan posisi tepat setengahnya — sisa 0 di kedua sisi
 * (mis. rumah-mungil: jendela 2,4 m di dinding 2,4 m; secara fisik itu bukan
 * jendela, itu dinding yang hilang). Pintu utama pun memakai `positionM: 0.5`
 * hardcoded untuk daun 0,9 m → sisa 5 cm, terulang di 12 proyek.
 *
 * ATURAN: domain-knowledge/domain-knowledge-pintu.md §1 — sisakan 10–15 cm
 * dari dinding tegak lurus terdekat agar daun bisa membuka penuh 90°.
 *
 * Berbeda dari `freeDoorPosition` (yang mencari posisi untuk lebar TETAP di
 * tengah bentang bersama, sadar tetangga & tabrakan), fungsi ini menjawab
 * pertanyaan yang lebih sederhana: "dinding sepanjang ini, bukaan selebar ini
 * — muat berapa, di mana?" Lebar boleh MENYUSUT agar clearance terpenuhi.
 */
import { OPENING_EDGE_MARGIN_M } from "./opening-plan"

export interface FitOpeningInput {
  /** Panjang dinding tempat bukaan menempel (m). */
  wallLenM: number
  /** Lebar yang diinginkan (m). Boleh menyusut bila dinding tak cukup. */
  desiredWidthM: number
  /** Titik tengah yang diinginkan (m). Ditarik ke titik sah terdekat. */
  preferredPositionM?: number
  /** Di bawah ini bukaan tak berarti; kembalikan null alih-alih memaksa. */
  minWidthM?: number
  /** Clearance minimal ke tiap ujung dinding (m). */
  marginM?: number
  /**
   * Titik pertemuan tembok di sepanjang dinding ini (koordinat dinding host),
   * mis. dari `wallJunctions()`. Bukaan dijaga tidak menumpang maupun mepet
   * titik-titik ini — dinding sekat menempel tegak lurus di situ.
   *
   * Tanpa ini, menggeser bukaan menjauh dari ujung dinding justru bisa
   * mendorongnya menumpang pertemuan di tengah bidang (regresi nyata dari
   * migration 0024 — lihat fit-opening.test.ts).
   */
  junctionsM?: number[]
}

export interface FitOpeningResult {
  /** Titik tengah bukaan pada dinding (m, 2 desimal). */
  positionM: number
  /** Lebar terpakai (m, 2 desimal) — bisa < desiredWidthM. */
  widthM: number
}

const round2 = (v: number) => Math.round(v * 100) / 100

/**
 * Lebar & posisi yang muat pada dinding dengan clearance di kedua ujung.
 * Null bila dinding terlalu pendek untuk `minWidthM` + clearance — dinding
 * yang memang tak layak lebih baik dilaporkan apa adanya daripada diberi
 * bukaan yang mustahil dibangun.
 */
export function fitOpeningToWall({
  wallLenM,
  desiredWidthM,
  preferredPositionM,
  minWidthM = 0.6,
  marginM = OPENING_EDGE_MARGIN_M,
  junctionsM = [],
}: FitOpeningInput): FitOpeningResult | null {
  if (!(wallLenM > 0) || !(desiredWidthM > 0)) return null

  // Bidang-bidang solid dinding: ujung dinding & pertemuan tembok memotongnya.
  const cuts = [0, ...junctionsM.filter((j) => j > 0 && j < wallLenM), wallLenM].sort((a, b) => a - b)
  const wanted = preferredPositionM ?? wallLenM / 2

  let best: (FitOpeningResult & { gap: number }) | null = null
  for (let i = 0; i < cuts.length - 1; i++) {
    const panelLo = cuts[i]
    const panelHi = cuts[i + 1]
    const usable = panelHi - panelLo - 2 * marginM
    if (usable < minWidthM - 1e-9) continue

    // Menyusut hanya bila perlu; jangan pernah melebarkan melebihi permintaan.
    const widthM = round2(Math.min(desiredWidthM, usable))
    if (widthM < minWidthM - 1e-9) continue

    const half = widthM / 2
    const lo = panelLo + marginM + half
    const hi = panelHi - marginM - half
    if (hi < lo - 1e-9) continue

    const positionM = round2(Math.min(Math.max(wanted, lo), hi))
    // Pilih bidang yang paling dekat dengan niat pemanggil, dan di antara yang
    // sama dekat, yang memuat bukaan paling lebar.
    const gap = Math.abs(positionM - wanted)
    if (!best || gap < best.gap - 1e-9 || (Math.abs(gap - best.gap) < 1e-9 && widthM > best.widthM)) {
      best = { positionM, widthM, gap }
    }
  }
  if (!best) return null
  return { positionM: best.positionM, widthM: best.widthM }
}
