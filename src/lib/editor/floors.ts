/**
 * Helper jenis lantai (Fase E5, plan ARSITEKTUR_MODERN) — pengganti asumsi
 * susunan array & magic string "floor-rooftop" yang tersebar. `kind` absen =
 * regular; id "floor-rooftop" tetap dianggap rooftop (kompat data lama).
 */

import type { Floor } from "@/types"

export function isRooftopFloor(f: Floor): boolean {
  return f.kind === "rooftop" || f.id === "floor-rooftop"
}

export function isMezzanineFloor(f: Floor): boolean {
  return f.kind === "mezzanine"
}

export function isRegularFloor(f: Floor): boolean {
  return !isRooftopFloor(f) && !isMezzanineFloor(f)
}

/** Lantai reguler, urutan array (konvensi tumpukan). */
export function regularFloorsOf(floors: readonly Floor[]): Floor[] {
  return floors.filter(isRegularFloor)
}

/** Id lantai reguler TERATAS (level tertinggi) — bidang atap duduk di atasnya. */
export function topRegularFloorId(floors: readonly Floor[]): string | null {
  const regs = regularFloorsOf(floors)
  if (regs.length === 0) return null
  return [...regs].sort((a, b) => b.level - a.level)[0].id
}

/** Lantai INDUK sebuah mezzanine = lantai reguler tepat sebelumnya di array. */
export function mezzanineParentOf(
  floors: readonly Floor[],
  mezzId: string,
): Floor | null {
  const idx = floors.findIndex((f) => f.id === mezzId)
  if (idx < 0 || !isMezzanineFloor(floors[idx])) return null
  for (let i = idx - 1; i >= 0; i--) {
    if (isRegularFloor(floors[i])) return floors[i]
  }
  return null
}

/** Batas geser cantilever per sumbu (m) — plan PLAN_TUTUP_GAP Gap 2 Track B. */
export const CANTILEVER_MAX_M = 1.5

/** Geser horizontal efektif lantai (ter-clamp ±CANTILEVER_MAX). Absen = 0. */
export function floorOffset(floor: Floor | undefined): { dx: number; dy: number } {
  const o = floor?.offsetM
  if (!o) return { dx: 0, dy: 0 }
  const c = (v: number) =>
    Number.isFinite(v) ? Math.max(-CANTILEVER_MAX_M, Math.min(CANTILEVER_MAX_M, v)) : 0
  return { dx: c(o.dx), dy: c(o.dy) }
}
