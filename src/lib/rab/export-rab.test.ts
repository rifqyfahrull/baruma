// @vitest-environment node
import { describe, it, expect } from "vitest"

import { rabToAoa, rabToAssumptionsAoa, rabToPrintHtml, rabToXlsxBlob } from "./export-rab"
import type { RAB, Project } from "@/types"

const rab = {
  projectId: "p1",
  versionId: "v1",
  areaM2: 120,
  summary: { lowIDR: 800_000_000, midIDR: 900_000_000, highIDR: 1_000_000_000, perM2IDR: 7_500_000, confidence: "medium" },
  items: [
    { id: "struktur-0", category: "struktur", item: "Pondasi", volume: 120, unit: "m²", unitPriceIDR: 500_000, totalIDR: 60_000_000, confidence: "medium" },
    { id: "custom-1", category: "struktur", item: "Manual <x>", volume: 1, unit: "ls", unitPriceIDR: 25_000_000, totalIDR: 25_000_000, confidence: "low", notes: "catatan" },
  ],
  assumptions: ["Harga regional 2026."],
} as unknown as RAB

const project = { name: "Rumah A" } as Project

describe("rabToAoa", () => {
  it("has a header row, one row per item (numbers stay numeric), and a TOTAL", () => {
    const aoa = rabToAoa(rab, project)
    const h = aoa.findIndex((r) => r[0] === "Kategori")
    expect(h).toBeGreaterThan(-1)
    expect(aoa[h]).toContain("Total (IDR)")
    const item = aoa[h + 1]
    expect(item[1]).toBe("Pondasi")
    expect(item[4]).toBe(500_000) // unit price numeric (for Excel math)
    expect(item[5]).toBe(60_000_000) // total numeric
    expect(aoa.some((r) => r.includes("TOTAL") && r.includes(85_000_000))).toBe(true) // 60M + 25M
  })
})

describe("rabToPrintHtml", () => {
  it("renders title, items, and escapes user content", () => {
    const html = rabToPrintHtml(rab, project)
    expect(html).toContain("RAB / BOQ")
    expect(html).toContain("Rumah A")
    expect(html).toContain("Pondasi")
    expect(html).not.toContain("Manual <x>")
    expect(html).toContain("Manual &lt;x&gt;")
  })

  it("works without a project", () => {
    expect(rabToPrintHtml(rab)).toContain("RAB / BOQ")
  })
})

describe("rabToAssumptionsAoa", () => {
  it("lists every assumption, numbered, plus a generated date and the estimate's confidence", () => {
    const aoa = rabToAssumptionsAoa(rab)
    expect(aoa.some((r) => r[0] === "Keyakinan estimasi" && r[1] === "Sedang")).toBe(true)
    expect(aoa.some((r) => r[0] === "Tanggal dibuat")).toBe(true)
    expect(aoa.some((r) => r[0] === 1 && r[1] === "Harga regional 2026.")).toBe(true)
  })

  it("falls back to an explicit 'no assumptions' row instead of an empty sheet", () => {
    const noAssumptions = { ...rab, assumptions: [] } as unknown as RAB
    const aoa = rabToAssumptionsAoa(noAssumptions)
    expect(aoa.some((r) => r[1] === "Tidak ada catatan asumsi khusus.")).toBe(true)
  })
})

describe("rabToXlsxBlob", () => {
  it("returns a non-empty Blob with the xlsx MIME type", async () => {
    const blob = await rabToXlsxBlob(rab, project)
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.size).toBeGreaterThan(0)
    expect(blob.type).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
  })

  it("works without a project argument", async () => {
    const blob = await rabToXlsxBlob(rab)
    expect(blob.size).toBeGreaterThan(0)
  })

  it("includes both an 'RAB' and an 'Asumsi' worksheet, the latter carrying rab.assumptions", async () => {
    const XLSX = await import("xlsx")
    const blob = await rabToXlsxBlob(rab, project)
    const wb = XLSX.read(new Uint8Array(await blob.arrayBuffer()), { type: "array" })
    expect(wb.SheetNames).toEqual(["RAB", "Asumsi"])

    const rows: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets["Asumsi"], { header: 1 })
    expect(rows.some((r) => r.includes("Harga regional 2026."))).toBe(true)
  })
})
