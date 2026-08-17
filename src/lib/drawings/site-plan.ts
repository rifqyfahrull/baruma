import type { DesignLayout, Site } from "@/types"
import { exteriorElementBoundingBox, round2 } from "@/lib/exterior/geometry"
import { projectExteriorPlan } from "@/lib/exterior/projection"
import { isOutdoorRoom } from "@/lib/geometry/connectivity"
import { rectUnionPolygon } from "@/lib/geometry/union"
import type { Drawing, DrawLabel, DrawLine } from "./types"

const ROOFTOP_FLOOR_ID = "floor-rooftop"

function rectLines(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  kind: DrawLine["kind"],
  refId?: string,
): DrawLine[] {
  return [
    { x1: minX, y1: minY, x2: maxX, y2: minY, kind, refId },
    { x1: maxX, y1: minY, x2: maxX, y2: maxY, kind, refId },
    { x1: maxX, y1: maxY, x2: minX, y2: maxY, kind, refId },
    { x1: minX, y1: maxY, x2: minX, y2: minY, kind, refId },
  ]
}

function firstRegularFloorId(layout: DesignLayout): string {
  return layout.floors
    .filter((floor) => floor.id !== ROOFTOP_FLOOR_ID)
    .slice()
    .sort((a, b) => a.level - b.level)[0]?.id ?? layout.floors[0]?.id ?? "floor-1"
}

function derivedSiteBounds(layout: DesignLayout, site?: Pick<Site, "widthM" | "depthM">) {
  const exteriorBounds = (layout.exteriorElements ?? [])
    .filter((element) => !element.hidden)
    .map(exteriorElementBoundingBox)
  const maxRoomX = layout.rooms.reduce((max, room) => Math.max(max, room.x + room.width), 0)
  const maxRoomY = layout.rooms.reduce((max, room) => Math.max(max, room.y + room.depth), 0)
  return {
    widthM: round2(Math.max(site?.widthM ?? 0, maxRoomX, ...exteriorBounds.map((bounds) => bounds.maxX), 1)),
    depthM: round2(Math.max(site?.depthM ?? 0, maxRoomY, ...exteriorBounds.map((bounds) => bounds.maxY), 1)),
  }
}

export function buildSitePlan(
  layout: DesignLayout,
  site?: Pick<Site, "widthM" | "depthM">,
): Drawing {
  const floorId = firstRegularFloorId(layout)
  const bounds = derivedSiteBounds(layout, site)
  const lines: DrawLine[] = [
    ...rectLines(0, 0, bounds.widthM, bounds.depthM, "ground", "site-boundary"),
  ]
  const labels: DrawLabel[] = [
    {
      x: round2(bounds.widthM / 2),
      y: round2(bounds.depthM + 0.35),
      text: "BATAS TAPAK",
      kind: "title" as const,
      refId: "site-boundary",
    },
  ]

  // Building footprint from union of rooms on this floor. Ruang terbuka
  // (carport, taman, kolam, balkon, rooftop_lounge, void) dikecualikan agar
  // outline "BANGUNAN" tidak melebar ke area yang memang tidak berdinding —
  // konsisten dengan 3D (`build-model.ts`) dan elevasi/potongan.
  const roomsOnFloor = layout.rooms.filter((room) => room.floorId === floorId)
  const walledRoomsOnFloor = roomsOnFloor.filter((room) => !isOutdoorRoom(room))
  if (walledRoomsOnFloor.length > 0) {
    const roomRects = walledRoomsOnFloor.map((r) => ({ x: r.x, y: r.y, width: r.width, depth: r.depth }))
    const unionPoints = rectUnionPolygon(roomRects)
    if (unionPoints.length > 1) {
      for (let i = 0; i < unionPoints.length - 1; i++) {
        const p1 = unionPoints[i]
        const p2 = unionPoints[i + 1]
        lines.push({
          x1: round2(p1.x),
          y1: round2(p1.y),
          x2: round2(p2.x),
          y2: round2(p2.y),
          kind: "outline",
          refId: "building-footprint",
        })
      }
      const cx = unionPoints.reduce((s, p) => s + p.x, 0) / unionPoints.length
      const cy = unionPoints.reduce((s, p) => s + p.y, 0) / unionPoints.length
      labels.push({
        x: round2(cx),
        y: round2(cy - 0.5),
        text: "BANGUNAN",
        kind: "title" as const,
        refId: "building-footprint",
      })
    }
  }

  for (const room of layout.rooms.filter((room) => room.floorId === floorId)) {
    lines.push(
      ...rectLines(
        round2(room.x),
        round2(room.y),
        round2(room.x + room.width),
        round2(room.y + room.depth),
        room.type === "carport" || room.type === "taman" ? "opening" : "outline",
        room.id,
      ),
    )
  }

  const exterior = projectExteriorPlan(layout.exteriorElements ?? [], floorId)
  lines.push(...exterior.lines)
  labels.push(...exterior.labels)

  return {
    widthM: bounds.widthM,
    heightM: bounds.depthM,
    lines,
    labels,
    dims: [
      { axis: "x", at: -0.8, points: [0, bounds.widthM] },
      { axis: "y", at: -0.8, points: [0, bounds.depthM] },
    ],
    levels: [],
    title: "Rencana Tapak",
  }
}
