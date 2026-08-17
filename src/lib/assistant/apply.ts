/**
 * Client glue for the editor AI assistant.
 *
 * - build*Scene(): snapshot the live store state (incl. unsaved edits) into the
 *   compact grounding the assistant API expects.
 * - apply*Actions(): dispatch validated actions through the existing undo-aware
 *   store methods, so every applied change is reversible with Ctrl+Z. Each
 *   action is defensively re-checked against live state and failures are skipped
 *   so one bad action never aborts the batch. Returns the count actually applied.
 */
import { parseOpeningWall } from "@/lib/geometry"
import { nanoid } from "nanoid"
import { autoGenerateElectrical } from "@/lib/electrical/plan"
import { autoGenerateWater } from "@/lib/water/plan"
import { autoSizeSanitation } from "@/lib/water/sanitation"
import { roofAreaForLayout } from "@/lib/editor/sanitation-place"
import { openingDefaultsForKind, ROOF_MATERIALS } from "@/lib/constants"
import { effectiveLamps } from "@/lib/three/lamps"
import {
  makeAssetElement,
  makeBoxElement,
  makeFrameElement,
  makeGableFrameElement,
  makeSegmentElement,
  makeStairElement,
  makeSurfaceElement,
} from "@/lib/exterior/factories"
import { getFurniture } from "@/lib/interior/presets"
import { isRooftopFloor, topRegularFloorId } from "@/lib/editor/floors"
import { useEditorStore } from "@/stores/editor-store"
import { useInteriorStore } from "@/stores/interior-store"
import type { ExteriorElement, Floor, Opening, RoofSpec, RoofZone } from "@/types"
import type {
  FloorplanAction,
  FloorplanScene,
  InteriorAction,
  InteriorScene,
} from "./actions"

type SceneRoofMaterial = NonNullable<FloorplanScene["roofZones"][number]["materialId"]>

function sceneRoofMaterial(value: unknown): SceneRoofMaterial | undefined {
  return typeof value === "string" && value in ROOF_MATERIALS
    ? (value as SceneRoofMaterial)
    : undefined
}

/* ----- scene snapshots ----- */

export function buildFloorplanScene(): FloorplanScene | null {
  const { layout, site, selectedFloorId, selectedObjectId } = useEditorStore.getState()
  if (!layout) return null

  // Include rooms from ALL floors so the assistant understands the floor
  // structure and can move rooms between floors.
  const rooms = layout.rooms
  const roomIds = new Set(rooms.map((r) => r.id))
  const openings = layout.openings.flatMap((o) => {
    const parsed = parseOpeningWall(o.wallId)
    if (!parsed || !roomIds.has(parsed.roomId)) return []
    return [{
      id: o.id,
      roomId: parsed.roomId,
      side: parsed.side,
      type: o.type,
      positionM: o.positionM,
      kind: o.kind,
      widthM: o.widthM,
      heightM: o.heightM,
    }]
  })

  // Electrical points as grounding (defensive: the layout PUT has no zod, so
  // skip malformed entries / non-finite coords — carry-forward from T1).
  const electrical = (Array.isArray(layout.electrical) ? layout.electrical : []).flatMap((p) => {
    if (!p || typeof p.id !== "string" || typeof p.roomId !== "string") return []
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return []
    return [{ id: p.id, type: String(p.type), roomId: p.roomId, x: p.x, y: p.y }]
  })

  // Water points as grounding (same defensive treatment as electrical).
  const water = (Array.isArray(layout.water) ? layout.water : []).flatMap((p) => {
    if (!p || typeof p.id !== "string" || typeof p.roomId !== "string") return []
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return []
    return [{ id: p.id, type: String(p.type), roomId: p.roomId, x: p.x, y: p.y }]
  })

  // Sanitation bag as grounding (land-level objects). Defensive: keep only
  // well-formed objects so the assistant can target existing ids/indices.
  const san = layout.sanitation && typeof layout.sanitation === "object" ? layout.sanitation : null
  const sanitizeObj = (o: unknown) => {
    if (!o || typeof o !== "object") return null
    const p = o as Record<string, unknown>
    if (typeof p.id !== "string" || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null
    return {
      id: p.id,
      x: p.x as number,
      y: p.y as number,
      widthM: Number(p.widthM) || 0,
      lengthM: Number(p.lengthM) || 0,
      depthM: Number(p.depthM) || 0,
      ...(Number.isFinite(p.capacity) ? { capacity: p.capacity as number } : {}),
    }
  }
  const sanitation = san
    ? {
        ...(sanitizeObj(san.septicTank) ? { septicTank: sanitizeObj(san.septicTank)! } : {}),
        ...(sanitizeObj(san.soakwell) ? { soakwell: sanitizeObj(san.soakwell)! } : {}),
        controlBoxes: (Array.isArray(san.controlBoxes) ? san.controlBoxes : []).flatMap((b) => {
          const s = sanitizeObj(b)
          return s ? [s] : []
        }),
      }
    : undefined

  return {
    site: { widthM: site?.widthM ?? 0, depthM: site?.depthM ?? 0 },
    floors: layout.floors.map((f) => ({ id: f.id, name: f.name, level: f.level })),
    selectedFloorId: selectedFloorId ?? null,
    selectedRoomId: selectedObjectId && roomIds.has(selectedObjectId) ? selectedObjectId : null,
    rooms: rooms.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      floorId: r.floorId,
      x: r.x,
      y: r.y,
      width: r.width,
      depth: r.depth,
      areaM2: r.areaM2,
      locked: r.locked,
      requiresNaturalLight: r.requiresNaturalLight,
      requiresVentilation: r.requiresVentilation,
      zoneId: r.zoneId,
      levelOffsetM: r.levelOffsetM,
      railingStyle: r.railingStyle,
      stairDirection: r.stairDirection,
      stairRiserM: r.stairRiserM,
      stairShape: r.stairShape,
      stairTurn: r.stairTurn,
      poolShallowM: r.poolShallowM,
      poolDeepM: r.poolDeepM,
      poolEntrySide: r.poolEntrySide,
      poolCirculationType: r.poolCirculationType,
      poolHasJets: r.poolHasJets,
      poolHeater: r.poolHeater,
      poolSaltChlorinator: r.poolSaltChlorinator,
    })),
    openings,
    // Roof + rooftop state so the model knows the current shape (skillion low
    // side, fascia on/off) before proposing a setRoof/setRooftop patch.
    roof: layout.roof
      ? {
          type: layout.roof.type,
          slopeDeg: layout.roof.slopeDeg,
          overhangM: layout.roof.overhangM,
          material: layout.roof.material,
          lowSide: layout.roof.lowSide,
          fascia: layout.roof.fascia
            ? { heightM: layout.roof.fascia.heightM, color: layout.roof.fascia.color }
            : undefined,
        }
      : undefined,
    roofZones: (layout.roofZones ?? []).map((z) => ({
      ...z,
      materialId: sceneRoofMaterial(z.materialId),
    })),
    rooftopEnabled: layout.floors.some((f) => f.id === "floor-rooftop"),
    rooftopArea: layout.rooftopArea,
    // Facade cladding maps + louver bands (ids the model may target).
    facade: layout.facade,
    facadeInner: layout.facadeInner,
    facadeElements: (layout.facadeElements ?? []).map((fe) => ({
      id: fe.id,
      wallId: fe.wallId,
      kind: fe.kind,
      positionM: fe.positionM,
      widthM: fe.widthM,
      sillHeightM: fe.sillHeightM,
      heightM: fe.heightM,
      finish: fe.finish,
      modelUrl: fe.modelUrl ?? null,
      modelAssetId: fe.modelAssetId ?? null,
    })),
    exteriorElements: (layout.exteriorElements ?? []).map((element) => ({ ...element })),
    // EFFECTIVE exterior lamps: auto placement is materialised here so
    // updateLamp/removeLamp always have legal target ids even before the
    // copy-on-write list exists on the layout.
    exteriorLamps: effectiveLamps(layout).map((l) => ({
      id: l.id,
      kind: l.kind,
      x: l.x,
      y: l.y,
      mountH: l.mountH,
      side: l.side,
      color: l.color,
      intensity: l.intensity,
      watt: l.watt,
    })),
    electrical,
    water,
    sanitation,
  }
}

export function buildInteriorScene(): InteriorScene | null {
  const { plan, layout, selectedRoomId, style } = useInteriorStore.getState()
  if (!plan || !layout) return null

  const rooms = plan.rooms.map((rp) => {
    const room = layout.rooms.find((r) => r.id === rp.roomId)
    return {
      roomId: rp.roomId,
      name: rp.roomName ?? room?.name ?? rp.roomId,
      type: rp.roomType,
      widthM: room?.width ?? 0,
      depthM: room?.depth ?? 0,
      furniture: rp.furniture.map((f) => ({
        id: f.id,
        furnitureId: f.furnitureId,
        name: f.name,
        category: f.category,
        x: f.x,
        y: f.y,
        rotationDeg: f.rotationDeg,
      })),
      lighting: rp.lighting.map((l) => ({
        id: l.id,
        roomId: l.roomId,
        type: l.type,
        x: l.x,
        y: l.y,
        heightM: l.heightM,
        colorTemperature: l.colorTemperature,
        qty: l.qty,
        watt: l.watt,
      })),
    }
  })

  return { style, selectedRoomId, rooms }
}

/* ----- apply ----- */

/**
 * Floor id yang SAH untuk dipakai addRoom di store.
 *
 * Aksi deterministik (`buildInitialFloorplan` → `generateLayout`) menamai
 * lantai "floor-1", "floor-2", … sedangkan lantai NYATA di store memakai id
 * acak untuk lantai kedua dst. ("floor-k4KTN1"). Merujuk id yang tak ada di
 * `layout.floors` membuat ruang mendarat di lantai hantu: tak terlihat di UI,
 * dan gerbang konektivitas melihatnya sebagai ruang terputus.
 *
 * Regresi nyata proj-modern-tropis-1 (2026-08-02): build denah kosong lolos
 * E2E server-side (yang hanya mensimulasikan) tapi di editor nyata seluruh
 * ruang jadi hantu — solvernya benar, jalur apply yang salah sasaran.
 *
 * Label "floor-N" dibaca sebagai LEVEL; bila ada lantai dengan level itu,
 * pakai id aslinya. Id yang sudah ada dipakai apa adanya; yang tak dikenal
 * (mis. "floor-rooftop" yang memang belum dibuat) tetap diteruskan apa adanya
 * agar perilaku lama tidak berubah.
 */
function resolveFloorId(floorId: string | undefined, floors: Floor[]): string | undefined {
  if (!floorId) return undefined
  if (floors.some((f) => f.id === floorId)) return floorId
  const m = /^floor-(\d+)$/.exec(floorId)
  if (m) {
    const byLevel = floors.find((f) => f.level === Number(m[1]))
    if (byLevel) return byLevel.id
  }
  return floorId
}

export function applyFloorplanActions(actions: FloorplanAction[]): number {
  let applied = 0
  // PEMETAAN RUANG BARU — aksi deterministik menamai ruang yang belum dibuat
  // sebagai "new-N" (cara `simulateFloorplanActions` memberi id), sedangkan
  // `store.addRoom` melahirkan id acak `room-<nanoid>`. Tanpa pemetaan ini
  // SELURUH addOpening jatuh ke ruang yang tak pernah ada → di-skip (0 aksi) →
  // `applyFloorplanActionsAtomic` rollback seluruh build → pengguna melihat 0
  // aksi. Regresi proj-modern-tropis-1, 2026-08-02: E2E server-side mensimulasikan
  // dengan id konsisten sehingga lolos, tapi editor nyata gagal total.
  //
  // Offset `new-${offset + i}` dihitung sama dengan simulator: penghitung mulai
  // dari jumlah ruang yang tersisa setelah deleteRoom, lalu bertambah per
  // addRoom. Karena deleteRoom berada di depan (build/rebuild), offset = jumlah
  // ruang yang tersisa saat addRoom pertama di-apply.
  const roomIdMap = new Map<string, string>()
  let roomOffset: number | null = null
  let addRoomIndex = 0
  const resolveRoom = (id: string | undefined): string | undefined =>
    id ? (roomIdMap.get(id) ?? id) : id
  for (const a of actions) {
    const store = useEditorStore.getState()
    try {
      if (a.type === "updateRoom" || a.type === "addOpening" || a.type === "deleteRoom") {
        const realId = resolveRoom(a.roomId)
        if (!realId || !store.layout?.rooms.some((r) => r.id === realId)) continue
        if (a.type === "updateRoom") store.updateRoom(realId, a.patch)
        else if (a.type === "addOpening") {
          // Optional specific kind (e.g. garage_door): the store only creates
          // hinged_door/sliding_window, so create first, then re-kind the new
          // opening with the kind's full defaults (2.7×2.2 garage door, etc.).
          const kindDefaults = a.kind ? openingDefaultsForKind(a.kind) : null
          const before = new Set(store.layout.openings.map((o) => o.id))
          store.addOpening(realId, a.side, a.positionM, kindDefaults?.type ?? a.openingType)
          if (kindDefaults) {
            const created = useEditorStore
              .getState()
              .layout?.openings.find((o) => !before.has(o.id))
            if (created) useEditorStore.getState().updateOpening(created.id, kindDefaults)
          }
        } else store.deleteObject(realId)
      } else if (a.type === "addRoom") {
        // Aksi deterministic menamai lantai "floor-1/floor-2"; lantai nyata
        // memakai id acak untuk level ≥2. Petakan dulu supaya ruang mendarat di
        // lantai yang BENAR-BENAR ada (regresi proj-modern-tropis-1: build lolos
        // test server-side tapi di editor ruang jadi hantu di floor yang tak ada).
        const targetFloorId = resolveFloorId(a.floorId, store.layout?.floors ?? [])
        if (targetFloorId && store.selectedFloorId !== targetFloorId) {
          store.setSelectedFloor(targetFloorId)
        }
        const roomCountBefore = store.layout?.rooms.length ?? 0
        store.addRoom(a.roomType, a.x ?? 0, a.y ?? 0)
        // `store` adalah snapshot yang diambil SEBELUM addRoom — `store.layout`
        // adalah referensi basi (addRoom meng-commit objek layout baru). Wajib
        // re-fetch state segar untuk membaca ruang yang baru dibuat; kalau tidak,
        // `created` jatuh ke ruang lama yang salah dan pemetaan new-N ikut salah.
        const created = useEditorStore.getState().layout?.rooms.slice(-1)[0]
        if (created) {
          // Rekam `new-${offset + i}` → id nyata, supaya addOpening yang
          // menyusul menyambung ke ruang yang benar.
          if (roomOffset === null) roomOffset = roomCountBefore
          roomIdMap.set(`new-${roomOffset + addRoomIndex}`, created.id)
          addRoomIndex++
          if (a.width != null || a.depth != null) {
            store.updateRoom(created.id, {
              ...(a.width != null ? { width: a.width } : {}),
              ...(a.depth != null ? { depth: a.depth } : {}),
            })
          }
        }
      } else if (a.type === "addFloor") {
        store.addFloor()
      } else if (a.type === "removeFloor") {
        store.removeFloor(a.floorId)
      } else if (a.type === "updateFloor") {
        if (!store.layout?.floors.some((f) => f.id === a.floorId)) continue
        store.updateFloor(a.floorId, a.patch)
      } else if (a.type === "updateOpening") {
        const patch: Partial<Opening> = {}
        // `kind` is the source of truth: it resets metadata + dimensions to the
        // kind's defaults (QuickEditor pattern); explicit fields below win.
        if (a.patch.kind != null) Object.assign(patch, openingDefaultsForKind(a.patch.kind))
        else if (a.patch.openingType != null) patch.type = a.patch.openingType
        if (a.patch.positionM != null) patch.positionM = a.patch.positionM
        if (a.patch.widthM != null) patch.widthM = a.patch.widthM
        if (a.patch.heightM != null) patch.heightM = a.patch.heightM
        if (a.patch.sillHeightM != null) patch.sillHeightM = a.patch.sillHeightM
        if (a.patch.headHeightM != null) patch.headHeightM = a.patch.headHeightM
        if (a.patch.frameColor != null) patch.frameColor = a.patch.frameColor
        // Gap pre-existing: frameDepthM sudah ada di zod schema (actions.ts)
        // + prompt (editor-assistant.ts) + UI (opening-inspector.tsx) tapi
        // TIDAK diteruskan di sini — agent bisa "minta" bingkai menonjol tapi
        // patch-nya hilang sebelum sampai ke store.
        if (a.patch.frameDepthM != null) patch.frameDepthM = a.patch.frameDepthM
        if (a.patch.archShape != null) patch.archShape = a.patch.archShape
        // null = detach the library model (back to procedural leaf/panel)
        if (a.patch.modelUrl !== undefined) patch.modelUrl = a.patch.modelUrl
        if (a.patch.modelAssetId !== undefined) patch.modelAssetId = a.patch.modelAssetId
        store.updateOpening(a.openingId, patch)
      } else if (a.type === "deleteOpening") {
        store.deleteObject(a.openingId)
      } else if (a.type === "setRoof") {
        const { fascia, ...rest } = a.patch
        const patch: Partial<RoofSpec> = { ...rest }
        // fascia:null = turn the band OFF. The store merges {...l.roof, ...patch},
        // so send the key EXPLICITLY as undefined to actually delete it (a key
        // absent from the patch would leave the old fascia in place).
        if (fascia !== undefined) patch.fascia = fascia ?? undefined
        store.setRoof(patch)
      } else if (a.type === "addRoofZone") {
        const zone: RoofZone = {
          id: `roofz-ai-${nanoid(6)}`,
          slopeDeg: a.zone.type === "datar" ? 0 : 30,
          overhangM: 0.2,
          materialId: "genteng_beton",
          ...a.zone,
        }
        store.addRoofZone(zone)
      } else if (a.type === "updateRoofZone") {
        if (!store.layout?.roofZones?.some((z) => z.id === a.id)) continue
        store.updateRoofZone(a.id, a.patch)
      } else if (a.type === "removeRoofZone") {
        if (!store.layout?.roofZones?.some((z) => z.id === a.id)) continue
        store.removeRoofZone(a.id)
      } else if (a.type === "setRooftop") {
        if (!store.layout) continue
        store.setRooftop(a.enabled)
      } else if (a.type === "setWallCladding") {
        const parsed = parseOpeningWall(a.wallId)
        if (!parsed || !store.layout?.rooms.some((r) => r.id === parsed.roomId)) continue
        store.setWallCladding(a.wallId, a.claddingId, a.face ?? "outer")
      } else if (a.type === "addFacadeElement") {
        const parsed = parseOpeningWall(a.wallId)
        if (!parsed || !store.layout?.rooms.some((r) => r.id === parsed.roomId)) continue
        store.addFacadeElement(a.wallId)
      } else if (a.type === "updateFacadeElement") {
        if (!store.layout?.facadeElements?.some((fe) => fe.id === a.id)) continue
        store.updateFacadeElement(a.id, a.patch)
      } else if (a.type === "removeFacadeElement") {
        if (!store.layout?.facadeElements?.some((fe) => fe.id === a.id)) continue
        store.removeFacadeElement(a.id)
      } else if (a.type === "addExteriorElement") {
        const draft = a.element
        let element: ExteriorElement
        if ("start" in draft) {
          element = makeSegmentElement(draft.kind, draft.start, draft.end, {
            floorId: draft.floorId,
            label: draft.label,
            heightM: draft.heightM,
            thicknessM: draft.thicknessM,
            material: draft.material,
          })
        } else if (draft.kind === "portal_frame") {
          element = makeFrameElement(draft.x, draft.y, {
            floorId: draft.floorId,
            label: draft.label,
            widthM: draft.widthM,
            heightM: draft.heightM,
            depthM: draft.depthM,
            memberSizeM: draft.memberSizeM,
            rotationDeg: draft.rotationDeg,
            material: draft.material,
          })
        } else if (draft.kind === "gable_frame") {
          element = makeGableFrameElement(draft.x, draft.y, {
            floorId: draft.floorId,
            label: draft.label,
            widthM: draft.widthM,
            heightM: draft.heightM,
            eaveLeftM: draft.eaveLeftM,
            eaveRightM: draft.eaveRightM,
            apexOffsetM: draft.apexOffsetM,
            depthM: draft.depthM,
            memberSizeM: draft.memberSizeM,
            zM: draft.zM,
            rotationDeg: draft.rotationDeg,
            material: draft.material,
          })
        } else if (draft.kind === "exterior_stair") {
          element = makeStairElement(draft.x, draft.y, {
            floorId: draft.floorId,
            label: draft.label,
            widthM: draft.widthM,
            lengthM: draft.lengthM,
            riseM: draft.riseM,
            direction: draft.direction,
            material: draft.material,
          })
        } else if ("points" in draft) {
          element = makeSurfaceElement(draft.kind, draft.points, {
            floorId: draft.floorId,
            label: draft.label,
            thicknessM: draft.thicknessM,
            material: draft.material,
            scatterSeed: draft.scatterSeed,
          })
        } else if (
          draft.kind === "asset" ||
          draft.kind === "plant" ||
          draft.kind === "tree" ||
          draft.kind === "exterior_decor" ||
          draft.kind === "vehicle"
        ) {
          element = makeAssetElement(draft.kind, draft.x, draft.y, {
            modelUrl: draft.modelUrl,
            modelAssetId: null,
            fitMode: "fit_envelope",
          }, {
            floorId: draft.floorId,
            label: draft.label,
            widthM: draft.widthM,
            depthM: draft.depthM,
            heightM: draft.heightM,
            zM: draft.zM,
            rotationDeg: draft.rotationDeg,
            material: draft.material,
          })
        } else if (
          // Kind box (sisa satu-satunya varian draft setelah exclusion di atas).
          // Dicek EKSPLISIT (bukan `else` polos) supaya TS menyempitkan
          // `draft` secara POSITIF ke varian box — union diskriminan 7 arah
          // ini tak selalu bisa dinegasikan bersih lewat `else` biasa, dan
          // varian box adalah satu-satunya yang punya `pattern`/`posts`
          // (khusus kind "pergola").
          draft.kind === "solid_wall" ||
          draft.kind === "facade_panel" ||
          draft.kind === "column" ||
          draft.kind === "chimney" ||
          draft.kind === "beam" ||
          draft.kind === "slab" ||
          draft.kind === "canopy" ||
          draft.kind === "overhang_slab" ||
          draft.kind === "planter" ||
          draft.kind === "pergola"
        ) {
          // Cerobong tanpa lantai eksplisit default ke dak/lantai teratas —
          // di tapak ia terkubur dalam massa bangunan (sama dgn jalur UI
          // tap-to-place di plan-canvas).
          const boxFloorId =
            draft.floorId ??
            (draft.kind === "chimney"
              ? (store.layout?.floors.find(isRooftopFloor)?.id ??
                (store.layout ? topRegularFloorId(store.layout.floors) : null) ??
                undefined)
              : undefined)
          element = makeBoxElement(draft.kind, draft.x, draft.y, {
            floorId: boxFloorId,
            label: draft.label,
            widthM: draft.widthM,
            depthM: draft.depthM,
            heightM: draft.heightM,
            zM: draft.zM,
            rotationDeg: draft.rotationDeg,
            material: draft.material,
            pattern: draft.pattern,
            posts: draft.posts,
          })
        } else {
          continue // unreachable utk draft valid (zod sudah menutup semua kind)
        }
        store.addExteriorElement(element)
      } else if (a.type === "updateExteriorElement") {
        if (!store.layout?.exteriorElements?.some((element) => element.id === a.id)) continue
        store.updateExteriorElement(a.id, a.patch as Partial<ExteriorElement>)
      } else if (a.type === "removeExteriorElement") {
        if (!store.layout?.exteriorElements?.some((element) => element.id === a.id)) continue
        store.removeExteriorElement(a.id)
      } else if (a.type === "applyFacadeTemplate") {
        store.applyExteriorTemplate(a.templateId)
      } else if (a.type === "addWallLamp") {
        const parsed = parseOpeningWall(a.wallId)
        if (!parsed || !store.layout?.rooms.some((r) => r.id === parsed.roomId)) continue
        store.addWallLamp(a.wallId)
      } else if (a.type === "updateLamp") {
        // Validate against the EFFECTIVE list — the store copy-on-writes the
        // auto placement, so auto ids are legal targets too.
        if (!store.layout || !effectiveLamps(store.layout).some((l) => l.id === a.id)) continue
        store.updateLamp(a.id, a.patch)
      } else if (a.type === "removeLamp") {
        if (!store.layout || !effectiveLamps(store.layout).some((l) => l.id === a.id)) continue
        store.removeLamp(a.id)
      } else if (a.type === "setRooftopArea") {
        // Store clamps the rect to the building footprint — do NOT clamp here.
        store.setRooftopArea(a.area)
      } else if (a.type === "clearRooftopArea") {
        store.setRooftopArea(undefined)
      } else if (a.type === "setSoilBearing") {
        store.setSoilBearing(a.soilBearingKPa)
      } else if (a.type === "addElectricalPoint") {
        if (!store.layout?.rooms.some((r) => r.id === a.roomId)) continue
        store.addElectricalPoint(a.roomId, a.pointType, a.x, a.y)
      } else if (a.type === "moveElectricalPoint") {
        if (!store.layout?.electrical?.some((p) => p.id === a.id)) continue
        store.moveElectricalPoint(a.id, a.x, a.y)
      } else if (a.type === "updateElectricalPoint") {
        if (!store.layout?.electrical?.some((p) => p.id === a.id)) continue
        store.updateElectricalPoint(a.id, a.patch)
      } else if (a.type === "removeElectricalPoint") {
        if (!store.layout?.electrical?.some((p) => p.id === a.id)) continue
        store.removeElectricalPoint(a.id)
      } else if (a.type === "autoGenerateElectrical") {
        if (!store.layout) continue
        store.setElectrical(autoGenerateElectrical(store.layout, a.floorId))
      } else if (a.type === "addWaterPoint") {
        if (!store.layout?.rooms.some((r) => r.id === a.roomId)) continue
        store.addWaterPoint(a.roomId, a.waterType, a.x, a.y)
      } else if (a.type === "moveWaterPoint") {
        if (!store.layout?.water?.some((p) => p.id === a.id)) continue
        store.moveWaterPoint(a.id, a.x, a.y)
      } else if (a.type === "updateWaterPoint") {
        if (!store.layout?.water?.some((p) => p.id === a.id)) continue
        store.updateWaterPoint(a.id, a.patch)
      } else if (a.type === "removeWaterPoint") {
        if (!store.layout?.water?.some((p) => p.id === a.id)) continue
        store.removeWaterPoint(a.id)
      } else if (a.type === "autoGenerateWater") {
        if (!store.layout) continue
        store.setWater(autoGenerateWater(store.layout, a.floorId))
      } else if (a.type === "autoSizeSanitation") {
        if (!store.layout || !store.site) continue
        store.setSanitation(
          autoSizeSanitation(store.layout, roofAreaForLayout(store.layout), store.site)
        )
      } else if (a.type === "moveSanitationObject") {
        const san = store.layout?.sanitation
        const exists =
          a.kind === "controlBox"
            ? Boolean(san?.controlBoxes?.[a.ref ?? -1])
            : Boolean(san?.[a.kind])
        if (!exists) continue
        // moveSanitationObject is live()-based (drag gesture); bracket it so a
        // single AI-dispatched move records exactly one undo entry (parity with
        // SP4's commit-based moveElectricalPoint).
        store.beginDrag()
        store.moveSanitationObject(a.kind, a.ref ?? null, a.x, a.y)
        store.endDrag()
      }
      applied++
    } catch {
      // skip a failing action; keep applying the rest
    }
  }
  return applied
}

export function applyInteriorActions(actions: InteriorAction[]): number {
  let applied = 0
  for (const a of actions) {
    const store = useInteriorStore.getState()
    try {
      if (a.type === "setStyle") {
        store.setStyle(a.style)
        applied++
        continue
      }
      if (!store.plan?.rooms.some((r) => r.roomId === a.roomId)) continue
      const roomPlan = store.plan.rooms.find((r) => r.roomId === a.roomId)!
      if (a.type === "addFurniture") {
        const item = getFurniture(a.furnitureId)
        if (!item) continue
        const result = store.addFurniture(a.roomId, item)
        if (!result.ok) continue
      } else if (a.type === "moveFurniture") {
        if (!roomPlan.furniture.some((item) => item.id === a.furnitureId)) continue
        store.moveFurniture(a.roomId, a.furnitureId, a.x, a.y)
      } else if (a.type === "rotateFurniture") {
        if (!roomPlan.furniture.some((item) => item.id === a.furnitureId)) continue
        store.rotateFurniture(a.roomId, a.furnitureId)
      } else if (a.type === "removeFurniture") {
        if (!roomPlan.furniture.some((item) => item.id === a.furnitureId)) continue
        store.removeFurniture(a.roomId, a.furnitureId)
      } else if (a.type === "resetRoom") {
        store.resetRoom(a.roomId)
      } else if (a.type === "addLight") {
        store.addLight(a.roomId, a.lightType)
      } else if (a.type === "moveLight") {
        if (!roomPlan.lighting.some((light) => light.id === a.lightId)) continue
        store.moveLight(a.roomId, a.lightId, a.x, a.y)
      } else if (a.type === "updateLight") {
        if (!roomPlan.lighting.some((light) => light.id === a.lightId)) continue
        const patch: Parameters<typeof store.updateLight>[2] = {}
        if (a.patch.lightType != null) patch.type = a.patch.lightType
        if (a.patch.colorTemperature != null) patch.colorTemperature = a.patch.colorTemperature
        if (a.patch.qty != null) patch.qty = a.patch.qty
        if (a.patch.heightM != null) patch.heightM = a.patch.heightM
        if (a.patch.watt != null) patch.watt = a.patch.watt
        store.updateLight(a.roomId, a.lightId, patch)
      } else if (a.type === "removeLight") {
        if (!roomPlan.lighting.some((light) => light.id === a.lightId)) continue
        store.removeLight(a.roomId, a.lightId)
      }
      applied++
    } catch {
      // skip a failing action; keep applying the rest
    }
  }
  return applied
}

/**
 * Apply a proposal as one conceptual transaction. Any stale/invalid action
 * rolls the whole store back; a successful batch is collapsed to one Undo.
 */
export function applyFloorplanActionsAtomic(actions: FloorplanAction[]): boolean {
  if (actions.length === 0) return false
  const before = useEditorStore.getState()
  const applied = applyFloorplanActions(actions)
  if (applied !== actions.length) {
    useEditorStore.setState(before, true)
    return false
  }
  const after = useEditorStore.getState()
  useEditorStore.setState({
    ...after,
    past: before.layout ? [...before.past, before.layout] : before.past,
    future: [],
  }, true)
  return true
}

export function applyInteriorActionsAtomic(actions: InteriorAction[]): boolean {
  if (actions.length === 0) return false
  const before = useInteriorStore.getState()
  const applied = applyInteriorActions(actions)
  if (applied !== actions.length) {
    useInteriorStore.setState(before, true)
    return false
  }
  const after = useInteriorStore.getState()
  const historyEntry = before.plan ? {
    plan: before.plan,
    selectedRoomId: before.selectedRoomId,
    selectedFurnitureId: before.selectedFurnitureId,
    selectedLightId: before.selectedLightId,
  } : null
  useInteriorStore.setState({
    ...after,
    history: historyEntry ? [...before.history, historyEntry].slice(-30) : before.history,
    future: [],
  }, true)
  return true
}
