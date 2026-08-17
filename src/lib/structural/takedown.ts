/**
 * Column load takedown (SNI, disederhanakan).
 *
 * Pure, dependency-free module (no react / zustand / three). Computes the axial
 * load on the *bottom* column from a conservative full-bay tributary area.
 *
 * Tributary is deliberately the FULL bay (`spanX*spanY`) for every column — a
 * conservative simplification (interior columns really carry a quarter-bay from
 * four sides = one full bay, edge/corner carry less, so this over-estimates
 * edge/corner and is exact for interior). `floors` is the number of storeys the
 * column stacks under; the roof always contributes once on top.
 *
 * Load combinations come from `loads.ts` (`floorWu`/`roofWu` factored,
 * `floorWs`/`roofWs` service) — NOT hardcoded 9.2/3.4/7.0/2.5 — so a change to
 * DL/LL constants flows through here automatically.
 */
import { round2 } from "@/lib/geometry"

import { floorWu, roofWu, floorWs, roofWs } from "@/lib/structural/loads"

/** Axial load takedown for one (bottom) column. All loads in kN. */
export type ColumnLoad = {
  /** Tributary area (m²) = spanX*spanY. */
  Atrib: number
  /** Ultimate (factored) axial load Pu (kN). */
  Pu: number
  /** Service (unfactored) axial load Ps (kN). */
  Ps: number
}

/**
 * Axial load on the bottom column.
 *
 * - `Atrib = round2(spanX*spanY)`
 * - `Pu = round2(Atrib * (floors*floorWu() + roofWu()))`
 * - `Ps = round2(Atrib * (floors*floorWs() + roofWs()))`
 *
 * Guards:
 * - `floors < 1` is clamped to `1` (a building has at least one storey).
 * - Non-finite spans (NaN/±Infinity) yield an all-zero result — safe, no NaN
 *   leaks into downstream sizing.
 */
export function columnLoad(spanX: number, spanY: number, floors: number): ColumnLoad {
  if (!Number.isFinite(spanX) || !Number.isFinite(spanY)) {
    return { Atrib: 0, Pu: 0, Ps: 0 }
  }
  const n = Number.isFinite(floors) ? Math.max(1, Math.floor(floors)) : 1
  const Atrib = round2(spanX * spanY)
  const Pu = round2(Atrib * (n * floorWu() + roofWu()))
  const Ps = round2(Atrib * (n * floorWs() + roofWs()))
  return { Atrib, Pu, Ps }
}
