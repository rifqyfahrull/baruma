/**
 * Spread (pad) footing sizing from soil bearing capacity σ (SNI, disederhanakan).
 *
 * Pure, dependency-free module (no react / zustand / three). Turns the service
 * axial load `PsKN` (kN, from `takedown.ts`) and the soil bearing `soilKPa`
 * (kPa ≡ kN/m²) into a square footing side (m) at a fixed 0.25 m thickness.
 *
 * `SOIL_DEFAULT_KPA` (the σ fallback) and `roundUp` (the 0.1 m quantizer) come
 * from `loads.ts`; `round2` from geometry. The formula constants below (0.25 m
 * thickness, 0.8 m minimum side, the 0.1 m side step, and the 4 m² deep-
 * foundation threshold) are pinned by the design and named as locals.
 */
import { round2 } from "@/lib/geometry"

import { SOIL_DEFAULT_KPA, roundUp } from "@/lib/structural/loads"

/** Fixed footing thickness (m). */
const FOOTING_THICKNESS_M = 0.25
/** Practical minimum footing side (m). */
const MIN_FOOTING_SIDE_M = 0.8
/** Footing side quantum (m) — snap up to the next 100 mm. */
const FOOTING_SIDE_STEP_M = 0.1
/** Above this required area (m²) a shallow pad is impractical → advise deep foundation. */
const DEEP_FOUNDATION_AREA_M2 = 4

/** Verbatim advisory emitted when the required area exceeds the shallow-pad threshold. */
const DEEP_NOTE = "pertimbangkan pondasi dalam (tiang/strauss) — konsultasi ahli"

/** Square spread-footing result. */
export type FootingSize = {
  /** Square footing side (m). */
  side: number
  /** Footing thickness (m) — fixed 0.25. */
  thickness: number
  /** Required bearing area A = Ps/σ (m², round2). */
  area: number
  /** Present when A > 4 m² (σ low / load high): advise a deep foundation. */
  deepNote?: string
}

/**
 * Square spread-footing size from service load and soil bearing.
 *
 * - `area = round2(PsKN / σ)` m² (σ ≡ `soilKPa` in kN/m²)
 * - `side = max(0.8, roundUp(√area, 0.1))` m
 * - `thickness = 0.25` m
 * - `deepNote` set when `area > 4` m².
 *
 * Guards:
 * - `soilKPa <= 0` or non-finite → σ clamped to `SOIL_DEFAULT_KPA` (150) so we
 *   never divide by zero / produce Infinity.
 * - non-finite / non-positive `PsKN` → safe minimal footing (0.8 m side, area
 *   0, no note) — no NaN leaks downstream.
 */
export function sizeFooting(PsKN: number, soilKPa: number): FootingSize {
  const sigma =
    Number.isFinite(soilKPa) && soilKPa > 0 ? soilKPa : SOIL_DEFAULT_KPA
  if (!Number.isFinite(PsKN) || PsKN <= 0) {
    return { side: MIN_FOOTING_SIDE_M, thickness: FOOTING_THICKNESS_M, area: 0 }
  }
  const area = round2(PsKN / sigma)
  const side = Math.max(
    MIN_FOOTING_SIDE_M,
    roundUp(Math.sqrt(area), FOOTING_SIDE_STEP_M),
  )
  const result: FootingSize = {
    side,
    thickness: FOOTING_THICKNESS_M,
    area,
  }
  if (area > DEEP_FOUNDATION_AREA_M2) result.deepNote = DEEP_NOTE
  return result
}
