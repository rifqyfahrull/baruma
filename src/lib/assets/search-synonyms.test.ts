import { describe, it, expect } from "vitest"
import { expandSearchTerms } from "./search-synonyms"

describe("expandSearchTerms — sinonim ID↔EN", () => {
  it("query kosong → array kosong", () => {
    expect(expandSearchTerms("")).toEqual([])
    expect(expandSearchTerms("   ")).toEqual([])
  })

  it("selalu menyertakan query asli", () => {
    expect(expandSearchTerms("random xyz")).toContain("random xyz")
  })

  it("pagar → mencakup fence (dan gate lewat grup? tidak — pagar hanya di grup fence)", () => {
    const t = expandSearchTerms("pagar")
    expect(t).toContain("pagar")
    expect(t).toContain("fence")
  })

  it("gerbang & pintu masuk → gate", () => {
    expect(expandSearchTerms("gerbang")).toContain("gate")
    expect(expandSearchTerms("pintu masuk")).toContain("gate")
  })

  it("frase multi-kata dikenali (pintu masuk sbg frase, bukan hanya 'pintu')", () => {
    const t = expandSearchTerms("pintu masuk")
    expect(t).toContain("gate")
    expect(t).toContain("gerbang")
  })

  it("ekspansi per-kata untuk query majemuk (pagar besi → fence)", () => {
    const t = expandSearchTerms("pagar besi")
    expect(t).toContain("pagar besi") // asli
    expect(t).toContain("fence") // dari kata "pagar"
  })

  it("wastafel → sink; kloset → toilet; lampu → lamp", () => {
    expect(expandSearchTerms("wastafel")).toContain("sink")
    expect(expandSearchTerms("kloset")).toContain("toilet")
    expect(expandSearchTerms("lampu")).toContain("lamp")
  })

  it("EN → ID juga (gate → gerbang) karena grup dua arah", () => {
    expect(expandSearchTerms("gate")).toContain("gerbang")
  })

  it("case-insensitive", () => {
    expect(expandSearchTerms("PAGAR")).toContain("fence")
  })
})
