// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const query = vi.fn()
vi.mock("@/lib/server/db", () => ({ query: (...a: unknown[]) => query(...a) }))

import { searchAssetsForAgent, formatAssetSuggestionsNote, wantsAssetSuggestions } from "./asset-search"

beforeEach(() => {
  query.mockReset()
  query.mockResolvedValue({ rows: [] })
})

describe("wantsAssetSuggestions", () => {
  it("true saat pengguna minta model/aset", () => {
    for (const q of [
      "carikan gerbang minimalis besi hitam",
      "ada model sofa L?",
      "rekomendasikan furnitur untuk kamar",
      "saya butuh wastafel dapur",
      "pengen pasang kanopi",
    ]) expect(wantsAssetSuggestions(q)).toBe(true)
  })
  it("false utk pertanyaan desain umum (tak minta aset)", () => {
    for (const q of [
      "apakah desain saya sudah sesuai standar?",
      "berapa idealnya lebar kamar tidur utama?",
      "kenapa rumah saya terasa panas?",
    ]) expect(wantsAssetSuggestions(q)).toBe(false)
  })
})

describe("searchAssetsForAgent", () => {
  it("ekspansi sinonim: 'gerbang' ikut mencari 'gate' di params", async () => {
    await searchAssetsForAgent("carikan gerbang minimalis")
    const terms = query.mock.calls.at(-1)?.[1]?.[0] as string[]
    expect(terms).toContain("gerbang")
    expect(terms).toContain("gate")
    // patterns %term%
    expect((query.mock.calls.at(-1)?.[1]?.[1] as string[])).toContain("%gerbang%")
  })

  it("tak query bila tak ada kata bermakna", async () => {
    const r = await searchAssetsForAgent("apa itu?")
    expect(r).toEqual([])
    expect(query).not.toHaveBeenCalled()
  })

  it("hanya kembalikan baris dgn skor > 0", async () => {
    query.mockResolvedValueOnce({
      rows: [
        { id: "a1", name: "Modern Gate", category: "gate", description: "pagar besi", score: "2" },
        { id: "a2", name: "Random Chair", category: "seating", description: null, score: "0" },
      ],
    })
    const r = await searchAssetsForAgent("gerbang besi")
    expect(r).toHaveLength(1)
    expect(r[0].id).toBe("a1")
  })
})

describe("formatAssetSuggestionsNote", () => {
  it("array kosong → string kosong", () => {
    expect(formatAssetSuggestionsNote([])).toBe("")
  })
  it("menampilkan nama + kategori + deskripsi ringkas", () => {
    const note = formatAssetSuggestionsNote([
      { id: "a1", name: "G+1 Home with gate", category: "gate", description: "Fasad rumah modern dengan pagar besi hitam minimalis." },
      { id: "a2", name: "Steel Fence Panel", category: "fence", description: null },
    ])
    expect(note).toContain("G+1 Home with gate [gate]")
    expect(note).toContain("pagar besi hitam")
    expect(note).toContain("Steel Fence Panel [fence]")
  })
})
