/**
 * Water fixture constants + symbol glyphs for the "Rencana Air" sheets.
 * Pure data/functions — no DOM, no store. Values are pinned by the SP5
 * plan's Global Constraints
 * (docs/superpowers/plans/2026-07-04-sp5-air-sanitasi.md):
 *
 * - `WATER_SYSTEM`: piping system per fixture type — kloset → limbah;
 *   wastafel/shower/floor_drain/sink_dapur → kotor;
 *   kran/kran_taman/kran_wudhu → bersih.
 * - `PIPE_DIAMETER`: nominal pipe Ø per system (SNI 8153:2015) — bersih ¾",
 *   kotor 2", limbah 4".
 * - `symbolLines`: line-only glyph per fixture type, electrical-plan
 *   `symbolLines` style — every line `kind: "opening"`, coords `round2`
 *   and within ±`SYM_M` of the (cx, cy) center. The LINE COUNTS are pinned
 *   and asserted by tests: kloset 6 (oval bowl) · wastafel 4 (basin) ·
 *   shower 5 (tray + spray) · kran/kran_taman/kran_wudhu 3 (faucet) ·
 *   floor_drain 6 (grate + cross) · sink_dapur 5 (basin + drain).
 */
import type { WaterPointType, WaterSystem } from "@/types"
import { round2 } from "@/lib/geometry"
import type { DrawLine } from "@/lib/drawings/types"

/** Symbol half-extent (m): every glyph coordinate stays within ±SYM_M of center. */
export const SYM_M = 0.15

/** Piping system per fixture type (SP5 Global Constraints). */
export const WATER_SYSTEM: Record<WaterPointType, WaterSystem> = {
  kloset: "limbah",
  wastafel: "kotor",
  shower: "kotor",
  floor_drain: "kotor",
  sink_dapur: "kotor",
  kran: "bersih",
  kran_taman: "bersih",
  kran_wudhu: "bersih",
}

/** Nominal pipe Ø per system (SNI 8153:2015, SP5 Global Constraints). */
export const PIPE_DIAMETER: Record<WaterSystem, string> = {
  bersih: '¾"',
  kotor: '2"',
  limbah: '4"',
}

function line(x1: number, y1: number, x2: number, y2: number): DrawLine {
  return { x1: round2(x1), y1: round2(y1), x2: round2(x2), y2: round2(y2), kind: "opening" }
}

/** Closed polygon outline through the given offsets — one line per edge. */
function polyLines(cx: number, cy: number, pts: Array<[number, number]>): DrawLine[] {
  const out: DrawLine[] = []
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i]
    const [bx, by] = pts[(i + 1) % pts.length]
    out.push(line(cx + ax, cy + ay, cx + bx, cy + by))
  }
  return out
}

/** Axis-aligned rectangle outline centered on (cx, cy) — 4 lines. */
function boxLines(cx: number, cy: number, hx: number, hy: number): DrawLine[] {
  return [
    line(cx - hx, cy - hy, cx + hx, cy - hy),
    line(cx + hx, cy - hy, cx + hx, cy + hy),
    line(cx + hx, cy + hy, cx - hx, cy + hy),
    line(cx - hx, cy + hy, cx - hx, cy - hy),
  ]
}

/**
 * Line-only glyph for a water fixture, centered on (cx, cy). All lines are
 * `kind: "opening"`, all coords `round2` and within ±SYM_M of the center.
 * Line counts per type are pinned (see module docblock).
 */
export function symbolLines(type: WaterPointType, cx: number, cy: number): DrawLine[] {
  switch (type) {
    case "kloset":
      // Tall oval bowl approximated by a 6-vertex hexagon = 6 lines.
      return polyLines(cx, cy, [
        [0, 0.15],
        [0.1, 0.08],
        [0.1, -0.08],
        [0, -0.15],
        [-0.1, -0.08],
        [-0.1, 0.08],
      ])
    case "wastafel":
      // Basin outline (wider than tall) = 4 lines.
      return boxLines(cx, cy, 0.13, 0.09)
    case "shower":
      // Tray square (4) + one diagonal spray stroke = 5.
      return [
        ...boxLines(cx, cy, 0.12, 0.12),
        line(cx - 0.12, cy + 0.12, cx + 0.12, cy - 0.12),
      ]
    case "floor_drain":
      // Square grate (4) + centred cross (2) = 6.
      return [
        ...boxLines(cx, cy, 0.12, 0.12),
        line(cx - 0.12, cy, cx + 0.12, cy),
        line(cx, cy - 0.12, cx, cy + 0.12),
      ]
    case "sink_dapur":
      // Rectangular sink basin (4) + centre drain tick = 5.
      return [
        ...boxLines(cx, cy, 0.14, 0.09),
        line(cx, cy - 0.05, cx, cy + 0.05),
      ]
    case "kran":
    case "kran_taman":
    case "kran_wudhu":
    default:
      // Faucet: vertical stem + horizontal arm + down spout = 3.
      return [
        line(cx, cy - 0.1, cx, cy + 0.1),
        line(cx, cy + 0.1, cx + 0.1, cy + 0.1),
        line(cx + 0.1, cy + 0.1, cx + 0.1, cy + 0.02),
      ]
  }
}
