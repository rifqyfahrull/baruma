// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const chatText = vi.fn()
const llmEnabled = vi.fn(() => true)
vi.mock("@/lib/server/llm", () => ({
  chatText: (...a: unknown[]) => chatText(...a),
  llmEnabled: () => llmEnabled(),
}))
const retrieveDesign = vi.fn(async () => [] as unknown[])
vi.mock("@/lib/server/repo/design-knowledge", () => ({
  retrieveDesignKnowledge: (...a: unknown[]) => retrieveDesign(...a),
  formatDesignKnowledgeNote: (rows: { topic: string }[]) => rows.map((r) => r.topic).join("|"),
}))
const retrieveApp = vi.fn(async () => [] as unknown[])
vi.mock("@/lib/server/repo/app-knowledge", () => ({
  retrieveAppKnowledge: (...a: unknown[]) => retrieveApp(...a),
  formatAppKnowledgeNote: () => "",
}))

import { answerKnowledgeQuestion, isKnowledgeQuestion } from "./knowledge-answer"

beforeEach(() => {
  chatText.mockReset()
  retrieveDesign.mockReset()
  retrieveDesign.mockResolvedValue([])
  retrieveApp.mockReset()
  retrieveApp.mockResolvedValue([])
  llmEnabled.mockReturnValue(true)
})

describe("isKnowledgeQuestion — gerbang jalur Q&A", () => {
  it("pertanyaan pengetahuan (kasus produksi yang gagal) → true", () => {
    // Persis yang diketik pengguna di tab Denah dan jatuh ke fallback edit.
    expect(isKnowledgeQuestion("Kenapa sebaiknya pakai kitchen island?")).toBe(true)
    expect(isKnowledgeQuestion("apa itu HPL?")).toBe(true)
    expect(isKnowledgeQuestion("bagaimana cara mengatasi rumah panas")).toBe(true)
    expect(isKnowledgeQuestion("material apa yang cocok untuk dapur?")).toBe(true)
  })

  it("perintah edit TIDAK dibajak jalur Q&A — meski berbentuk tanya", () => {
    expect(isKnowledgeQuestion("tambah jendela di dapur")).toBe(false)
    expect(isKnowledgeQuestion("tolong perbaiki designnya, kamar tidur 2 tidak ada akses")).toBe(false)
    expect(isKnowledgeQuestion("bisa geser dapur ke kiri?")).toBe(false)
    expect(isKnowledgeQuestion("kenapa tidak dihapus saja kamarnya?")).toBe(false)
  })
})

describe("answerKnowledgeQuestion", () => {
  it("bukan pertanyaan pengetahuan → null (pipeline edit berjalan normal)", async () => {
    expect(await answerKnowledgeQuestion("geser dapur ke kiri")).toBeNull()
    expect(chatText).not.toHaveBeenCalled()
  })

  it("LLM hidup → jawab via chatText dgn grounding di system prompt", async () => {
    retrieveDesign.mockResolvedValue([
      { topic: "Kitchen island", topic_type: "furniture", knowledge: {} },
    ])
    chatText.mockResolvedValue("Kitchen island menambah area kerja …")
    const out = await answerKnowledgeQuestion("Kenapa sebaiknya pakai kitchen island?")
    expect(out).toContain("Kitchen island")
    const system = (chatText.mock.calls[0][0] as { content: string }[])[0].content
    expect(system).toContain("PENGETAHUAN")
    expect(system).toContain("Kitchen island")
  })

  it("LLM GAGAL → jawaban deterministik dari knowledge, BUKAN fallback edit", async () => {
    // Inilah cacat produksi: LLM gagal → pengguna disuruh 'pecah jadi langkah
    // edit'. Kini isi knowledge dipakai langsung.
    retrieveDesign.mockResolvedValue([
      {
        topic: "Kitchen island",
        topic_type: "furniture",
        knowledge: {
          why_used: ["Menambah area kerja", "Interaksi sosial saat memasak"],
          when_not_to_use: ["Dapur < 2,5 m"],
        },
      },
    ])
    chatText.mockResolvedValue(null)
    const out = await answerKnowledgeQuestion("Kenapa sebaiknya pakai kitchen island?")
    expect(out).toContain("Kitchen island")
    expect(out).toContain("Menambah area kerja")
    expect(out).toContain("Dapur < 2,5 m")
  })

  it("LLM gagal & tak ada knowledge → null (biar pipeline lain menangani)", async () => {
    chatText.mockResolvedValue(null)
    expect(await answerKnowledgeQuestion("kenapa langit biru?")).toBeNull()
  })
})
