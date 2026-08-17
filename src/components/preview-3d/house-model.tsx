"use client"

import * as React from "react"
import { Html, useGLTF } from "@react-three/drei"
import { useThree, type ThreeEvent } from "@react-three/fiber"

import type { DesignLayout, ExteriorLamp, InteriorSurface, MaterialAssignment, PlacedFurniture, Project } from "@/types"
import { useInteriorStore } from "@/stores/interior-store"
import { usePreviewStore } from "@/stores/preview-store"
import {
  buildModel,
  EXPLODE_GAP,
  OPEN_TYPES,
  ROOFTOP_RAIL_ID,
  SLAB_T,
  WALL_H,
  WALL_T,
  hazardOpenSides,
  type Prim,
  type PrimKind,
} from "@/lib/three/build-model"
import { buildingFootprint } from "@/lib/structural/grid"
import { floorElevations } from "@/lib/geometry/vertical"
import { clampRooftopArea, isPartialRooftop } from "@/lib/geometry/rooftop"
import { Box3, DoubleSide, MeshStandardMaterial, Object3D, Shape, Vector3 } from "three"

import { glassMaterialProps, MATERIAL_PRESETS, SHARED_COLORS } from "@/lib/three/materials"
import { primMaterial, type PrimMaterial } from "@/lib/three/surface"
import { facadeCladdingById } from "@/lib/three/facade-claddings"
import { materialVisualForAssignment, materialVisualForRoof } from "@/lib/three/material-visuals"
import { exteriorSurfaceKindForMaterial, resolveExteriorMaterial } from "@/lib/exterior/materials"
import { openingVisualSpec } from "@/lib/three/opening-visuals"
import { landscapePlacements } from "@/lib/three/landscape"
import { effectiveLamps } from "@/lib/three/lamps"
import { FurnitureModel, GlbErrorBoundary } from "@/components/preview-3d/furniture-model"
import { HumanFigure } from "@/components/preview-3d/human-figure"
import { registeredModelUrls, resolveFurnitureSource } from "@/lib/three/furniture-models"
import { worldToRoomLocal } from "@/lib/three/drag-plane"
import { GableEndWall, GablePrism, HipPyramid, SkillionWedge } from "@/components/preview-3d/roof-geometry"
import * as THREE from "three"

import { buildGableFrameGeometry } from "@/lib/three/roof-geometry-core"
import { computeFitTransformOriented } from "@/lib/three/fit-transform"

type Site = { widthM: number; depthM: number }

const CLICKABLE: PrimKind[] = ["tile", "garden", "pool"]
const HTML_LABEL_Z_INDEX_RANGE: [number, number] = [20, 0]

function materialKey(roomId: string, surface: InteriorSurface): string {
  return `${roomId}:${surface}`
}

function surfaceForPrimMaterial(kind: PrimKind): InteriorSurface | null {
  if (kind === "tile") return "floor"
  if (kind === "wall" || kind === "riser") return "wall"
  return null
}

function materialOverrideForPrim(
  kind: PrimKind,
  roomId: string | undefined,
  materialByRoomSurface: Map<string, MaterialAssignment>
): ReturnType<typeof materialVisualForAssignment> {
  const surface = surfaceForPrimMaterial(kind)
  if (!roomId || !surface) return undefined
  return materialVisualForAssignment(materialByRoomSurface.get(materialKey(roomId, surface)))
}

export function HouseModel({
  layout,
  site,
  project,
}: {
  layout: DesignLayout
  site: Site
  project: Project
}) {
  const exploded = usePreviewStore((s) => s.exploded)
  const selectedWallId = usePreviewStore((s) => s.selectedWallId)
  const selectWall = usePreviewStore((s) => s.selectWall)
  const showRoof = usePreviewStore((s) => s.showRoof)
  const showLabels = usePreviewStore((s) => s.showLabels)
  const showHumanScale = usePreviewStore((s) => s.showHumanScale)
  const showVegetation = usePreviewStore((s) => s.showVegetation)
  const night = usePreviewStore((s) => s.nightMode)
  const selectRoof = usePreviewStore((s) => s.selectRoof)
  const selectedLampId = usePreviewStore((s) => s.selectedLampId)
  const selectLamp = usePreviewStore((s) => s.selectLamp)
  const selectRailing = usePreviewStore((s) => s.selectRailing)
  const presetId = usePreviewStore((s) => s.materialPreset)
  const realistic = usePreviewStore((s) => s.realistic)
  const glassRealistic = usePreviewStore((s) => s.glassRealistic)
  const glassProps = glassMaterialProps(glassRealistic)
  // frameloop="demand": material JSX-prop swaps already invalidate via the
  // r3f reconciler, but `transmission` needs the renderer's offscreen pass
  // primed — force one extra render right after the toggle flips so it never
  // shows the pre-transmission frame under demand mode.
  const invalidate = useThree((s) => s.invalidate)
  React.useEffect(() => {
    invalidate()
  }, [glassRealistic, invalidate])
  const visibleFloors = usePreviewStore((s) => s.visibleFloors)
  const selectedRoomId = usePreviewStore((s) => s.selectedRoomId)
  const selectRoom = usePreviewStore((s) => s.selectRoom)
  const selectedExteriorElementId = usePreviewStore((s) => s.selectedExteriorElementId)
  const selectExteriorElement = usePreviewStore((s) => s.selectExteriorElement)

  // HouseModel TIDAK lagi subscribe seluruh interior plan: drag furniture
  // memutasi plan per pointermove dan dulu me-reconcile seluruh pohon prim.
  // Yang dibutuhkan di sini hanya MATERIAL per ruang — subscribe via
  // SIGNATURE string (stabil selama material tak berubah), lalu baca nilai
  // non-reaktif di useMemo. Render furniture pindah ke <FurnitureLayer>.
  const materialsSig = useInteriorStore((s) =>
    s.plan
      ? s.plan.rooms
          .map((r) => r.roomId + ":" + r.materials.map((m) => m.surface + "=" + m.materialId).join(","))
          .join("|")
      : ""
  )

  const model = React.useMemo(
    () => buildModel(layout, site, project, { exploded, showRoof, showFurniture: false }),
    [layout, site, project, exploded, showRoof]
  )
  const vegetation = React.useMemo(() => landscapePlacements(layout), [layout])
  const lamps = React.useMemo(() => effectiveLamps(layout), [layout])

  const preset = MATERIAL_PRESETS[presetId]
  const cx = site.widthM / 2
  const cz = site.depthM / 2
  const floorStep = WALL_H + SLAB_T
  // Tabel elevasi (Fase D): baseY per lantai dari Floor.heightM — pengganti
  // index array × floorStep (index array ≠ index stacking begitu ada
  // mezzanine, dan tinggi lantai kini data). Gap explode via index stacking.
  const floorElevById = React.useMemo(
    () => floorElevations(layout.floors),
    [layout.floors]
  )
  const floorBaseY = React.useCallback(
    (floorId: string, gapM: number) => {
      const e = floorElevById.get(floorId)
      return e ? e.baseY + e.index * gapM : 0
    },
    [floorElevById]
  )
  // Dibaca non-reaktif; materialsSig menjamin memo hanya kadaluarsa saat
  // material benar-benar berubah (bukan tiap drag furniture).
  const materialByRoomSurface = React.useMemo(() => {
    const map = new Map<string, MaterialAssignment>()
    useInteriorStore.getState().plan?.rooms.forEach((roomPlan) => {
      roomPlan.materials.forEach((material) => {
        map.set(materialKey(roomPlan.roomId, material.surface), material)
      })
    })
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materialsSig])

  const setCursor = (v: string) => {
    if (typeof document !== "undefined") document.body.style.cursor = v
  }

  // Scale figure: stand a 1.7 m human in the largest walled ground-floor room
  // (slightly off-center so it doesn't z-fight the room label / furniture).
  const humanPos = React.useMemo<[number, number, number] | null>(() => {
    const ground = layout.floors[0]
    if (!ground) return null
    const candidates = layout.rooms
      .filter((r) => r.floorId === ground.id && !OPEN_TYPES.includes(r.type))
      .sort((a, b) => b.areaM2 - a.areaM2)
    const target = candidates[0]
    if (!target) return null
    return [
      target.x + target.width / 2 - cx + Math.min(0.5, target.width * 0.2),
      SLAB_T + (target.levelOffsetM ?? 0),
      target.y + target.depth / 2 - cz,
    ]
  }, [layout, cx, cz])

  return (
    <group>
      {model.prims.map((p) => {
        if (p.floorId && !visibleFloors[p.floorId]) return null

        if (p.kind === "door" || p.kind === "window") {
          return <OpeningPrimitive key={p.id} prim={p} />
        }

        if (p.kind === "wall_gable") {
          // SOPI-SOPI: dinding/kaca ujung bubungan — warna dinding preset;
          // klik = buka kartu atap (kontrol gableEnds ada di sana).
          const gwMat = primMaterial("wall", preset, realistic)
          return (
            <group
              key={p.id}
              onClick={(e: ThreeEvent<MouseEvent>) => {
                e.stopPropagation()
                if (e.delta > 4) return
                selectRoof(true)
              }}
              onContextMenu={(e: ThreeEvent<MouseEvent>) => {
                e.stopPropagation()
                selectRoof(true)
              }}
              onPointerOver={(e) => { e.stopPropagation(); setCursor("pointer") }}
              onPointerOut={() => setCursor("auto")}
            >
              <GableEndWall
                position={p.pos}
                args={p.args}
                color={p.tint ?? gwMat.color}
                map={gwMat.map}
                roughness={gwMat.roughness}
                metalness={gwMat.metalness}
                side={p.dir ?? "w"}
                overhangM={p.gableOverhangM ?? 0}
                ridgeOffsetM={p.ridgeOffsetM ?? 0}
                glass={p.glassEnd === true}
              />
            </group>
          )
        }

        if (p.kind === "roof_gable" || p.kind === "roof_hip" || p.kind === "roof_skillion") {
          const roofMat = primMaterial(p.kind, preset, realistic, materialVisualForRoof(p.roofMaterial ?? layout.roof?.material))
          const roofShapeProps = {
            position: p.pos,
            args: p.args,
            color: roofMat.color,
            map: roofMat.map,
            roughness: roofMat.roughness,
            metalness: roofMat.metalness,
          }
          return (
            // Klik atap = buka RoofQuickEditor (event r3f menggelembung ke group).
            <group
              key={p.id}
              onClick={(e: ThreeEvent<MouseEvent>) => {
                e.stopPropagation()
                if (e.delta > 4) return
                selectRoof(true)
              }}
              onContextMenu={(e: ThreeEvent<MouseEvent>) => {
                e.stopPropagation()
                selectRoof(true)
              }}
              onPointerOver={(e) => { e.stopPropagation(); setCursor("pointer") }}
              onPointerOut={() => setCursor("auto")}
            >
              {p.kind === "roof_skillion" ? (
                <SkillionWedge {...roofShapeProps} lowSide={p.dir ?? "s"} />
              ) : p.kind === "roof_gable" ? (
                <GablePrism
                  {...roofShapeProps}
                  ridgeOffsetM={p.ridgeOffsetM ?? 0}
                  openEnds={p.openGableEnds}
                />
              ) : (
                <HipPyramid {...roofShapeProps} />
              )}
            </group>
          )
        }

        const mat = primMaterial(
          p.kind,
          preset,
          realistic,
          materialOverrideForPrim(p.kind, p.roomId, materialByRoomSurface)
            ?? (p.kind === "roof" ? materialVisualForRoof(p.roofMaterial ?? layout.roof?.material) : undefined)
        )

        if (p.kind === "exterior" && p.exteriorElement) {
          const resolved = resolveExteriorMaterial(
            p.exteriorElement.material,
            exteriorSurfaceKindForMaterial(p.exteriorElement.kind)
          )
          const exteriorMat = primMaterial(
            "exterior",
            preset,
            realistic,
            resolved.visual,
          )
          return (
            <ExteriorPrimitiveMesh
              key={p.id}
              prim={p}
              mat={exteriorMat}
              selected={selectedExteriorElementId === p.exteriorElement.id}
              onSelect={() => selectExteriorElement(p.exteriorElement!.id)}
              setCursor={setCursor}
            />
          )
        }

        if (p.kind === "louver" && p.facadeElement?.modelUrl) {
          const horizontal = p.args[0] >= p.args[2]
          const width = horizontal ? p.args[0] : p.args[2]
          const height = p.args[1]
          const fallback = (
            <mesh>
              <boxGeometry args={p.args} />
              <meshStandardMaterial color={p.tint ?? mat.color} roughness={mat.roughness} metalness={mat.metalness} />
            </mesh>
          )
          return (
            <group key={p.id} position={p.pos}>
              <GlbErrorBoundary fallback={fallback}>
                <React.Suspense fallback={fallback}>
                  <FacadeElementModelGLB
                    url={p.facadeElement.modelUrl}
                    width={width}
                    height={height}
                    horizontal={horizontal}
                  />
                </React.Suspense>
              </GlbErrorBoundary>
            </group>
          )
        }

        // Dinding milik ruang: bisa diklik (pilih dinding → cladding fasad)
        // dan muka LUAR-nya bisa memakai material cladding per dinding.
        if (p.kind === "wall" && p.roomId && p.wallSide) {
          const wallKey = `${p.roomId}:${p.wallSide}`
          const cladding = facadeCladdingById(layout.facade?.[p.facadeKey ?? wallKey])
          const inner = facadeCladdingById(layout.facadeInner?.[wallKey])
          // Repeat tekstur proporsional dimensi muka dinding (panjang×tinggi)
          // — ukuran bata/kayu konsisten antar dinding 8 m dan 1,5 m.
          const faceDims = {
            widthM: p.wallSide === "n" || p.wallSide === "s" ? p.args[0] : p.args[2],
            heightM: p.args[1],
          }
          return (
            <FacadeWallMesh
              key={p.id}
              prim={p}
              baseMat={mat}
              cladMat={cladding ? primMaterial("wall", preset, realistic, cladding.visual, faceDims) : null}
              innerMat={inner ? primMaterial("wall", preset, realistic, inner.visual, faceDims) : null}
              selected={selectedWallId === wallKey}
              onSelect={(e) => {
                e.stopPropagation()
                if (e.delta > 4) return // seret orbit, bukan klik
                selectWall(wallKey)
              }}
              setCursor={setCursor}
            />
          )
        }

        const clickable = CLICKABLE.includes(p.kind) && p.roomId
        if (clickable) {
          // Leaf component: state hover LOKAL — dulu hover useState di root
          // membuat seluruh pohon prim di-reconcile tiap kursor melintas ruang.
          return (
            <RoomTilePrim
              key={p.id}
              prim={p}
              mat={mat}
              selected={p.roomId === selectedRoomId}
              onSelect={() => selectRoom(p.roomId!)}
              setCursor={setCursor}
            />
          )
        }
        const color = p.tint ?? mat.color
        const transparent = p.kind === "pool" || p.kind === "rail_glass" || p.kind === "roof_glass"
        const opacity = p.kind === "pool" ? 0.85 : p.kind === "rail_glass" ? 0.3 : p.kind === "roof_glass" ? 0.35 : 1

        return (
          <mesh
            key={p.id}
            position={p.pos}
            rotation={[0, p.rotationY ?? 0, 0]}
            onClick={
              p.kind === "roof" || p.kind === "fascia"
                ? (e: ThreeEvent<MouseEvent>) => {
                    e.stopPropagation()
                    if (e.delta > 4) return
                    selectRoof(true)
                  }
                : (p.kind === "rail" || p.kind === "rail_glass") && p.roomId && p.id.startsWith("rail")
                  ? (e: ThreeEvent<MouseEvent>) => {
                      e.stopPropagation()
                      if (e.delta > 4) return
                      selectRailing(p.roomId!)
                    }
                  : undefined
            }
            onContextMenu={
              p.kind === "roof" || p.kind === "fascia"
                ? (e: ThreeEvent<MouseEvent>) => {
                    e.stopPropagation()
                    selectRoof(true)
                  }
                : (p.kind === "rail" || p.kind === "rail_glass") && p.roomId && p.id.startsWith("rail")
                  ? (e: ThreeEvent<MouseEvent>) => {
                      e.stopPropagation()
                      selectRailing(p.roomId!)
                    }
                  : undefined
            }
            onPointerOver={
              p.kind === "roof" || p.kind === "fascia" || ((p.kind === "rail" || p.kind === "rail_glass") && p.roomId && p.id.startsWith("rail"))
                ? (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); setCursor("pointer") }
                : undefined
            }
            onPointerOut={
              p.kind === "roof" || p.kind === "fascia" || ((p.kind === "rail" || p.kind === "rail_glass") && p.roomId && p.id.startsWith("rail"))
                ? () => setCursor("auto")
                : undefined
            }
            castShadow={p.kind === "wall" || p.kind === "riser" || p.kind === "roof" || p.kind === "fascia" || p.kind === "louver" || p.kind === "stair"}
            receiveShadow={p.kind === "slab" || p.kind === "tile" || p.kind === "garden"}
          >
            <boxGeometry args={p.args} />
            {/* Railing kaca: "Kaca realistis" ON → meshPhysicalMaterial transmisif;
                OFF (atau prim lain apa pun) → material lama byte-identical. */}
            {p.kind === "rail_glass" && glassProps ? (
              <meshPhysicalMaterial
                color={color}
                transparent={transparent}
                opacity={opacity}
                depthWrite={false}
                roughness={glassProps.roughness}
                transmission={glassProps.transmission}
                ior={glassProps.ior}
                thickness={glassProps.thickness}
                clearcoat={glassProps.clearcoat}
                clearcoatRoughness={glassProps.clearcoatRoughness}
                polygonOffset={(p.depthRank ?? 0) > 0}
                polygonOffsetFactor={p.depthRank ?? 0}
                polygonOffsetUnits={(p.depthRank ?? 0) * 2}
              />
            ) : (
              <meshStandardMaterial
                color={color}
                map={mat.map ?? undefined}
                transparent={transparent}
                opacity={opacity}
                depthWrite={p.kind !== "rail_glass" && p.kind !== "roof_glass"}
                roughness={p.kind === "rail_glass" ? 0.05 : mat.roughness}
                metalness={p.kind === "rail_glass" ? 0.1 : mat.metalness}
                polygonOffset={(p.depthRank ?? 0) > 0}
                polygonOffsetFactor={p.depthRank ?? 0}
                polygonOffsetUnits={(p.depthRank ?? 0) * 2}
              />
            )}
          </mesh>
        )
      })}

      {/* Furniture di layer terpisah dgn subscription store sendiri — drag
          per-pointermove tak lagi me-reconcile seluruh pohon prim statis. */}
      <FurnitureLayer
        layout={layout}
        cx={cx}
        cz={cz}
        floorStep={floorStep}
        exploded={exploded}
        floorBaseY={floorBaseY}
        setCursor={setCursor}
      />

      {showHumanScale && humanPos && layout.floors[0] && visibleFloors[layout.floors[0].id] && (
        <HumanFigure position={humanPos} rotationY={Math.PI * 0.2} />
      )}

      {/* Lampu eksterior — fixture terlihat siang; malam: emissive + point
          light nyata (dibatasi 6 sumber demi performa) sehingga cahaya malam
          punya sumber, bukan hanya jendela yang berpendar. */}
      {lamps.map((l, i) => {
        if (!visibleFloors[l.floorId]) return null
        const baseY = floorBaseY(l.floorId, exploded ? EXPLODE_GAP : 0) + SLAB_T
        return (
          <LampFixture
            key={l.id}
            lamp={l}
            night={night}
            lit={night && i < 6 && (l.intensity ?? 1) > 0}
            selected={l.id === selectedLampId}
            onSelect={() => selectLamp(l.id)}
            position={[l.x - cx, baseY, l.y - cz]}
          />
        )
      })}

      {/* Railing GLB kustom — balkon dgn railingModelUrl: model dari library
          di-tile sepanjang sisi TERBUKA yang sama dengan auto-railing
          (hazardOpenSides — build-model men-skip prim gaya bawaannya). */}
      {layout.rooms
        .filter((r) => r.type === "balkon" && r.railingModelUrl && visibleFloors[r.floorId])
        .flatMap((r) => {
          const topY =
            floorBaseY(r.floorId, exploded ? EXPLODE_GAP : 0) + SLAB_T + (r.levelOffsetM ?? 0)
          const others = layout.rooms.filter((o) => o.floorId === r.floorId && o.id !== r.id)
          return hazardOpenSides(r, others).map((side) => {
            const horizontal = side === "n" || side === "s"
            const len = horizontal ? r.width : r.depth
            const pos: [number, number, number] =
              side === "n" ? [r.x + r.width / 2 - cx, topY, r.y - cz]
              : side === "s" ? [r.x + r.width / 2 - cx, topY, r.y + r.depth - cz]
              : side === "w" ? [r.x - cx, topY, r.y + r.depth / 2 - cz]
              : [r.x + r.width - cx, topY, r.y + r.depth / 2 - cz]
            return (
              <CustomRailingRun
                key={`crail-${r.id}-${side}`}
                url={r.railingModelUrl!}
                position={pos}
                lengthM={len}
                horizontal={horizontal}
                onSelect={(e) => {
                  e.stopPropagation()
                  if (e.delta > 4) return
                  selectRailing(r.id)
                }}
                setCursor={setCursor}
              />
            )
          })
        })}

      {/* Railing GLB kustom DAK ROOFTOP — dak bukan Room, jadi perimeter dihitung
          di sini (footprint / rect deck parsial) & GLB di-tile keliling 4 sisi
          pada tinggi dak. build-model men-skip prim gaya bawaannya. */}
      {(() => {
        const url = layout.rooftopRailingModelUrl
        const hasRt = layout.floors.some((f) => f.id === "floor-rooftop")
        if (!url || !hasRt || !visibleFloors["floor-rooftop"]) return null
        const fp = buildingFootprint(layout)
        if (fp.widthM <= 0 || fp.depthM <= 0) return null
        const deck =
          isPartialRooftop(layout) && layout.rooftopArea
            ? clampRooftopArea(layout.rooftopArea, fp)
            : { x: fp.x0, y: fp.y0, width: fp.widthM, depth: fp.depthM }
        const topY = floorBaseY("floor-rooftop", exploded ? EXPLODE_GAP : 0) + SLAB_T
        const midX = deck.x + deck.width / 2 - cx
        const midZ = deck.y + deck.depth / 2 - cz
        const sides: Array<{ key: string; horizontal: boolean; len: number; pos: [number, number, number] }> = [
          { key: "n", horizontal: true, len: deck.width, pos: [midX, topY, deck.y - cz] },
          { key: "s", horizontal: true, len: deck.width, pos: [midX, topY, deck.y + deck.depth - cz] },
          { key: "w", horizontal: false, len: deck.depth, pos: [deck.x - cx, topY, midZ] },
          { key: "e", horizontal: false, len: deck.depth, pos: [deck.x + deck.width - cx, topY, midZ] },
        ]
        return sides.map((s) => (
          <CustomRailingRun
            key={`rtrail-${s.key}`}
            url={url}
            position={s.pos}
            lengthM={s.len}
            horizontal={s.horizontal}
            onSelect={(e) => {
              e.stopPropagation()
              if (e.delta > 4) return
              selectRailing(ROOFTOP_RAIL_ID)
            }}
            setCursor={setCursor}
          />
        ))
      })()}

      {/* Vegetasi taman — konteks render (deterministik per ruang taman) */}
      {showVegetation &&
        vegetation.map((p) => {
          if (!visibleFloors[p.floorId]) return null
          const baseY = floorBaseY(p.floorId, exploded ? EXPLODE_GAP : 0) + SLAB_T
          const pos: [number, number, number] = [p.x - cx, baseY, p.y - cz]
          return p.kind === "tree" ? (
            <TreeMesh key={p.id} position={pos} scale={p.scale} />
          ) : (
            <BushMesh key={p.id} position={pos} scale={p.scale} />
          )
        })}

      {showLabels &&
        model.labels.map((l) =>
          visibleFloors[l.floorId] ? (
            <Html
              key={l.id}
              position={l.pos}
              center
              distanceFactor={14}
              zIndexRange={HTML_LABEL_Z_INDEX_RANGE}
              style={{ pointerEvents: "none" }}
            >
              <div className="pointer-events-none whitespace-nowrap rounded bg-background/85 px-1.5 py-0.5 text-[10px] font-medium text-foreground shadow-sm">
                {l.name}
              </div>
            </Html>
          ) : null
        )}
    </group>
  )
}

export function ExteriorPrimitiveMesh({
  prim,
  mat,
  selected,
  onSelect,
  setCursor,
}: {
  prim: Prim
  mat: PrimMaterial
  selected: boolean
  onSelect: () => void
  setCursor: (value: string) => void
}) {
  const selectProps = {
    onClick: (event: ThreeEvent<MouseEvent>) => {
      event.stopPropagation()
      if (event.delta > 4) return
      onSelect()
    },
    // Klik-kanan = pilih entity ini, lalu context-menu DOM (preview-3d-view)
    // menampilkan aksi untuk kind terpilih.
    onContextMenu: (event: ThreeEvent<MouseEvent>) => {
      event.stopPropagation()
      onSelect()
    },
    onPointerOver: (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation()
      setCursor("pointer")
    },
    onPointerOut: () => setCursor("auto"),
  }
  const color = selected ? "#f59e0b" : (prim.tint ?? mat.color)

  if (prim.surfacePoints) {
    return (
      <ExteriorSurfaceMesh
        points={prim.surfacePoints}
        y={prim.pos[1]}
        color={color}
        roughness={mat.roughness}
        metalness={mat.metalness}
        {...selectProps}
      />
    )
  }

  const fallback = prim.gableFrame ? (
    <GableFrameMesh prim={prim} color={color} mat={mat} />
  ) : (
    <mesh castShadow receiveShadow>
      <boxGeometry args={prim.args} />
      <meshStandardMaterial
        color={color}
        map={mat.map ?? undefined}
        roughness={mat.roughness}
        metalness={mat.metalness}
      />
    </mesh>
  )
  const modelUrl = prim.exteriorElement?.model?.modelUrl

  return (
    <group position={prim.pos} rotation={[0, prim.rotationY ?? 0, 0]} {...selectProps}>
      {modelUrl ? (
        <GlbErrorBoundary fallback={fallback}>
          <React.Suspense fallback={fallback}>
            <ExteriorModelGLB url={modelUrl} args={prim.args} />
          </React.Suspense>
        </GlbErrorBoundary>
      ) : fallback}
    </group>
  )
}

/** BINGKAI GABLE (W4): outline pelana asimetris — geometri custom, origin
 *  prim di tengah-dasar (group induk sudah memberi pos+rotationY). */
function GableFrameMesh({
  prim,
  color,
  mat,
}: {
  prim: Prim
  color: string
  mat: PrimMaterial
}) {
  const gf = prim.gableFrame!
  const geometry = React.useMemo(
    () =>
      buildGableFrameGeometry(
        prim.args[0],
        prim.args[1],
        gf.eaveLeftM,
        gf.eaveRightM,
        gf.apexOffsetM,
        gf.memberM,
        prim.args[2],
      ),
    [prim.args, gf]
  )
  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial
        color={color}
        map={mat.map ?? undefined}
        roughness={mat.roughness}
        metalness={mat.metalness}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

function ExteriorSurfaceMesh({
  points,
  y,
  color,
  roughness,
  metalness,
  ...events
}: {
  points: Array<[number, number]>
  y: number
  color: string
  roughness: number
  metalness: number
  onClick: (event: ThreeEvent<MouseEvent>) => void
  onPointerOver: (event: ThreeEvent<PointerEvent>) => void
  onPointerOut: () => void
}) {
  const shape = React.useMemo(() => {
    const value = new Shape()
    points.forEach(([x, z], index) => {
      if (index === 0) value.moveTo(x, z)
      else value.lineTo(x, z)
    })
    value.closePath()
    return value
  }, [points])
  return (
    <mesh position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]} receiveShadow {...events}>
      <shapeGeometry args={[shape]} />
      <meshStandardMaterial
        color={color}
        roughness={roughness}
        metalness={metalness}
        side={DoubleSide}
      />
    </mesh>
  )
}

// Asset-bank GLBs from the Blender/SketchUp pipeline (skp2glb.py,
// batch_in_process.py) export with KHR_draco_mesh_compression enabled.
// Passing "/draco/" here (all useGLTF calls below) makes decoding use the
// self-hosted decoder in public/draco/ — mirrors furniture-model.tsx's
// GlbModel. Without it, drei's useGLTF STILL decodes fine (useDraco defaults
// to true) but silently fetches the wasm decoder from Google's gstatic CDN,
// an unnecessary external dependency for a bundled asset.
function ExteriorModelGLB({
  url,
  args,
}: {
  url: string
  args: [number, number, number]
}) {
  const { scene } = useGLTF(url, "/draco/")
  const cloned = React.useMemo(() => scene.clone(true), [scene])
  const bbox = React.useMemo(() => {
    const box = new Box3().setFromObject(cloned)
    const size = new Vector3()
    const center = new Vector3()
    box.getSize(size)
    box.getCenter(center)
    return {
      size: [size.x, size.y, size.z] as [number, number, number],
      center: [center.x, center.y, center.z] as [number, number, number],
    }
  }, [cloned])
  const fit = React.useMemo(
    () => computeFitTransformOriented(bbox, { w: args[0], h: args[1], d: args[2] }),
    [bbox, args],
  )
  return (
    <group rotation={[0, fit.rotationY, 0]}>
      <primitive
        object={cloned}
        position={[fit.position[0], fit.position[1] - args[1] / 2, fit.position[2]]}
        scale={fit.scale}
      />
    </group>
  )
}

/** Tinggi target model GLB lampu per jenis (skala uniform dari bbox). */
const LAMP_MODEL_TARGET_H: Record<ExteriorLamp["kind"], number> = {
  wall: 0.35,
  bollard: 0.8,
  canopy: 0.25,
}

/**
 * Model GLB kustom untuk lampu (dari asset library) — dinormalisasi ke tinggi
 * nominal jenisnya supaya model berukuran sembarang tetap proporsional.
 */
function LampModelGLB({
  url,
  position,
  targetH,
}: {
  url: string
  position: [number, number, number]
  targetH: number
}) {
  const { scene } = useGLTF(url, "/draco/")
  const cloned = React.useMemo(() => scene.clone(true), [scene])
  const scale = React.useMemo(() => {
    const box = new Box3().setFromObject(cloned)
    const size = new Vector3()
    box.getSize(size)
    const maxDim = Math.max(size.x, size.y, size.z) || 1
    return targetH / maxDim
  }, [cloned, targetH])
  return <primitive object={cloned} position={position} scale={scale} />
}

/**
 * Prim lantai ruang yang bisa diklik (tile/garden/pool) — hover state LOKAL
 * sehingga pointerover hanya me-render 1 mesh ini, bukan seluruh HouseModel.
 */
function RoomTilePrim({
  prim,
  mat,
  selected,
  onSelect,
  setCursor,
}: {
  prim: Prim
  mat: PrimMaterial
  selected: boolean
  onSelect: () => void
  setCursor: (v: string) => void
}) {
  const [hovered, setHovered] = React.useState(false)
  const color = selected ? SHARED_COLORS.selected : hovered ? SHARED_COLORS.hover : prim.tint ?? mat.color
  const transparent = prim.kind === "pool"
  return (
    <mesh
      position={prim.pos}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation()
        if (e.delta > 4) return // seret orbit, bukan klik
        onSelect()
      }}
      onContextMenu={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation()
        onSelect()
      }}
      onPointerOver={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation()
        setHovered(true)
        setCursor("pointer")
      }}
      onPointerOut={() => {
        setHovered(false)
        setCursor("auto")
      }}
      receiveShadow={prim.kind === "tile"}
    >
      <boxGeometry args={prim.args} />
      <meshStandardMaterial
        color={color}
        map={mat.map ?? undefined}
        transparent={transparent}
        opacity={transparent ? 0.85 : 1}
        roughness={mat.roughness}
        metalness={mat.metalness}
        polygonOffset={(prim.depthRank ?? 0) > 0}
        polygonOffsetFactor={prim.depthRank ?? 0}
        polygonOffsetUnits={(prim.depthRank ?? 0) * 2}
      />
    </mesh>
  )
}

/**
 * Layer furniture interior — subscribe interior-store SENDIRI (plan, seleksi,
 * drag) sehingga mutasi per-pointermove saat drag hanya me-render layer ini;
 * prim statis rumah (dinding/atap/dst.) tidak ikut di-reconcile.
 */
function FurnitureLayer({
  layout,
  cx,
  cz,
  floorStep,
  exploded,
  floorBaseY,
  setCursor,
}: {
  layout: DesignLayout
  cx: number
  cz: number
  floorStep: number
  exploded: boolean
  floorBaseY: (floorId: string, gapM: number) => number
  setCursor: (v: string) => void
}) {
  const showFurniture = usePreviewStore((s) => s.showFurniture)
  const showInteriorLabels = usePreviewStore((s) => s.showInteriorLabels)
  const visibleFloors = usePreviewStore((s) => s.visibleFloors)
  const selectedRoomId = usePreviewStore((s) => s.selectedRoomId)
  const selectRoom = usePreviewStore((s) => s.selectRoom)
  const setDragging = usePreviewStore((s) => s.setDragging)
  const isEditMode = usePreviewStore((s) => s.interactionMode) === "edit"
  const interiorPlan = useInteriorStore((s) => s.plan)
  const selectedFurnitureId = useInteriorStore((s) => s.selectedFurnitureId)
  const selectFurniture = useInteriorStore((s) => s.selectFurniture)
  const moveFurniture = useInteriorStore((s) => s.moveFurniture)
  const settleFurniture = useInteriorStore((s) => s.settleFurniture)

  // Preload HANYA GLB yang benar-benar dipakai plan saat ini — dulu seluruh
  // registry (19 file ≈ 8 MB) diunduh tiap mount preview, terpakai atau tidak.
  React.useEffect(() => {
    if (!interiorPlan) return
    const urls = new Set<string>()
    const registered = new Set(registeredModelUrls())
    interiorPlan.rooms.forEach((rp) =>
      rp.furniture.forEach((item) => {
        if (item.modelUrl) {
          urls.add(item.modelUrl)
          return
        }
        const src = resolveFurnitureSource({ furnitureId: item.furnitureId, category: item.category })
        if (src.kind === "glb" && registered.has(src.url)) urls.add(src.url)
      })
    )
    urls.forEach((u) => useGLTF.preload(u, "/draco/"))
  }, [interiorPlan])

  if (!showFurniture) return null
  return (
    <>
      {interiorPlan?.rooms.flatMap((roomPlan) => {
        const room = layout.rooms.find((item) => item.id === roomPlan.roomId)
        if (!room) return []
        if (!visibleFloors[room.floorId]) return []
        const baseY = floorBaseY(room.floorId, exploded ? EXPLODE_GAP : 0)
        const slabTopY = baseY + SLAB_T

        return roomPlan.furniture.map((item) => {
          const height = sceneFurnitureHeight(item)
          const selected = item.id === selectedFurnitureId
          const posX = room.x + item.x + item.widthM / 2 - cx
          const posZ = room.y + item.y + item.depthM / 2 - cz
          const posBase: [number, number, number] = [
            posX,
            slabTopY + sceneFurnitureYOffset(item),
            posZ,
          ]
          return (
            <group key={item.id}>
              <FurnitureModel
                item={item}
                position={posBase}
                rotationDeg={item.rotationDeg}
                selected={selected}
                color={interiorFurnitureColor(item)}
                dims={{ w: item.widthM, d: item.depthM, h: height }}
                onSelect={() => { selectRoom(room.id); selectFurniture(item.id) }}
                onHoverChange={(hovering) => setCursor(hovering ? "pointer" : "auto")}
                floorY={slabTopY}
                onDragStart={isEditMode ? () => setDragging(item.id) : undefined}
                onDrag={isEditMode ? (wx, wz) => {
                  const local = worldToRoomLocal({
                    worldX: wx, worldZ: wz,
                    roomX: room.x, roomY: room.y, cx, cz,
                    widthM: item.widthM, depthM: item.depthM,
                  })
                  moveFurniture(room.id, item.id, local.x, local.y)
                } : undefined}
                onDragEnd={isEditMode ? () => {
                  setDragging(null)
                  // Open-plan zones: if the item was dragged into a zone
                  // sibling, hand ownership over so its coords, warnings, and
                  // budget belong to the room it actually occupies.
                  settleFurniture(room.id, item.id)
                } : undefined}
              />
              {/* Declutter: label furniture hanya utk RUANG TERPILIH — semua
                  ruang sekaligus = hutan label menembus dinding tak terbaca. */}
              {showInteriorLabels && room.id === selectedRoomId && (
                <Html
                  position={[posX, slabTopY + sceneFurnitureYOffset(item) + height + 0.15, posZ]}
                  center
                  distanceFactor={14}
                  zIndexRange={HTML_LABEL_Z_INDEX_RANGE}
                  style={{ pointerEvents: "none" }}
                >
                  <div
                    data-testid="interior-scene-furniture-label"
                    className="pointer-events-none whitespace-nowrap rounded bg-background/90 px-1.5 py-0.5 text-[10px] font-medium text-foreground shadow-sm"
                  >
                    {item.name}
                  </div>
                </Html>
              )}
            </group>
          )
        })
      })}
    </>
  )
}

// ── Railing GLB kustom (balkon) ─────────────────────────────────────────────

const RAIL_H = 1.0

/**
 * Panel kaca sederhana — fallback CustomRailingRun saat GLB masih dimuat atau
 * gagal. Railing adalah elemen PENGAMAN: sisi terbuka tidak boleh tampak
 * kosong walau modelnya bermasalah.
 */
function RailFallbackPanel({
  lengthM,
  horizontal,
}: {
  lengthM: number
  horizontal: boolean
}) {
  return (
    <mesh position={[0, RAIL_H / 2, 0]}>
      <boxGeometry args={horizontal ? [lengthM, RAIL_H, 0.05] : [0.05, RAIL_H, lengthM]} />
      <meshStandardMaterial color="#cfe4ee" transparent opacity={0.3} roughness={0.05} metalness={0.1} depthWrite={false} />
    </mesh>
  )
}

/**
 * Men-tile satu segmen GLB railing sepanjang sisi terbuka balkon:
 * - dinormalisasi uniform ke tinggi railing 1,0 m;
 * - sumbu TERPANJANG horizontal model dianggap arah memanjang (aset SKP tidak
 *   seragam orientasinya), diputar mengikuti arah sisi;
 * - jumlah instance = bulat(panjang sisi ÷ panjang segmen), lalu tiap instance
 *   diregangkan HANYA pada sumbu memanjang agar sambungan rapat menutup penuh
 *   (seperti fabrikasi nyata menyesuaikan lebar panel).
 */
function RailingSegments({ url, lengthM, horizontal }: { url: string; lengthM: number; horizontal: boolean }) {
  const { scene } = useGLTF(url, "/draco/")
  const { size, center } = React.useMemo(() => {
    const b = new Box3().setFromObject(scene)
    const s = new Vector3()
    const c = new Vector3()
    b.getSize(s)
    b.getCenter(c)
    return { size: s, center: c }
  }, [scene])

  const fit = React.useMemo(() => {
    const h = size.y || 1
    const scale = RAIL_H / h
    const lengthAxis: "x" | "z" = size.x >= size.z ? "x" : "z"
    const segLen = Math.max(0.2, (lengthAxis === "x" ? size.x : size.z) * scale)
    const count = Math.max(1, Math.round(lengthM / segLen))
    const stretch = lengthM / (count * segLen)
    // Model sumbu-panjang-x pada sisi horizontal (dan sumbu-z pada sisi
    // vertikal) tidak perlu rotasi; selain itu diputar 90°.
    const rotY = (lengthAxis === "x") === horizontal ? 0 : Math.PI / 2
    return { scale, segLen, count, stretch, rotY, lengthAxis }
  }, [size, lengthM, horizontal])

  const instances = React.useMemo(
    () => Array.from({ length: fit.count }, () => scene.clone(true)),
    [scene, fit.count]
  )

  const instLen = fit.segLen * fit.stretch
  return (
    <>
      {instances.map((obj, i) => {
        const along = -lengthM / 2 + (i + 0.5) * instLen
        // Skala non-uniform hanya pada sumbu memanjang model.
        const sc: [number, number, number] =
          fit.lengthAxis === "x"
            ? [fit.scale * fit.stretch, fit.scale, fit.scale]
            : [fit.scale, fit.scale, fit.scale * fit.stretch]
        return (
          <group
            key={i}
            position={horizontal ? [along, 0, 0] : [0, 0, along]}
            rotation={[0, fit.rotY, 0]}
          >
            <primitive
              object={obj}
              // Pusatkan x/z bbox di titik instance; dudukkan DASAR bbox
              // (min.y) tepat di muka slab (y grup = 0).
              position={[
                -center.x * sc[0],
                -(center.y - size.y / 2) * fit.scale,
                -center.z * sc[2],
              ]}
              scale={sc}
            />
          </group>
        )
      })}
    </>
  )
}

function CustomRailingRun({
  url,
  position,
  lengthM,
  horizontal,
  onSelect,
  setCursor,
}: {
  url: string
  position: [number, number, number]
  lengthM: number
  horizontal: boolean
  onSelect: (e: ThreeEvent<MouseEvent>) => void
  setCursor: (v: string) => void
}) {
  return (
    <group
      position={position}
      onClick={onSelect}
      onContextMenu={onSelect}
      onPointerOver={(e) => { e.stopPropagation(); setCursor("pointer") }}
      onPointerOut={() => setCursor("auto")}
    >
      {/* Hitbox tak terlihat — klik railing GLB = buka RailingQuickEditor. */}
      <mesh position={[0, RAIL_H / 2, 0]} visible={false}>
        <boxGeometry args={horizontal ? [lengthM, RAIL_H, 0.14] : [0.14, RAIL_H, lengthM]} />
      </mesh>
      <GlbErrorBoundary fallback={<RailFallbackPanel lengthM={lengthM} horizontal={horizontal} />}>
        <React.Suspense fallback={<RailFallbackPanel lengthM={lengthM} horizontal={horizontal} />}>
          <RailingSegments url={url} lengthM={lengthM} horizontal={horizontal} />
        </React.Suspense>
      </GlbErrorBoundary>
    </group>
  )
}

/** Offset arah keluar untuk fixture lampu dinding. */
const LAMP_OUT: Record<"n" | "s" | "w" | "e", [number, number]> = {
  n: [0, -1],
  s: [0, 1],
  w: [-1, 0],
  e: [1, 0],
}

/** Dimensi box body fixture lampu dinding (m) — dipakai jg utk hitung standoff. */
export const WALL_LAMP_BODY_ARGS: [number, number, number] = [0.1, 0.26, 0.1]

/**
 * Jarak pusat fixture lampu dinding dari SUMBU (centerline) dinding — BUG:
 * sebelumnya cuma 0,1 m, kurang dari WALL_T/2 (0,06) + separuh kedalaman box
 * (0,045), jadi muka-dalam box masih 0,5 cm terkubur di volume dinding &
 * sisanya nyaris rata dgn permukaan → di render 3D nyaris tak terlihat
 * (menyatu dgn bayangan dinding, kadang z-fighting). Sekarang standoff
 * melewati muka luar dinding + separuh box + margin, fixture selalu
 * menonjol PENUH keluar dari muka dinding.
 */
export const WALL_LAMP_STANDOFF_M = WALL_T / 2 + WALL_LAMP_BODY_ARGS[2] / 2 + 0.03

/**
 * Posisi dunia (x,y,z) box fixture lampu dinding — pusat dinding + standoff
 * KELUAR sepanjang normal sisi, tinggi mountH dari lantai. Murni & dapat
 * diuji lepas dari React Three Fiber.
 */
export function wallLampFixturePosition(
  wallCenterPos: [number, number, number],
  side: "n" | "s" | "w" | "e" | undefined,
  mountH: number
): [number, number, number] {
  const [ox, oz] = LAMP_OUT[side ?? "s"]
  return [
    wallCenterPos[0] + ox * WALL_LAMP_STANDOFF_M,
    wallCenterPos[1] + mountH,
    wallCenterPos[2] + oz * WALL_LAMP_STANDOFF_M,
  ]
}

/**
 * Arah + bukaan kerucut cahaya lampu eksterior per jenis. Diekspor murni agar
 * bisa diuji: untuk lampu DINDING, sumbu kerucut wajib condong KELUAR cukup
 * jauh sehingga (sudut sumbu-dari-normal + setengah bukaan) < 90° — tidak ada
 * satu sinar pun yang mengarah ke balik bidang dinding.
 */
export function lampAim(
  kind: "wall" | "canopy" | "bollard",
  side?: "n" | "s" | "w" | "e"
): { aim: [number, number, number]; angle: number } {
  if (kind === "wall") {
    const [ox, oz] = LAMP_OUT[side ?? "s"]
    // Sumbu (1.8 keluar, 1.2 turun) ≈ 34° dari normal dinding; 34° + 51.5°
    // (angle 0.9 rad) = 85.5° < 90° → seluruh kerucut di sisi luar dinding.
    return { aim: [ox * 1.8, -1.2, oz * 1.8], angle: 0.9 }
  }
  if (kind === "canopy") return { aim: [0, -2, 0], angle: 0.8 }
  return { aim: [0, -1, 0], angle: 1.0 }
}

/**
 * Cahaya lampu eksterior = SPOT berarah keluar/bawah — dulu pointLight yang
 * memancar ke segala arah, dan three.js tidak menghalangi cahaya dengan
 * geometri (tanpa shadow map): lantai ruang di balik tembok ikut terang
 * ("lampunya di luar, cahayanya masuk ke dalam"). Kerucut spot yang seluruh
 * arahnya menjauhi dinding menyelesaikan ini tanpa biaya shadow.
 */
function LampSpot({
  pos,
  aim,
  angle,
  color,
  intensity,
  distance,
}: {
  pos: [number, number, number]
  aim: [number, number, number]
  angle: number
  color: string
  intensity: number
  distance: number
}) {
  const target = React.useMemo(() => new Object3D(), [])
  return (
    <>
      <spotLight
        position={pos}
        target={target}
        color={color}
        intensity={intensity}
        distance={distance}
        angle={angle}
        penumbra={0.6}
        decay={2}
      />
      <primitive object={target} position={[pos[0] + aim[0], pos[1] + aim[1], pos[2] + aim[2]]} />
    </>
  )
}

/**
 * Fixture lampu eksterior. Siang: objek gelap kecil (tetap terlihat sebagai
 * elemen desain). Malam: bagian kaca menyala (emissive) dan — untuk beberapa
 * lampu pertama — memancarkan point light hangat sungguhan ke fasad/lantai.
 */
function LampFixture({
  lamp,
  night,
  lit,
  selected,
  onSelect,
  position,
}: {
  lamp: ExteriorLamp
  night: boolean
  lit: boolean
  selected: boolean
  onSelect: () => void
  position: [number, number, number]
}) {
  const warm = lamp.color ?? "#ffc98a"
  const body = "#2f3436"
  const boost = lamp.intensity ?? 1
  const handlers = {
    onClick: (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation()
      if (e.delta > 4) return
      onSelect()
    },
    onContextMenu: (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation()
      onSelect()
    },
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation()
      if (typeof document !== "undefined") document.body.style.cursor = "pointer"
    },
    onPointerOut: () => {
      if (typeof document !== "undefined") document.body.style.cursor = "auto"
    },
  }
  const glowMat = (
    <meshStandardMaterial
      color={night ? "#ffe3b8" : "#d8d3c8"}
      emissive={night ? warm : "#000000"}
      emissiveIntensity={night ? 1.6 * Math.max(0.15, boost) : 0}
      roughness={0.4}
    />
  )
  const halo = selected ? (
    <mesh position={[position[0], position[1] + lamp.mountH + (lamp.kind === "bollard" ? 0.57 : 0), position[2]]}>
      <sphereGeometry args={[0.28, 10, 8]} />
      <meshBasicMaterial color="#22c55e" transparent opacity={0.3} depthWrite={false} />
    </mesh>
  ) : null

  if (lamp.kind === "wall") {
    const [ox, oz] = LAMP_OUT[lamp.side ?? "s"]
    const [x, y, z] = wallLampFixturePosition(position, lamp.side, lamp.mountH)
    if (lamp.modelUrl) {
      return (
        <group {...handlers}>
          {halo}
          <React.Suspense fallback={null}>
            <LampModelGLB url={lamp.modelUrl} position={[x, y - LAMP_MODEL_TARGET_H.wall / 2, z]} targetH={LAMP_MODEL_TARGET_H.wall} />
          </React.Suspense>
          {lit && (
            <LampSpot pos={[x + ox * 0.3, y, z + oz * 0.3]} {...lampAim("wall", lamp.side)} color={warm} intensity={5 * boost} distance={5.5} />
          )}
        </group>
      )
    }
    return (
      <group {...handlers}>
        {halo}
        <mesh position={[x, y, z]}>
          <boxGeometry args={WALL_LAMP_BODY_ARGS} />
          <meshStandardMaterial color={body} roughness={0.6} metalness={0.3} />
        </mesh>
        {/* jendela cahaya atas & bawah (up/down washer) */}
        <mesh position={[x, y + 0.13, z]}>
          <boxGeometry args={[0.07, 0.02, 0.07]} />
          {glowMat}
        </mesh>
        <mesh position={[x, y - 0.13, z]}>
          <boxGeometry args={[0.07, 0.02, 0.07]} />
          {glowMat}
        </mesh>
        {lit && (
          <LampSpot
            pos={[x + ox * 0.3, y, z + oz * 0.3]}
            {...lampAim("wall", lamp.side)}
            color={warm}
            intensity={5 * boost}
            distance={5.5}
          />
        )}
      </group>
    )
  }

  if (lamp.kind === "canopy") {
    const y = position[1] + lamp.mountH
    if (lamp.modelUrl) {
      return (
        <group {...handlers}>
          {halo}
          <React.Suspense fallback={null}>
            <LampModelGLB url={lamp.modelUrl} position={[position[0], y - LAMP_MODEL_TARGET_H.canopy, position[2]]} targetH={LAMP_MODEL_TARGET_H.canopy} />
          </React.Suspense>
          {lit && (
            <LampSpot pos={[position[0], y - 0.25, position[2]]} {...lampAim("canopy")} color={warm} intensity={5 * boost} distance={4.5} />
          )}
        </group>
      )
    }
    return (
      <group {...handlers}>
        {halo}
        <mesh position={[position[0], y, position[2]]}>
          <cylinderGeometry args={[0.09, 0.09, 0.035, 12]} />
          {glowMat}
        </mesh>
        {lit && (
          <LampSpot
            pos={[position[0], y - 0.25, position[2]]}
            {...lampAim("canopy")}
            color={warm}
            intensity={5 * boost}
            distance={4.5}
          />
        )}
      </group>
    )
  }

  // bollard taman
  const y = position[1]
  if (lamp.modelUrl) {
    return (
      <group {...handlers}>
        {halo}
        <React.Suspense fallback={null}>
          <LampModelGLB url={lamp.modelUrl} position={[position[0], y, position[2]]} targetH={LAMP_MODEL_TARGET_H.bollard} />
        </React.Suspense>
        {lit && (
          <LampSpot pos={[position[0], y + 0.62, position[2]]} {...lampAim("bollard")} color={warm} intensity={1.6 * boost} distance={2.8} />
        )}
      </group>
    )
  }
  return (
    <group {...handlers}>
      {halo}
      <mesh position={[position[0], y + 0.27, position[2]]}>
        <cylinderGeometry args={[0.035, 0.045, 0.54, 8]} />
        <meshStandardMaterial color={body} roughness={0.6} metalness={0.3} />
      </mesh>
      <mesh position={[position[0], y + 0.57, position[2]]}>
        <cylinderGeometry args={[0.05, 0.05, 0.06, 8]} />
        {glowMat}
      </mesh>
      {lit && (
        <LampSpot
          pos={[position[0], y + 0.62, position[2]]}
          {...lampAim("bollard")}
          color={warm}
          intensity={1.6 * boost}
          distance={2.8}
        />
      )}
    </group>
  )
}

/** Pohon tropis stylized: batang + dua bola tajuk (murah, cocok estetika boxy). */
function TreeMesh({ position, scale }: { position: [number, number, number]; scale: number }) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.7, 0]} castShadow>
        <cylinderGeometry args={[0.06, 0.1, 1.4, 6]} />
        <meshStandardMaterial color="#7a5b3e" roughness={0.9} />
      </mesh>
      <mesh position={[0, 1.75, 0]} castShadow>
        <sphereGeometry args={[0.75, 10, 8]} />
        <meshStandardMaterial color="#4e7a46" roughness={0.85} />
      </mesh>
      <mesh position={[0.3, 2.25, 0.15]} castShadow>
        <sphereGeometry args={[0.45, 8, 7]} />
        <meshStandardMaterial color="#5a8a50" roughness={0.85} />
      </mesh>
    </group>
  )
}

/** Semak: bola pipih hijau. */
function BushMesh({ position, scale }: { position: [number, number, number]; scale: number }) {
  return (
    <mesh position={[position[0], position[1] + 0.22 * scale, position[2]]} scale={[scale, scale * 0.62, scale]} castShadow>
      <sphereGeometry args={[0.38, 8, 7]} />
      <meshStandardMaterial color="#5e8657" roughness={0.9} />
    </mesh>
  )
}

/** Index muka BoxGeometry: [+x, -x, +y, -y, +z, -z]; denah y → dunia Z. */
const FACE_INDEX_BY_SIDE: Record<"n" | "s" | "w" | "e", number> = { e: 0, w: 1, s: 4, n: 5 }
/** Muka DALAM = kebalikan muka luar. */
const INNER_FACE_BY_SIDE: Record<"n" | "s" | "w" | "e", number> = { e: 1, w: 0, s: 5, n: 4 }

/**
 * Dinding ruang di 3D. Tanpa cladding = satu material biasa. Dengan cladding
 * fasad, MUKA sisi luar dinding memakai material cladding (material array per
 * face BoxGeometry) — muka dalam tetap material ruang, seperti bangunan nyata.
 */
function FacadeWallMesh({
  prim,
  baseMat,
  cladMat,
  innerMat,
  selected,
  onSelect,
  setCursor,
}: {
  prim: Prim
  baseMat: PrimMaterial
  cladMat: PrimMaterial | null
  innerMat: PrimMaterial | null
  selected: boolean
  onSelect: (e: ThreeEvent<MouseEvent>) => void
  setCursor: (v: string) => void
}) {
  const rank = prim.depthRank ?? 0
  const materials = React.useMemo(() => {
    if ((!cladMat && !innerMat) || !prim.wallSide) return null
    const mk = (m: PrimMaterial) =>
      new MeshStandardMaterial({
        color: m.color,
        map: m.map ?? null,
        roughness: m.roughness,
        metalness: m.metalness,
        polygonOffset: rank > 0,
        polygonOffsetFactor: rank,
        polygonOffsetUnits: rank * 2,
      })
    const base = mk(baseMat)
    const arr = [base, base, base, base, base, base]
    if (cladMat) arr[FACE_INDEX_BY_SIDE[prim.wallSide]] = mk(cladMat)
    if (innerMat) arr[INNER_FACE_BY_SIDE[prim.wallSide]] = mk(innerMat)
    return arr
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    cladMat?.color, cladMat?.map, cladMat?.roughness, cladMat?.metalness,
    innerMat?.color, innerMat?.map, innerMat?.roughness, innerMat?.metalness,
    baseMat.color, baseMat.map, baseMat.roughness, baseMat.metalness,
    prim.wallSide, rank,
  ])
  React.useEffect(() => {
    if (!materials) return
    return () => new Set(materials).forEach((m) => m.dispose())
  }, [materials])

  return (
    <group>
      <mesh
        position={prim.pos}
        castShadow
        material={materials ?? undefined}
        onClick={onSelect}
        onContextMenu={onSelect}
        onPointerOver={(e) => { e.stopPropagation(); setCursor("pointer") }}
        onPointerOut={() => setCursor("auto")}
      >
        <boxGeometry args={prim.args} />
        {!materials && (
          <meshStandardMaterial
            color={baseMat.color}
            map={baseMat.map ?? undefined}
            roughness={baseMat.roughness}
            metalness={baseMat.metalness}
            polygonOffset={rank > 0}
            polygonOffsetFactor={rank}
            polygonOffsetUnits={rank * 2}
          />
        )}
      </mesh>
      {selected && (
        <mesh position={prim.pos}>
          <boxGeometry args={[prim.args[0] + 0.06, prim.args[1] + 0.06, prim.args[2] + 0.06]} />
          <meshBasicMaterial color="#22c55e" transparent opacity={0.22} depthWrite={false} />
        </mesh>
      )}
    </group>
  )
}

/**
 * Daun bukaan dari GLB kustom (Opening.modelUrl): model dari library di-fit ke
 * LEBAR × TINGGI bukaan (kedalaman dibatasi 0,45 m utk kusen/gagang menonjol),
 * dasar model duduk di ambang bawah panel. Orientasi mengikuti arah dinding —
 * sumbu terpanjang horizontal model dianggap lebar daun (aset SKP tak seragam).
 */
function OpeningModelGLB({
  url,
  width,
  height,
  horizontal,
}: {
  url: string
  width: number
  height: number
  horizontal: boolean
}) {
  const { scene } = useGLTF(url, "/draco/")
  const cloned = React.useMemo(() => scene.clone(true), [scene])
  const { size, center } = React.useMemo(() => {
    const b = new Box3().setFromObject(cloned)
    const s = new Vector3()
    const c = new Vector3()
    b.getSize(s)
    b.getCenter(c)
    return { size: s, center: c }
  }, [cloned])
  const fit = React.useMemo(() => {
    const wAxis: "x" | "z" = size.x >= size.z ? "x" : "z"
    const wSize = Math.max(wAxis === "x" ? size.x : size.z, 1e-3)
    const dSize = Math.max(wAxis === "x" ? size.z : size.x, 1e-3)
    const scale = Math.min(width / wSize, height / Math.max(size.y, 1e-3), 0.45 / dSize)
    // Lebar model sejajar dinding: dinding horizontal (sepanjang x dunia)
    // butuh sumbu lebar model di x; selain itu diputar 90°.
    const rotY = (wAxis === "x") === horizontal ? 0 : Math.PI / 2
    return { scale, rotY }
  }, [size, width, height, horizontal])
  return (
    <group rotation={[0, fit.rotY, 0]} position={[0, -height / 2, 0]}>
      <primitive
        object={cloned}
        position={[-center.x * fit.scale, -(center.y - size.y / 2) * fit.scale, -center.z * fit.scale]}
        scale={fit.scale}
      />
    </group>
  )
}

/**
 * Gorden / tirai — OVERLAY di sisi dalam jendela. Beda dari OpeningModelGLB
 * (yang MENGGANTI daun): kaca tetap ada, gorden di-fit sedikit lebih besar dari
 * bukaan (overhang ~20% lebar, 12% tinggi) sehingga menutup rapi seperti tirai
 * nyata. Anchor di titik-tengah bukaan → overhang simetris atas/bawah.
 */
function CurtainGLB({
  url,
  width,
  height,
  horizontal,
}: {
  url: string
  width: number
  height: number
  horizontal: boolean
}) {
  const { scene } = useGLTF(url, "/draco/")
  const cloned = React.useMemo(() => scene.clone(true), [scene])
  const { size, center } = React.useMemo(() => {
    const b = new Box3().setFromObject(cloned)
    const s = new Vector3()
    const c = new Vector3()
    b.getSize(s)
    b.getCenter(c)
    return { size: s, center: c }
  }, [cloned])
  const targetW = width * 1.2
  const targetH = height * 1.12
  const fit = React.useMemo(() => {
    const wAxis: "x" | "z" = size.x >= size.z ? "x" : "z"
    const wSize = Math.max(wAxis === "x" ? size.x : size.z, 1e-3)
    const dSize = Math.max(wAxis === "x" ? size.z : size.x, 1e-3)
    // Gorden mengisi lebar & tinggi bukaan (overhang); tebal dibatasi agar
    // lipatan tetap tipis (≤0,18 m) dan tak menembus furniture.
    const scale = Math.min(targetW / wSize, targetH / Math.max(size.y, 1e-3), 0.18 / dSize)
    const rotY = (wAxis === "x") === horizontal ? 0 : Math.PI / 2
    return { scale, rotY }
  }, [size, targetW, targetH, horizontal])
  return (
    <group rotation={[0, fit.rotY, 0]}>
      <primitive
        object={cloned}
        position={[-center.x * fit.scale, -center.y * fit.scale, -center.z * fit.scale]}
        scale={fit.scale}
      />
    </group>
  )
}

/**
 * Model fasad kustom — menggantikan geometri louver/slat/roster prosedural.
 * Aset GLB di-fit ke envelope elemen fasad (`widthM × heightM`) dan orientasinya
 * mengikuti arah dinding. Ini sengaja tidak memaksa kedalaman; banyak aset SKP
 * punya bbox depth yang noisy, sedangkan ukuran fasad yang penting adalah
 * bentang dan tinggi.
 */
function FacadeElementModelGLB({
  url,
  width,
  height,
  horizontal,
}: {
  url: string
  width: number
  height: number
  horizontal: boolean
}) {
  const { scene } = useGLTF(url, "/draco/")
  const cloned = React.useMemo(() => scene.clone(true), [scene])
  const { size, center } = React.useMemo(() => {
    const b = new Box3().setFromObject(cloned)
    const s = new Vector3()
    const c = new Vector3()
    b.getSize(s)
    b.getCenter(c)
    return { size: s, center: c }
  }, [cloned])
  const fit = React.useMemo(() => {
    const wAxis: "x" | "z" = size.x >= size.z ? "x" : "z"
    const wSize = Math.max(wAxis === "x" ? size.x : size.z, 1e-3)
    const scale = Math.min(width / wSize, height / Math.max(size.y, 1e-3))
    const rotY = (wAxis === "x") === horizontal ? 0 : Math.PI / 2
    return { scale, rotY }
  }, [size, width, height, horizontal])
  return (
    <group rotation={[0, fit.rotY, 0]}>
      <primitive
        object={cloned}
        position={[-center.x * fit.scale, -center.y * fit.scale, -center.z * fit.scale]}
        scale={fit.scale}
      />
    </group>
  )
}

function OpeningPrimitive({ prim }: { prim: Prim }) {
  const opening = prim.opening
  const selectedOpeningId = usePreviewStore((s) => s.selectedOpeningId)
  const selectOpening = usePreviewStore((s) => s.selectOpening)
  const night = usePreviewStore((s) => s.nightMode)
  const glassRealistic = usePreviewStore((s) => s.glassRealistic)
  const glassProps = glassMaterialProps(glassRealistic)
  const isSelected = !!prim.openingId && prim.openingId === selectedOpeningId
  const spec = openingVisualSpec({
    type: opening?.type ?? (prim.kind === "door" ? "door" : "window"),
    kind: opening?.kind,
    operation: opening?.operation,
    frameMaterial: opening?.frameMaterial,
    frameColor: opening?.frameColor,
  })
  const horizontal = prim.args[0] >= prim.args[2]
  const width = horizontal ? prim.args[0] : prim.args[2]
  const height = prim.args[1]
  const depth = (horizontal ? prim.args[2] : prim.args[0]) + 0.035
  const frame = Math.min(0.055, Math.max(0.025, width * 0.035))
  const barDepth = depth + 0.02
  const shade = opening?.shading ?? "none"

  const boxArgs = (along: number, y: number, cross: number): [number, number, number] =>
    horizontal ? [along, y, cross] : [cross, y, along]
  const boxPos = (along: number, y: number, cross = 0): [number, number, number] =>
    horizontal ? [along, y, cross] : [cross, y, along]

  const dividerPositions = Array.from({ length: Math.max(0, spec.panelSegments - 1) }, (_, i) =>
    -width / 2 + ((i + 1) * width) / spec.panelSegments
  )
  const horizontalSlats = Array.from({ length: spec.horizontalSlats }, (_, i) =>
    -height / 2 + ((i + 1) * height) / (spec.horizontalSlats + 1)
  )
  const verticalSlats = Array.from({ length: spec.verticalSlats }, (_, i) =>
    -width / 2 + ((i + 1) * width) / (spec.verticalSlats + 1)
  )
  const holes: Array<{ x: number; y: number }> = []
  if (spec.perforationRows > 0 && spec.perforationCols > 0) {
    for (let row = 0; row < spec.perforationRows; row++) {
      for (let col = 0; col < spec.perforationCols; col++) {
        holes.push({
          x: -width / 2 + ((col + 1) * width) / (spec.perforationCols + 1),
          y: -height / 2 + ((row + 1) * height) / (spec.perforationRows + 1),
        })
      }
    }
  }

  const setBodyCursor = (v: string) => {
    if (typeof document !== "undefined") document.body.style.cursor = v
  }

  const clickHandlers = {
    onClick: prim.openingId
      ? (e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation()
          if (e.delta > 4) return // seret orbit, bukan klik
          selectOpening(prim.openingId!)
        }
      : undefined,
    onContextMenu: prim.openingId
      ? (e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation()
          selectOpening(prim.openingId!)
        }
      : undefined,
    onPointerOver: prim.openingId
      ? (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); setBodyCursor("pointer") }
      : undefined,
    onPointerOut: prim.openingId ? () => setBodyCursor("auto") : undefined,
  }

  // Gorden/tirai — overlay GLB di sisi DALAM jendela (kaca tetap ada). Digantung
  // dengan standoff ke arah interior (prim.interiorSign) supaya tak menembus ke
  // luar. Fallback null (jangan tampilkan kotak) saat memuat/gagal.
  const CURTAIN_STANDOFF = 0.12
  const interiorSign = prim.interiorSign ?? -1
  const curtainOffset: [number, number, number] = horizontal
    ? [0, 0, interiorSign * CURTAIN_STANDOFF]
    : [interiorSign * CURTAIN_STANDOFF, 0, 0]
  const curtainOverlay =
    opening?.curtainModelUrl && opening?.type === "window" ? (
      <group position={curtainOffset}>
        <GlbErrorBoundary fallback={null}>
          <React.Suspense fallback={null}>
            <CurtainGLB
              url={opening.curtainModelUrl}
              width={width}
              height={height}
              horizontal={horizontal}
            />
          </React.Suspense>
        </GlbErrorBoundary>
      </group>
    ) : null

  // Model GLB kustom menggantikan visual daun+kusen prosedural sepenuhnya.
  // Fallback (dimuat/gagal) = panel polos warna spec agar lubang tak kosong.
  if (opening?.modelUrl) {
    const plainPanel = (
      <mesh>
        <boxGeometry args={prim.args} />
        <meshStandardMaterial
          color={spec.panelColor}
          transparent={spec.opacity < 1}
          opacity={spec.opacity}
          roughness={spec.roughness}
          metalness={spec.metalness}
        />
      </mesh>
    )
    return (
      <group position={prim.pos}>
        <mesh {...clickHandlers} visible={false}>
          <boxGeometry args={prim.args} />
        </mesh>
        {isSelected && (
          <mesh>
            <boxGeometry args={[prim.args[0] + 0.08, prim.args[1] + 0.08, prim.args[2] + 0.08]} />
            <meshBasicMaterial color="#22c55e" transparent opacity={0.28} depthWrite={false} />
          </mesh>
        )}
        <group {...clickHandlers}>
          <GlbErrorBoundary fallback={plainPanel}>
            <React.Suspense fallback={plainPanel}>
              <OpeningModelGLB
                url={opening.modelUrl}
                width={width}
                height={height}
                horizontal={horizontal}
              />
            </React.Suspense>
          </GlbErrorBoundary>
        </group>
        {curtainOverlay}
      </group>
    )
  }

  // ── Porthole (MVP Gap 1 Track A) — bingkai torus + kaca disc bundar ──────
  // Menggantikan frame persegi prosedural. Lubang dinding di build-model tetap
  // persegi (tak disentuh); dari tampak depan hanya disc bundar yang terbaca.
  // Diameter efektif = min(width, height); orientasi mengikuti arah dinding
  // (rotasi Y 90° bila dinding memanjang sumbu-z, sama seperti swap boxArgs).
  if (opening?.kind === "porthole") {
    const radius = Math.min(width, height) / 2
    const tube = Math.max(0.025, frame * 0.6) // ketebalan bingkai torus
    const glassRadius = Math.max(0.01, radius - tube * 0.5)
    return (
      <group position={prim.pos}>
        {/* Box tak terlihat seukuran lubang = target klik pilih bukaan. */}
        <mesh {...clickHandlers} visible={false}>
          <boxGeometry args={prim.args} />
        </mesh>
        {isSelected && (
          <mesh>
            <boxGeometry
              args={[prim.args[0] + 0.08, prim.args[1] + 0.08, prim.args[2] + 0.08]}
            />
            <meshBasicMaterial color="#22c55e" transparent opacity={0.28} depthWrite={false} />
          </mesh>
        )}
        <group rotation={[0, horizontal ? 0 : Math.PI / 2, 0]}>
          {/* Bingkai bundar (torus) — warna kusen dari spec. */}
          <mesh>
            <torusGeometry args={[radius, tube, 12, 32]} />
            <meshStandardMaterial color={spec.frameColor} roughness={0.65} metalness={0.1} />
          </mesh>
          {/* Kaca disc transparan — perilaku malam sama dengan kaca jendela lain.
              "Kaca realistis" ON → meshPhysicalMaterial transmisif; OFF → material
              lama byte-identical. */}
          <mesh>
            <circleGeometry args={[glassRadius, 32]} />
            {glassProps ? (
              <meshPhysicalMaterial
                color={spec.panelColor}
                transparent
                opacity={night ? Math.min(0.92, spec.opacity + 0.25) : spec.opacity}
                emissive={night ? "#ffbe78" : "#000000"}
                emissiveIntensity={night ? 1.15 : 0}
                roughness={glassProps.roughness}
                transmission={glassProps.transmission}
                ior={glassProps.ior}
                thickness={glassProps.thickness}
                clearcoat={glassProps.clearcoat}
                clearcoatRoughness={glassProps.clearcoatRoughness}
                side={DoubleSide}
              />
            ) : (
              <meshStandardMaterial
                color={spec.panelColor}
                transparent
                opacity={night ? Math.min(0.92, spec.opacity + 0.25) : spec.opacity}
                emissive={night ? "#ffbe78" : "#000000"}
                emissiveIntensity={night ? 1.15 : 0}
                roughness={spec.roughness}
                metalness={spec.metalness}
                side={DoubleSide}
              />
            )}
          </mesh>
        </group>
        {curtainOverlay}
      </group>
    )
  }

  return (
    <group position={prim.pos}>
      {/* Klik = pilih bukaan → OpeningQuickEditor di panel (edit dari 3D). */}
      <mesh {...clickHandlers}>
        <boxGeometry args={prim.args} />
        {/* Malam: panel KACA (opacity<1) memancarkan cahaya interior hangat.
            "Kaca realistis" ON + panel kaca sungguhan (bukan pintu/roster/dll)
            → meshPhysicalMaterial transmisif; OFF → material lama byte-identical. */}
        {spec.showsGlass && glassProps ? (
          <meshPhysicalMaterial
            color={spec.panelColor}
            transparent
            opacity={night ? Math.min(0.92, spec.opacity + 0.25) : spec.opacity}
            emissive={night ? "#ffbe78" : "#000000"}
            emissiveIntensity={night ? 1.15 : 0}
            roughness={glassProps.roughness}
            transmission={glassProps.transmission}
            ior={glassProps.ior}
            thickness={glassProps.thickness}
            clearcoat={glassProps.clearcoat}
            clearcoatRoughness={glassProps.clearcoatRoughness}
            polygonOffset={(prim.depthRank ?? 0) > 0}
            polygonOffsetFactor={prim.depthRank ?? 0}
            polygonOffsetUnits={(prim.depthRank ?? 0) * 2}
          />
        ) : (
          <meshStandardMaterial
            color={spec.panelColor}
            transparent={spec.opacity < 1}
            opacity={night && spec.opacity < 1 ? Math.min(0.92, spec.opacity + 0.25) : spec.opacity}
            emissive={night && spec.opacity < 1 ? "#ffbe78" : "#000000"}
            emissiveIntensity={night && spec.opacity < 1 ? 1.15 : 0}
            roughness={spec.roughness}
            metalness={spec.metalness}
            polygonOffset={(prim.depthRank ?? 0) > 0}
            polygonOffsetFactor={prim.depthRank ?? 0}
            polygonOffsetUnits={(prim.depthRank ?? 0) * 2}
          />
        )}
      </mesh>

      {/* Highlight bukaan terpilih */}
      {isSelected && (
        <mesh>
          <boxGeometry
            args={[prim.args[0] + 0.08, prim.args[1] + 0.08, prim.args[2] + 0.08]}
          />
          <meshBasicMaterial color="#22c55e" transparent opacity={0.28} depthWrite={false} />
        </mesh>
      )}

      {/* perimeter frame */}
      <mesh position={boxPos(0, height / 2 - frame / 2, 0)}>
        <boxGeometry args={boxArgs(width + frame, frame, barDepth)} />
        <meshStandardMaterial color={spec.frameColor} roughness={0.65} metalness={0.1} />
      </mesh>
      <mesh position={boxPos(0, -height / 2 + frame / 2, 0)}>
        <boxGeometry args={boxArgs(width + frame, frame, barDepth)} />
        <meshStandardMaterial color={spec.frameColor} roughness={0.65} metalness={0.1} />
      </mesh>
      <mesh position={boxPos(-width / 2 + frame / 2, 0, 0)}>
        <boxGeometry args={boxArgs(frame, height, barDepth)} />
        <meshStandardMaterial color={spec.frameColor} roughness={0.65} metalness={0.1} />
      </mesh>
      <mesh position={boxPos(width / 2 - frame / 2, 0, 0)}>
        <boxGeometry args={boxArgs(frame, height, barDepth)} />
        <meshStandardMaterial color={spec.frameColor} roughness={0.65} metalness={0.1} />
      </mesh>

      {dividerPositions.map((x, i) => (
        <mesh key={`div-${i}`} position={boxPos(x, 0, 0)}>
          <boxGeometry args={boxArgs(frame * 0.8, height - frame * 2, barDepth + 0.01)} />
          <meshStandardMaterial color={spec.frameColor} roughness={0.65} metalness={0.1} />
        </mesh>
      ))}

      {horizontalSlats.map((y, i) => (
        <mesh key={`hslat-${i}`} position={boxPos(0, y, 0)}>
          <boxGeometry args={boxArgs(width - frame * 2, frame * 0.65, barDepth + 0.02)} />
          <meshStandardMaterial color={spec.frameColor} roughness={0.7} metalness={0.05} />
        </mesh>
      ))}

      {verticalSlats.map((x, i) => (
        <mesh key={`vslat-${i}`} position={boxPos(x, 0, 0)}>
          <boxGeometry args={boxArgs(frame * 0.65, height - frame * 2, barDepth + 0.02)} />
          <meshStandardMaterial color={spec.frameColor} roughness={0.7} metalness={0.05} />
        </mesh>
      ))}

      {holes.map((hole, i) => (
        <mesh key={`hole-${i}`} position={boxPos(hole.x, hole.y, barDepth / 2 + 0.01)}>
          <boxGeometry args={boxArgs(width / (spec.perforationCols + 2) * 0.55, height / (spec.perforationRows + 2) * 0.45, 0.018)} />
          <meshStandardMaterial color="#0c1614" roughness={0.95} metalness={0} />
        </mesh>
      ))}

      {shade === "overhang" && (
        <mesh position={boxPos(0, height / 2 + 0.08, depth * 0.9)}>
          <boxGeometry args={boxArgs(width + 0.28, 0.06, 0.55)} />
          <meshStandardMaterial color="#d8d2c5" roughness={0.8} metalness={0} />
        </mesh>
      )}
      {shade === "vertical_fin" && (
        <>
          <mesh position={boxPos(-width / 2 - 0.08, 0, depth * 0.8)}>
            <boxGeometry args={boxArgs(0.06, height + 0.2, 0.45)} />
            <meshStandardMaterial color="#d8d2c5" roughness={0.8} metalness={0} />
          </mesh>
          <mesh position={boxPos(width / 2 + 0.08, 0, depth * 0.8)}>
            <boxGeometry args={boxArgs(0.06, height + 0.2, 0.45)} />
            <meshStandardMaterial color="#d8d2c5" roughness={0.8} metalness={0} />
          </mesh>
        </>
      )}
      {(shade === "screen" || shade === "secondary_skin") && (
        <mesh position={boxPos(0, 0, WALL_T + 0.16)}>
          <boxGeometry args={boxArgs(width + 0.18, height + 0.18, 0.035)} />
          <meshStandardMaterial color={shade === "screen" ? "#6d7875" : "#b8afa0"} transparent opacity={0.46} roughness={0.85} />
        </mesh>
      )}

      {curtainOverlay}
    </group>
  )
}

export function sceneFurnitureHeight(item: PlacedFurniture): number {
  // Pipihkan HANYA dekorasi tanpa model 3D (karpet dsb. digambar sebagai
  // lempeng). Item ber-GLB ikut kategori "decor" (aset kustom My Library
  // dipetakan generic→decor), dan fit GLB memakai skala MINIMUM semua sumbu —
  // tinggi 4 cm memaksa mobil 1,86 m menyusut jadi mainan 9 cm (Rumah Qyfa).
  const hasModel = !!(item.modelUrl || item.modelAssetId)
  if (!hasModel && (item.furnitureId === "rug-large" || item.category === "decor")) return 0.04
  if (item.furnitureId === "tv-55") return 0.72
  return Math.max(0.08, Math.min(item.heightM, 2.4))
}

function sceneFurnitureYOffset(item: PlacedFurniture): number {
  // Tinggi pasang eksplisit (jam dinding, ambalan, TV gantung) menang.
  if (typeof item.mountHeightM === "number") return item.mountHeightM
  if (item.furnitureId === "tv-55") return 1.05
  return 0.04
}

export function interiorFurnitureColor(item: PlacedFurniture): string {
  if (item.category === "bed") return "#d8cbbb"
  if (item.category === "wardrobe" || item.category === "cabinet") return "#b18458"
  if (item.category === "appliance") return "#3f4544"
  if (item.category === "decor") return "#caa37b"
  if (item.category === "kitchen") return "#b8ad9e"
  return SHARED_COLORS.furniture
}
