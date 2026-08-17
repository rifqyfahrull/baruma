/**
 * Pure projection of a `DesignLayout` into a `Drawing` for the "Rencana
 * Kusen" plan (top-view denah, one sheet per floor, with kusen code
 * labels at each door/window). No DOM, no three.js — safe to unit test
 * and reuse from SVG/PDF renderers. Mirrors elevation.ts/section.ts's
 * module style.
 *
 * Plan-view convention (pinned — see
 * docs/superpowers/plans/2026-07-03-sp2-rencana-kusen.md Task 2): this is
 * a top-view denah, so plan x/y are used DIRECTLY as drawing coords — no
 * y-flip here, that's the renderer's job (same convention the other
 * builders use for their own axes). Rooms of `type === "void"` are
 * excluded entirely: no outline, no name label, and they don't
 * contribute to the dim chains or the bounding box.
 *
 * A kusen code label sits at the opening segment's midpoint, offset
 * `INSET_M` toward the room interior. The offset direction is derived
 * from the wall side (see `roomsAdjacentOnSide`/build-model.ts): side "n"
 * is the room's `y = room.y` edge, so the interior is at larger y (+y);
 * "s" is `y = room.y + depth`, interior at smaller y (-y); "w" is
 * `x = room.x`, interior at larger x (+x); "e" is `x = room.x + width`,
 * interior at smaller x (-x).
 *
 * The void filter is scoped to outlines + room-name labels only (mirrors
 * elevation.ts/section.ts's precedent of computing totals from ALL
 * rooms): widthM/heightM and the x/y DimChains are derived from every
 * room on the floor, void included, so the sheet's bounding box always
 * covers the full footprint.
 */
import type { DesignLayout } from "@/types"
import { round2, openingSegment, parseOpeningWall, type Side } from "@/lib/geometry"
import { kusenCodeByOpeningId } from "./kusen"
import type { Drawing, DrawLine, DrawLabel, DimChain } from "./types"

const INSET_M = 0.25

/** Offset applied to an opening segment's midpoint, toward the room interior. */
function insetForSide(side: Side): { dx: number; dy: number } {
  switch (side) {
    case "n":
      return { dx: 0, dy: INSET_M }
    case "s":
      return { dx: 0, dy: -INSET_M }
    case "w":
      return { dx: INSET_M, dy: 0 }
    case "e":
    default:
      return { dx: -INSET_M, dy: 0 }
  }
}

export function buildKusenPlan(layout: DesignLayout, floorId: string): Drawing {
  const floor = layout.floors.find((f) => f.id === floorId)
  const allRooms = layout.rooms.filter((r) => r.floorId === floorId)
  const rooms = allRooms.filter((r) => r.type !== "void")
  const codeByOpeningId = kusenCodeByOpeningId(layout)

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

  for (const room of rooms) {
    const x0 = round2(room.x)
    const y0 = round2(room.y)
    const x1 = round2(room.x + room.width)
    const y1 = round2(room.y + room.depth)

    lines.push({ x1: x0, y1: y0, x2: x1, y2: y0, kind: "outline" })
    lines.push({ x1: x1, y1: y0, x2: x1, y2: y1, kind: "outline" })
    lines.push({ x1: x1, y1: y1, x2: x0, y2: y1, kind: "outline" })
    lines.push({ x1: x0, y1: y1, x2: x0, y2: y0, kind: "outline" })

    labels.push({
      x: round2(room.x + room.width / 2),
      y: round2(room.y + room.depth / 2),
      text: room.name,
      kind: "room",
    })
  }

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

    const code = codeByOpeningId.get(op.id)
    if (!code) continue
    const { dx, dy } = insetForSide(parsed.side)
    labels.push({
      x: round2((seg.x1 + seg.x2) / 2 + dx),
      y: round2((seg.y1 + seg.y2) / 2 + dy),
      text: code,
      kind: "room",
    })
  }

  const widthM = round2(allRooms.reduce((m, r) => Math.max(m, r.x + r.width), 0))
  const heightM = round2(allRooms.reduce((m, r) => Math.max(m, r.y + r.depth), 0))

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
    title: `Rencana Kusen — ${floor ? floor.name : floorId}`,
  }
}
