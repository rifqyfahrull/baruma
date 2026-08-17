/**
 * Pure projection of a `DesignLayout` into a schematic "Diagram Riser" plumbing
 * riser drawing. This is a SCHEMATIC — NOT to scale: it shows how the supply,
 * waste, soil and vent stacks connect the floors, with a representative branch
 * stub + fixture count per floor per system. No DOM, no three.js — safe to
 * unit test and reuse from SVG/PDF renderers. Coordinates are in schematic
 * metres with y UP (the `Drawing` contract); the lowest floor (smallest
 * `floor.level`) sits at the bottom.
 *
 * Layout (schematic, y-UP):
 *  - one horizontal floor line (`kind: "slab"`) per floor, ascending by level,
 *    labelled with the floor name at its left end;
 *  - four vertical stacks (`kind: "opening"`): air bersih (supply, x=1.0),
 *    air kotor (grey, x=2.5), air limbah (soil, x=3.5) and vent (x=5.0). The
 *    waste/soil stacks drop below the lowest floor (toward the septic); the
 *    vent stack rises above the top floor (through the roof);
 *  - per floor, a short branch stub off each system's stack for which that
 *    floor has ≥1 fixture, plus a `"<n> titik"` count label (fixtures are
 *    aggregated from `layout.water` grouped by `WATER_SYSTEM`);
 *  - pipe-Ø callouts near the top of each stack, from `PIPE_DIAMETER` (+ vent).
 *
 * Defensive (T1 carry-forward): `layout.floors`/`layout.rooms`/`layout.water`
 * come from an un-validated PUT (no zod), so missing arrays, orphan water
 * points and unknown fixture types are tolerated — never crashed on.
 */
import type { DesignLayout, WaterSystem } from "@/types"
import { round2 } from "@/lib/geometry"
import { WATER_SYSTEM, PIPE_DIAMETER } from "@/lib/water/water"
import type { Drawing, DrawLine, DrawLabel } from "./types"
import { normalize } from "./sanitation-detail"

const TITLE = "Diagram Riser"

/** Horizontal span (m) of each schematic floor line. */
const FLOOR_SPAN_M = 6
/** Vertical gap (m) between adjacent floor lines. */
const FLOOR_GAP_M = 1.4
/** Length (m) of a fixture branch stub off a stack. */
const STUB_M = 0.6
/** Drop (m) of the waste/soil stacks below the lowest floor (toward septic). */
const WASTE_DROP_M = 0.9
/** Rise (m) of the vent stack above the top floor (through the roof). */
const VENT_RISE_M = 1.0
/** Vent pipe Ø (SNI 8153:2015) — not in PIPE_DIAMETER (systems only). */
const VENT_DIAMETER = '2"'

/** Schematic x of each vertical stack. */
const X_BERSIH = 1.0
const X_KOTOR = 2.5
const X_LIMBAH = 3.5
const X_VENT = 5.0

type SystemCounts = Record<WaterSystem, number>

export function buildRiserDiagram(layout: DesignLayout): Drawing {
  const floors = (Array.isArray(layout.floors) ? layout.floors : [])
    .slice()
    .sort((a, b) => a.level - b.level)

  // roomId → floorId, so each water point can be attributed to a floor.
  const floorIdByRoom = new Map<string, string>()
  for (const r of Array.isArray(layout.rooms) ? layout.rooms : []) {
    if (r && typeof r.id === "string") floorIdByRoom.set(r.id, r.floorId)
  }

  // Aggregate fixture counts per floor, per piping system.
  const countsByFloor = new Map<string, SystemCounts>()
  for (const f of floors) countsByFloor.set(f.id, { bersih: 0, kotor: 0, limbah: 0 })
  for (const p of Array.isArray(layout.water) ? layout.water : []) {
    if (!p) continue
    const fid = floorIdByRoom.get(p.roomId)
    if (fid === undefined) continue
    const bucket = countsByFloor.get(fid)
    if (!bucket) continue
    const system = WATER_SYSTEM[p.type]
    if (!system) continue
    bucket[system] += 1
  }

  const lines: DrawLine[] = []
  const labels: DrawLabel[] = []
  const n = floors.length
  const topY = n > 0 ? round2((n - 1) * FLOOR_GAP_M) : 0

  floors.forEach((floor, i) => {
    const y = round2(i * FLOOR_GAP_M)
    // Floor line + name label (x = LEFT text edge at the line's left end →
    // anchor "start"; centred, half the name hung left past the floor line).
    lines.push({ x1: 0, y1: y, x2: FLOOR_SPAN_M, y2: y, kind: "slab" })
    labels.push({ x: 0.1, y: round2(y + 0.2), text: floor.name ?? floor.id, kind: "room", anchor: "start" })

    // Representative branch stubs + fixture counts for each system present.
    const c = countsByFloor.get(floor.id) ?? { bersih: 0, kotor: 0, limbah: 0 }
    // Count labels hug their stub tip: the bersih stub points LEFT, so its
    // text ENDS at the tip (anchor "end"); kotor/limbah stubs point RIGHT, so
    // their text STARTS at the tip (anchor "start"). Centred, the text sat
    // half on top of the stub/stack lines.
    if (c.bersih > 0) {
      lines.push({ x1: X_BERSIH, y1: y, x2: round2(X_BERSIH - STUB_M), y2: y, kind: "opening" })
      labels.push({ x: round2(X_BERSIH - STUB_M - 0.1), y: round2(y + 0.15), text: `${c.bersih} titik`, kind: "room", anchor: "end" })
    }
    if (c.kotor > 0) {
      lines.push({ x1: X_KOTOR, y1: y, x2: round2(X_KOTOR + STUB_M), y2: y, kind: "opening" })
      labels.push({ x: round2(X_KOTOR + STUB_M + 0.05), y: round2(y + 0.15), text: `${c.kotor} titik`, kind: "room", anchor: "start" })
    }
    if (c.limbah > 0) {
      lines.push({ x1: X_LIMBAH, y1: y, x2: round2(X_LIMBAH + STUB_M), y2: y, kind: "opening" })
      labels.push({ x: round2(X_LIMBAH + STUB_M + 0.05), y: round2(y + 0.15), text: `${c.limbah} titik`, kind: "room", anchor: "start" })
    }
  })

  if (n > 0) {
    // Vertical stacks: supply rises, waste/soil drop below, vent rises above.
    lines.push({ x1: X_BERSIH, y1: 0, x2: X_BERSIH, y2: topY, kind: "opening" })
    lines.push({ x1: X_KOTOR, y1: round2(-WASTE_DROP_M), x2: X_KOTOR, y2: topY, kind: "opening" })
    lines.push({ x1: X_LIMBAH, y1: round2(-WASTE_DROP_M), x2: X_LIMBAH, y2: topY, kind: "opening" })
    lines.push({ x1: X_VENT, y1: 0, x2: X_VENT, y2: round2(topY + VENT_RISE_M), kind: "opening" })

    // Pipe-Ø callouts near the top of each stack.
    labels.push({ x: X_BERSIH, y: round2(topY + 0.3), text: `Air bersih Ø ${PIPE_DIAMETER.bersih}`, kind: "room" })
    labels.push({ x: X_KOTOR, y: round2(topY + 0.6), text: `Air kotor Ø ${PIPE_DIAMETER.kotor}`, kind: "room" })
    labels.push({ x: X_LIMBAH, y: round2(topY + 0.3), text: `Air limbah Ø ${PIPE_DIAMETER.limbah}`, kind: "room" })
    labels.push({ x: X_VENT, y: round2(topY + VENT_RISE_M + 0.3), text: `Vent Ø ${VENT_DIAMETER}`, kind: "room" })
  }

  return normalize({
    widthM: round2(FLOOR_SPAN_M + 0.5),
    heightM: round2(topY + VENT_RISE_M + 1.0),
    lines,
    labels,
    dims: [],
    levels: [],
    title: TITLE,
  })
}
