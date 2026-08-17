/**
 * buildGlbBlob harus setia pada apa yang dirender house-model.tsx:
 * - atap pelana/limasan/miring diekspor sebagai geometri atap sungguhan
 *   (prisma/limas/wedge — 6 vertex), BUKAN BoxGeometry (24 vertex);
 * - Prim.tint menang atas baseColor preset;
 * - warna dasar datang dari resolver bersama baseColor() (surface.ts).
 *
 * Verifikasi lewat parsing biner GLB minimal: chunk JSON (nodes/meshes/
 * accessors/materials) + chunk BIN (posisi vertex Float32).
 */
import { describe, expect, it } from "vitest"
import * as THREE from "three"

import type { DesignLayout, Project } from "@/types"
import { MATERIAL_PRESETS } from "@/lib/three/materials"
import { baseColor } from "@/lib/three/surface"
import { buildGlbBlob } from "./glb"

// ---------------------------------------------------------------------------
// Fixture layout/project
// ---------------------------------------------------------------------------

const project = {
  id: "p1",
  name: "Rumah Test",
  site: { widthM: 8, depthM: 12, areaM2: 96 },
  floors: 1,
  rooftop: false,
  status: "editing",
  readiness: "concept_ready",
  projectType: "new",
  thumbnail: "family",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
} as unknown as Project

function makeLayout(overrides: Partial<DesignLayout> = {}): DesignLayout {
  return {
    id: "l1",
    projectId: "p1",
    versionId: "v1",
    floors: [{ id: "f1", level: 1, name: "Lantai 1", heightM: 3.2 }],
    rooms: [
      {
        id: "r1",
        floorId: "f1",
        name: "Ruang Tamu",
        type: "ruang_tamu",
        x: 0, y: 0, width: 8, depth: 6, areaM2: 48,
      },
    ],
    walls: [],
    openings: [],
    stairs: [],
    pools: [],
    validation: { passed: true, issues: [] },
    ...overrides,
  } as unknown as DesignLayout
}

// ---------------------------------------------------------------------------
// GLB parsing helpers (header 12 B + chunk JSON + chunk BIN)
// ---------------------------------------------------------------------------

type GltfJson = {
  nodes: Array<{ name?: string; mesh?: number; translation?: number[] }>
  meshes: Array<{ primitives: Array<{ attributes: { POSITION: number }; material?: number }> }>
  accessors: Array<{ bufferView?: number; byteOffset?: number; count: number; min?: number[]; max?: number[] }>
  bufferViews: Array<{ byteOffset?: number; byteLength: number }>
  materials?: Array<{
    pbrMetallicRoughness?: { baseColorFactor?: number[] }
    alphaMode?: string
    doubleSided?: boolean
  }>
}

async function exportAndParse(layout: DesignLayout) {
  const blob = await buildGlbBlob(layout, project)
  const buf = await blob.arrayBuffer()
  const dv = new DataView(buf)

  expect(dv.getUint32(0, true)).toBe(0x46546c67) // magic "glTF"
  const jsonLen = dv.getUint32(12, true)
  expect(dv.getUint32(16, true)).toBe(0x4e4f534a) // chunk "JSON"
  const json = JSON.parse(
    new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen))
  ) as GltfJson

  const binHeader = 20 + jsonLen
  const binLen = dv.getUint32(binHeader, true)
  expect(dv.getUint32(binHeader + 4, true)).toBe(0x004e4942) // chunk "BIN"
  const bin = buf.slice(binHeader + 8, binHeader + 8 + binLen)

  return { blob, json, bin }
}

function nodeByName(json: GltfJson, name: string) {
  const node = json.nodes.find((n) => n.name === name && n.mesh !== undefined)
  expect(node, `node "${name}" harus ada di GLB`).toBeDefined()
  return node!
}

function positionAccessor(json: GltfJson, name: string) {
  const node = nodeByName(json, name)
  const prim = json.meshes[node.mesh!].primitives[0]
  return json.accessors[prim.attributes.POSITION]
}

/** Posisi vertex (Float32) mesh bernama `name`, dibaca dari chunk BIN. */
function positions(json: GltfJson, bin: ArrayBuffer, name: string): Float32Array {
  const acc = positionAccessor(json, name)
  const bv = json.bufferViews[acc.bufferView!]
  const offset = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0)
  return new Float32Array(bin.slice(offset, offset + acc.count * 3 * 4))
}

/** Vertex-vertex pada ketinggian maksimum (puncak/bubungan) dari array posisi. */
function apexVertices(pos: Float32Array): Array<{ x: number; y: number; z: number }> {
  const verts: Array<{ x: number; y: number; z: number }> = []
  for (let i = 0; i < pos.length; i += 3) {
    verts.push({ x: pos[i], y: pos[i + 1], z: pos[i + 2] })
  }
  const maxY = Math.max(...verts.map((v) => v.y))
  return verts.filter((v) => Math.abs(v.y - maxY) < 1e-5)
}

function materialOf(json: GltfJson, name: string) {
  const node = nodeByName(json, name)
  const prim = json.meshes[node.mesh!].primitives[0]
  expect(prim.material).toBeDefined()
  return json.materials![prim.material!]
}

function expectColor(factor: number[] | undefined, hex: string) {
  const expected = new THREE.Color(hex).toArray()
  expect(factor).toBeDefined()
  for (let i = 0; i < 3; i++) expect(factor![i]).toBeCloseTo(expected[i], 5)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildGlbBlob — blob dasar", () => {
  it("menghasilkan Blob model/gltf-binary dengan header GLB valid", async () => {
    const { blob } = await exportAndParse(makeLayout())
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe("model/gltf-binary")
    expect(blob.size).toBeGreaterThan(0)
  })

  it("prim non-atap tetap box (24 vertex) dan warnanya dari baseColor bersama", async () => {
    const { json } = await exportAndParse(makeLayout())
    expect(positionAccessor(json, "wall").count).toBe(24) // BoxGeometry
    expectColor(
      materialOf(json, "wall").pbrMetallicRoughness?.baseColorFactor,
      baseColor("wall", MATERIAL_PRESETS["modern_tropis"])
    )
  })
})

describe("buildGlbBlob — geometri atap sungguhan", () => {
  it("atap pelana diekspor sebagai prisma gable 6 vertex, bukan box", async () => {
    const { json, bin } = await exportAndParse(
      makeLayout({
        roof: { type: "pelana", slopeDeg: 30, overhangM: 0.5, material: "genteng_beton" },
      } as Partial<DesignLayout>)
    )
    const acc = positionAccessor(json, "roof_gable")
    expect(acc.count).toBe(6) // prisma segitiga — BoxGeometry akan 24

    // Prisma gable: tepat 2 vertex puncak (bubungan), keduanya di TENGAH
    // sumbu melintang (koordinat 0) dan di ±ujung sumbu bubungan.
    const pos = positions(json, bin, "roof_gable")
    const apex = apexVertices(pos)
    expect(apex).toHaveLength(2)
    const ridgeAlongX = Math.abs(apex[0].z) < 1e-5
    for (const v of apex) {
      expect(ridgeAlongX ? v.z : v.x).toBeCloseTo(0, 5) // melintang: tengah
    }
    const ridgeCoords = apex.map((v) => (ridgeAlongX ? v.x : v.z)).sort((a, b) => a - b)
    const ridgeHalf = ridgeAlongX ? acc.max![0] : acc.max![2]
    expect(ridgeCoords[0]).toBeCloseTo(-ridgeHalf, 5) // bubungan sepanjang alas
    expect(ridgeCoords[1]).toBeCloseTo(ridgeHalf, 5)
  })

  it("atap limasan diekspor sebagai hip 6 vertex dengan ridge lebih pendek dari alas", async () => {
    const { json, bin } = await exportAndParse(
      makeLayout({
        roof: { type: "limasan", slopeDeg: 30, overhangM: 0.5, material: "genteng_beton" },
      } as Partial<DesignLayout>)
    )
    const acc = positionAccessor(json, "roof_hip")
    expect(acc.count).toBe(6)

    // Ridge hip menyusut (long - short): vertex puncak berada STRICT di dalam
    // alas pada kedua sumbu horizontal (beda dari gable yang menyentuh ujung).
    const pos = positions(json, bin, "roof_hip")
    const apex = apexVertices(pos)
    expect(apex).toHaveLength(2)
    for (const v of apex) {
      expect(Math.abs(v.x)).toBeLessThan(acc.max![0] - 1e-4)
      expect(Math.abs(v.z)).toBeLessThan(acc.max![2] - 1e-4)
    }
  })

  it("atap miring diekspor sebagai wedge 6 vertex yang menghormati Prim.dir (lowSide)", async () => {
    const { json, bin } = await exportAndParse(
      makeLayout({
        roof: { type: "miring", slopeDeg: 10, overhangM: 0.5, material: "genteng_beton", lowSide: "e" },
      } as Partial<DesignLayout>)
    )
    const acc = positionAccessor(json, "roof_skillion")
    expect(acc.count).toBe(6)

    // lowSide "e" → sisi TINGGI di barat: kedua vertex puncak menempel tepi
    // barat alas (x = min x), turun ke arah timur.
    const pos = positions(json, bin, "roof_skillion")
    const apex = apexVertices(pos)
    expect(apex).toHaveLength(2)
    expect(acc.min![0]).toBeLessThan(0)
    for (const v of apex) expect(v.x).toBeCloseTo(acc.min![0], 5)
  })

  it("material atap miring double-sided seperti komponen preview", async () => {
    const { json } = await exportAndParse(
      makeLayout({
        roof: { type: "pelana", slopeDeg: 30, overhangM: 0.5, material: "genteng_beton" },
      } as Partial<DesignLayout>)
    )
    expect(materialOf(json, "roof_gable").doubleSided).toBe(true)
    // Dinding tetap single-sided (box tertutup).
    expect(materialOf(json, "wall").doubleSided).not.toBe(true)
  })
})

describe("buildGlbBlob — warna", () => {
  it("Prim.tint menang atas baseColor (fascia memakai warna fascia custom)", async () => {
    const tint = "#3355aa"
    const { json } = await exportAndParse(
      makeLayout({
        roof: {
          type: "datar", slopeDeg: 30, overhangM: 0.5, material: "genteng_beton",
          fascia: { heightM: 0.35, color: tint },
        },
      } as Partial<DesignLayout>)
    )
    expectColor(materialOf(json, "fascia").pbrMetallicRoughness?.baseColorFactor, tint)
  })

  it("atap tanpa tint memakai warna roof preset bersama", async () => {
    const { json } = await exportAndParse(
      makeLayout({
        roof: { type: "pelana", slopeDeg: 30, overhangM: 0.5, material: "genteng_beton" },
      } as Partial<DesignLayout>)
    )
    expectColor(
      materialOf(json, "roof_gable").pbrMetallicRoughness?.baseColorFactor,
      baseColor("roof_gable", MATERIAL_PRESETS["modern_tropis"])
    )
  })

  it("rail_glass balkon diekspor transparan (BLEND, alpha 0.3) seperti preview", async () => {
    const { json } = await exportAndParse(
      makeLayout({
        floors: [
          { id: "f1", level: 1, name: "Lantai 1", heightM: 3.2 },
          { id: "f2", level: 2, name: "Lantai 2", heightM: 3.2 },
        ],
        rooms: [
          { id: "r1", floorId: "f1", name: "Ruang Tamu", type: "ruang_tamu", x: 0, y: 0, width: 8, depth: 6, areaM2: 48 },
          { id: "b1", floorId: "f2", name: "Balkon", type: "balkon", x: 2, y: 1, width: 4, depth: 3, areaM2: 12 },
        ],
      } as Partial<DesignLayout>)
    )
    const mat = materialOf(json, "rail_glass")
    expect(mat.alphaMode).toBe("BLEND")
    expect(mat.pbrMetallicRoughness?.baseColorFactor?.[3]).toBeCloseTo(0.3, 5)
  })
})
