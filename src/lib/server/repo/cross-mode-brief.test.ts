import { describe, expect, it } from "vitest"
import { buildMessages } from "@/lib/server/editor-assistant"
import { buildAssistantContextBlocks, formatExistingLayoutNote } from "../brief-assistant-context"
import type { Brief, FloorplanScene, InteriorScene } from "@/types"

const mockBrief: Brief = {
  summary: {
    architecturalStyle: "Japandi Modern",
    houseType: "Rumah Tinggal 2 Lantai",
    siteDimensions: { widthM: 10, depthM: 15 },
    totalFloorAreaM2: 120,
    estimatedCostIDR: 600000000,
  },
  site: { widthM: 10, depthM: 15, totalAreaM2: 150 },
  building: { floorsCount: 2, heightM: 7 },
  priorities: ["Pencahayaan Alami", "Konsep Open Plan"],
  spaceProgram: [
    { roomType: "kamar_tidur", name: "Kamar Utama", quantity: 1 },
    { roomType: "ruang_tamu", name: "Ruang Tamu", quantity: 1 },
  ],
  constraints: ["Batas Garis Sempadan Bangunan 3m"],
  risks: [{ title: "Lahan Sempit", mitigation: "Desain Kompak" }],
}

const mockFloorplanScene: FloorplanScene = {
  site: { widthM: 10, depthM: 15 },
  floors: [{ id: "floor-1", label: "Lantai 1", levelOffsetM: 0 }],
  rooms: [
    {
      id: "rm-1",
      name: "Ruang Tamu",
      type: "ruang_tamu",
      floorId: "floor-1",
      x: 0,
      y: 0,
      width: 4,
      depth: 5,
      areaM2: 20,
    },
  ],
  openings: [],
}

const mockInteriorScene: InteriorScene = {
  style: "japandi",
  rooms: [
    {
      roomId: "rm-1",
      name: "Ruang Tamu",
      type: "ruang_tamu",
      widthM: 4,
      depthM: 5,
      furniture: [],
      lighting: [],
    },
  ],
}

describe("Cross-Mode Brief Grounding", () => {
  it("injects BRIEF PROYEK into interior mode prompt when brief is provided", () => {
    const msgs = buildMessages(
      "interior",
      mockInteriorScene,
      "saran furnitur",
      [],
      undefined,
      undefined,
      undefined,
      mockBrief,
    )
    expect(msgs[0].content).toContain("BRIEF PROYEK")
    expect(msgs[0].content).toContain("Japandi Modern")
    expect(msgs[0].content).toContain("ATURAN PATUH BRIEF")
  })

  it("injects BRIEF PROYEK into floorplan mode prompt when brief is provided", () => {
    const msgs = buildMessages(
      "floorplan",
      mockFloorplanScene,
      "tambah kamar",
      [],
      undefined,
      undefined,
      undefined,
      mockBrief,
    )
    expect(msgs[0].content).toContain("BRIEF PROYEK")
    expect(msgs[0].content).toContain("Japandi Modern")
  })

  it("handles null brief gracefully with guidance to help user create a brief", () => {
    const msgs = buildMessages(
      "interior",
      mockInteriorScene,
      "buatkan brief",
      [],
      undefined,
      undefined,
      undefined,
      null,
    )
    expect(msgs[0].content).toContain("BRIEF PROYEK: (Belum diisi oleh pengguna)")
    expect(msgs[0].content).toContain("bantu pandu dan susun ringkasan brief")
  })

  it("grounds agent with existing layout design when brief is null", () => {
    const mockLayout = {
      site: { widthM: 10, depthM: 12 },
      floors: [{ id: "floor-1", name: "Lantai 1" }, { id: "floor-2", name: "Lantai 2" }],
      rooms: [
        { name: "Carport", type: "carport", areaM2: 30 },
        { name: "Ruang Tamu", type: "ruang_tamu", areaM2: 22 },
        { name: "Dapur", type: "dapur", areaM2: 15 },
      ],
    }

    const note = formatExistingLayoutNote(mockLayout, { widthM: 10, depthM: 12 })
    expect(note).toContain("DESAIN DENAH & 2D TERSEDIA")
    expect(note).toContain("Carport (30m²)")
    expect(note).toContain("2 lantai")

    const blocks = buildAssistantContextBlocks({
      brief: null,
      existingLayoutNote: note,
    })

    expect(blocks[0].content).toContain("DESAIN DENAH & 2D SUDAH TERSEDIA")
    expect(blocks[0].content).toContain("Tawarkan Opsi Berpenomoran")
  })
})
