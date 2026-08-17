/**
 * Structural load constants & combinations (SNI, disederhanakan).
 *
 * Pure, foundational module for the SP6 structural takedown. No react / zustand
 * / three imports — the sizing/grid/takedown/foundation modules build on top of
 * these. `SOIL_DEFAULT_KPA` intentionally lives here (not imported from the
 * editor store) so the structural math stays dependency-free; the editor store
 * keeps its own copy, mirroring the DEFAULT_ROOF / DATAR_DEFAULTS pattern.
 */
import { round2 } from "@/lib/geometry"

/** Dead & live loads (kPa). */
export const DL_FLOOR = 5.0
export const DL_ROOF = 1.5
export const LL_FLOOR = 2.0
export const LL_ROOF = 1.0

/** Material & geometry defaults. */
export const FC_MPA = 25
export const FY_MPA = 400
export const MAX_SPAN = 4.0
export const SOIL_DEFAULT_KPA = 150

/**
 * Ultimate (factored) load combination: `1.2·DL + 1.6·LL` (kPa).
 * Rounded to 2 decimals so downstream Pu numbers stay clean (raw FP gives e.g.
 * 9.200000000000001 for the floor combo).
 */
export function wu(dl: number, ll: number): number {
  return round2(1.2 * dl + 1.6 * ll)
}

/** Service (unfactored) load combination: `DL + LL` (kPa). */
export function ws(dl: number, ll: number): number {
  return round2(dl + ll)
}

/** Factored floor combo → 9.2 kPa. */
export function floorWu(): number {
  return wu(DL_FLOOR, LL_FLOOR)
}

/** Factored roof combo → 3.4 kPa. */
export function roofWu(): number {
  return wu(DL_ROOF, LL_ROOF)
}

/** Service floor combo → 7.0 kPa. */
export function floorWs(): number {
  return ws(DL_FLOOR, LL_FLOOR)
}

/** Service roof combo → 2.5 kPa. */
export function roofWs(): number {
  return ws(DL_ROOF, LL_ROOF)
}

/**
 * Round `x` up to the next multiple of `step`. FP-safe: a tiny epsilon defuses
 * cases where `x` is already an exact multiple but division lands a hair above
 * (e.g. 0.8 / 0.1 = 8.000…2), and the result is snapped to 2 decimals so
 * step-quantized values read cleanly (e.g. 12 * 0.1 → 1.2, not 1.2000…2).
 */
export function roundUp(x: number, step: number): number {
  if (step <= 0) return x
  return round2(Math.ceil(x / step - 1e-9) * step)
}

/** Round `x` up to the next multiple of 50 (member dimensions, mm). */
export function roundUp50(x: number): number {
  return roundUp(x, 50)
}
