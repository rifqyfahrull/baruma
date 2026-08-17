/**
 * Shared lighting-fixture symbol geometry for plan sheets (rencana plafon +
 * rencana listrik). Extracted from ceiling-plan.ts so electrical-plan.ts reuses
 * the exact same lamp glyphs without duplication.
 *
 * A fixture's x/y are ROOM-LOCAL, so the CALLER passes the absolute symbol
 * center (`room.x + f.x`, `room.y + f.y`). Every line is `kind: "opening"`
 * (the renderer draws these as thin symbol strokes), all coords `round2` and
 * within ±`SYMBOL_HALF_M` of the center. downlight/task/outdoor render as a
 * CROSS (2 lines); the rest render as a DIAMOND (a 45°-rotated square, 4 lines).
 */
import type { LightingFixture } from "@/types"
import { round2 } from "@/lib/geometry"
import type { DrawLine } from "./types"

/** Symbol half-extent (m): every glyph coordinate stays within ±SYMBOL_HALF_M of center. */
export const SYMBOL_HALF_M = 0.12

/** Fixture types that render as a cross; the rest render as a diamond. */
export const CROSS_TYPES = new Set<LightingFixture["type"]>(["downlight", "task", "outdoor"])

/** Two lines centered on (cx, cy): a horizontal + vertical stroke, ±SYMBOL_HALF_M. */
export function crossLines(cx: number, cy: number): DrawLine[] {
  return [
    { x1: round2(cx - SYMBOL_HALF_M), y1: cy, x2: round2(cx + SYMBOL_HALF_M), y2: cy, kind: "opening" },
    { x1: cx, y1: round2(cy - SYMBOL_HALF_M), x2: cx, y2: round2(cy + SYMBOL_HALF_M), kind: "opening" },
  ]
}

/** A 45°-rotated square (belah ketupat) centered on (cx, cy), ±SYMBOL_HALF_M vertices. */
export function diamondLines(cx: number, cy: number): DrawLine[] {
  const top = { x: cx, y: round2(cy + SYMBOL_HALF_M) }
  const right = { x: round2(cx + SYMBOL_HALF_M), y: cy }
  const bottom = { x: cx, y: round2(cy - SYMBOL_HALF_M) }
  const left = { x: round2(cx - SYMBOL_HALF_M), y: cy }
  return [
    { x1: top.x, y1: top.y, x2: right.x, y2: right.y, kind: "opening" },
    { x1: right.x, y1: right.y, x2: bottom.x, y2: bottom.y, kind: "opening" },
    { x1: bottom.x, y1: bottom.y, x2: left.x, y2: left.y, kind: "opening" },
    { x1: left.x, y1: left.y, x2: top.x, y2: top.y, kind: "opening" },
  ]
}
