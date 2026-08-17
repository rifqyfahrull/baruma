/**
 * Pure kusen (door/window frame) schedule, type-coding, and pricing —
 * derived from `layout.openings`. No DOM, no three.js — safe to unit test
 * and reuse from SVG/PDF renderers and the RAB module.
 *
 * Coding conventions (pinned — see docs/superpowers/plans/2026-07-03-sp2-rencana-kusen.md
 * Global Constraints):
 *   Group openings by `(type, round2(widthM), round2(heightM))`. Doors are
 *   coded P1.. and windows J1.. — each group sorted by widthM desc, then
 *   heightM desc, which is already fully deterministic because the grouping
 *   key makes every (widthM, heightM) pair within a type unique.
 */
import type { DesignLayout, FinishingLevel, Opening } from "@/types"
import { round2 } from "@/lib/geometry"

export type KusenType = {
  code: string
  openingType: "door" | "window"
  widthM: number
  heightM: number
  count: number
  perFloor: Record<string, number>
  openingIds: string[]
}

type Group = {
  openingType: "door" | "window"
  widthM: number
  heightM: number
  perFloor: Record<string, number>
  openingIds: string[]
}

function round1k(n: number): number {
  return Math.round(n / 1000) * 1000
}

function groupKey(o: Opening): string {
  return `${o.type}:${round2(o.widthM)}x${round2(o.heightM)}`
}

function sortGroups(a: Group, b: Group): number {
  return b.widthM - a.widthM || b.heightM - a.heightM
}

export function kusenSchedule(layout: DesignLayout): KusenType[] {
  const groups = new Map<string, Group>()

  for (const o of layout.openings) {
    const key = groupKey(o)
    let g = groups.get(key)
    if (!g) {
      g = {
        openingType: o.type,
        widthM: round2(o.widthM),
        heightM: round2(o.heightM),
        perFloor: {},
        openingIds: [],
      }
      groups.set(key, g)
    }
    g.openingIds.push(o.id)
    g.perFloor[o.floorId] = (g.perFloor[o.floorId] ?? 0) + 1
  }

  const doors = Array.from(groups.values())
    .filter((g) => g.openingType === "door")
    .sort(sortGroups)
  const windows = Array.from(groups.values())
    .filter((g) => g.openingType === "window")
    .sort(sortGroups)

  const toType = (g: Group, prefix: "P" | "J", i: number): KusenType => ({
    code: `${prefix}${i + 1}`,
    openingType: g.openingType,
    widthM: g.widthM,
    heightM: g.heightM,
    count: g.openingIds.length,
    perFloor: g.perFloor,
    openingIds: g.openingIds,
  })

  return [
    ...doors.map((g, i) => toType(g, "P", i)),
    ...windows.map((g, i) => toType(g, "J", i)),
  ]
}

export function kusenCodeByOpeningId(layout: DesignLayout): Map<string, string> {
  const map = new Map<string, string>()
  for (const t of kusenSchedule(layout)) {
    for (const id of t.openingIds) map.set(id, t.code)
  }
  return map
}

const DOOR_BASE_IDR: Record<FinishingLevel, number> = {
  standar: 850_000,
  menengah: 1_400_000,
  premium: 2_400_000,
}

const WINDOW_BASE_IDR: Record<FinishingLevel, number> = {
  standar: 450_000,
  menengah: 750_000,
  premium: 1_300_000,
}

export function kusenPrice(
  openingType: "door" | "window",
  widthM: number,
  heightM: number,
  finishing: FinishingLevel
): number {
  const base = (openingType === "door" ? DOOR_BASE_IDR : WINDOW_BASE_IDR)[finishing]
  const areaDaun = widthM * heightM
  return round1k(base * (0.6 + 0.4 * areaDaun))
}
