/**
 * Circuit grouping + MCB sizing for the "Rencana Listrik" sheets (SP4 T3).
 * Pure functions — no DOM, no store. Rules pinned by the SP4 plan's Global
 * Constraints (docs/superpowers/plans/2026-07-04-sp4-instalasi-listrik.md):
 *
 * Per floor:
 * - exactly 1 "penerangan" circuit — ALL the floor's lamps (via interiors);
 *   a fixture with qty N counts as N points and N × `LAMP_LOAD_VA[type]`.
 * - exactly 1 "stopkontak" circuit — all `stopkontak` points, `LOAD_VA` each.
 * - 1 "khusus" circuit PER `stopkontak_daya` point (input array order).
 * - `saklar_*`/`panel`/`data` contribute NO circuit and 0 load.
 * - A circuit with 0 points is omitted; a floor with no points and no lamps
 *   yields [].
 *
 * Names are Bahasa (`Penerangan — <floor.name>`, `Stopkontak — <floor.name>`,
 * `Daya Khusus <i>`) — em-dash convention matching ceiling-plan/kusen-plan/
 * sheet-list (floor names are already "Lantai N"); ids are stable
 * (`circ-<kind>-<floorId>[-i]`, i 1-based).
 * Order: penerangan, stopkontak, then khusus.
 *
 * Carry-forward (T1): the layout save API has no zod, so `layout.electrical`
 * is read defensively — null entries and unknown types crash nothing (they
 * simply contribute no load/circuit) and a point whose room is missing is
 * treated as not on this floor.
 */
import type { DesignLayout, ElectricalPoint, RoomInteriorPlan } from "@/types"
import { LAMP_LOAD_VA, LOAD_VA } from "./electrical"
import { exteriorLampWatt } from "./costing"
import { effectiveLamps } from "@/lib/three/lamps"

export type Circuit = {
  id: string
  name: string
  kind: "penerangan" | "stopkontak" | "khusus"
  pointCount: number
  loadVA: number
  mcbA: number
}

/** Standard MCB ratings (A) — SP4 Global Constraints. */
export const MCB_STANDARDS = [2, 4, 6, 10, 16, 20, 25]

/**
 * First standard rating ≥ (va/220) × 1.25; above every standard → 25 A (v1).
 * Worked examples: 90 VA → 2 A · 1600 VA → 10 A · 900 VA → 6 A.
 */
export function mcbFor(va: number): number {
  const amps = (va / 220) * 1.25
  return MCB_STANDARDS.find((a) => a >= amps) ?? MCB_STANDARDS[MCB_STANDARDS.length - 1]
}

/** Group a floor's lamps + electrical points into sized circuits. */
export function buildCircuits(
  layout: DesignLayout,
  interiors: RoomInteriorPlan[],
  floorId: string,
): Circuit[] {
  const floorName = layout.floors.find((f) => f.id === floorId)?.name ?? floorId
  const roomFloor = new Map(layout.rooms.map((r) => [r.id, r.floorId]))

  // Lamps (penerangan): interiors entries on this floor — use the entry's own
  // floorId when present, otherwise resolve the room via layout.rooms.
  let lampCount = 0
  let lampVA = 0
  for (const plan of interiors) {
    const fid = plan.floorId || roomFloor.get(plan.roomId)
    if (fid !== floorId) continue
    for (const f of plan.lighting ?? []) {
      // Watt per fixture bisa di-override user (use-case riil: lampu 3 W vs
      // 25 W beda beban & MCB); default tetap LAMP_LOAD_VA per tipe.
      const unitVA = f?.watt ?? LAMP_LOAD_VA[f?.type]
      const qty = typeof f?.qty === "number" && Number.isFinite(f.qty) ? f.qty : 0
      if (unitVA === undefined || qty <= 0) continue
      lampCount += qty
      lampVA += unitVA * qty
    }
  }

  // Lampu EKSTERIOR (teras/taman/kanopi) ikut sirkuit penerangan lantainya —
  // beban nyata di lapangan, bukan sekadar visual 3D. effectiveLamps =
  // daftar editable user bila ada, selain itu penempatan otomatis (persis
  // yang tampil di preview 3D).
  for (const l of effectiveLamps(layout)) {
    if (!l || l.floorId !== floorId) continue
    lampCount += 1
    lampVA += exteriorLampWatt(l)
  }

  // Points: only stopkontak/stopkontak_daya form circuits; everything else
  // (switches, panel, data, unknown types) contributes nothing.
  let outletCount = 0
  const dayaPoints: ElectricalPoint[] = []
  for (const p of layout.electrical ?? []) {
    if (!p || roomFloor.get(p.roomId) !== floorId) continue
    // Non-finite coords can't be drawn (electrical-plan.ts skips them), so
    // exclude them here too — keeps the panel schedule counts consistent with
    // the rendered plan (carry-forward: PUT has no zod).
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue
    if (p.type === "stopkontak") outletCount += 1
    else if (p.type === "stopkontak_daya") dayaPoints.push(p)
  }

  const circuits: Circuit[] = []
  if (lampCount > 0) {
    circuits.push({
      id: `circ-penerangan-${floorId}`,
      name: `Penerangan — ${floorName}`,
      kind: "penerangan",
      pointCount: lampCount,
      loadVA: lampVA,
      mcbA: mcbFor(lampVA),
    })
  }
  if (outletCount > 0) {
    const loadVA = outletCount * LOAD_VA.stopkontak
    circuits.push({
      id: `circ-stopkontak-${floorId}`,
      name: `Stopkontak — ${floorName}`,
      kind: "stopkontak",
      pointCount: outletCount,
      loadVA,
      mcbA: mcbFor(loadVA),
    })
  }
  dayaPoints.forEach((_, i) => {
    const loadVA = LOAD_VA.stopkontak_daya
    circuits.push({
      id: `circ-khusus-${floorId}-${i + 1}`,
      name: `Daya Khusus ${i + 1}`,
      kind: "khusus",
      pointCount: 1,
      loadVA,
      mcbA: mcbFor(loadVA),
    })
  })
  return circuits
}
