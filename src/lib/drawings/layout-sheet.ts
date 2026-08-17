/**
 * Shared A3 sheet-placement math. Given a `Drawing`, computes the picked
 * architect scale plus a `toMm` projector from drawing-space meters
 * (y points UP) to sheet millimeters (y points DOWN — the SVG/PDF
 * convention), centered inside the sheet's printable content area.
 *
 * Factored out so `SheetSvg` (SVG renderer) and the future PDF exporter
 * (`drawings-pack.ts`) render from the exact same numbers.
 *
 * Also hosts `buildLayoutSheet` — the DENAH (architectural floor plan)
 * builder, one sheet per floor. Same plan-view convention as
 * kusen-plan.ts: top-view denah, plan x/y used DIRECTLY as drawing
 * coords (no y-flip — that's the renderer's job), `void` rooms excluded
 * from outlines/labels but included in the bbox + dim chains. On top of
 * the kusen-plan base (room outlines, name labels, opening segments) the
 * denah prints the features the 3D model already builds but no sheet
 * printed yet: stair treads + NAIK arrow, balcony glass railing on OPEN
 * sides, the carport canopy (dashed outline + posts, skipped when a
 * floor above covers it) and facade louver bands — each mirroring the
 * exact rule in `build-model.ts` (stair-/railg-/cpr-/cpp-/louv- prims).
 */
import type { DesignLayout } from "@/types"
import {
  openingSegment,
  parseOpeningWall,
  rectsOverlap,
  roomsAdjacentOnSide,
  round2,
  type Side,
} from "@/lib/geometry"
import { hazardOpenSides, OPEN_TYPES, SLAB_T, WALL_H } from "@/lib/three/build-model"
import { pickSheetScale } from "./scale"
import type { DimChain, DrawLabel, DrawLine, Drawing } from "./types"
import { projectExteriorPlan } from "@/lib/exterior/projection"
import { interiorStairLayout, interiorStairSpec } from "@/lib/stairs/geometry"
import { floorElevations, stairRiseM } from "@/lib/geometry/vertical"

export const SHEET_W_MM = 420
export const SHEET_H_MM = 297
export const SHEET_MARGIN_MM = 15
export const TITLE_BLOCK_H_MM = 22

/** Printable content box: inside the margin, above the title block strip. */
export const CONTENT_LEFT_MM = SHEET_MARGIN_MM
export const CONTENT_TOP_MM = SHEET_MARGIN_MM
export const CONTENT_RIGHT_MM = SHEET_W_MM - SHEET_MARGIN_MM
export const CONTENT_BOTTOM_MM = SHEET_H_MM - SHEET_MARGIN_MM - TITLE_BLOCK_H_MM

export type SheetPlacement = {
  /** Chosen architect scale denominator (1:N). */
  scaleN: number
  /** Sheet-mm x for drawing x=0. */
  ox: number
  /** Sheet-mm y for drawing y=0 (bottom of the drawing's bounding box). */
  oy: number
  /** Project a drawing-space point (meters, y UP) to sheet mm (y DOWN). */
  toMm: (x: number, y: number) => { x: number; y: number }
}

function mm(v: number): number {
  return Math.round(v * 1000) / 1000
}

/** Compute the scale + centered origin for a `Drawing` on the A3 sheet. */
export function sheetPlacement(drawing: Drawing): SheetPlacement {
  const scaleN = pickSheetScale(drawing.widthM, drawing.heightM)

  const availW = CONTENT_RIGHT_MM - CONTENT_LEFT_MM
  const availH = CONTENT_BOTTOM_MM - CONTENT_TOP_MM
  const drawWMm = (drawing.widthM * 1000) / scaleN
  const drawHMm = (drawing.heightM * 1000) / scaleN

  const ox = CONTENT_LEFT_MM + (availW - drawWMm) / 2
  const oy = CONTENT_BOTTOM_MM - (availH - drawHMm) / 2

  function toMm(x: number, y: number): { x: number; y: number } {
    return { x: mm(ox + (x * 1000) / scaleN), y: mm(oy - (y * 1000) / scaleN) }
  }

  return { scaleN, ox, oy, toMm }
}

/* ── DENAH builder ── */

const SIDES: Side[] = ["n", "s", "w", "e"]

/** Railing balkon: jarak garis kedua dari garis tepi (garis ganda tipis). */
const RAIL_OFFSET_M = 0.05
/** Kanopi carport: overhang tiap sisi (build-model: args w+0.3 terpusat). */
const CANOPY_OVERHANG_M = 0.15
/** Tiang kanopi 10x10, sudut inset 0,15 — sama dengan prim `cpp-`. */
const POST_SIZE_M = 0.1
const POST_INSET_M = 0.15
/** Louver band menempel PROUD di muka luar dinding host. */
const LOUVER_PROUD_M = 0.15
/** Panah NAIK: inset ujung dari tepi run, panjang kepala, setengah-lebar kepala. */
const ARROW_MARGIN_M = 0.3
const ARROW_HEAD_M = 0.2
const ARROW_HEAD_HALF_M = 0.1
/** Label "NAIK" ditarik mundur dari ujung panah sepanjang arah naik. */
const NAIK_PULLBACK_M = 0.5

/** Vektor satuan plan-space per arah sisi (n = -y, s = +y, w = -x, e = +x). */
function sideVec(side: Side): { x: number; y: number } {
  switch (side) {
    case "n":
      return { x: 0, y: -1 }
    case "s":
      return { x: 0, y: 1 }
    case "w":
      return { x: -1, y: 0 }
    case "e":
    default:
      return { x: 1, y: 0 }
  }
}

/** 4 garis keliling sebuah rect — dipakai outline ruang, kanopi & tiang. */
function pushRect(
  lines: DrawLine[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  kind: DrawLine["kind"]
): void {
  lines.push({ x1: x0, y1: y0, x2: x1, y2: y0, kind })
  lines.push({ x1: x1, y1: y0, x2: x1, y2: y1, kind })
  lines.push({ x1: x1, y1: y1, x2: x0, y2: y1, kind })
  lines.push({ x1: x0, y1: y1, x2: x0, y2: y0, kind })
}

/**
 * DENAH per lantai: outline + label ruang, segmen bukaan, dim chains — plus
 * tangga (tread lines + panah/label NAIK), railing balkon sisi terbuka,
 * kanopi carport (skip bila tertutup lantai atas) dan louver band fasad.
 */
export function buildLayoutSheet(layout: DesignLayout, floorId: string): Drawing {
  const floor = layout.floors.find((f) => f.id === floorId)
  // Rise tangga per lantai dari tabel elevasi (Fase D4) — selaras 3D/section/RAB.
  const lsElev = floorElevations(layout.floors)
  const allRooms = layout.rooms.filter((r) => r.floorId === floorId)
  const rooms = allRooms.filter((r) => r.type !== "void")

  const lines: DrawLine[] = []
  const labels: DrawLabel[] = []
  const xPoints = new Set<number>()
  const yPoints = new Set<number>()

  for (const room of allRooms) {
    xPoints.add(round2(room.x))
    xPoints.add(round2(room.x + room.width))
    yPoints.add(round2(room.y))
    yPoints.add(round2(room.y + room.depth))
  }

  // Lantai di ATAS lantai ini (urut level) — penentu kanopi carport.
  const sortedFloors = layout.floors.slice().sort((a, b) => a.level - b.level)
  const floorIdx = sortedFloors.findIndex((f) => f.id === floorId)
  const floorAbove = floorIdx >= 0 ? sortedFloors[floorIdx + 1] : undefined

  for (const room of rooms) {
    const x0 = round2(room.x)
    const y0 = round2(room.y)
    const x1 = round2(room.x + room.width)
    const y1 = round2(room.y + room.depth)
    const others = allRooms.filter((o) => o.id !== room.id)

    pushRect(lines, x0, y0, x1, y1, "outline")
    labels.push({
      x: round2(room.x + room.width / 2),
      y: round2(room.y + room.depth / 2),
      text: room.name,
      kind: "room",
    })

    // TANGGA: tread lines tegak lurus arah run + panah NAIK. Arah &
    // pembagian anak identik dgn prim `stair-` (default sisi terpanjang).
    if (room.type === "tangga" && interiorStairLayout(room, stairRiseM(lsElev, room.floorId)).shape !== "lurus") {
      // ── L/U: tread per run, penomoran menerus, label BORDES, panah NAIK
      // hanya di run pertama (bordes memutus garis jalan).
      const stairLayout = interiorStairLayout(room, stairRiseM(lsElev, room.floorId))
      for (const seg of stairLayout.segments) {
        const sx0 = round2(seg.x)
        const sy0 = round2(seg.y)
        const sx1 = round2(seg.x + seg.width)
        const sy1 = round2(seg.y + seg.depth)
        if (seg.kind === "landing") {
          pushRect(lines, sx0, sy0, sx1, sy1, "outline")
          labels.push({
            x: round2(seg.x + seg.width / 2),
            y: round2(seg.y + seg.depth / 2),
            text: "BORDES",
            kind: "room",
            refId: room.id,
          })
          continue
        }
        const segHorizontal = seg.dir === "w" || seg.dir === "e"
        const tread = seg.treadM!
        for (let k = 1; k < seg.steps!; k++) {
          if (segHorizontal) {
            const xk = round2(seg.dir === "e" ? seg.x + k * tread : seg.x + seg.width - k * tread)
            lines.push({ x1: xk, y1: sy0, x2: xk, y2: sy1, kind: "outline", refId: room.id })
          } else {
            const yk = round2(seg.dir === "s" ? seg.y + k * tread : seg.y + seg.depth - k * tread)
            lines.push({ x1: sx0, y1: yk, x2: sx1, y2: yk, kind: "outline", refId: room.id })
          }
        }
        // Penomoran menerus — pola sama dgn lurus, offset 25% lebar jalur.
        const uSeg = sideVec(seg.dir)
        const perpSeg = { x: -uSeg.y, y: uSeg.x }
        const laneW = segHorizontal ? seg.depth : seg.width
        for (let k = 0; k < seg.steps!; k++) {
          const along = (k + 0.5) * tread
          const bx = seg.dir === "e" ? seg.x + along : seg.dir === "w" ? seg.x + seg.width - along : seg.x + seg.width / 2
          const by = seg.dir === "s" ? seg.y + along : seg.dir === "n" ? seg.y + seg.depth - along : seg.y + seg.depth / 2
          labels.push({
            x: round2(bx + perpSeg.x * laneW * 0.25),
            y: round2(by + perpSeg.y * laneW * 0.25),
            text: String(seg.firstStepNo! + k),
            kind: "room",
            refId: room.id,
          })
        }
      }
      // Panah NAIK di run pertama.
      const first = stairLayout.segments[0]
      const uF = sideVec(first.dir)
      const fLen = first.runLenM!
      const fcx = first.x + first.width / 2
      const fcy = first.y + first.depth / 2
      const fHalf = fLen / 2 - Math.min(ARROW_MARGIN_M, fLen / 4)
      const ftx = round2(fcx + uF.x * fHalf)
      const fty = round2(fcy + uF.y * fHalf)
      lines.push({ x1: round2(fcx - uF.x * fHalf), y1: round2(fcy - uF.y * fHalf), x2: ftx, y2: fty, kind: "opening", refId: room.id })
      const perpF = { x: -uF.y, y: uF.x }
      for (const s of [-1, 1]) {
        lines.push({
          x1: ftx,
          y1: fty,
          x2: round2(ftx - uF.x * ARROW_HEAD_M + s * perpF.x * ARROW_HEAD_HALF_M),
          y2: round2(fty - uF.y * ARROW_HEAD_M + s * perpF.y * ARROW_HEAD_HALF_M),
          kind: "opening",
          refId: room.id,
        })
      }
      labels.push({
        x: round2(ftx - uF.x * NAIK_PULLBACK_M),
        y: round2(fty - uF.y * NAIK_PULLBACK_M),
        text: "NAIK",
        kind: "room",
        refId: room.id,
      })
    } else if (room.type === "tangga") {
      const spec = interiorStairSpec(room, stairRiseM(lsElev, room.floorId))
      const { dir, horizontalRun, runLenM: runLen, steps } = spec
      const treadD = spec.treadM
      for (let k = 1; k < steps; k++) {
        if (horizontalRun) {
          const x = round2(room.x + k * treadD)
          lines.push({ x1: x, y1: y0, x2: x, y2: y1, kind: "outline" })
        } else {
          const y = round2(room.y + k * treadD)
          lines.push({ x1: x0, y1: y, x2: x1, y2: y, kind: "outline" })
        }
      }

      // Penomoran anak tangga 1..N di as run, sedikit menepi agar tidak
      // menabrak panah NAIK (offset 25% lebar dari tepi).
      const uN = sideVec(dir)
      const perpN = { x: -uN.y, y: uN.x }
      const stairWidth = horizontalRun ? room.depth : room.width
      const offEdge = stairWidth * 0.25
      for (let k = 0; k < steps; k++) {
        const along = (k + 0.5) * treadD
        const bx = dir === "e" ? room.x + along : dir === "w" ? room.x + room.width - along : room.x + room.width / 2
        const by = dir === "s" ? room.y + along : dir === "n" ? room.y + room.depth - along : room.y + room.depth / 2
        labels.push({
          x: round2(bx + perpN.x * offEdge),
          y: round2(by + perpN.y * offEdge),
          text: String(k + 1),
          kind: "room",
          refId: room.id,
        })
      }

      // Panah arah NAIK di as run: batang + 2 garis kepala, kind "opening".
      const u = sideVec(dir)
      const cxm = room.x + room.width / 2
      const cym = room.y + room.depth / 2
      const margin = Math.min(ARROW_MARGIN_M, runLen / 4)
      const half = runLen / 2 - margin
      const sx = round2(cxm - u.x * half)
      const sy = round2(cym - u.y * half)
      const tx = round2(cxm + u.x * half)
      const ty = round2(cym + u.y * half)
      lines.push({ x1: sx, y1: sy, x2: tx, y2: ty, kind: "opening" })
      const perp = { x: -u.y, y: u.x }
      for (const s of [-1, 1]) {
        lines.push({
          x1: tx,
          y1: ty,
          x2: round2(tx - u.x * ARROW_HEAD_M + s * perp.x * ARROW_HEAD_HALF_M),
          y2: round2(ty - u.y * ARROW_HEAD_M + s * perp.y * ARROW_HEAD_HALF_M),
          kind: "opening",
        })
      }
      labels.push({
        x: round2(tx - u.x * NAIK_PULLBACK_M),
        y: round2(ty - u.y * NAIK_PULLBACK_M),
        text: "NAIK",
        kind: "room",
      })
    }

    // RAILING BALKON: garis ganda tipis pada sisi TERBUKA saja — sisi dgn
    // tetangga balkon lain (railing menerus), ruang berdinding TAK sezona,
    // atau ruang berdinding sezona (dinding di-drop, tapi tetap dapat
    // railing) — aturan yang sama dgn prim `railg-` di build-model
    // (`hazardOpenSides`, satu sumber kebenaran dipakai keduanya).
    if (room.type === "balkon") {
      for (const side of hazardOpenSides(room, others)) {
        const out = sideVec(side)
        if (side === "n" || side === "s") {
          const yEdge = side === "n" ? y0 : y1
          const yIn = round2(yEdge - out.y * RAIL_OFFSET_M)
          lines.push({ x1: x0, y1: yEdge, x2: x1, y2: yEdge, kind: "opening" })
          lines.push({ x1: x0, y1: yIn, x2: x1, y2: yIn, kind: "opening" })
        } else {
          const xEdge = side === "w" ? x0 : x1
          const xIn = round2(xEdge - out.x * RAIL_OFFSET_M)
          lines.push({ x1: xEdge, y1: y0, x2: xEdge, y2: y1, kind: "opening" })
          lines.push({ x1: xIn, y1: y0, x2: xIn, y2: y1, kind: "opening" })
        }
      }
    }

    // KANOPI CARPORT: outline dashed (kind "opening") footprint + overhang
    // dan kotak tiang di sudut TERBUKA — skip total bila ruang lantai atas
    // menutupi footprint (lantai itu sudah jadi atapnya), sama dgn
    // prim `cpr-`/`cpp-`.
    if (room.type === "carport") {
      const coveredAbove =
        !!floorAbove &&
        layout.rooms.some((r) => r.floorId === floorAbove.id && rectsOverlap(r, room))
      if (!coveredAbove && room.carportCanopyMode !== "none") {
        pushRect(
          lines,
          round2(x0 - CANOPY_OVERHANG_M),
          round2(y0 - CANOPY_OVERHANG_M),
          round2(x1 + CANOPY_OVERHANG_M),
          round2(y1 + CANOPY_OVERHANG_M),
          "opening"
        )
        const walled = (s: Side) => {
          const nb = roomsAdjacentOnSide(room, s, others)
          return !!nb && !OPEN_TYPES.includes(nb.type)
        }
        const sideWalled = { n: walled("n"), s: walled("s"), w: walled("w"), e: walled("e") }
        const corners: Array<{ x: number; y: number; skip: boolean }> = [
          { x: room.x + POST_INSET_M, y: room.y + POST_INSET_M, skip: sideWalled.n || sideWalled.w },
          { x: room.x + room.width - POST_INSET_M, y: room.y + POST_INSET_M, skip: sideWalled.n || sideWalled.e },
          { x: room.x + POST_INSET_M, y: room.y + room.depth - POST_INSET_M, skip: sideWalled.s || sideWalled.w },
          { x: room.x + room.width - POST_INSET_M, y: room.y + room.depth - POST_INSET_M, skip: sideWalled.s || sideWalled.e },
        ]
        const half = POST_SIZE_M / 2
        for (const c of corners) {
          if (c.skip) continue
          pushRect(
            lines,
            round2(c.x - half),
            round2(c.y - half),
            round2(c.x + half),
            round2(c.y + half),
            "cut"
          )
        }
        labels.push({
          x: round2(room.x + room.width / 2),
          y: round2(room.y + 0.3),
          text: "KANOPI",
          kind: "room",
        })
      }
    }
  }

  // Segmen bukaan (pintu/jendela) — sama dgn kusen-plan, tanpa kode kusen.
  for (const op of layout.openings.filter((o) => o.floorId === floorId)) {
    const parsed = parseOpeningWall(op.wallId)
    if (!parsed) continue
    const room = rooms.find((r) => r.id === parsed.roomId)
    if (!room) continue
    const seg = openingSegment(room, parsed.side, op.positionM, op.widthM)
    lines.push({
      x1: round2(seg.x1),
      y1: round2(seg.y1),
      x2: round2(seg.x2),
      y2: round2(seg.y2),
      kind: "opening",
    })
  }

  // LOUVER BAND: garis band PROUD 0,15 di sisi LUAR dinding host — proyeksi
  // plan dari prim `louv-` (standoff keluar muka dinding).
  for (const fe of (layout.facadeElements ?? []).filter((f) => f.floorId === floorId)) {
    const parsed = parseOpeningWall(fe.wallId)
    if (!parsed) continue
    const host = allRooms.find((r) => r.id === parsed.roomId)
    if (!host) continue
    const seg = openingSegment(host, parsed.side, fe.positionM, fe.widthM)
    const out = sideVec(parsed.side)
    lines.push({
      x1: round2(seg.x1 + out.x * LOUVER_PROUD_M),
      y1: round2(seg.y1 + out.y * LOUVER_PROUD_M),
      x2: round2(seg.x2 + out.x * LOUVER_PROUD_M),
      y2: round2(seg.y2 + out.y * LOUVER_PROUD_M),
      kind: "opening",
    })
  }

  const exterior = projectExteriorPlan(layout.exteriorElements ?? [], floorId)
  lines.push(...exterior.lines)
  labels.push(...exterior.labels)

  const widthM = round2(Math.max(
    exterior.maxX,
    allRooms.reduce((m, r) => Math.max(m, r.x + r.width), 0),
  ))
  const heightM = round2(Math.max(
    exterior.maxY,
    allRooms.reduce((m, r) => Math.max(m, r.y + r.depth), 0),
  ))

  const dims: DimChain[] = [
    { axis: "x", at: -0.8, points: Array.from(xPoints).sort((a, b) => a - b) },
    { axis: "y", at: -0.8, points: Array.from(yPoints).sort((a, b) => a - b) },
  ]

  return {
    widthM,
    heightM,
    lines,
    labels,
    dims,
    levels: [],
    title: `Denah — ${floor ? floor.name : floorId}`,
  }
}
