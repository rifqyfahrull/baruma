// @vitest-environment node
import { describe, it, expect } from "vitest"

import { briefToPrintHtml } from "./print-brief"
import type { Brief, Project } from "@/types"

const brief = {
  projectId: "p1",
  summary: "Rumah baru 2 lantai di tanah 8×15 m, Bandung.",
  site: { widthM: 8, depthM: 15, areaM2: 120, city: "Bandung", frontOrientation: "east", sidesAttached: 1 },
  building: { floors: 2, rooftop: true, budget: { minIDR: 500_000_000, maxIDR: 900_000_000 }, finishingLevel: "menengah" },
  priorities: ["terasa_lega"],
  spaceProgram: [
    { id: "r1", roomType: "kamar_tidur", name: "Kamar", required: true, quantity: 3 },
    { id: "r2", roomType: "dapur", name: "Dapur", required: false, quantity: 1 },
  ],
  assumptions: ["Tanah relatif datar."],
  constraints: ["Lahan relatif sempit di sisi lebar."],
  risks: [{ id: "x", level: "warning", category: "structural", title: "Bangunan 2 lantai", message: "Perlu cek struktur." }],
} as unknown as Brief

const project = { name: "Rumah A", city: "Bandung" } as Project

describe("briefToPrintHtml", () => {
  it("renders the brief sections and content", () => {
    const html = briefToPrintHtml(brief, project)
    expect(html).toContain("Brief Desain")
    expect(html).toContain("Rumah A")
    expect(html).toContain(brief.summary)
    expect(html).toContain("Program ruang")
    expect(html).toContain("Catatan risiko")
    expect(html).toContain("Bangunan 2 lantai") // risk title
  })

  it("escapes HTML in user-provided content (no injection)", () => {
    const html = briefToPrintHtml(brief, { name: "<script>alert(1)</script>", city: "" } as Project)
    expect(html).not.toContain("<script>alert(1)</script>")
    expect(html).toContain("&lt;script&gt;")
  })

  it("works without a project (falls back to site city / generic title)", () => {
    const html = briefToPrintHtml(brief)
    expect(html).toContain("Brief Desain")
    expect(html).toContain("Bandung") // from site.city
  })
})
