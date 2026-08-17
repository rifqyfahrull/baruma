/**
 * Member sizing (SNI, disederhanakan) — square RC column & rectangular beam.
 *
 * Pure, dependency-free module (no react / zustand / three). Turns the factored
 * axial load `Pu` (kN, from `takedown.ts`) into a square column side, and a
 * clear span (m) into a beam `b×h` — all in mm, snapped up to the next 50 mm
 * module for buildability.
 *
 * Material strength (`FC_MPA`) and the `roundUp50` quantizer come from
 * `loads.ts` — NOT re-declared here — so a change to f'c flows through
 * automatically. The formula constants below (0.33 axial-capacity factor, the
 * kN→N ×1000, the span/12 depth rule, the h/2 width rule, and the 150/300 mm
 * practical floors) are pinned by the design and named as locals for clarity.
 */
import { FC_MPA, roundUp50 } from "@/lib/structural/loads"

/** Practical minimum column side (mm). */
const MIN_COLUMN_MM = 150
/** Simplified effective axial-capacity factor for a square RC column. */
const AXIAL_CAP_FACTOR = 0.33
/** Practical minimum beam depth (mm). */
const MIN_BEAM_H_MM = 300
/** Practical minimum beam width (mm). */
const MIN_BEAM_B_MM = 150

/** Square column result: side (mm) + the required gross area `Ag_req` (mm²)
 * that drove it — exposed so a calc sheet can show the intermediate step
 * WITHOUT re-deriving the 0.33·f'c formula (single source of truth). */
export type ColumnSize = { side: number; agReq: number }
/** Rectangular beam result (mm). */
export type BeamSize = { b: number; h: number }

/**
 * Square column side (mm) for a factored axial load `PuKN` (kN).
 *
 * - `Ag_req = PuKN*1000 / (0.33*FC_MPA)` mm²
 * - `side = max(150, roundUp50(√Ag_req))` mm
 *
 * Guard: non-finite / non-positive `PuKN` → the practical minimum 150 mm (no
 * NaN leaks into downstream drawings / RAB).
 */
export function sizeColumn(PuKN: number): ColumnSize {
  if (!Number.isFinite(PuKN) || PuKN <= 0) return { side: MIN_COLUMN_MM, agReq: 0 }
  const AgReq = (PuKN * 1000) / (AXIAL_CAP_FACTOR * FC_MPA)
  const side = Math.max(MIN_COLUMN_MM, roundUp50(Math.sqrt(AgReq)))
  return { side, agReq: Math.round(AgReq) }
}

/**
 * Rectangular beam `b×h` (mm) for a clear span `spanM` (m).
 *
 * - `h = max(300, roundUp50(spanM*1000/12))` mm
 * - `b = max(150, roundUp50(h/2))` mm — width derived from the *clamped* depth
 *
 * Guard: non-finite / non-positive `spanM` → the minimum 150×300 beam.
 */
export function sizeBeam(spanM: number): BeamSize {
  if (!Number.isFinite(spanM) || spanM <= 0) {
    return { b: MIN_BEAM_B_MM, h: MIN_BEAM_H_MM }
  }
  const h = Math.max(MIN_BEAM_H_MM, roundUp50((spanM * 1000) / 12))
  const b = Math.max(MIN_BEAM_B_MM, roundUp50(h / 2))
  return { b, h }
}

/** Sloof (tie beam) — fixed 150×200 mm section regardless of span. */
export const SLOOF = { b: 150, h: 200 } as const
