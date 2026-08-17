import { findFreeRect, rectsOverlap, roomArea, round2, type Rect } from "@/lib/geometry"
import type { FloorplanAction, FloorplanScene } from "./actions"
import {
  axisOverlapLength,
  canMoveRoom,
  groundSanitationRooms,
  openGroundPockets,
  otherSanitationObstacles,
  roomMovePriority,
  roomRect,
  roomsTouchingPocketSide,
  sanitationObstaclesForFloor,
  sanitationRoomObstacles,
  type PocketSide,
  type SceneRoom,
} from "./spatial-analysis"

export type DesignStrategyProposal = {
  strategyId: string
  title: string
  confidence: "high" | "medium" | "low"
  rationale: string
  actions: FloorplanAction[]
}

const SERVICE_BLOCKER_TYPES = new Set(["kamar_mandi", "laundry", "gudang", "tangga"])
const MAIN_LIVING_TYPES = new Set([
  "dapur",
  "ruang_keluarga",
  "ruang_tamu",
  "ruang_makan",
  "area_kumpul",
])
const MIN_COMPACT_SERVICE = 1.2
const MIN_USABLE_ROOM_AREA = 4

type ConnectionRelation = {
  orientation: "vertical" | "horizontal"
  first: SceneRoom
  second: SceneRoom
  band: Rect
}

function relationBetween(a: SceneRoom, b: SceneRoom): ConnectionRelation | null {
  const aRect = roomRect(a)
  const bRect = roomRect(b)
  const xOverlap = axisOverlapLength(aRect.x, aRect.x + aRect.width, bRect.x, bRect.x + bRect.width)
  const yOverlap = axisOverlapLength(aRect.y, aRect.y + aRect.depth, bRect.y, bRect.y + bRect.depth)
  const minXOverlap = Math.min(aRect.width, bRect.width) * 0.35
  const minYOverlap = Math.min(aRect.depth, bRect.depth) * 0.35

  if (xOverlap >= minXOverlap) {
    const upper = aRect.y <= bRect.y ? a : b
    const lower = upper.id === a.id ? b : a
    const gap = round2(lower.y - (upper.y + upper.depth))
    if (gap >= -0.01 && gap <= 3.2) {
      return {
        orientation: "vertical",
        first: upper,
        second: lower,
        band: {
          x: round2(Math.max(upper.x, lower.x)),
          y: round2(upper.y + upper.depth),
          width: round2(xOverlap),
          depth: round2(Math.max(0.05, gap)),
        },
      }
    }
  }

  if (yOverlap >= minYOverlap) {
    const left = aRect.x <= bRect.x ? a : b
    const right = left.id === a.id ? b : a
    const gap = round2(right.x - (left.x + left.width))
    if (gap >= -0.01 && gap <= 3.2) {
      return {
        orientation: "horizontal",
        first: left,
        second: right,
        band: {
          x: round2(left.x + left.width),
          y: round2(Math.max(left.y, right.y)),
          width: round2(Math.max(0.05, gap)),
          depth: round2(yOverlap),
        },
      }
    }
  }

  return null
}

function expandRect(rect: Rect, amount: number): Rect {
  return {
    x: round2(rect.x - amount),
    y: round2(rect.y - amount),
    width: round2(rect.width + amount * 2),
    depth: round2(rect.depth + amount * 2),
  }
}

function rectArea(rect: Rect): number {
  return round2(rect.width * rect.depth)
}

function roomWithPatch(room: SceneRoom, patch: { x?: number; y?: number; width?: number; depth?: number }): SceneRoom {
  return {
    ...room,
    ...patch,
    areaM2: round2((patch.width ?? room.width) * (patch.depth ?? room.depth)),
  }
}

function patchFromRect(
  room: SceneRoom,
  rect: Rect
): { x?: number; y?: number; width?: number; depth?: number } {
  return {
    ...(Math.abs(rect.x - room.x) > 0.01 ? { x: rect.x } : {}),
    ...(Math.abs(rect.y - room.y) > 0.01 ? { y: rect.y } : {}),
    ...(Math.abs(rect.width - room.width) > 0.01 ? { width: rect.width } : {}),
    ...(Math.abs(rect.depth - room.depth) > 0.01 ? { depth: rect.depth } : {}),
  }
}

function floorRoomsAfterPatches(
  scene: FloorplanScene,
  floorId: string,
  patches: Map<string, { x?: number; y?: number; width?: number; depth?: number }>
): SceneRoom[] {
  return scene.rooms
    .filter((room) => room.floorId === floorId)
    .map((room) => {
      const patch = patches.get(room.id)
      return patch ? roomWithPatch(room, patch) : room
    })
}

function patchesAreSpatiallyClean(
  scene: FloorplanScene,
  floorId: string,
  patches: Map<string, { x?: number; y?: number; width?: number; depth?: number }>
): boolean {
  const rooms = floorRoomsAfterPatches(scene, floorId, patches)
  const sanitation = sanitationObstaclesForFloor(scene, floorId)
  const patchedIds = new Set(patches.keys())

  for (const room of rooms) {
    if (!patchedIds.has(room.id)) continue
    if (room.width < MIN_COMPACT_SERVICE || room.depth < MIN_COMPACT_SERVICE) return false
    if (room.areaM2 < MIN_USABLE_ROOM_AREA) return false
    if (room.x < -0.01 || room.y < -0.01) return false
    if (room.x + room.width > scene.site.widthM + 0.01) return false
    if (room.y + room.depth > scene.site.depthM + 0.01) return false
    if (sanitation.some((obj) => rectsOverlap(roomRect(room), obj))) return false
  }

  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      if (!patchedIds.has(rooms[i].id) && !patchedIds.has(rooms[j].id)) continue
      if (rectsOverlap(roomRect(rooms[i]), roomRect(rooms[j]))) return false
    }
  }

  return true
}

function compactServiceBlocker(
  blocker: SceneRoom,
  relation: ConnectionRelation,
  scene: FloorplanScene
): { patch: { x?: number; y?: number; width?: number; depth?: number }; freedLabel: string } | null {
  const band = relation.band
  const blockers = scene.rooms.filter((room) => room.floorId === blocker.floorId && room.id !== blocker.id)
  const sanitation = sanitationObstaclesForFloor(scene, blocker.floorId)
  const test = (rect: Rect): boolean => {
    if (rect.width < MIN_COMPACT_SERVICE || rect.depth < MIN_COMPACT_SERVICE) return false
    if (rectArea(rect) < MIN_USABLE_ROOM_AREA) return false
    if (rect.x < -0.01 || rect.y < -0.01) return false
    if (rect.x + rect.width > scene.site.widthM + 0.01) return false
    if (rect.y + rect.depth > scene.site.depthM + 0.01) return false
    if (blockers.some((room) => rectsOverlap(rect, roomRect(room)))) return false
    if (sanitation.some((obj) => rectsOverlap(rect, obj))) return false
    return true
  }

  if (relation.orientation === "vertical") {
    const compactWidth = round2(Math.min(blocker.width, Math.max(MIN_COMPACT_SERVICE, Math.min(1.8, band.width * 0.42))))
    const currentRight = blocker.x + blocker.width
    const rightRect: Rect = {
      x: round2(currentRight - compactWidth),
      y: blocker.y,
      width: compactWidth,
      depth: blocker.depth,
    }
    const leftRect: Rect = {
      x: blocker.x,
      y: blocker.y,
      width: compactWidth,
      depth: blocker.depth,
    }
    const candidates = blocker.x + blocker.width / 2 >= band.x + band.width / 2
      ? [rightRect, leftRect]
      : [leftRect, rightRect]
    const rect = candidates.find(test)
    if (!rect) return null
    return {
      patch: {
        x: rect.x,
        width: rect.width,
        ...(Math.abs(rect.y - blocker.y) > 0.01 ? { y: rect.y } : {}),
        ...(Math.abs(rect.depth - blocker.depth) > 0.01 ? { depth: rect.depth } : {}),
      },
      freedLabel: relation.first.name + " dan " + relation.second.name,
    }
  }

  const compactDepth = round2(Math.min(blocker.depth, Math.max(MIN_COMPACT_SERVICE, Math.min(1.8, band.depth * 0.42))))
  const currentBottom = blocker.y + blocker.depth
  const bottomRect: Rect = {
    x: blocker.x,
    y: round2(currentBottom - compactDepth),
    width: blocker.width,
    depth: compactDepth,
  }
  const topRect: Rect = {
    x: blocker.x,
    y: blocker.y,
    width: blocker.width,
    depth: compactDepth,
  }
  const candidates = blocker.y + blocker.depth / 2 >= band.y + band.depth / 2
    ? [bottomRect, topRect]
    : [topRect, bottomRect]
  const rect = candidates.find(test)
  if (!rect) return null
  return {
    patch: {
      y: rect.y,
      depth: rect.depth,
      ...(Math.abs(rect.x - blocker.x) > 0.01 ? { x: rect.x } : {}),
      ...(Math.abs(rect.width - blocker.width) > 0.01 ? { width: rect.width } : {}),
    },
    freedLabel: relation.first.name + " dan " + relation.second.name,
  }
}

function repackServiceBlocker(
  blocker: SceneRoom,
  relation: ConnectionRelation,
  scene: FloorplanScene
): { actions: FloorplanAction[]; freedLabel: string } | null {
  const band = relation.band
  const candidates: {
    removedArea: number
    blockerRect: Rect
    mainPatch: { room: SceneRoom; patch: { x?: number; y?: number; width?: number; depth?: number } }
  }[] = []

  if (relation.orientation === "vertical") {
    const width = round2(Math.min(blocker.width, Math.max(MIN_COMPACT_SERVICE, Math.min(1.8, band.width * 0.42))))
    const depth = round2(Math.max(blocker.depth, MIN_USABLE_ROOM_AREA / width))
    const lower = relation.second
    const lowerRight = lower.x + lower.width
    const sideRects: Rect[] = [
      { x: round2(band.x + band.width - width), y: blocker.y, width, depth },
      { x: band.x, y: blocker.y, width, depth },
    ]

    for (const rect of sideRects) {
      const serviceOnRight = rect.x + rect.width / 2 >= band.x + band.width / 2
      const mainRect: Rect = serviceOnRight
        ? { x: lower.x, y: lower.y, width: round2(rect.x - lower.x), depth: lower.depth }
        : {
            x: round2(rect.x + rect.width),
            y: lower.y,
            width: round2(lowerRight - (rect.x + rect.width)),
            depth: lower.depth,
          }
      if (mainRect.width < MIN_COMPACT_SERVICE || rectArea(mainRect) < MIN_USABLE_ROOM_AREA) continue
      candidates.push({
        removedArea: round2(lower.areaM2 - rectArea(mainRect)),
        blockerRect: rect,
        mainPatch: { room: lower, patch: patchFromRect(lower, mainRect) },
      })
    }
  } else {
    const depth = round2(Math.min(blocker.depth, Math.max(MIN_COMPACT_SERVICE, Math.min(1.8, band.depth * 0.42))))
    const width = round2(Math.max(blocker.width, MIN_USABLE_ROOM_AREA / depth))
    const right = relation.second
    const rightBottom = right.y + right.depth
    const sideRects: Rect[] = [
      { x: blocker.x, y: round2(band.y + band.depth - depth), width, depth },
      { x: blocker.x, y: band.y, width, depth },
    ]

    for (const rect of sideRects) {
      const serviceOnBottom = rect.y + rect.depth / 2 >= band.y + band.depth / 2
      const mainRect: Rect = serviceOnBottom
        ? { x: right.x, y: right.y, width: right.width, depth: round2(rect.y - right.y) }
        : {
            x: right.x,
            y: round2(rect.y + rect.depth),
            width: right.width,
            depth: round2(rightBottom - (rect.y + rect.depth)),
          }
      if (mainRect.depth < MIN_COMPACT_SERVICE || rectArea(mainRect) < MIN_USABLE_ROOM_AREA) continue
      candidates.push({
        removedArea: round2(right.areaM2 - rectArea(mainRect)),
        blockerRect: rect,
        mainPatch: { room: right, patch: patchFromRect(right, mainRect) },
      })
    }
  }

  candidates.sort((a, b) => a.removedArea - b.removedArea)
  for (const candidate of candidates) {
    const blockerPatch = patchFromRect(blocker, candidate.blockerRect)
    const patches = new Map<string, { x?: number; y?: number; width?: number; depth?: number }>([
      [blocker.id, blockerPatch],
      [candidate.mainPatch.room.id, candidate.mainPatch.patch],
    ])
    if (!patchesAreSpatiallyClean(scene, blocker.floorId, patches)) continue
    return {
      actions: [
        { type: "updateRoom", roomId: blocker.id, patch: blockerPatch },
        { type: "updateRoom", roomId: candidate.mainPatch.room.id, patch: candidate.mainPatch.patch },
      ],
      freedLabel: relation.first.name + " dan " + relation.second.name,
    }
  }

  return null
}

function trimRectToAvoid(
  room: SceneRoom,
  fixed: Rect
): { patch: { x?: number; y?: number; width?: number; depth?: number }; removedArea: number } | null {
  const rect = roomRect(room)
  if (!rectsOverlap(rect, fixed)) return { patch: {}, removedArea: 0 }

  const candidates: { rect: Rect; removedArea: number }[] = []
  const originalArea = rectArea(rect)

  const rightTrim: Rect = { ...rect, width: round2(fixed.x - rect.x) }
  if (rightTrim.width >= MIN_COMPACT_SERVICE && rectArea(rightTrim) >= MIN_USABLE_ROOM_AREA) {
    candidates.push({ rect: rightTrim, removedArea: round2(originalArea - rectArea(rightTrim)) })
  }

  const leftX = round2(fixed.x + fixed.width)
  const leftTrim: Rect = {
    x: leftX,
    y: rect.y,
    width: round2(rect.x + rect.width - leftX),
    depth: rect.depth,
  }
  if (leftTrim.width >= MIN_COMPACT_SERVICE && rectArea(leftTrim) >= MIN_USABLE_ROOM_AREA) {
    candidates.push({ rect: leftTrim, removedArea: round2(originalArea - rectArea(leftTrim)) })
  }

  const bottomTrim: Rect = { ...rect, depth: round2(fixed.y - rect.y) }
  if (bottomTrim.depth >= MIN_COMPACT_SERVICE && rectArea(bottomTrim) >= MIN_USABLE_ROOM_AREA) {
    candidates.push({ rect: bottomTrim, removedArea: round2(originalArea - rectArea(bottomTrim)) })
  }

  const topY = round2(fixed.y + fixed.depth)
  const topTrim: Rect = {
    x: rect.x,
    y: topY,
    width: rect.width,
    depth: round2(rect.y + rect.depth - topY),
  }
  if (topTrim.depth >= MIN_COMPACT_SERVICE && rectArea(topTrim) >= MIN_USABLE_ROOM_AREA) {
    candidates.push({ rect: topTrim, removedArea: round2(originalArea - rectArea(topTrim)) })
  }

  candidates.sort((a, b) => a.removedArea - b.removedArea)
  const best = candidates[0]
  return best ? { patch: patchFromRect(room, best.rect), removedArea: best.removedArea } : null
}

function uniqueRects(rects: Rect[]): Rect[] {
  const seen = new Set<string>()
  return rects.filter((rect) => {
    const key = `${rect.x}:${rect.y}:${rect.width}:${rect.depth}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function expansionCandidates(room: SceneRoom, scene: FloorplanScene): Rect[] {
  const current = roomRect(room)
  const sizes = [
    { width: round2(Math.max(current.width, MIN_USABLE_ROOM_AREA / current.depth)), depth: current.depth },
    { width: current.width, depth: round2(Math.max(current.depth, MIN_USABLE_ROOM_AREA / current.width)) },
    {
      width: round2(Math.max(current.width, Math.sqrt(MIN_USABLE_ROOM_AREA))),
      depth: round2(Math.max(current.depth, Math.sqrt(MIN_USABLE_ROOM_AREA))),
    },
  ].filter((size) => size.width >= MIN_COMPACT_SERVICE && size.depth >= MIN_COMPACT_SERVICE)

  const rects: Rect[] = []
  const sameFloorRooms = scene.rooms.filter((other) => other.floorId === room.floorId && other.id !== room.id)
  for (const size of sizes) {
    const xChoices = [
      current.x,
      round2(current.x + current.width - size.width),
      round2(current.x + (current.width - size.width) / 2),
      0,
      round2(scene.site.widthM - size.width),
      ...sameFloorRooms.flatMap((other) => [
        round2(other.x + other.width),
        round2(other.x - size.width),
      ]),
    ]
    const yChoices = [
      current.y,
      round2(current.y + current.depth - size.depth),
      round2(current.y + (current.depth - size.depth) / 2),
      0,
      round2(scene.site.depthM - size.depth),
      ...sameFloorRooms.flatMap((other) => [
        round2(other.y + other.depth),
        round2(other.y - size.depth),
      ]),
    ]

    for (const x of xChoices) {
      for (const y of yChoices) {
        rects.push({ x, y, width: size.width, depth: size.depth })
      }
    }
  }

  return uniqueRects(rects).filter((rect) =>
    rectArea(rect) >= MIN_USABLE_ROOM_AREA &&
    rect.x >= -0.01 &&
    rect.y >= -0.01 &&
    rect.x + rect.width <= scene.site.widthM + 0.01 &&
    rect.y + rect.depth <= scene.site.depthM + 0.01
  )
}

export function proposeSmallRoomRepair(
  scene: FloorplanScene,
  opts: {
    roomId?: string | null
    floorId?: string | null
    sacrificeRoomIds?: string[]
    sacrificeRoomTypes?: string[]
  } = {}
): DesignStrategyProposal | null {
  const sacrificeIds = new Set(opts.sacrificeRoomIds ?? [])
  const sacrificeTypes = new Set(opts.sacrificeRoomTypes ?? [])
  const hasSacrificeConstraint = sacrificeIds.size > 0 || sacrificeTypes.size > 0
  const candidates = scene.rooms
    .filter((room) => (!opts.floorId || room.floorId === opts.floorId))
    .filter((room) => (!opts.roomId || room.id === opts.roomId))
    .filter((room) => roomArea(room.width, room.depth) < MIN_USABLE_ROOM_AREA)
    .sort((a, b) => roomArea(a.width, a.depth) - roomArea(b.width, b.depth))

  for (const room of candidates) {
    const options: { score: number; actions: FloorplanAction[] }[] = []
    const others = scene.rooms.filter((other) => other.floorId === room.floorId && other.id !== room.id)

    for (const rect of expansionCandidates(room, scene)) {
      const patches = new Map<string, { x?: number; y?: number; width?: number; depth?: number }>([
        [room.id, patchFromRect(room, rect)],
      ])
      let removedArea = 0
      let failed = false

      for (const other of others) {
        if (!rectsOverlap(rect, roomRect(other))) continue
        if (
          hasSacrificeConstraint &&
          !sacrificeIds.has(other.id) &&
          !sacrificeTypes.has(other.type)
        ) {
          failed = true
          break
        }
        const trim = trimRectToAvoid(other, rect)
        if (!trim) {
          failed = true
          break
        }
        removedArea += trim.removedArea
        patches.set(other.id, trim.patch)
      }
      if (failed) continue
      if (!patchesAreSpatiallyClean(scene, room.floorId, patches)) continue

      const moveDistance = Math.abs(rect.x - room.x) + Math.abs(rect.y - room.y)
      const resizeDelta = Math.abs(rect.width - room.width) + Math.abs(rect.depth - room.depth)
      const actions: FloorplanAction[] = Array.from(patches.entries())
        .filter(([, patch]) => Object.keys(patch).length > 0)
        .map(([roomId, patch]) => ({ type: "updateRoom", roomId, patch }))
      if (actions.length === 0) continue
      options.push({
        score: round2(moveDistance + resizeDelta + removedArea * 3),
        actions,
      })
    }

    options.sort((a, b) => a.score - b.score)
    const best = options[0]
    if (!best) continue
    return {
      strategyId: "repair-small-room",
      title: "Perbaiki ruang yang terlalu kecil",
      confidence: "medium",
      rationale:
        `${room.name} berada di bawah ambang luas ${MIN_USABLE_ROOM_AREA} m2; ` +
        "ruang diperbesar sampai layak dan batas ruang tetangga disesuaikan bila perlu.",
      actions: best.actions,
    }
  }

  return null
}

function relocateBlocker(
  blocker: SceneRoom,
  relation: ConnectionRelation,
  scene: FloorplanScene
): FloorplanAction | null {
  const obstacles = [
    ...scene.rooms
      .filter((room) => room.floorId === blocker.floorId && room.id !== blocker.id)
      .map(roomRect),
    ...sanitationObstaclesForFloor(scene, blocker.floorId),
    expandRect(relation.band, 0.05),
  ]
  const pos = findFreeRect(
    { width: blocker.width, depth: blocker.depth },
    obstacles,
    scene.site,
    { preferredPositions: edgePreferredPositions(blocker, scene.site) }
  )
  if (!pos) return null
  return { type: "updateRoom", roomId: blocker.id, patch: { x: pos.x, y: pos.y } }
}

function edgePreferredPositions(room: SceneRoom, site: FloorplanScene["site"]): { x: number; y: number }[] {
  return [
    { x: 0, y: room.y },
    { x: round2(site.widthM - room.width), y: room.y },
    { x: room.x, y: 0 },
    { x: room.x, y: round2(site.depthM - room.depth) },
  ]
}

function openPlanZoneId(a: SceneRoom, b: SceneRoom): string {
  const raw = `zone-open-${a.id}-${b.id}`
  return raw.length <= 40 ? raw : `zone-open-${a.id.slice(0, 10)}-${b.id.slice(0, 10)}`
}

export function proposeOpenPlanConnection(
  scene: FloorplanScene,
  opts: {
    mainRoomTypes: string[]
    blockerType?: string | null
    floorId?: string | null
  }
): DesignStrategyProposal | null {
  const floorIds = opts.floorId
    ? [opts.floorId]
    : [...new Set(scene.rooms.map((room) => room.floorId))]

  for (const floorId of floorIds) {
    const floorRooms = scene.rooms.filter((room) => room.floorId === floorId)
    const mainRooms = opts.mainRoomTypes
      .filter((type) => MAIN_LIVING_TYPES.has(type))
      .flatMap((type) => floorRooms.filter((room) => room.type === type).slice(0, 1))
    if (mainRooms.length < 2) continue

    for (let i = 0; i < mainRooms.length; i++) {
      for (let j = i + 1; j < mainRooms.length; j++) {
        const relation = relationBetween(mainRooms[i], mainRooms[j])
        if (!relation) continue
        const band = expandRect(relation.band, 0.03)
        const blockers = floorRooms
          .filter((room) => room.id !== relation.first.id && room.id !== relation.second.id)
          .filter((room) => (opts.blockerType ? room.type === opts.blockerType : SERVICE_BLOCKER_TYPES.has(room.type)))
          .filter((room) => rectsOverlap(roomRect(room), band))
          .sort((a, b) => roomMovePriority(a) - roomMovePriority(b) || a.areaM2 - b.areaM2)
        if (blockers.length === 0) continue

        const blocker = blockers[0]
        const zoneId = openPlanZoneId(relation.first, relation.second)
        const zoneActions: FloorplanAction[] = [
          { type: "updateRoom", roomId: relation.first.id, patch: { zoneId } },
          { type: "updateRoom", roomId: relation.second.id, patch: { zoneId } },
        ]

        const relocated = relocateBlocker(blocker, relation, scene)
        if (relocated) {
          return {
            strategyId: "open-plan-relocate-service-blocker",
            title: "Buka koneksi ruang utama",
            confidence: "medium",
            rationale:
              `${blocker.name} berada di sumbu ${relation.first.name} dan ${relation.second.name}; ` +
              "ruang servis dipindahkan ke area lain yang tidak menutup hubungan dua ruang utama.",
            actions: [relocated, ...zoneActions],
          }
        }

        const compacted = compactServiceBlocker(blocker, relation, scene)
        if (compacted) {
          return {
            strategyId: "open-plan-compact-service-blocker",
            title: "Kompakkan ruang servis di sisi sumbu utama",
            confidence: "medium",
            rationale:
              `${blocker.name} berada di sumbu ${compacted.freedLabel}; ` +
              "karena belum ada spot kosong penuh, ruang servis dibuat lebih kompak ke sisi band agar bukaan visual/sirkulasi dua ruang utama menjadi lebih bersih.",
            actions: [
              { type: "updateRoom", roomId: blocker.id, patch: compacted.patch },
              ...zoneActions,
            ],
          }
        }

        const repacked = repackServiceBlocker(blocker, relation, scene)
        if (repacked) {
          return {
            strategyId: "open-plan-repack-service-blocker",
            title: "Buka koneksi ruang utama dengan menata ulang blok servis",
            confidence: "medium",
            rationale:
              `${blocker.name} berada di sumbu ${repacked.freedLabel}; ` +
              "agar ruang servis tetap layak, blok servis disisihkan ke tepi dan batas ruang utama disesuaikan sehingga hubungan visual/sirkulasi tetap terbuka.",
            actions: [
              ...repacked.actions,
              ...zoneActions,
            ],
          }
        }
      }
    }
  }

  return null
}

function tamanPreferredPositions(
  scene: FloorplanScene,
  size: { width: number; depth: number }
): { x: number; y: number }[] {
  const groundFloorLevels = new Set(
    scene.floors
      .filter((f) => f.level === Math.min(...scene.floors.map((floor) => floor.level)))
      .map((f) => f.id)
  )
  return scene.rooms.flatMap((r) => {
    if (!groundFloorLevels.has(r.floorId) || r.type !== "taman") return []
    if (r.width < size.width || r.depth < size.depth) return []
    return [{
      x: round2(r.x + (r.width - size.width) / 2),
      y: round2(r.y + (r.depth - size.depth) / 2),
    }]
  })
}

function findDirectSoakwellSpot(scene: FloorplanScene): { x: number; y: number } | null {
  const soakwell = scene.sanitation?.soakwell
  if (!soakwell) return null
  const size = { width: soakwell.widthM, depth: soakwell.lengthM }
  const spot = findFreeRect(
    size,
    [...sanitationRoomObstacles(scene), ...otherSanitationObstacles(scene)],
    scene.site,
    { preferredPositions: tamanPreferredPositions(scene, size) }
  )
  if (!spot) return null
  return {
    x: round2(spot.x + soakwell.widthM / 2),
    y: round2(spot.y + soakwell.lengthM / 2),
  }
}

function applyPocketExpansion(
  pocket: Rect,
  rooms: SceneRoom[],
  site: FloorplanScene["site"],
  side: PocketSide,
  amount: number
): boolean {
  if (amount <= 0.01) return true
  const move =
    side === "left" ? { dx: -amount, dy: 0 } :
    side === "right" ? { dx: amount, dy: 0 } :
    side === "top" ? { dx: 0, dy: -amount } :
    { dx: 0, dy: amount }

  const candidates = roomsTouchingPocketSide(rooms, pocket, side)
    .filter((room) => canMoveRoom(room, move.dx, move.dy, rooms, site))
    .sort((a, b) => roomMovePriority(a) - roomMovePriority(b) || a.name.localeCompare(b.name))

  const room = candidates[0]
  if (!room) return false
  room.x = round2(room.x + move.dx)
  room.y = round2(room.y + move.dy)

  if (side === "left") {
    pocket.x = round2(pocket.x - amount)
    pocket.width = round2(pocket.width + amount)
  } else if (side === "right") {
    pocket.width = round2(pocket.width + amount)
  } else if (side === "top") {
    pocket.y = round2(pocket.y - amount)
    pocket.depth = round2(pocket.depth + amount)
  } else {
    pocket.depth = round2(pocket.depth + amount)
  }
  return true
}

function fitServiceCourtPocket(
  scene: FloorplanScene,
  initialPocket: Rect,
  size: { width: number; depth: number }
): { x: number; y: number; actions: FloorplanAction[]; movedRoomNames: string[] } | null {
  const rooms = scene.rooms.map((r) => ({ ...r }))
  const initialRooms = new Map(rooms.map((r) => [r.id, { x: r.x, y: r.y }]))
  const groundRooms = groundSanitationRooms(scene, rooms)
  const pocket = { ...initialPocket }
  const maxNudge = 0.35

  const widthNeed = round2(size.width - pocket.width)
  if (widthNeed > maxNudge) return null
  if (widthNeed > 0.01) {
    const rightFirst = applyPocketExpansion(pocket, groundRooms, scene.site, "right", widthNeed)
    if (!rightFirst && !applyPocketExpansion(pocket, groundRooms, scene.site, "left", widthNeed)) {
      return null
    }
  }

  const depthNeed = round2(size.depth - pocket.depth)
  if (depthNeed > maxNudge) return null
  if (depthNeed > 0.01) {
    const topFirst = applyPocketExpansion(pocket, groundRooms, scene.site, "top", depthNeed)
    if (!topFirst && !applyPocketExpansion(pocket, groundRooms, scene.site, "bottom", depthNeed)) {
      return null
    }
  }

  if (pocket.width + 0.01 < size.width || pocket.depth + 0.01 < size.depth) return null
  const finalRect = { x: pocket.x, y: pocket.y, width: size.width, depth: size.depth }
  if (otherSanitationObstacles(scene).some((o) => rectsOverlap(finalRect, o))) return null
  if (groundSanitationRooms(scene, rooms).some((room) => rectsOverlap(finalRect, roomRect(room)))) {
    return null
  }

  const roomActions: FloorplanAction[] = rooms.flatMap((room) => {
    const initial = initialRooms.get(room.id)
    if (!initial) return []
    const patch: { x?: number; y?: number } = {}
    if (Math.abs(room.x - initial.x) > 0.01) patch.x = round2(room.x)
    if (Math.abs(room.y - initial.y) > 0.01) patch.y = round2(room.y)
    return Object.keys(patch).length > 0
      ? [{ type: "updateRoom" as const, roomId: room.id, patch }]
      : []
  })
  if (roomActions.length === 0) return null

  const movedRoomNames = roomActions.flatMap((action) => {
    if (action.type !== "updateRoom") return []
    const room = rooms.find((r) => r.id === action.roomId)
    return room ? [room.name] : []
  })
  return {
    x: round2(finalRect.x + size.width / 2),
    y: round2(finalRect.y + size.depth / 2),
    actions: roomActions,
    movedRoomNames,
  }
}

function proposeServiceCourtForSoakwell(scene: FloorplanScene): DesignStrategyProposal | null {
  const soakwell = scene.sanitation?.soakwell
  if (!soakwell) return null
  const size = { width: soakwell.widthM, depth: soakwell.lengthM }
  const maxNudge = 0.35
  const pockets = openGroundPockets(scene)
    .filter((pocket) => {
      const widthNeed = Math.max(0, size.width - pocket.width)
      const depthNeed = Math.max(0, size.depth - pocket.depth)
      return (
        pocket.width >= Math.max(0.8, size.width - maxNudge) &&
        pocket.depth >= Math.max(0.8, size.depth - maxNudge) &&
        widthNeed <= maxNudge &&
        depthNeed <= maxNudge &&
        widthNeed + depthNeed > 0.01
      )
    })
    .sort((a, b) => {
      const aDeficit = Math.max(0, size.width - a.width) + Math.max(0, size.depth - a.depth)
      const bDeficit = Math.max(0, size.width - b.width) + Math.max(0, size.depth - b.depth)
      if (Math.abs(aDeficit - bDeficit) > 0.01) return aDeficit - bDeficit
      return b.width * b.depth - a.width * a.depth
    })

  for (const pocket of pockets) {
    const plan = fitServiceCourtPocket(scene, pocket, size)
    if (!plan) continue
    return {
      strategyId: "service-court-for-soakwell",
      title: "Jadikan pocket kosong sebagai taman servis",
      confidence: "medium",
      rationale:
        `Pocket kosong tak berlabel dapat dijadikan taman servis/inner court. ` +
        `${plan.movedRoomNames.join(" dan ")} digeser sedikit agar sumur resapan punya tanah terbuka.`,
      actions: [
        ...plan.actions,
        { type: "moveSanitationObject", kind: "soakwell", x: plan.x, y: plan.y },
      ],
    }
  }
  return null
}

export function proposeSoakwellRelocation(scene: FloorplanScene): DesignStrategyProposal | null {
  const spot = findDirectSoakwellSpot(scene)
  if (spot) {
    return {
      strategyId: "move-soakwell-to-open-ground",
      title: "Pindahkan sumur resapan ke tanah terbuka",
      confidence: "high",
      rationale: "Ada area tanah terbuka/taman yang cukup tanpa mengubah massa ruang.",
      actions: [{ type: "moveSanitationObject", kind: "soakwell", x: spot.x, y: spot.y }],
    }
  }
  return proposeServiceCourtForSoakwell(scene)
}
