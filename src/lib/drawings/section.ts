/**
 * Pure projection of a `DesignLayout` into a `Drawing` (potongan / section
 * cut). No DOM, no three.js — safe to unit test and reuse from SVG/PDF
 * renderers. Mirrors elevation.ts's structure and constants; see
 * docs/superpowers/plans/2026-07-03-sp1-tampak-potongan.md for the pinned
 * conventions.
 *
 * Projection conventions (pinned):
 *   axis "x" cut (plane ⊥ x at positionM): h = y. A room is cut when
 *   `room.x ≤ positionM ≤ room.x+width`. Openings on n/s walls (which run
 *   along x) intersect the plane when their x-span (via `openingSegment`)
 *   contains `positionM`.
 *   axis "y" cut (plane ⊥ y at positionM): h = x (analog: w/e walls, room.y
 *   span test).
 */
import type { DesignLayout, Room } from "@/types"
import { round2, openingSegment, parseOpeningWall, type Side } from "@/lib/geometry"
import { floorElevations, stairRiseM } from "@/lib/geometry/vertical"
import { formatElevation } from "@/lib/format"
import { OPEN_TYPES, SLAB_T, WALL_H } from "@/lib/three/build-model"
import { interiorStairLayout, stairProfilePoints } from "@/lib/stairs/geometry"
import { buildingFootprint } from "@/lib/structural/grid"
import { floorOffset } from "@/lib/editor/floors"
import { clampRooftopArea, isPartialRooftop } from "@/lib/geometry/rooftop"
import { hasExplicitRoofZones, type EffectiveRoofZone } from "@/lib/exterior/roof-zones"
import { WINDOW_SILL_M, DRAW_SLAB_M, buildPartialRoof, buildRoofZoneProfiles, effectiveRoof, roofProfile } from "./elevation"
import type { Drawing, DrawLine, DrawLabel, LevelMark, DimChain } from "./types"

export type SectionCut = { axis: "x" | "y"; positionM: number }

const ROOFTOP_FLOOR_ID = "floor-rooftop"
/** Half-thickness (m) drawn for an opening rect sitting ON a cut wall line. */
const OPENING_CUT_THICKNESS_M = 0.06
/** Tolerance for the half-open roof-piece boundary test (float robustness). */
const SECTION_TOL = 1e-6

const TITLES: Record<SectionCut["axis"], string> = {
  x: "Potongan A-A",
  y: "Potongan B-B",
}

function isOpenRoom(room: Room): boolean {
  return OPEN_TYPES.includes(room.type)
}

/** Ascending [hStart, hEnd] for a room's footprint on the cut's h-axis. */
function roomHBounds(room: Room, axis: SectionCut["axis"]): [number, number] {
  return axis === "x"
    ? [round2(room.y), round2(room.y + room.depth)]
    : [round2(room.x), round2(room.x + room.width)]
}

/** Does the cutting plane at `positionM` pass through `room`'s footprint? */
function isCutRoom(room: Room, axis: SectionCut["axis"], positionM: number): boolean {
  return axis === "x"
    ? room.x <= positionM && positionM <= room.x + room.width
    : room.y <= positionM && positionM <= room.y + room.depth
}

export function buildSection(layout: DesignLayout, cut: SectionCut): Drawing {
  const { axis, positionM } = cut
  const roof = effectiveRoof(layout)
  const partial = isPartialRooftop(layout)
  const explicitRoofZones = hasExplicitRoofZones(layout)

  // Mezzanine BUKAN lantai penuh — dikeluarkan dari tumpukan reguler dan
  // digambar sebagai band slab platform tersendiri (pass di bawah).
  const regularFloors = layout.floors
    .filter((f) => f.id !== ROOFTOP_FLOOR_ID && f.kind !== "mezzanine")
    .slice()
    .sort((a, b) => a.level - b.level)
  const rooftopFloor = layout.floors.find((f) => f.id === ROOFTOP_FLOOR_ID) ?? null

  const nonRooftopRooms = layout.rooms.filter((r) => r.floorId !== ROOFTOP_FLOOR_ID)
  const totalW = round2(nonRooftopRooms.reduce((m, r) => Math.max(m, r.x + r.width), 0))
  const totalD = round2(nonRooftopRooms.reduce((m, r) => Math.max(m, r.y + r.depth), 0))
  const drawingWidth = axis === "x" ? totalD : totalW

  const lines: DrawLine[] = []
  const labels: DrawLabel[] = []
  const levels: LevelMark[] = []
  const levelYs = new Set<number>()
  const hDimPoints = new Set<number>()

  // Fase D: prefix-sum lokal diganti TABEL ELEVASI bersama (nilai identik —
  // keduanya membaca Floor.heightM) supaya 3D & gambar kerja satu sumber.
  const elevTable = floorElevations(layout.floors)
  const baseYByFloor = new Map<string, number>()
  let totalRegularHeight = 0
  for (const floor of regularFloors) {
    const e = elevTable.get(floor.id)
    baseYByFloor.set(floor.id, e?.baseY ?? totalRegularHeight)
    totalRegularHeight = (e?.baseY ?? totalRegularHeight) + (e?.floorToFloorM ?? floor.heightM)
  }

  const rooftopRooms = rooftopFloor ? layout.rooms.filter((r) => r.floorId === ROOFTOP_FLOOR_ID) : []
  const rooftopSolids = rooftopRooms.filter((r) => !isOpenRoom(r))
  const hasRooftopBlock = !!rooftopFloor && rooftopSolids.length > 0
  const peakY = hasRooftopBlock ? totalRegularHeight + rooftopFloor!.heightM : totalRegularHeight

  function addLevel(y: number) {
    const ry = round2(y)
    if (levelYs.has(ry)) return
    levelYs.add(ry)
    levels.push({ y: ry, label: formatElevation(ry, "m") })
  }

  /** Draws one floor's cut geometry (slabs/walls/openings for cut rooms). */
  function drawFloor(floorId: string, baseY: number, heightM: number, isTrueTop: boolean) {
    addLevel(baseY)

    // Cantilever (CB4): geser massa lantai ber-offset pada koordinat site
    // sebelum uji potong & proyeksi ke sumbu H. Potongan sumbu "x" → H=y →
    // pakai dy; sumbu "y" → H=x → pakai dx (roomHBounds). Komponen tegak-lurus
    // (dx utk axis x, dy utk axis y) menggeser posisi bidang potong menembus
    // ruang — konsisten dengan massa yang menjorok di 3D. Lantai tanpa offset →
    // objek ruang identik (output byte-identik pra-fitur).
    const thisFloor = layout.floors.find((f) => f.id === floorId)
    const o = floorOffset(thisFloor)
    const rawRooms = layout.rooms.filter((r) => r.floorId === floorId)
    const rooms =
      o.dx === 0 && o.dy === 0
        ? rawRooms
        : rawRooms.map((r) => ({ ...r, x: r.x + o.dx, y: r.y + o.dy }))
    const cutRooms = rooms.filter((r) => isCutRoom(r, axis, positionM))
    const wallSides: Side[] = axis === "x" ? ["n", "s"] : ["w", "e"]

    for (const room of cutRooms) {
      const [h0, h1] = roomHBounds(room, axis)
      const off = room.levelOffsetM ?? 0
      const bottomY = round2(baseY + off)
      const topY = round2(baseY + heightM)
      hDimPoints.add(h0)
      hDimPoints.add(h1)

      lines.push({ x1: h0, y1: bottomY, x2: h1, y2: bottomY, kind: "slab" })
      lines.push({ x1: h0, y1: topY, x2: h1, y2: topY, kind: "slab" })
      // The flat roof-slab line only exists for a datar roof; a sloped roof
      // replaces it with the profile drawn after the floors loop.
      if (isTrueTop && roof.type === "datar" && !explicitRoofZones) {
        const roofY = round2(topY + DRAW_SLAB_M)
        lines.push({ x1: h0, y1: roofY, x2: h1, y2: roofY, kind: "slab" })
      }

      if (isOpenRoom(room)) continue

      lines.push({ x1: h0, y1: bottomY, x2: h0, y2: topY, kind: "cut" })
      lines.push({ x1: h1, y1: bottomY, x2: h1, y2: topY, kind: "cut" })
      labels.push({
        x: round2((h0 + h1) / 2),
        y: round2((bottomY + topY) / 2),
        text: room.name,
        kind: "room",
      })

      for (const op of layout.openings.filter((o) => o.floorId === floorId)) {
        const parsed = parseOpeningWall(op.wallId)
        if (!parsed || parsed.roomId !== room.id || !wallSides.includes(parsed.side)) continue

        const seg = openingSegment(room, parsed.side, op.positionM, op.widthM)
        const within = axis === "x" ? positionM >= seg.x1 && positionM <= seg.x2 : positionM >= seg.y1 && positionM <= seg.y2
        if (!within) continue

        const hWall = axis === "x" ? round2(seg.y1) : round2(seg.x1)
        const sill = op.type === "door" ? 0 : WINDOW_SILL_M
        const yBottom = round2(baseY + off + sill)
        const yTop = round2(yBottom + op.heightM)
        const ha = round2(hWall - OPENING_CUT_THICKNESS_M)
        const hb = round2(hWall + OPENING_CUT_THICKNESS_M)

        // TODO(bukaan-lengkung): op.archShape ("arch"/"capsule") digambar
        // rect persegi biasa di sini — potongan 2D belum mengikuti siluet
        // lengkung (di luar scope; 3D sudah, lihat build-model.ts).
        // TODO(bukaan-trapesium): op.topSlopeM (tepi atas miring) juga masih
        // digambar rect persegi biasa di sini — sama alasan (di luar scope;
        // 3D sudah, lihat topSlopeCornerFillPrims di build-model.ts).
        lines.push({ x1: ha, y1: yBottom, x2: hb, y2: yBottom, kind: "opening" })
        lines.push({ x1: ha, y1: yTop, x2: hb, y2: yTop, kind: "opening" })
        lines.push({ x1: ha, y1: yBottom, x2: ha, y2: yTop, kind: "opening" })
        lines.push({ x1: hb, y1: yBottom, x2: hb, y2: yTop, kind: "opening" })
      }

      // Profil tangga per SEGMEN (lurus = 1 run; L/U = run + bordes + run).
      // Run digambar zig-zag hanya bila arahnya SEJAJAR bidang gambar
      // (axis "x" → h=y → run n/s; axis "y" → h=x → run w/e); bordes = garis
      // datar di elevasinya. Segmen hanya digambar bila bidang menembusnya.
      if (room.type === "tangga") {
        const stairLayout = interiorStairLayout(room, stairRiseM(elevTable, room.floorId))
        let drewAny = false
        for (const seg of stairLayout.segments) {
          const inCut = axis === "x"
            ? seg.x <= positionM && positionM <= seg.x + seg.width
            : seg.y <= positionM && positionM <= seg.y + seg.depth
          if (!inCut) continue
          const [sh0, sh1] = axis === "x"
            ? [round2(seg.y), round2(seg.y + seg.depth)]
            : [round2(seg.x), round2(seg.x + seg.width)]
          if (seg.kind === "landing") {
            lines.push({
              x1: sh0, y1: round2(baseY + off + seg.elevStartM),
              x2: sh1, y2: round2(baseY + off + seg.elevStartM),
              kind: "cut", refId: room.id,
            })
            drewAny = true
            continue
          }
          const segHorizontal = seg.dir === "w" || seg.dir === "e"
          const runParallel = axis === "x" ? !segHorizontal : segHorizontal
          if (!runParallel) continue
          const ascending = seg.dir === "s" || seg.dir === "e"
          const segRise = seg.elevEndM - seg.elevStartM
          const segSpec = {
            dir: seg.dir,
            horizontalRun: segHorizontal,
            runLenM: seg.runLenM!,
            widthM: 0,
            totalRiseM: segRise,
            steps: seg.steps!,
            riserM: segRise / seg.steps!,
            treadM: seg.treadM!,
          }
          const pts = stairProfilePoints(segSpec, ascending ? sh0 : sh1, baseY + off + seg.elevStartM, ascending)
          for (let i = 0; i < pts.length - 1; i++) {
            lines.push({
              x1: round2(pts[i].h), y1: round2(pts[i].y),
              x2: round2(pts[i + 1].h), y2: round2(pts[i + 1].y),
              kind: "cut", refId: room.id,
            })
          }
          drewAny = true
        }
        if (drewAny) {
          labels.push({
            x: round2((h0 + h1) / 2),
            y: round2(baseY + off + (stairLayout.riserM * stairLayout.totalSteps) / 2),
            text: `TANGGA ${stairLayout.totalSteps} anak · R ${Math.round(stairLayout.riserM * 100)} cm`,
            kind: "room", refId: room.id,
          })
        }
      }
    }
  }

  regularFloors.forEach((floor, idx) => {
    const baseY = baseYByFloor.get(floor.id)!
    // A partial rooftop replaces the top floor's flat roof-slab with the deck +
    // strip pieces drawn below, so suppress the datar slab here when partial.
    const isTrueTop = idx === regularFloors.length - 1 && !hasRooftopBlock && !partial && !explicitRoofZones
    drawFloor(floor.id, baseY, floor.heightM, isTrueTop)
  })

  // MEZZANINE (E9): platform parsial — band slab (bawah+atas, tebal 0.15)
  // pada elevasinya, hanya sepanjang ruang platform yang terpotong garis cut.
  for (const mz of layout.floors) {
    if (mz.kind !== "mezzanine") continue
    const mzBase = elevTable.get(mz.id)?.baseY
    if (mzBase === undefined) continue
    // Cantilever (CB4): mezzanine ber-offset ikut tergeser (default 0 → identik).
    const mo = floorOffset(mz)
    const mzRooms = layout.rooms
      .filter((r) => r.floorId === mz.id)
      .map((r) => (mo.dx === 0 && mo.dy === 0 ? r : { ...r, x: r.x + mo.dx, y: r.y + mo.dy }))
      .filter((r) => isCutRoom(r, axis, positionM))
    for (const room of mzRooms) {
      const [h0, h1] = roomHBounds(room, axis)
      const y0 = round2(mzBase)
      const y1 = round2(mzBase + 0.15)
      lines.push({ x1: h0, y1: y0, x2: h1, y2: y0, kind: "slab" })
      lines.push({ x1: h0, y1: y1, x2: h1, y2: y1, kind: "slab" })
      labels.push({
        x: round2((h0 + h1) / 2),
        y: round2(y1 + 0.3),
        text: `${mz.name.toUpperCase()} ${formatElevation(y1, "m")}`,
        kind: "room",
      })
      addLevel(y0)
    }
  }

  if (rooftopFloor && hasRooftopBlock) {
    drawFloor(rooftopFloor.id, totalRegularHeight, rooftopFloor.heightM, true)
  }

  addLevel(peakY)

  // Sloped roof: a cut across the ridge (axis ⟂ ridge) shows the triangle
  // profile; a cut parallel to the ridge shows the long-facade profile. The
  // h axis maps to y for an axis-x cut and to x for an axis-y cut; the ridge
  // runs along the longer footprint dimension (x when totalW >= totalD).
  let sheetTopY = round2(peakY)
  if (explicitRoofZones) {
    const cutIntersectsZone = (zone: EffectiveRoofZone): boolean => {
      const minX = zone.x - zone.widthM / 2
      const maxX = zone.x + zone.widthM / 2
      const minY = zone.y - zone.depthM / 2
      const maxY = zone.y + zone.depthM / 2
      return axis === "x"
        ? minX - SECTION_TOL <= positionM && positionM < maxX - SECTION_TOL
        : minY - SECTION_TOL <= positionM && positionM < maxY - SECTION_TOL
    }
    const skillionLowAt = (zone: EffectiveRoofZone): "h0" | "h1" | "facing" => {
      const low = zone.lowSide ?? "s"
      return axis === "x"
        ? low === "n" ? "h0" : low === "s" ? "h1" : "facing"
        : low === "w" ? "h0" : low === "e" ? "h1" : "facing"
    }
    const { lines: roofLines, apexY } = buildRoofZoneProfiles(layout, {
      topYForZone: (zone) => {
        if (zone.floorId) {
          const baseY = baseYByFloor.get(zone.floorId)
          const floor = regularFloors.find((f) => f.id === zone.floorId)
          if (baseY !== undefined && floor) return round2(baseY + floor.heightM)
          if (zone.floorId === ROOFTOP_FLOOR_ID && rooftopFloor && hasRooftopBlock) {
            return round2(totalRegularHeight + rooftopFloor.heightM)
          }
        }
        return round2(peakY)
      },
      projectZone: (zone) => {
        if (!cutIntersectsZone(zone)) return { h0: 0, h1: 0, crossExtent: 0, include: false }
        const minX = zone.x - zone.widthM / 2
        const maxX = zone.x + zone.widthM / 2
        const minY = zone.y - zone.depthM / 2
        const maxY = zone.y + zone.depthM / 2
        // Gable asimetris: h section searah sumbu site (tanpa mirror) —
        // ridgeH = koordinat garis bubungan pada sumbu h.
        const ro = zone.type === "pelana" ? (zone.ridgeOffsetM ?? 0) : 0
        return axis === "x"
          ? {
              h0: round2(minY),
              h1: round2(maxY),
              crossExtent: zone.widthM,
              ...(ro ? { ridgeH: round2(zone.y + ro) } : {}),
            }
          : {
              h0: round2(minX),
              h1: round2(maxX),
              crossExtent: zone.depthM,
              ...(ro ? { ridgeH: round2(zone.x + ro) } : {}),
            }
      },
      ridgeParallelToH: (zone) => (axis === "x" ? zone.depthM > zone.widthM : zone.widthM >= zone.depthM),
      skillionLowAt,
    })
    lines.push(...roofLines)
    if (apexY > sheetTopY) {
      addLevel(apexY)
      sheetTopY = apexY
    }
  } else if (partial) {
    // Partial rooftop: the cut shows a flat deck (+ railing) where it crosses
    // the deck rect, and a strip roof profile where it crosses a strip — same
    // decomposition + rise math as the 3D and the elevations.
    const footprint = buildingFootprint(layout)
    const deck = clampRooftopArea(layout.rooftopArea!, footprint)
    const { lines: roofLines, apexY } = buildPartialRoof({
      footprint,
      deck,
      roof,
      topY: totalRegularHeight,
      projectRect: (rect) =>
        axis === "x"
          ? { h0: round2(rect.y), h1: round2(rect.y + rect.depth), crossExtent: rect.width }
          : { h0: round2(rect.x), h1: round2(rect.x + rect.width), crossExtent: rect.depth },
      ridgeParallelToH: (exW, exD) => (axis === "x" ? !(exW >= exD) : exW >= exD),
      // Half-open on the far edge so a cut exactly on a shared deck/strip
      // boundary belongs to EXACTLY one piece (the piece whose near edge it is),
      // instead of satisfying both pieces' inclusive tests and double-drawing.
      includeRect: (rect) =>
        axis === "x"
          ? rect.x - SECTION_TOL <= positionM && positionM < rect.x + rect.width - SECTION_TOL
          : rect.y - SECTION_TOL <= positionM && positionM < rect.y + rect.depth - SECTION_TOL,
      // A solid room on the rooftop floor already slabs topY (FIX 3, v1).
      suppressDeckSlab: hasRooftopBlock,
    })
    lines.push(...roofLines)
    if (apexY > sheetTopY) {
      addLevel(apexY)
      sheetTopY = apexY
    }
  } else if (roof.type !== "datar") {
    const ridgeAlongX = totalW >= totalD
    // Skillion pada potongan: axis "x" → h = y (utara di h0); axis "y" → h = x
    // (barat di h0). Kemiringan tegak lurus bidang potong → "facing" (persegi).
    const low = roof.lowSide ?? "s"
    const skillionLowAt: "h0" | "h1" | "facing" =
      axis === "x"
        ? low === "n" ? "h0" : low === "s" ? "h1" : "facing"
        : low === "w" ? "h0" : low === "e" ? "h1" : "facing"
    const secHExtent = axis === "x" ? totalD : totalW
    const secRo = roof.type === "pelana" ? (roof.ridgeOffsetM ?? 0) : 0
    const { lines: roofLines, apexY } = roofProfile({
      roof,
      hExtent: secHExtent,
      crossExtent: axis === "x" ? totalW : totalD,
      ridgeParallelToH: axis === "x" ? !ridgeAlongX : ridgeAlongX,
      topY: peakY,
      skillionLowAt,
      // Section h searah sumbu site — offset bubungan tanpa mirror.
      ...(secRo ? { apexH: secHExtent / 2 + secRo } : {}),
    })
    lines.push(...roofLines)
    addLevel(apexY)
    sheetTopY = apexY
  }

  const dims: DimChain[] = [
    { axis: "y", at: -0.8, points: Array.from(levelYs).sort((a, b) => a - b) },
    { axis: "x", at: -0.8, points: Array.from(hDimPoints).sort((a, b) => a - b) },
  ]

  return {
    widthM: drawingWidth,
    heightM: sheetTopY,
    lines,
    labels,
    dims,
    levels,
    title: TITLES[axis],
  }
}
