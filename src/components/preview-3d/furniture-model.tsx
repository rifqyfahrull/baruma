"use client"

import * as React from "react"
import { Suspense, useMemo, useEffect } from "react"
import { useGLTF } from "@react-three/drei"
import * as THREE from "three"
import type { ThreeEvent } from "@react-three/fiber"

import { computeFitTransformOriented } from "@/lib/three/fit-transform"
import { resolveFurnitureSource, archetypeForCategory } from "@/lib/three/furniture-models"
import { ProceduralFurniture } from "@/components/preview-3d/furniture-procedural"
import { SHARED_COLORS } from "@/lib/three/materials"
import type { PlacedFurniture } from "@/types"

// ---------------------------------------------------------------------------
// ErrorBoundary — catches GLB render errors and shows procedural fallback
// ---------------------------------------------------------------------------

type GlbErrorBoundaryProps = {
  fallback: React.ReactNode
  children: React.ReactNode
}

type GlbErrorBoundaryState = {
  hasError: boolean
}

export class GlbErrorBoundary extends React.Component<GlbErrorBoundaryProps, GlbErrorBoundaryState> {
  constructor(props: GlbErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): GlbErrorBoundaryState {
    return { hasError: true }
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return this.props.fallback
    }
    return this.props.children
  }
}

// ---------------------------------------------------------------------------
// GlbModel — loads a GLB, clones the scene graph, fits to dims
// ---------------------------------------------------------------------------

export function GlbModel({ url, dims }: { url: string; dims: { w: number; d: number; h: number } }) {
  const { scene } = useGLTF(url, "/draco/")
  const cloned = useMemo(() => scene.clone(true), [scene])
  const { size, center } = useMemo(() => {
    const b = new THREE.Box3().setFromObject(cloned)
    const s = new THREE.Vector3()
    const c = new THREE.Vector3()
    b.getSize(s)
    b.getCenter(c)
    return {
      size: [s.x, s.y, s.z] as [number, number, number],
      center: [c.x, c.y, c.z] as [number, number, number],
    }
  }, [cloned])
  const fit = useMemo(
    () => computeFitTransformOriented({ size, center }, dims),
    [size, center, dims]
  )
  return (
    <group
      position={fit.position as [number, number, number]}
      rotation={[0, fit.rotationY, 0]}
      scale={fit.scale}
    >
      <primitive object={cloned} />
    </group>
  )
}

// ---------------------------------------------------------------------------
// FurnitureModel — public component
// ---------------------------------------------------------------------------

export function FurnitureModel({
  item,
  position,
  rotationDeg,
  selected,
  color,
  dims,
  onSelect,
  onHoverChange,
  floorY = 0,
  onDragStart,
  onDrag,
  onDragEnd,
}: {
  item: PlacedFurniture
  position: [number, number, number]
  rotationDeg: number
  selected: boolean
  color: string
  dims: { w: number; d: number; h: number }
  onSelect: () => void
  onHoverChange: (hovering: boolean) => void
  floorY?: number
  onDragStart?: () => void
  onDrag?: (worldX: number, worldZ: number) => void
  onDragEnd?: () => void
}) {
  // Use user-uploaded model URL if available, otherwise fall back to registry
  const userModelUrl = (item as { modelUrl?: string | null }).modelUrl
  const source = userModelUrl
    ? { kind: "glb" as const, url: userModelUrl }
    : resolveFurnitureSource({ furnitureId: item.furnitureId, category: item.category })
  const fallbackArchetype = archetypeForCategory(item.category) ?? "generic"

  const DRAG_THRESHOLD = 0.03 // metres on the floor plane before a press becomes a drag
  const drag = React.useRef<{ down: boolean; active: boolean; start: THREE.Vector3 | null }>({
    down: false, active: false, start: null,
  })
  const floorPlane = useMemo(
    () => new THREE.Plane(new THREE.Vector3(0, 1, 0), -floorY),
    [floorY]
  )
  const hitPoint = React.useRef(new THREE.Vector3()).current

  // Memoize cage geometry (only when selected) and dispose on unmount to avoid memory leaks
  const cageGeo = useMemo(
    () => (selected ? new THREE.BoxGeometry(dims.w, dims.h, dims.d) : null),
    [selected, dims.w, dims.d, dims.h]
  )
  useEffect(() => () => { cageGeo?.dispose() }, [cageGeo])

  return (
    <group position={position} rotation={[0, -(rotationDeg) * Math.PI / 180, 0]}>
      {/* model */}
      {source.kind === "glb" && (
        <GlbErrorBoundary
          key={source.url}
          fallback={
            <ProceduralFurniture archetype={fallbackArchetype} dims={dims} color={color} />
          }
        >
          <Suspense
            fallback={
              <ProceduralFurniture archetype={fallbackArchetype} dims={dims} color={color} />
            }
          >
            <GlbModel url={source.url} dims={dims} />
          </Suspense>
        </GlbErrorBoundary>
      )}
      {source.kind === "procedural" && (
        <ProceduralFurniture archetype={source.archetype} dims={dims} color={color} />
      )}
      {source.kind === "box" && (
        <mesh position={[0, dims.h / 2, 0]}>
          <boxGeometry args={[dims.w, dims.h, dims.d]} />
          <meshStandardMaterial color={color} />
        </mesh>
      )}

      {/* selection cage */}
      {selected && cageGeo && (
        <lineSegments position={[0, dims.h / 2, 0]}>
          <edgesGeometry args={[cageGeo]} />
          <lineBasicMaterial color={SHARED_COLORS.selected} />
        </lineSegments>
      )}

      {/* invisible hitbox — handles pointer events regardless of model shape */}
      <mesh
        position={[0, dims.h / 2, 0]}
        visible={false}
        onPointerDown={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation()
          onSelect()
          if (!onDrag) return
          ;(e.target as Element).setPointerCapture?.(e.pointerId)
          const hit = e.ray.intersectPlane(floorPlane, hitPoint)
          drag.current = { down: true, active: false, start: hit ? hit.clone() : null }
        }}
        onPointerMove={(e: ThreeEvent<PointerEvent>) => {
          if (!drag.current.down) return
          const hit = e.ray.intersectPlane(floorPlane, hitPoint)
          if (!hit) return
          e.stopPropagation()
          if (!drag.current.active) {
            // start the drag only once the pointer has moved past the threshold
            if (drag.current.start && hit.distanceTo(drag.current.start) < DRAG_THRESHOLD) return
            drag.current.active = true
            onDragStart?.()
          }
          onDrag?.(hit.x, hit.z)
        }}
        onPointerUp={(e: ThreeEvent<PointerEvent>) => {
          if (!drag.current.down) return
          ;(e.target as Element).releasePointerCapture?.(e.pointerId)
          const wasActive = drag.current.active
          drag.current = { down: false, active: false, start: null }
          if (wasActive) onDragEnd?.()
        }}
        onPointerOver={(e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); onHoverChange(true) }}
        onPointerOut={() => onHoverChange(false)}
      >
        <boxGeometry args={[dims.w, dims.h, dims.d]} />
      </mesh>
    </group>
  )
}
