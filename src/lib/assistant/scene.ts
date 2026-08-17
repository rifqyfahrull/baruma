/** Pure scene builders shared by browser stores and the server agent. */
import { parseOpeningWall } from "@/lib/geometry"
import { ROOF_MATERIALS } from "@/lib/constants"
import { effectiveLamps } from "@/lib/three/lamps"
import type { DesignLayout, InteriorPlan, Site } from "@/types"
import type { FloorplanScene, InteriorScene } from "./actions"

type FloorplanSelection = {
  selectedFloorId?: string | null
  selectedRoomId?: string | null
}

type SceneRoofMaterial = NonNullable<FloorplanScene["roofZones"][number]["materialId"]>

function sceneRoofMaterial(value: unknown): SceneRoofMaterial | undefined {
  return typeof value === "string" && value in ROOF_MATERIALS
    ? (value as SceneRoofMaterial)
    : undefined
}

export function floorplanSceneFromLayout(
  layout: DesignLayout,
  site: Pick<Site, "widthM" | "depthM"> | null | undefined,
  selection: FloorplanSelection = {}
): FloorplanScene {
  const rooms = Array.isArray(layout.rooms) ? layout.rooms : []
  const roomIds = new Set(rooms.map((room) => room.id))
  const openings = (Array.isArray(layout.openings) ? layout.openings : []).flatMap((opening) => {
    const parsed = parseOpeningWall(opening.wallId)
    if (!parsed || !roomIds.has(parsed.roomId)) return []
    return [{
      id: opening.id,
      roomId: parsed.roomId,
      side: parsed.side,
      type: opening.type,
      positionM: opening.positionM,
      kind: opening.kind,
      widthM: opening.widthM,
      heightM: opening.heightM,
    }]
  })

  const electrical = (Array.isArray(layout.electrical) ? layout.electrical : []).flatMap((point) => {
    if (!point || typeof point.id !== "string" || typeof point.roomId !== "string") return []
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return []
    return [{ id: point.id, type: String(point.type), roomId: point.roomId, x: point.x, y: point.y }]
  })
  const water = (Array.isArray(layout.water) ? layout.water : []).flatMap((point) => {
    if (!point || typeof point.id !== "string" || typeof point.roomId !== "string") return []
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return []
    return [{ id: point.id, type: String(point.type), roomId: point.roomId, x: point.x, y: point.y }]
  })

  const sanitizeObject = (value: unknown) => {
    if (!value || typeof value !== "object") return null
    const object = value as Record<string, unknown>
    if (typeof object.id !== "string" || !Number.isFinite(object.x) || !Number.isFinite(object.y)) return null
    return {
      id: object.id,
      x: object.x as number,
      y: object.y as number,
      widthM: Number(object.widthM) || 0,
      lengthM: Number(object.lengthM) || 0,
      depthM: Number(object.depthM) || 0,
      ...(Number.isFinite(object.capacity) ? { capacity: object.capacity as number } : {}),
    }
  }
  const rawSanitation = layout.sanitation && typeof layout.sanitation === "object"
    ? layout.sanitation
    : null
  const septicTank = rawSanitation ? sanitizeObject(rawSanitation.septicTank) : null
  const soakwell = rawSanitation ? sanitizeObject(rawSanitation.soakwell) : null
  const sanitation = rawSanitation
    ? {
        ...(septicTank ? { septicTank } : {}),
        ...(soakwell ? { soakwell } : {}),
        controlBoxes: (Array.isArray(rawSanitation.controlBoxes) ? rawSanitation.controlBoxes : [])
          .flatMap((box) => {
            const sanitized = sanitizeObject(box)
            return sanitized ? [sanitized] : []
          }),
      }
    : undefined

  return {
    site: { widthM: site?.widthM ?? 0, depthM: site?.depthM ?? 0 },
    floors: (Array.isArray(layout.floors) ? layout.floors : []).map((floor) => ({
      id: floor.id,
      name: floor.name,
      level: floor.level,
    })),
    selectedFloorId: selection.selectedFloorId ?? null,
    selectedRoomId: selection.selectedRoomId && roomIds.has(selection.selectedRoomId)
      ? selection.selectedRoomId
      : null,
    rooms: rooms.map((room) => ({
      id: room.id,
      name: room.name,
      type: room.type,
      floorId: room.floorId,
      x: room.x,
      y: room.y,
      width: room.width,
      depth: room.depth,
      areaM2: room.areaM2,
      locked: room.locked,
      requiresNaturalLight: room.requiresNaturalLight,
      requiresVentilation: room.requiresVentilation,
      zoneId: room.zoneId,
      levelOffsetM: room.levelOffsetM,
      railingStyle: room.railingStyle,
      stairDirection: room.stairDirection,
    })),
    openings,
    roof: layout.roof ? {
      type: layout.roof.type,
      slopeDeg: layout.roof.slopeDeg,
      overhangM: layout.roof.overhangM,
      material: layout.roof.material,
      lowSide: layout.roof.lowSide,
      fascia: layout.roof.fascia
        ? { heightM: layout.roof.fascia.heightM, color: layout.roof.fascia.color }
        : undefined,
    } : undefined,
    roofZones: (layout.roofZones ?? []).map((zone) => ({
      ...zone,
      materialId: sceneRoofMaterial(zone.materialId),
    })),
    rooftopEnabled: layout.floors.some((floor) => floor.id === "floor-rooftop"),
    rooftopArea: layout.rooftopArea,
    facade: layout.facade,
    facadeInner: layout.facadeInner,
    facadeElements: (layout.facadeElements ?? []).map((element) => ({
      id: element.id,
      wallId: element.wallId,
      kind: element.kind,
      positionM: element.positionM,
      widthM: element.widthM,
      sillHeightM: element.sillHeightM,
      heightM: element.heightM,
      finish: element.finish,
      modelUrl: element.modelUrl ?? null,
      modelAssetId: element.modelAssetId ?? null,
    })),
    exteriorElements: (layout.exteriorElements ?? []).map((element) => ({
      ...element,
      model: element.model
        ? {
            modelAssetId: element.model.modelAssetId ?? null,
            modelUrl: element.model.modelUrl ?? null,
            fitMode: element.model.fitMode,
            upAxis: element.model.upAxis,
            frontAxis: element.model.frontAxis,
            performance: element.model.performance,
          }
        : undefined,
    })),
    exteriorLamps: effectiveLamps(layout).map((lamp) => ({
      id: lamp.id,
      kind: lamp.kind,
      x: lamp.x,
      y: lamp.y,
      mountH: lamp.mountH,
      side: lamp.side,
      color: lamp.color,
      intensity: lamp.intensity,
      watt: lamp.watt,
    })),
    electrical,
    water,
    sanitation,
  }
}

export function interiorSceneFromPlan(
  plan: InteriorPlan,
  layout: DesignLayout,
  selectedRoomId?: string | null
): InteriorScene {
  return {
    style: plan.style,
    selectedRoomId: selectedRoomId ?? null,
    rooms: plan.rooms.map((roomPlan) => {
      const room = layout.rooms.find((candidate) => candidate.id === roomPlan.roomId)
      return {
        roomId: roomPlan.roomId,
        name: roomPlan.roomName ?? room?.name ?? roomPlan.roomId,
        type: roomPlan.roomType,
        widthM: room?.width ?? 0,
        depthM: room?.depth ?? 0,
        furniture: roomPlan.furniture.map((furniture) => ({
          id: furniture.id,
          furnitureId: furniture.furnitureId,
          name: furniture.name,
          category: furniture.category,
          x: furniture.x,
          y: furniture.y,
          rotationDeg: furniture.rotationDeg,
        })),
        lighting: roomPlan.lighting.map((light) => ({
          id: light.id,
          roomId: light.roomId,
          type: light.type,
          x: light.x,
          y: light.y,
          heightM: light.heightM,
          colorTemperature: light.colorTemperature,
          qty: light.qty,
          watt: light.watt,
        })),
      }
    }),
  }
}
