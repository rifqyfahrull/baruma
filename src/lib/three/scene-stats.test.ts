import { describe, expect, it } from "vitest"

import {
  buildPreviewSceneStats,
  countSemanticObjects,
  estimatePrimTriangles,
  formatBytes,
  summarizeModelStats,
} from "./scene-stats"
import type { DesignLayout, Project } from "@/types"
import type { Model, Prim } from "./build-model"

const project = {
  id: "p",
  name: "Stats Project",
  status: "editing",
  readiness: "concept_ready",
  projectType: "new",
  thumbnail: "compact",
  site: { widthM: 8, depthM: 16, areaM2: 128 },
  floors: 1,
  rooftop: false,
  createdAt: "2026-07-15T00:00:00.000Z",
  updatedAt: "2026-07-15T00:00:00.000Z",
} satisfies Project

function layout(): DesignLayout {
  return {
    id: "layout-stats",
    projectId: "p",
    versionId: "v",
    floors: [{ id: "f1", level: 0, name: "Lantai 1", heightM: 3 }],
    rooms: [
      { id: "r1", floorId: "f1", name: "R1", type: "ruang_tamu", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 },
      { id: "r2", floorId: "f1", name: "R2", type: "kamar_tidur", x: 4, y: 0, width: 4, depth: 3, areaM2: 12 },
    ],
    walls: [],
    openings: [
      { id: "w1", floorId: "f1", wallId: "r1:s", type: "window", positionM: 2, widthM: 1, heightM: 1 },
    ],
    stairs: [],
    pools: [],
    roofZones: [
      {
        id: "rz1",
        floorId: "f1",
        type: "pelana",
        x: 2,
        y: 1.5,
        widthM: 4,
        depthM: 3,
        slopeDeg: 30,
        overhangM: 0.2,
        materialId: "genteng_beton",
      },
      {
        id: "rz2",
        floorId: "f1",
        type: "datar",
        x: 6,
        y: 1.5,
        widthM: 4,
        depthM: 3,
        slopeDeg: 0,
        overhangM: 0.2,
        materialId: "metal",
      },
    ],
    exteriorElements: [
      {
        id: "gate",
        kind: "sliding_gate",
        label: "Gate",
        floorId: "f1",
        start: { x: 1, y: 15 },
        end: { x: 5, y: 15 },
        heightM: 1.8,
        thicknessM: 0.08,
        structuralRole: "non_structural",
        material: { materialId: "metal_gelap" },
      },
    ],
    validation: { passed: true, issues: [] },
  }
}

describe("scene-stats", () => {
  it("estimates primitive triangle counts from rendered geometry kinds", () => {
    expect(estimatePrimTriangles({ kind: "wall" })).toBe(12)
    expect(estimatePrimTriangles({ kind: "roof_gable" })).toBe(8)
    expect(estimatePrimTriangles({ kind: "roof_hip" })).toBe(8)
    expect(estimatePrimTriangles({ kind: "roof_skillion" })).toBe(8)
    expect(estimatePrimTriangles({ kind: "exterior", surfacePoints: [[0, 0], [1, 0], [1, 1], [0, 1]] })).toBe(2)
  })

  it("builds deterministic preview stats and budget status", () => {
    const stats = buildPreviewSceneStats(layout(), project.site, project, {
      showRoof: true,
      realistic: true,
    })

    expect(stats.semanticObjects).toBe(6)
    expect(stats.byKind.roof_gable).toBe(1)
    expect(stats.byKind.roof).toBe(1)
    expect(stats.byKind.window).toBeGreaterThanOrEqual(1)
    expect(stats.meshes).toBe(stats.prims)
    expect(stats.drawCalls).toBe(stats.meshes)
    expect(stats.textureCount).toBeGreaterThan(0)
    expect(stats.textureMemoryBytes).toBe(stats.textureCount * 256 * 256 * 4)
    expect(stats.ok).toBe(true)
  })

  it("flags budget failures for overdrawn scenes", () => {
    const prim = {
      id: "p",
      kind: "wall",
      floorId: "f1",
      pos: [0, 0, 0],
      args: [1, 1, 1],
    } satisfies Prim
    const model: Model = {
      prims: Array.from({ length: 401 }, (_, index) => ({ ...prim, id: `p-${index}` })),
      labels: [],
      height: 1,
    }

    const stats = summarizeModelStats(model, layout(), { realistic: false })
    expect(stats.ok).toBe(false)
    expect(stats.budgets.drawCalls).toMatchObject({ value: 401, limit: 300, ok: false })
    expect(stats.textureMemoryBytes).toBe(0)
  })

  it("formats bytes for the dev overlay", () => {
    expect(formatBytes(12)).toBe("12 B")
    expect(formatBytes(256 * 1024)).toBe("256 KB")
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MB")
  })
})

describe("countSemanticObjects — tangga/kolam via rooms (TG-6/KL-8)", () => {
  it("menghitung room tangga/kolam lewat rooms, bukan array dorman stairs/pools", () => {
    const l: DesignLayout = {
      id: "l", projectId: "p", versionId: "v",
      floors: [{ id: "f1", level: 0, name: "L1", heightM: 3 }],
      rooms: [
        { id: "r1", floorId: "f1", name: "Tamu", type: "ruang_tamu", x: 0, y: 0, width: 3, depth: 3, areaM2: 9 },
        { id: "r2", floorId: "f1", name: "Tangga", type: "tangga", x: 3, y: 0, width: 2, depth: 2, areaM2: 4 },
        { id: "r3", floorId: "f1", name: "Kolam", type: "kolam", x: 0, y: 3, width: 4, depth: 8, areaM2: 32 },
      ],
      walls: [], openings: [], stairs: [], pools: [],
      validation: { passed: true, issues: [] },
    }
    // rooms(3) + openings(0) + facade(0) + exterior(0) + roof(0) + lamps(0) = 3
    expect(countSemanticObjects(l)).toBe(3)
  })
})
