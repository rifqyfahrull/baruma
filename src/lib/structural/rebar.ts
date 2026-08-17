/**
 * Demand-based reinforcement takeoff (bar schedule) for the RAB.
 *
 * Turns the SP6 structural demand (factored axial `Pu`, flexural `Mu`) into a
 * required steel area, then into a discrete BAR COUNT — a real bar schedule, not
 * a blanket kg/m³ ratio. Pure, dependency-free (mirrors loads/sizing modules).
 *
 * Simplified but standard (SNI 2847 / ACI 318 shape):
 *  - Column (tied): Pu = φ[0.85 f'c (Ag−Ast) + fy·Ast], φ=0.65 → solve Ast,
 *    clamped to ρ ∈ [1%, 4%] of Ag.
 *  - Beam (flexure): As = Mu / (φ·fy·jd), φ=0.9, jd ≈ 0.9·d, d = h − 70 mm;
 *    floored at ρmin ≈ 0.0025·b·d.
 * Final bar counts still need verification against a full bending schedule.
 */
import { FC_MPA, FY_MPA } from "./loads"

export const REBAR_KG_PER_M: Record<number, number> = {
  8: 0.395,
  10: 0.617,
  12: 0.888,
  13: 1.042,
  16: 1.578,
}
const BAR_AREA_MM2: Record<number, number> = {
  8: 50.3,
  10: 78.5,
  12: 113.1,
  13: 132.7,
  16: 201.1,
}

export const rebarKg = (dia: number, totalLenM: number) =>
  (REBAR_KG_PER_M[dia] ?? 0) * totalLenM

/** Required column longitudinal steel area (mm²) from factored axial Pu (kN). */
export function columnLongitudinalAs(PuKN: number, sideMm: number): number {
  const Ag = sideMm * sideMm
  const phi = 0.65
  const raw = (PuKN * 1000) / phi - 0.85 * FC_MPA * Ag
  const As = raw / (FY_MPA - 0.85 * FC_MPA)
  const lo = 0.01 * Ag
  const hi = 0.04 * Ag
  return Math.min(hi, Math.max(lo, Number.isFinite(As) ? As : lo))
}

/** Required beam bottom (tension) steel area (mm²) from ultimate moment Mu (kNm). */
export function beamBottomAs(MuKNm: number, bMm: number, hMm: number): number {
  const d = Math.max(hMm - 70, 100)
  const As = (MuKNm * 1e6) / (0.9 * FY_MPA * 0.9 * d)
  const AsMin = 0.0025 * bMm * d
  return Math.max(Number.isFinite(As) ? As : AsMin, AsMin)
}

/** Discrete bar count covering `asMm2` with diameter `dia` (min count, even). */
export function barsForArea(asMm2: number, dia: number, minN: number): number {
  const n = Math.max(minN, Math.ceil(asMm2 / (BAR_AREA_MM2[dia] ?? 1)))
  return dia >= 13 && n % 2 === 1 ? n + 1 : n
}
