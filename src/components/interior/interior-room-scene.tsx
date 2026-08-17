"use client"

import * as React from "react"
import * as THREE from "three"
import { Canvas } from "@react-three/fiber"
import { OrbitControls, PerspectiveCamera } from "@react-three/drei"

import type { Room, RoomInteriorPlan } from "@/types"
import { fixtureToLight, type LightDesc } from "@/lib/interior/lighting"
import { getInteriorStyle } from "@/lib/interior/presets"
import { materialVisualForAssignment } from "@/lib/three/material-visuals"
import { furnitureColor } from "@/lib/interior/furniture-color"
import { useInteriorStore } from "@/stores/interior-store"
import { useEditorStore } from "@/stores/editor-store"
import { isWebGLAvailable } from "@/lib/three/webgl-support"
import { actionsForContext } from "@/components/editor/context-menu/action-registry"
import {
  EditorCursorMenu,
  type CursorMenuState,
} from "@/components/editor/context-menu/cursor-menu"

const WALL_H = 2.8

function SpotFixture({ desc }: { desc: LightDesc }) {
  const light = React.useRef<THREE.SpotLight>(null)
  const target = React.useRef<THREE.Object3D>(null)
  React.useEffect(() => {
    if (light.current && target.current) {
      light.current.target = target.current
      light.current.target.updateMatrixWorld()
    }
  }, [desc.target])
  return (
    <>
      <spotLight ref={light} position={desc.position} intensity={desc.intensity} color={desc.color} angle={0.7} penumbra={0.5} castShadow={desc.castShadow} />
      <object3D ref={target} position={desc.target ?? [desc.position[0], 0, desc.position[2]]} />
    </>
  )
}

export function InteriorRoomScene({ room, plan }: { room: Room; plan: RoomInteriorPlan }) {
  const style = getInteriorStyle(plan.style)
  const selectedFurnitureId = useInteriorStore((s) => s.selectedFurnitureId)
  const selectedLightId = useInteriorStore((s) => s.selectedLightId)
  const selectFurniture = useInteriorStore((s) => s.selectFurniture)
  const selected3d = useEditorStore((s) => s.selected)
  const selectLight = useInteriorStore((s) => s.selectLight)
  const [menuState, setMenuState] = React.useState<CursorMenuState>({ open: false, x: 0, y: 0 })
  const closeMenu = React.useCallback(() => setMenuState((s) => ({ ...s, open: false })), [])
  const w = room.width
  const d = room.depth
  const floorColor =
    materialVisualForAssignment(plan.materials.find((item) => item.surface === "floor"))?.color ??
    style.colors.primary
  const wallColor =
    materialVisualForAssignment(plan.materials.find((item) => item.surface === "wall"))?.color ??
    style.colors.secondary

  if (!isWebGLAvailable()) {
    return (
      <div className="flex min-h-[30rem] items-center justify-center rounded-lg border bg-card text-sm text-muted-foreground">
        Preview 3D tidak tersedia — browser/perangkat ini tidak mendukung WebGL.
      </div>
    )
  }

  const menuItems = actionsForContext({
    ref: selected3d,
    point: null,
    layout: null,
    store: useEditorStore.getState(),
    openAddRoom: () => {},
  })

  return (
    <div
      className="relative min-h-[30rem] overflow-hidden rounded-lg border bg-card"
      onContextMenu={(e) => {
        e.preventDefault()
        setMenuState({ open: true, x: e.clientX, y: e.clientY })
      }}
    >
      {/* "percentage" = PCFShadowMap; bare `shadows` picks the r184-deprecated
          PCFSoftShadowMap (console-warns then falls back to PCF anyway). */}
      {/* On-demand rendering, same rationale as house-scene.tsx: this room is
          static geometry, no useFrame animation lives here. drei's
          OrbitControls already invalidates on its own "change" event, and any
          store-driven prop change (selection highlight, material swap,
          furniture/light reposition from the 2D tab) goes through React's
          commit → r3f's reconciler calls invalidateInstance() automatically.
          No manual invalidate() wiring needed unless a future useFrame
          animation is added here — if so, call invalidate() each tick it's
          active. */}
      <Canvas shadows="percentage" frameloop="demand" dpr={[1, 2]}>
        <PerspectiveCamera makeDefault position={[w * 0.9, WALL_H * 1.8, d * 1.4]} fov={50} />
        <OrbitControls target={[0, 0.6, 0]} maxPolarAngle={Math.PI / 2.1} />
        <ambientLight intensity={0.25} />
        <directionalLight position={[w, WALL_H * 2, d]} intensity={0.5} castShadow />

        {/* floor */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[w, d]} />
          <meshStandardMaterial color={floorColor} />
        </mesh>
        {/* back + left walls */}
        <mesh position={[0, WALL_H / 2, -d / 2]} receiveShadow>
          <boxGeometry args={[w, WALL_H, 0.05]} />
          <meshStandardMaterial color={wallColor} />
        </mesh>
        <mesh position={[-w / 2, WALL_H / 2, 0]} receiveShadow>
          <boxGeometry args={[0.05, WALL_H, d]} />
          <meshStandardMaterial color={wallColor} />
        </mesh>

        {/* furniture */}
        {plan.furniture.map((item, i) => (
          <mesh
            key={item.id}
            position={[item.x + item.widthM / 2 - w / 2, 0.3, item.y + item.depthM / 2 - d / 2]}
            rotation={[0, -(item.rotationDeg * Math.PI) / 180, 0]}
            castShadow
            onClick={(e) => { e.stopPropagation(); selectFurniture(item.id) }}
            onContextMenu={(e) => { e.stopPropagation(); selectFurniture(item.id) }}
          >
            <boxGeometry args={[Math.max(0.3, item.widthM), 0.6, Math.max(0.3, item.depthM)]} />
            <meshStandardMaterial
              color={furnitureColor(item, style, i)}
              emissive={item.id === selectedFurnitureId ? "#3b82f6" : "#000000"}
              emissiveIntensity={item.id === selectedFurnitureId ? 0.4 : 0}
            />
          </mesh>
        ))}

        {/* lights + source markers */}
        {plan.lighting.map((f) => {
          const L = fixtureToLight(f, room)
          return (
            <group key={f.id}>
              {L.kind === "spot" ? (
                <SpotFixture desc={L} />
              ) : (
                <pointLight position={L.position} intensity={L.intensity} color={L.color} castShadow={L.castShadow} />
              )}
              <mesh
                position={L.position}
                onClick={(e) => { e.stopPropagation(); selectLight(f.id) }}
                onContextMenu={(e) => { e.stopPropagation(); selectLight(f.id) }}
              >
                <sphereGeometry args={[f.id === selectedLightId ? 0.12 : 0.08, 12, 12]} />
                <meshStandardMaterial color={L.color} emissive={L.color} emissiveIntensity={f.id === selectedLightId ? 1.5 : 0.8} />
              </mesh>
            </group>
          )
        })}
      </Canvas>
      <div className="absolute left-4 top-4 rounded-md bg-background/90 px-3 py-2 text-sm shadow-sm">
        <p className="font-medium">3D room — lighting</p>
        <p className="text-xs text-muted-foreground">{plan.lighting.length} titik lampu • {plan.furniture.length} furniture</p>
      </div>
      <EditorCursorMenu state={menuState} items={menuItems} onClose={closeMenu} />
    </div>
  )
}
