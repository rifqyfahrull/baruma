// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock the data layer before importing generate
vi.mock("@/lib/data", () => ({
  data: {
    getProject: vi.fn(),
    getRAB: vi.fn(),
    getBrief: vi.fn(),
    getLayout: vi.fn(),
    getInterior: vi.fn(),
  },
}))

// Mock jspdf and jspdf-autotable so they work in node env
vi.mock("jspdf", () => {
  const jsPDF = vi.fn().mockImplementation(() => ({
    internal: { pageSize: { getWidth: () => 210 } },
    setFontSize: vi.fn(),
    setFont: vi.fn(),
    setTextColor: vi.fn(),
    text: vi.fn(),
    splitTextToSize: vi.fn().mockReturnValue(["line"]),
    output: vi.fn().mockReturnValue(new Uint8Array([1, 2, 3])),
    lastAutoTable: { finalY: 100 },
  }))
  return { jsPDF }
})

vi.mock("jspdf-autotable", () => ({
  default: vi.fn().mockImplementation((doc: { lastAutoTable: unknown }) => {
    doc.lastAutoTable = { finalY: 100 }
  }),
}))

// Mock three and GLTFExporter so they work in node env
vi.mock("three", async () => {
  const actual = await vi.importActual<typeof import("three")>("three")
  return actual
})

vi.mock("three/examples/jsm/exporters/GLTFExporter.js", () => ({
  GLTFExporter: vi.fn().mockImplementation(() => ({
    parse: (_obj: unknown, onDone: (r: ArrayBuffer) => void, _onErr: unknown, _opts: unknown) => {
      void _onErr
      void _opts
      onDone(new ArrayBuffer(8))
    },
  })),
}))

// contractor-pack.ts / zip-all.ts have their own dedicated content tests —
// here we only verify generateExport WIRES the right project/layout/opts
// into them, so this file doesn't need to grow a full jsPDF surface mock.
vi.mock("./contractor-pack", () => ({
  buildContractorPackPdf: vi.fn().mockResolvedValue(new Blob(["contractor"])),
}))
vi.mock("./zip-all", () => ({
  buildZipAllBlob: vi.fn().mockResolvedValue(new Blob(["zip"])),
}))

import { generateExport } from "./generate"
import { data } from "@/lib/data"
import { buildContractorPackPdf } from "./contractor-pack"
import { buildZipAllBlob } from "./zip-all"

const mockProject = {
  id: "p1",
  name: "Rumah Test",
  site: { widthM: 8, depthM: 12, areaM2: 96 },
  floors: 2,
  rooftop: false,
  status: "editing",
  readiness: "concept_ready",
  projectType: "new",
  thumbnail: "family",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

const mockRab = {
  projectId: "p1",
  versionId: "v1",
  areaM2: 96,
  summary: { lowIDR: 500_000_000, midIDR: 600_000_000, highIDR: 700_000_000, perM2IDR: 6_250_000, confidence: "medium" },
  items: [
    { id: "s1", category: "struktur", item: "Pondasi", volume: 96, unit: "m²", unitPriceIDR: 500_000, totalIDR: 48_000_000, confidence: "medium" },
  ],
  assumptions: [],
}

const mockBrief = {
  projectId: "p1",
  summary: "Rumah 2 lantai di Jakarta",
  site: { widthM: 8, depthM: 12, areaM2: 96, city: "Jakarta" },
  building: {
    floors: 2,
    rooftop: false,
    budget: { minIDR: 500_000_000, maxIDR: 700_000_000 },
    finishingLevel: "menengah",
  },
  priorities: [],
  spaceProgram: [],
  assumptions: [],
  constraints: [],
  risks: [],
}

const mockLayout = {
  id: "l1",
  projectId: "p1",
  versionId: "v1",
  floors: [{ id: "f1", level: 1, name: "Lantai 1", heightM: 3.2 }],
  rooms: [
    { id: "r1", floorId: "f1", name: "Ruang Tamu", type: "ruang_tamu", x: 0, y: 0, width: 4, depth: 4, areaM2: 16 },
  ],
  walls: [],
  openings: [],
  stairs: [],
  pools: [],
  validation: { passed: true, issues: [] },
}

beforeEach(() => {
  vi.mocked(data.getProject).mockResolvedValue(mockProject as never)
  vi.mocked(data.getRAB).mockResolvedValue(mockRab as never)
  vi.mocked(data.getBrief).mockResolvedValue(mockBrief as never)
  vi.mocked(data.getLayout).mockResolvedValue(mockLayout as never)
  vi.mocked(data.getInterior).mockResolvedValue(null as never)
  vi.mocked(buildContractorPackPdf).mockClear()
  vi.mocked(buildZipAllBlob).mockClear()
})

describe("generateExport — unsupported formats", () => {
  it("rejects ifc with 'belum tersedia' — the only remaining stub (kartu 'Segera hadir', see EXPORT_META.ifc.comingSoon)", async () => {
    await expect(generateExport("p1", "ifc")).rejects.toThrow("belum tersedia")
  })
})

describe("generateExport — dxf (real, no longer unsupported)", () => {
  it("returns a real DXF Blob with a 'denah-{slug}.dxf' filename", async () => {
    const result = await generateExport("p1", "dxf")
    expect(result.blob).toBeInstanceOf(Blob)
    expect(result.blob.type).toBe("application/dxf")
    expect(result.blob.size).toBeGreaterThan(0)
    expect(result.filename).toBe("denah-rumah-test.dxf")
  })

  it("is parseable ASCII DXF content (SECTION/ENTITIES/EOF)", async () => {
    const result = await generateExport("p1", "dxf")
    const text = await result.blob.text()
    expect(text).toContain("SECTION")
    expect(text).toContain("ENTITIES")
    expect(text.trim().endsWith("0\nEOF")).toBe(true)
  })

  it("throws when the layout is missing", async () => {
    vi.mocked(data.getLayout).mockResolvedValueOnce(null)
    await expect(generateExport("p1", "dxf")).rejects.toThrow("Data belum lengkap")
  })
})

describe("generateExport — zip_all (real, no longer unsupported)", () => {
  it("delegates to buildZipAllBlob with project/brief/rab/layout/interior rooms and a 'baruma-{slug}.zip' filename", async () => {
    const result = await generateExport("p1", "zip_all", { watermark: true })

    expect(vi.mocked(buildZipAllBlob)).toHaveBeenCalledTimes(1)
    const [project, brief, rab, layout, rooms, opts] = vi.mocked(buildZipAllBlob).mock.calls[0]
    expect(project).toEqual(mockProject)
    expect(brief).toEqual(mockBrief)
    expect(rab).toEqual(mockRab)
    expect(layout).toEqual(mockLayout)
    expect(Array.isArray(rooms)).toBe(true)
    expect(opts).toMatchObject({ watermark: true })

    expect(result.blob.size).toBeGreaterThan(0)
    expect(result.filename).toBe("baruma-rumah-test.zip")
  })

  it("throws when the layout is missing", async () => {
    vi.mocked(data.getLayout).mockResolvedValueOnce(null)
    await expect(generateExport("p1", "zip_all")).rejects.toThrow("Data belum lengkap")
  })
})

describe("generateExport — contractor_pack threads layout/watermark/thumbnail into the builder", () => {
  it("passes the fetched layout, opts.watermark, and opts.thumbnailDataUrl through", async () => {
    await generateExport("p1", "contractor_pack", {
      watermark: true,
      thumbnailDataUrl: "data:image/png;base64,AAAA",
    })

    expect(vi.mocked(buildContractorPackPdf)).toHaveBeenCalledTimes(1)
    const [project, brief, rab, opts] = vi.mocked(buildContractorPackPdf).mock.calls[0]
    expect(project).toEqual(mockProject)
    expect(brief).toEqual(mockBrief)
    expect(rab).toEqual(mockRab)
    expect(opts).toMatchObject({
      layout: mockLayout,
      watermark: true,
      thumbnailDataUrl: "data:image/png;base64,AAAA",
    })
  })
})

describe("generateExport — rab_excel", () => {
  it("returns a Blob with .xlsx filename and sizeLabel", async () => {
    const result = await generateExport("p1", "rab_excel")
    expect(result.blob).toBeInstanceOf(Blob)
    expect(result.blob.size).toBeGreaterThan(0)
    expect(result.filename).toMatch(/\.xlsx$/)
    expect(result.filename).toContain("rumah-test")
    expect(result.sizeLabel).toMatch(/KB|MB|B/)
  })

  it("throws when project is missing", async () => {
    vi.mocked(data.getProject).mockResolvedValueOnce(null)
    await expect(generateExport("p1", "rab_excel")).rejects.toThrow(
      "Data belum lengkap"
    )
  })

  it("throws when rab is missing", async () => {
    vi.mocked(data.getRAB).mockResolvedValueOnce(null)
    await expect(generateExport("p1", "rab_excel")).rejects.toThrow(
      "Data belum lengkap"
    )
  })
})

describe("generateExport — slug and sizeLabel helpers (via rab_excel)", () => {
  it("slugifies project name correctly", async () => {
    vi.mocked(data.getProject).mockResolvedValue({
      ...mockProject,
      name: "Rumah Besar & Indah!",
    } as never)
    const result = await generateExport("p1", "rab_excel")
    expect(result.filename).toContain("rumah-besar-indah")
  })

  it("produces KB label for small files", async () => {
    const result = await generateExport("p1", "rab_excel")
    // xlsx blob from the test data is small — expect KB or B
    expect(result.sizeLabel).toMatch(/\d+(\.\d+)? (KB|MB|B)/)
  })
})
