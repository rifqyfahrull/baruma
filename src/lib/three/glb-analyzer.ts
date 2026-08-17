/**
 * Client-side GLB analysis utilities for the furnimesh ingestion pipeline.
 * Runs in the browser using three.js — no server-side rendering needed.
 *
 * Used to:
 * 1. Validate GLB files (load test, mesh/material counts, bounding box)
 * 2. Calculate performance metrics
 * 3. Extract material names for Design DNA matching
 */
import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js"
import type { Object3D } from "three"

export type GlbAnalysisResult = {
  /** Whether the GLB loaded successfully. */
  loaded: boolean
  /** Error message if loading failed. */
  error?: string

  /** Number of meshes in the scene. */
  meshCount: number
  /** Number of unique materials. */
  materialCount: number
  /** Number of textures (rough count). */
  textureCount: number
  /** Estimated triangle count (sum of all mesh geometries). */
  estimatedTriangleCount: number

  /** Bounding box dimensions in model units. */
  boundingBox: {
    width: number
    depth: number
    height: number
  } | null

  /** Material names extracted from the GLB. */
  materialNames: string[]

  /** Performance flags. */
  performance: {
    /** Whether the model exceeds recommended thresholds. */
    warnings: string[]
    /** Estimated mobile performance risk: low | medium | high. */
    mobileRisk: "low" | "medium" | "high"
    /** Total file size in MB (must be passed in, not extracted from GLB). */
    fileSizeMb?: number
  }
}

/**
 * Load and analyze a GLB file in the browser.
 * Uses THREE.GLTFLoader with Draco decoder support.
 *
 * @param file - The GLB File object from a file input or drop event.
 * @param dracoPath - Path to Draco decoder WASM (default: "/draco/").
 */
export async function analyzeGlbFile(
  file: File,
  dracoPath = "/draco/"
): Promise<GlbAnalysisResult> {
  const fileSizeMb = file.size / (1024 * 1024)

  const loader = new GLTFLoader()
  const dracoLoader = new DRACOLoader()
  dracoLoader.setDecoderPath(dracoPath)
  loader.setDRACOLoader(dracoLoader)

  try {
    const arrayBuffer = await file.arrayBuffer()
    const gltf = await loader.parseAsync(arrayBuffer, "")

    const scene = gltf.scene

    // Count meshes and triangles
    let meshCount = 0
    let estimatedTriangleCount = 0
    const materialNames: string[] = []
    const materialSet = new Set<string>()

    scene.traverse((child: Object3D) => {
      if (child instanceof THREE.Mesh) {
        meshCount++
        if (child.geometry) {
          const geo = child.geometry
          if (geo.index) {
            estimatedTriangleCount += geo.index.count / 3
          } else if (geo.attributes.position) {
            estimatedTriangleCount += geo.attributes.position.count / 3
          }
        }
        const mat = child.material
        if (mat) {
          const mats = Array.isArray(mat) ? mat : [mat]
          for (const m of mats) {
            const name = m.name || `material_${materialSet.size}`
            materialSet.add(name)
            materialNames.push(name)
          }
        }
      }
    })

    // Calculate bounding box
    const bbox = new THREE.Box3().setFromObject(scene)
    const size = new THREE.Vector3()
    bbox.getSize(size)

    // Performance analysis
    const warnings: string[] = []
    if (fileSizeMb > 10) warnings.push("Ukuran file >10MB, pertimbangkan optimasi")
    if (meshCount > 50) warnings.push(`Jumlah mesh tinggi (${meshCount}), bisa lambat di mobile`)
    if (materialSet.size > 20) warnings.push(`Banyak material (${materialSet.size}), bisa lambat dirender`)
    if (estimatedTriangleCount > 500_000) warnings.push("Triangle count tinggi, pertimbangkan LOD")

    let mobileRisk: GlbAnalysisResult["performance"]["mobileRisk"] = "low"
    if (fileSizeMb > 15 || meshCount > 100 || estimatedTriangleCount > 500_000) {
      mobileRisk = "high"
    } else if (fileSizeMb > 8 || meshCount > 30 || estimatedTriangleCount > 100_000) {
      mobileRisk = "medium"
    }

    return {
      loaded: true,
      meshCount,
      materialCount: materialSet.size,
      textureCount: 0, // Rough count — detailed texture analysis is V2
      estimatedTriangleCount: Math.round(estimatedTriangleCount),
      boundingBox: {
        width: Math.round(size.x * 100) / 100,
        depth: Math.round(size.z * 100) / 100,
        height: Math.round(size.y * 100) / 100,
      },
      materialNames: Array.from(new Set(materialNames)),
      performance: {
        warnings,
        mobileRisk,
        fileSizeMb: Math.round(fileSizeMb * 100) / 100,
      },
    }
  } catch (e) {
    return {
      loaded: false,
      error: e instanceof Error ? e.message : "Gagal membaca file GLB",
      meshCount: 0,
      materialCount: 0,
      textureCount: 0,
      estimatedTriangleCount: 0,
      boundingBox: null,
      materialNames: [],
      performance: {
        warnings: ["File GLB tidak bisa dibaca — mungkin corrupt atau format tidak didukung"],
        mobileRisk: "high",
        fileSizeMb: Math.round(fileSizeMb * 100) / 100,
      },
    }
  }
}

/**
 * Validate a bounding box against a slot's expected dimensions (deterministic).
 * Returns confidence score and warnings — no LLM needed.
 */
export function validateBboxForSlot(
  bbox: { width: number; depth: number; height: number },
  expected: {
    widthM: [number, number]
    depthM: [number, number]
    heightM: [number, number]
    widthToDepthMin?: number
    widthToHeight?: [number, number]
  }
): {
  confidence: number
  checks: Array<{ name: string; status: "passed" | "warning" | "failed" }>
  warnings: string[]
} {
  const checks: Array<{ name: string; status: "passed" | "warning" | "failed" }> = []
  const warnings: string[] = []
  let passed = 0
  let total = 0

  // Width check
  total++
  if (bbox.width >= expected.widthM[0] && bbox.width <= expected.widthM[1]) {
    checks.push({ name: "width_range", status: "passed" })
    passed++
  } else {
    checks.push({ name: "width_range", status: "warning" })
    warnings.push(`Lebar model di luar rentang ekspektasi (${expected.widthM[0]}–${expected.widthM[1]}m)`)
  }

  // Depth check
  total++
  if (bbox.depth >= expected.depthM[0] && bbox.depth <= expected.depthM[1]) {
    checks.push({ name: "depth_range", status: "passed" })
    passed++
  } else {
    checks.push({ name: "depth_range", status: "warning" })
    warnings.push(`Kedalaman model di luar rentang ekspektasi (${expected.depthM[0]}–${expected.depthM[1]}m)`)
  }

  // Height check
  total++
  if (bbox.height >= expected.heightM[0] && bbox.height <= expected.heightM[1]) {
    checks.push({ name: "height_range", status: "passed" })
    passed++
  } else {
    checks.push({ name: "height_range", status: "warning" })
    warnings.push(`Tinggi model di luar rentang ekspektasi (${expected.heightM[0]}–${expected.heightM[1]}m)`)
  }

  // Width-to-depth ratio check (TV-like check)
  if (expected.widthToDepthMin) {
    total++
    const ratio = bbox.depth > 0 ? bbox.width / bbox.depth : 0
    if (ratio >= expected.widthToDepthMin) {
      checks.push({ name: "width_to_depth_ratio", status: "passed" })
      passed++
    } else {
      checks.push({ name: "width_to_depth_ratio", status: "warning" })
      warnings.push("Model terlalu tebal — tidak seperti objek flat")
    }
  }

  // Width-to-height ratio check
  if (expected.widthToHeight) {
    total++
    const ratio = bbox.height > 0 ? bbox.width / bbox.height : 0
    if (ratio >= expected.widthToHeight[0] && ratio <= expected.widthToHeight[1]) {
      checks.push({ name: "width_to_height_ratio", status: "passed" })
      passed++
    } else {
      checks.push({ name: "width_to_height_ratio", status: "warning" })
      warnings.push("Rasio lebar/tinggi tidak sesuai ekspektasi")
    }
  }

  const confidence = total > 0 ? Math.round((passed / total) * 100) : 0

  return { confidence, checks, warnings }
}
