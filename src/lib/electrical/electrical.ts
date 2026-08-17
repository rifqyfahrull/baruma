/**
 * Electrical constants + symbol glyphs for the "Rencana Listrik" sheets.
 * Pure data/functions — no DOM, no store. Values are pinned by the SP4
 * plan's Global Constraints
 * (docs/superpowers/plans/2026-07-04-sp4-instalasi-listrik.md):
 *
 * - `LOAD_VA`: VA load per electrical point type (switches/panel/data = 0).
 * - `LAMP_LOAD_VA`: VA per lamp unit (multiply by fixture qty).
 * - `symbolLines`: line-only glyph per point type, ceiling-plan
 *   `crossLines`/`diamondLines` style — every line `kind: "opening"`,
 *   coords `round2` and within ±`SYM_M` of the (cx, cy) center. The LINE
 *   COUNTS are pinned and asserted by tests:
 *   stopkontak 6 (box 4 + 2 prongs) · stopkontak_daya 7 (+1 diagonal "D")
 *   · saklar_tunggal 2 (45° stem + lever) · saklar_ganda 4 (2 stems +
 *   2 levers) · panel 5 (square 4 + 1 diagonal hatch) · data 3 (triangle).
 */
import type { ElectricalPointType, LightingFixture } from "@/types"
import { round2 } from "@/lib/geometry"
import type { DrawLine } from "@/lib/drawings/types"

/** Symbol half-extent (m): every glyph coordinate stays within ±SYM_M of center. */
export const SYM_M = 0.15

/** VA load per point (SP4 Global Constraints). */
export const LOAD_VA: Record<ElectricalPointType, number> = {
  stopkontak: 200,
  stopkontak_daya: 900,
  saklar_tunggal: 0,
  saklar_ganda: 0,
  panel: 0,
  data: 0,
}

/** VA per lamp unit — multiply by the fixture's qty (SP4 Global Constraints). */
export const LAMP_LOAD_VA: Record<LightingFixture["type"], number> = {
  downlight: 15,
  pendant: 25,
  task: 20,
  wall_lamp: 15,
  indirect: 20,
  outdoor: 30,
}

/** Inner box half-extent for stopkontak glyphs (prongs extend up to SYM_M). */
const BOX_M = 0.09
/** Prong x-offset from center for stopkontak glyphs. */
const PRONG_M = 0.05

function line(x1: number, y1: number, x2: number, y2: number): DrawLine {
  return { x1: round2(x1), y1: round2(y1), x2: round2(x2), y2: round2(y2), kind: "opening" }
}

/** Axis-aligned square outline centered on (cx, cy) with half-extent h — 4 lines. */
function boxLines(cx: number, cy: number, h: number): DrawLine[] {
  return [
    line(cx - h, cy - h, cx + h, cy - h),
    line(cx + h, cy - h, cx + h, cy + h),
    line(cx + h, cy + h, cx - h, cy + h),
    line(cx - h, cy + h, cx - h, cy - h),
  ]
}

/**
 * Line-only glyph for an electrical point, centered on (cx, cy).
 * All lines are `kind: "opening"`, all coords `round2` and within ±SYM_M
 * of the center. Line counts per type are pinned (see module docblock).
 */
export function symbolLines(type: ElectricalPointType, cx: number, cy: number): DrawLine[] {
  switch (type) {
    case "stopkontak":
      // Box (4) + two prongs sticking out of the top edge (2) = 6.
      return [
        ...boxLines(cx, cy, BOX_M),
        line(cx - PRONG_M, cy + BOX_M, cx - PRONG_M, cy + SYM_M),
        line(cx + PRONG_M, cy + BOX_M, cx + PRONG_M, cy + SYM_M),
      ]
    case "stopkontak_daya":
      // Stopkontak (6) + one diagonal "D[aya]" stroke across the box = 7.
      return [
        ...symbolLines("stopkontak", cx, cy),
        line(cx - BOX_M, cy - BOX_M, cx + BOX_M, cy + BOX_M),
      ]
    case "saklar_tunggal":
      // 45° stem (1) + horizontal lever tick at its tip (1) = 2.
      return [
        line(cx - 0.1, cy - 0.1, cx + 0.1, cy + 0.1),
        line(cx + 0.1, cy + 0.1, cx + SYM_M, cy + 0.1),
      ]
    case "saklar_ganda":
      // Two parallel 45° stems + their lever ticks = 4.
      return [
        line(cx - 0.1, cy - 0.1, cx + 0.1, cy + 0.1),
        line(cx + 0.1, cy + 0.1, cx + SYM_M, cy + 0.1),
        line(cx - SYM_M, cy - 0.05, cx + 0.05, cy + SYM_M),
        line(cx + 0.05, cy + SYM_M, cx + 0.1, cy + SYM_M),
      ]
    case "panel":
      // Full-size square (4) + one diagonal hatch = 5.
      return [
        ...boxLines(cx, cy, 0.12),
        line(cx - 0.12, cy - 0.12, cx + 0.12, cy + 0.12),
      ]
    case "data":
    default:
      // Triangle (data/TV point) = 3.
      return [
        line(cx, cy + 0.12, cx + 0.12, cy - 0.1),
        line(cx + 0.12, cy - 0.1, cx - 0.12, cy - 0.1),
        line(cx - 0.12, cy - 0.1, cx, cy + 0.12),
      ]
  }
}
