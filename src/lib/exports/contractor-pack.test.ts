import { describe, it, expect, vi, beforeEach } from "vitest"

import type { Brief, DesignLayout, Project, RAB } from "@/types"

const textCalls: unknown[][] = []
const addImageCalls: unknown[][] = []

vi.mock("jspdf", () => {
  class FakeJsPDF {
    internal = { pageSize: { getWidth: () => 210, getHeight: () => 297 } }
    lastAutoTable = { finalY: 100 }
    setFontSize = vi.fn()
    setFont = vi.fn()
    setTextColor = vi.fn()
    splitTextToSize = vi.fn((s: string) => [s])
    addPage = vi.fn()
    addImage = vi.fn((...args: unknown[]) => addImageCalls.push(args))
    text = vi.fn((...args: unknown[]) => textCalls.push(args))
    output = vi.fn().mockReturnValue(new Blob(["fake-pdf"], { type: "application/pdf" }))
  }
  return { jsPDF: FakeJsPDF }
})

vi.mock("jspdf-autotable", () => ({
  default: vi.fn().mockImplementation((doc: { lastAutoTable: unknown }) => {
    doc.lastAutoTable = { finalY: 100 }
  }),
}))

const watermarkSpy = vi.fn()
vi.mock("./watermark", () => ({ applyDraftWatermark: (doc: unknown) => watermarkSpy(doc) }))

import autoTable from "jspdf-autotable"
import { buildContractorPackPdf } from "./contractor-pack"

const project = {
  id: "p1",
  name: "Rumah Uji",
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
  summary: "Rumah 1 lantai di Jakarta",
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
  assumptions: ["Harga rata-rata nasional 2026, verifikasi dengan kontraktor lokal."],
} as unknown as RAB

// Room "Gudang" sits outside the 8x10 site (x=20) => "danger" bounds issue,
// AND is < 4m² => "info" small-room issue — exercises severity sort order.
const layoutWithWarnings = {
  id: "l1",
  projectId: "p1",
  versionId: "v1",
  floors: [{ id: "f1", level: 0, name: "Lantai 1", heightM: 3 }],
  rooms: [
    { id: "r1", floorId: "f1", name: "Gudang", type: "gudang", x: 20, y: 0, width: 1, depth: 1, areaM2: 1 },
  ],
  walls: [],
  openings: [],
  stairs: [],
  pools: [],
  validation: { passed: true, issues: [] },
} as unknown as DesignLayout

beforeEach(() => {
  textCalls.length = 0
  addImageCalls.length = 0
  vi.mocked(autoTable).mockClear()
  watermarkSpy.mockClear()
})

describe("buildContractorPackPdf — Catatan & Asumsi", () => {
  it("adds a page with RAB assumptions and layout warnings, danger severity first", async () => {
    await buildContractorPackPdf(project, brief, rab, { layout: layoutWithWarnings })

    const bodies = vi.mocked(autoTable).mock.calls.map(
      (c) => (c[1] as { body: unknown[] }).body
    )

    const assumptionsBody = bodies.find((b) =>
      JSON.stringify(b).includes("Harga rata-rata nasional")
    )
    expect(assumptionsBody).toBeTruthy()

    const warningsBody = bodies.find(
      (b) => Array.isArray(b) && b.some((row) => Array.isArray(row) && row[0] === "Bahaya")
    ) as [string, string][] | undefined
    expect(warningsBody).toBeTruthy()
    // Danger (bounds) must come before info (small room) — severity-sorted.
    expect(warningsBody![0][0]).toBe("Bahaya")
    expect(warningsBody!.some((row) => row[0] === "Info")).toBe(true)
  })

  it("omits the notes page entirely when there are no assumptions and no layout", async () => {
    const rabNoAssumptions = { ...rab, assumptions: [] } as unknown as RAB
    await buildContractorPackPdf(project, brief, rabNoAssumptions)

    const bodies = vi.mocked(autoTable).mock.calls.map(
      (c) => (c[1] as { body?: unknown[] }).body
    )
    expect(bodies.some((b) => JSON.stringify(b).includes("Bahaya"))).toBe(false)
  })
})

describe("buildContractorPackPdf — denah per lantai", () => {
  it("does not throw and adds no broken images when canvas rasterization is unavailable (jsdom without the `canvas` package)", async () => {
    const result = await buildContractorPackPdf(project, brief, rab, { layout: layoutWithWarnings })
    expect(result).toBeInstanceOf(Blob)
    // jsdom's canvas 2D context is null by default -> rasterization skips
    // gracefully -> no addImage calls for the denah (and no thumbnail given).
    expect(addImageCalls.length).toBe(0)
  })
})

describe("buildContractorPackPdf — 3D thumbnail", () => {
  it("adds a thumbnail image page when thumbnailDataUrl is provided", async () => {
    await buildContractorPackPdf(project, brief, rab, {
      thumbnailDataUrl: "data:image/png;base64,AAAA",
    })
    expect(addImageCalls.length).toBe(1)
    expect(addImageCalls[0][0]).toBe("data:image/png;base64,AAAA")
  })

  it("omits the thumbnail page when no capture was available", async () => {
    await buildContractorPackPdf(project, brief, rab)
    expect(addImageCalls.length).toBe(0)
  })
})

describe("buildContractorPackPdf — watermark gating", () => {
  it("applies the watermark when opts.watermark is true", async () => {
    await buildContractorPackPdf(project, brief, rab, { watermark: true })
    expect(watermarkSpy).toHaveBeenCalledTimes(1)
  })

  it("does not apply the watermark by default", async () => {
    await buildContractorPackPdf(project, brief, rab)
    expect(watermarkSpy).not.toHaveBeenCalled()
  })
})
