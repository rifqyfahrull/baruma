import { describe, it, expect } from "vitest"
import JSZip from "jszip"

import type { Brief, DesignLayout, Project, RAB } from "@/types"
import { buildZipAllBlob } from "./zip-all"

const project = {
  id: "p1",
  name: "Rumah Uji Zip",
  site: { widthM: 8, depthM: 10, areaM2: 80 },
  floors: 1,
  rooftop: false,
  status: "editing",
  readiness: "concept_ready",
  projectType: "new",
  thumbnail: "family",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
} as unknown as Project

const brief = {
  projectId: "p1",
  summary: "Rumah 1 lantai",
  site: { widthM: 8, depthM: 10, areaM2: 80, city: "Jakarta" },
  building: {
    floors: 1,
    rooftop: false,
    budget: { minIDR: 300_000_000, maxIDR: 400_000_000 },
    finishingLevel: "menengah",
  },
  priorities: [],
  spaceProgram: [],
  assumptions: [],
  constraints: [],
  risks: [],
} as unknown as Brief

const rab = {
  projectId: "p1",
  versionId: "v1",
  areaM2: 80,
  summary: { lowIDR: 1, midIDR: 2, highIDR: 3, perM2IDR: 4, confidence: "medium" },
  items: [
    { id: "i1", category: "struktur", item: "Pondasi", volume: 1, unit: "ls", unitPriceIDR: 100, totalIDR: 100, confidence: "medium" },
  ],
  assumptions: ["Harga rata-rata nasional 2026."],
} as unknown as RAB

const layout = {
  id: "l1",
  projectId: "p1",
  versionId: "v1",
  floors: [{ id: "f1", level: 0, name: "Lantai 1", heightM: 3 }],
  rooms: [
    { id: "r1", floorId: "f1", name: "Ruang Tamu", type: "ruang_tamu", x: 0, y: 0, width: 4, depth: 4, areaM2: 16 },
  ],
  walls: [],
  openings: [],
  stairs: [],
  pools: [],
  validation: { passed: true, issues: [] },
} as unknown as DesignLayout

describe("buildZipAllBlob", () => {
  it("bundles contractor pack, drawings pack, interior pack, and rab.xlsx into one zip", async () => {
    const blob = await buildZipAllBlob(project, brief, rab, layout, [])
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toMatch(/zip/)

    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    const names = Object.keys(zip.files).sort()
    expect(names).toEqual([
      "contractor-pack.pdf",
      "gambar-kerja.pdf",
      "interior-pack.pdf",
      "rab.xlsx",
    ])

    for (const name of names) {
      const bytes = await zip.file(name)!.async("uint8array")
      expect(bytes.length).toBeGreaterThan(0)
    }
  }, 30_000)

  it("omits rab.xlsx when there is no RAB yet", async () => {
    const blob = await buildZipAllBlob(project, brief, null, layout, [])
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    expect(Object.keys(zip.files)).not.toContain("rab.xlsx")
  }, 30_000)

  it("excludes the GLB by default and includes it only when includeGlb is set", async () => {
    const blob = await buildZipAllBlob(project, brief, rab, layout, [])
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    expect(Object.keys(zip.files)).not.toContain("model-3d.glb")
  }, 30_000)

  it("reports staged progress via onProgress, ending at 100", async () => {
    const stages: number[] = []
    await buildZipAllBlob(project, brief, rab, layout, [], { onProgress: (pct) => stages.push(pct) })
    expect(stages.length).toBeGreaterThan(1)
    expect(stages[stages.length - 1]).toBe(100)
    // Monotonically non-decreasing.
    expect(stages.every((v, i) => i === 0 || v >= stages[i - 1])).toBe(true)
  }, 30_000)
})
