/**
 * Architect-scale picker for the A3 "Gambar Kerja" sheet.
 *
 * Sheet is A3 landscape 420×297mm, margin 15mm on every side, with a 22mm
 * title block strip along the bottom. The raw available content box is
 * therefore 420 − 2×15 = 390mm wide and 297 − 2×15 − 22 = 245mm tall.
 * `SHEET_AVAIL_*_MM` below are a shade tighter than that raw box (a small
 * defensive buffer so a drawing never touches the margin frame) — these
 * exact numbers are pinned by the four cases in scale.test.ts.
 */
export const SHEET_AVAIL_W_MM = 380
export const SHEET_AVAIL_H_MM = 238

/** Candidate architect scale denominators, smallest (largest drawing) first. */
export const SCALE_CANDIDATES = [50, 100, 200, 500] as const

/**
 * Smallest denominator from `SCALE_CANDIDATES` whose projected footprint
 * (wM × 1000 / N, hM × 1000 / N) fits inside the sheet's available content
 * area. Falls back to the largest candidate if nothing fits.
 */
export function pickSheetScale(wM: number, hM: number): number {
  for (const n of SCALE_CANDIDATES) {
    const wMm = (wM * 1000) / n
    const hMm = (hM * 1000) / n
    if (wMm <= SHEET_AVAIL_W_MM && hMm <= SHEET_AVAIL_H_MM) return n
  }
  return SCALE_CANDIDATES[SCALE_CANDIDATES.length - 1]
}
