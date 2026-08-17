/**
 * Builds a real GLB (binary glTF) blob from the project DesignLayout using
 * Three.js + GLTFExporter. Mirrors the color/opacity/geometry logic in
 * house-model.tsx so the exported model visually matches the in-app preview:
 * sloped roofs (`roof_gable`/`roof_hip`/`roof_skillion`) export their real
 * gable/hip/wedge geometry (not bounding boxes) and per-prim `tint` wins over
 * the preset base color, exactly like the renderer.
 */
import * as THREE from "three"
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js"

import type { DesignLayout, Project } from "@/types"
import { buildModel, type Prim } from "@/lib/three/build-model"
import { MATERIAL_PRESETS } from "@/lib/three/materials"
import { baseColor } from "@/lib/three/surface"
import { materialVisualForRoof } from "@/lib/three/material-visuals"
import {
  buildGableEndGeometry,
  buildGableFrameGeometry,
  buildGableGeometry,
  buildHipGeometry,
  buildSkillionGeometry,
} from "@/lib/three/roof-geometry-core"

/** Default preset used when no user preference is known at export time. */
const DEFAULT_PRESET = MATERIAL_PRESETS["modern_tropis"]

/**
 * Geometry for one prim — the same shape house-model.tsx renders: sloped roof
 * kinds get their real gable/hip/skillion BufferGeometry (skillion reads
 * `Prim.dir` for the low side, defaulting to "s" like SkillionWedge's caller);
 * everything else stays a box.
 */
function geometryFor(p: Prim): THREE.BufferGeometry {
  if (p.surfacePoints?.length) {
    const shape = new THREE.Shape()
    p.surfacePoints.forEach(([x, z], index) => {
      if (index === 0) shape.moveTo(x, z)
      else shape.lineTo(x, z)
    })
    shape.closePath()
    const geometry = new THREE.ShapeGeometry(shape)
    geometry.rotateX(Math.PI / 2)
    return geometry
  }
  switch (p.kind) {
    case "roof_gable":
      return buildGableGeometry(...p.args, p.ridgeOffsetM ?? 0, p.openGableEnds)
    case "roof_hip":
      return buildHipGeometry(...p.args)
    case "roof_skillion":
      return buildSkillionGeometry(...p.args, p.dir ?? "s")
    case "wall_gable":
      return buildGableEndGeometry(
        p.args[0],
        p.args[1],
        p.gableOverhangM ?? 0,
        p.ridgeOffsetM ?? 0,
        p.args[2],
        (p.dir ?? "w") === "w" || p.dir === "e",
      )
    default:
      // Prim exterior ber-payload gableFrame (W4) memakai geometri outline,
      // bukan box — paritas ExteriorPrimitiveMesh/GableFrameMesh.
      if (p.gableFrame) {
        return buildGableFrameGeometry(
          p.args[0],
          p.args[1],
          p.gableFrame.eaveLeftM,
          p.gableFrame.eaveRightM,
          p.gableFrame.apexOffsetM,
          p.gableFrame.memberM,
          p.args[2],
        )
      }
      return new THREE.BoxGeometry(...p.args)
  }
}

const SLOPED_ROOF_KINDS = new Set(["roof_gable", "roof_hip", "roof_skillion", "wall_gable"])

export async function buildGlbBlob(
  layout: DesignLayout,
  project: Project
): Promise<Blob> {
  const model = buildModel(
    layout,
    { widthM: project.site.widthM, depthM: project.site.depthM },
    project,
    { exploded: false, showRoof: true, showFurniture: true }
  )

  const group = new THREE.Group()
  group.name = project.name

  for (const p of model.prims) {
    const geometry = geometryFor(p)
    const transparent =
      p.kind === "window" || p.kind === "pool" || p.kind === "rail_glass"
    const opacity =
      p.kind === "window" ? 0.45
      : p.kind === "pool" ? 0.85
      : p.kind === "rail_glass" ? 0.3
      : 1

    const roofVisual = p.kind.startsWith("roof") ? materialVisualForRoof(p.roofMaterial) : undefined
    const material = new THREE.MeshStandardMaterial({
      // Per-prim tint (e.g. louver finish, kayu rail) wins over the preset
      // base color — same precedence as house-model.tsx.
      color: new THREE.Color(p.tint ?? roofVisual?.color ?? baseColor(p.kind, DEFAULT_PRESET)),
      transparent,
      opacity,
      // Sloped roof shells are open surfaces; the renderer draws them
      // double-sided (GablePrism/HipPyramid/SkillionWedge).
      side: SLOPED_ROOF_KINDS.has(p.kind) || !!p.surfacePoints
        ? THREE.DoubleSide
        : THREE.FrontSide,
    })

    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(...p.pos)
    mesh.rotation.y = p.rotationY ?? 0
    mesh.name = p.name ?? p.kind
    group.add(mesh)
  }

  const exporter = new GLTFExporter()
  const buf = await new Promise<ArrayBuffer>((resolve, reject) => {
    exporter.parse(
      group,
      (result) => resolve(result as ArrayBuffer),
      (error) => reject(error),
      { binary: true }
    )
  })

  return new Blob([buf], { type: "model/gltf-binary" })
}
