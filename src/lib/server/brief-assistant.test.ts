// @vitest-environment node
import { describe, it, expect } from "vitest"

import { buildAssistantMessages, type AssistantTurn } from "./brief-assistant"
import type { Brief } from "@/types"

const brief = {
  projectId: "p1",
  summary: "Rumah baru 2 lantai di tanah 8×15 m, Bandung.",
  site: { widthM: 8, depthM: 15, areaM2: 120, city: "Bandung" },
  building: { floors: 2, rooftop: false, budget: { minIDR: 1, maxIDR: 2 }, finishingLevel: "menengah" },
  priorities: ["terasa_lega"],
  spaceProgram: [{ id: "r1", roomType: "kamar_tidur", name: "Kamar", required: true, quantity: 3 }],
  assumptions: [],
  constraints: ["Lahan relatif sempit di sisi lebar."],
  risks: [{ id: "x", level: "warning", category: "structural", title: "Bangunan 2 lantai", message: "..." }],
} as unknown as Brief

describe("buildAssistantMessages", () => {
  it("starts with a system message grounded on the brief", () => {
    const m = buildAssistantMessages(brief, "kolam realistis?")
    expect(m[0].role).toBe("system")
    expect(m[0].content).toContain("Rumah baru 2 lantai") // summary embedded
    expect(m[0].content).toContain("Bahasa Indonesia")
  })

  it("appends the question as the final user message", () => {
    const m = buildAssistantMessages(brief, "tambah musholla")
    expect(m[m.length - 1]).toEqual({ role: "user", content: "tambah musholla" })
  })

  it("keeps history but trims to the last 8 turns", () => {
    const hist: AssistantTurn[] = Array.from({ length: 12 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `t${i}`,
    }))
    const m = buildAssistantMessages(brief, "q", hist)
    // 1 system + 8 trimmed history + 1 question
    expect(m).toHaveLength(10)
    expect(m[1].content).toBe("t4") // last 8 of t0..t11 → starts at t4
  })
})

describe("buildAssistantMessages — standards grounding", () => {
  it("injects the standards note into the system prompt when provided", () => {
    const note = "Hasil audit standar denah — skor 64/100:\n- Kamar utama lebih kecil dari standar (SNI 03-1733-2004)"
    const m = buildAssistantMessages(brief, "apakah desain saya sudah bagus?", [], note)
    expect(m[0].role).toBe("system")
    expect(m[0].content).toContain("HASIL AUDIT STANDAR")
    expect(m[0].content).toContain("skor 64/100")
    expect(m[0].content).toContain("SNI 03-1733-2004")
  })

  it("omits the standards section entirely when no note is given (backward compatible)", () => {
    const m = buildAssistantMessages(brief, "kolam realistis?")
    expect(m[0].content).not.toContain("HASIL AUDIT STANDAR")
  })
})

describe("buildAssistantMessages — design-knowledge grounding", () => {
  const dkNote =
    "• Kitchen island (furniture)\n  - why_used: Menambah area kerja; Storage ekstra\n  - when_not_to_use: Dapur < 3 meter"

  it("injects the design-knowledge note into the system prompt when provided", () => {
    const m = buildAssistantMessages(brief, "kenapa pakai kitchen island?", [], undefined, dkNote)
    expect(m[0].role).toBe("system")
    expect(m[0].content).toContain("PENGETAHUAN DESAIN")
    expect(m[0].content).toContain("Kitchen island")
    expect(m[0].content).toContain("Menambah area kerja")
  })

  it("omits the design-knowledge section when no note is given (backward compatible)", () => {
    const m = buildAssistantMessages(brief, "kolam realistis?")
    expect(m[0].content).not.toContain("PENGETAHUAN DESAIN")
  })

  it("carries both standards and design-knowledge notes together", () => {
    const m = buildAssistantMessages(brief, "review desain", [], "skor 64/100", dkNote)
    expect(m[0].content).toContain("HASIL AUDIT STANDAR")
    expect(m[0].content).toContain("PENGETAHUAN DESAIN")
  })
})

describe("buildAssistantMessages — asset suggestions grounding", () => {
  const assetNote = "• G+1 Home with gate [gate] — Fasad modern dengan pagar besi hitam\n• Steel Fence Panel [fence]"

  it("injects the asset suggestions note when provided", () => {
    const m = buildAssistantMessages(brief, "carikan gerbang besi hitam", [], undefined, undefined, assetNote)
    expect(m[0].content).toContain("MODEL TERSEDIA DI LIBRARY")
    expect(m[0].content).toContain("G+1 Home with gate")
    // instruksi anti-halusinasi hadir
    expect(m[0].content).toContain("JANGAN mengarang model lain")
  })

  it("omits the asset section when no note is given (backward compatible)", () => {
    const m = buildAssistantMessages(brief, "kolam realistis?")
    expect(m[0].content).not.toContain("MODEL TERSEDIA DI LIBRARY")
  })

  it("carries design-knowledge and asset notes together", () => {
    const m = buildAssistantMessages(brief, "q", [], undefined, "• Kitchen island (furniture)", assetNote)
    expect(m[0].content).toContain("PENGETAHUAN DESAIN")
    expect(m[0].content).toContain("MODEL TERSEDIA DI LIBRARY")
  })
})
