"use client"

/**
 * R3F mesh components for the three sloped roof PrimKinds ("roof_gable" |
 * "roof_hip" | "roof_skillion"). The actual BufferGeometry builders live in the
 * pure module src/lib/three/roof-geometry-core.ts (shared with the GLB
 * exporter) and are re-exported here for backward compatibility. All other prim
 * kinds keep rendering as boxes in house-model.tsx — untouched.
 */
import * as React from "react"
import * as THREE from "three"

import {
  buildGableEndGeometry,
  buildGableGeometry,
  buildHipGeometry,
  buildSkillionGeometry,
} from "@/lib/three/roof-geometry-core"

export { buildGableGeometry, buildHipGeometry, buildSkillionGeometry }

type RoofMeshProps = {
  position: [number, number, number]
  args: [number, number, number]
  color: string
  /** Procedural roof map applied only when realistic (T11); flat when omitted/null. */
  map?: THREE.Texture | null
  /** PBR roughness — defaults to the pre-T11 flat value when not realistic. */
  roughness?: number
  metalness?: number
}

/** Renders a `roof_gable` prim (pelana) as a triangular prism.
 *  `ridgeOffsetM` (opsional) = gable asimetris: bubungan digeser dari tengah.
 *  `openEnds` (opsional) = end-cap yang dibuka karena ujungnya ber-sopi-sopi. */
export function GablePrism({
  position,
  args,
  color,
  map,
  roughness = 0.85,
  metalness = 0,
  ridgeOffsetM = 0,
  openEnds,
}: RoofMeshProps & {
  ridgeOffsetM?: number
  openEnds?: { neg?: boolean; pos?: boolean }
}) {
  const geometry = React.useMemo(
    () => buildGableGeometry(args[0], args[1], args[2], ridgeOffsetM, openEnds),
    [args, ridgeOffsetM, openEnds]
  )
  return (
    <mesh position={position} geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial
        color={color}
        map={map ?? undefined}
        roughness={roughness}
        metalness={metalness}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

/** SOPI-SOPI: renders a `wall_gable` prim — dinding/kaca pengisi ujung
 *  bubungan pelana. `side` (dir prim) menentukan sumbu; glass = transparan. */
export function GableEndWall({
  position,
  args,
  color,
  map,
  roughness = 0.9,
  metalness = 0,
  side,
  overhangM = 0,
  ridgeOffsetM = 0,
  glass = false,
}: RoofMeshProps & {
  side: "n" | "s" | "w" | "e"
  overhangM?: number
  ridgeOffsetM?: number
  glass?: boolean
}) {
  const geometry = React.useMemo(
    () =>
      buildGableEndGeometry(
        args[0],
        args[1],
        overhangM,
        ridgeOffsetM,
        args[2],
        side === "w" || side === "e",
      ),
    [args, overhangM, ridgeOffsetM, side]
  )
  return (
    <mesh position={position} geometry={geometry} castShadow={!glass} receiveShadow>
      {glass ? (
        <meshStandardMaterial
          color="#9fc4d4"
          transparent
          opacity={0.35}
          depthWrite={false}
          roughness={0.08}
          metalness={0.1}
          side={THREE.DoubleSide}
        />
      ) : (
        <meshStandardMaterial
          color={color}
          map={map ?? undefined}
          roughness={roughness}
          metalness={metalness}
          side={THREE.DoubleSide}
        />
      )}
    </mesh>
  )
}

/** Renders a `roof_hip` prim (limasan) as a hip roof (or pyramid when square). */
export function HipPyramid({ position, args, color, map, roughness = 0.85, metalness = 0 }: RoofMeshProps) {
  const geometry = React.useMemo(
    () => buildHipGeometry(args[0], args[1], args[2]),
    [args]
  )
  return (
    <mesh position={position} geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial
        color={color}
        map={map ?? undefined}
        roughness={roughness}
        metalness={metalness}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

/** Renders a `roof_skillion` prim (miring) as a one-way sloped wedge. */
export function SkillionWedge({
  position,
  args,
  lowSide,
  color,
  map,
  roughness = 0.85,
  metalness = 0,
}: RoofMeshProps & { lowSide: "n" | "s" | "w" | "e" }) {
  const geometry = React.useMemo(
    () => buildSkillionGeometry(args[0], args[1], args[2], lowSide),
    [args, lowSide]
  )
  return (
    <mesh position={position} geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial
        color={color}
        map={map ?? undefined}
        roughness={roughness}
        metalness={metalness}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}
