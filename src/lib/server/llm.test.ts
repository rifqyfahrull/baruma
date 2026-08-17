// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

const completeChat = vi.fn()
const llmProviderEnabled = vi.fn()

vi.mock("./openai-client", () => ({
  completeChat: (...args: unknown[]) => completeChat(...args),
  llmProviderEnabled: () => llmProviderEnabled(),
}))

import { askAssistant, chatJSON, chatText, formatJsonToMarkdown, llmEnabled, PROSE_SLUG } from "./llm"

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.OPENAI_MODEL
  delete process.env.OPENAI_MODEL_PROSE
})

describe("llmEnabled", () => {
  it("mirrors the underlying openai-client provider check", () => {
    llmProviderEnabled.mockReturnValue(false)
    expect(llmEnabled()).toBe(false)
    llmProviderEnabled.mockReturnValue(true)
    expect(llmEnabled()).toBe(true)
  })
})

describe("chatJSON", () => {
  it("returns null when completeChat resolves null (LLM disabled/failed)", async () => {
    completeChat.mockResolvedValue(null)
    expect(await chatJSON([{ role: "user", content: "x" }])).toBeNull()
  })

  it("parses a clean JSON completion", async () => {
    completeChat.mockResolvedValue({ content: '{"a":1}' })
    expect(await chatJSON<{ a: number }>([{ role: "user", content: "x" }])).toEqual({ a: 1 })
  })

  it("strips ```json fences before parsing", async () => {
    completeChat.mockResolvedValue({ content: '```json\n{"a":1}\n```' })
    expect(await chatJSON<{ a: number }>([{ role: "user", content: "x" }])).toEqual({ a: 1 })
  })

  it("falls back to {reply, actions:[]} when content isn't valid or repairable JSON", async () => {
    completeChat.mockResolvedValue({ content: "not-json" })
    expect(await chatJSON([{ role: "user", content: "x" }])).toEqual({ reply: "not-json", actions: [] })
  })

  it("uses the actions profile (low temperature, json responseFormat) by default", async () => {
    completeChat.mockResolvedValue({ content: "{}" })
    await chatJSON([{ role: "user", content: "x" }])
    const args = completeChat.mock.calls[0][0]
    expect(args.responseFormat).toBe("json")
    expect(args.temperature).toBe(0.2)
  })

  it("switches to the prose profile's higher temperature when opts.slug is PROSE_SLUG", async () => {
    completeChat.mockResolvedValue({ content: "{}" })
    await chatJSON([{ role: "user", content: "x" }], { slug: PROSE_SLUG })
    const args = completeChat.mock.calls[0][0]
    expect(args.temperature).toBe(0.7)
  })

  it("reads OPENAI_MODEL for the model passed to completeChat", async () => {
    process.env.OPENAI_MODEL = "deepseek-chat"
    completeChat.mockResolvedValue({ content: "{}" })
    await chatJSON([{ role: "user", content: "x" }])
    expect(completeChat.mock.calls[0][0].model).toBe("deepseek-chat")
  })
})

describe("chatText", () => {
  it("returns trimmed text", async () => {
    completeChat.mockResolvedValue({ content: "  Halo  " })
    expect(await chatText([{ role: "user", content: "x" }])).toBe("Halo")
  })

  it("returns null when completeChat resolves null", async () => {
    completeChat.mockResolvedValue(null)
    expect(await chatText([{ role: "user", content: "x" }])).toBeNull()
  })

  it("uses the prose model profile", async () => {
    process.env.OPENAI_MODEL_PROSE = "gpt-4.1"
    process.env.OPENAI_MODEL = "gpt-4o-mini"
    completeChat.mockResolvedValue({ content: "halo" })
    await chatText([{ role: "user", content: "x" }])
    expect(completeChat.mock.calls[0][0].model).toBe("gpt-4.1")
    expect(completeChat.mock.calls[0][0].responseFormat).toBe("text")
  })
})

describe("formatJsonToMarkdown", () => {
  it("prefers a primary prose field when present", () => {
    expect(formatJsonToMarkdown({ response: "Halo dunia" })).toBe("Halo dunia")
  })

  it("renders arbitrary keys as markdown sections", () => {
    const md = formatJsonToMarkdown({ analisis: "Bagus", catatan_risiko: ["a", "b"] })
    expect(md).toContain("**Analisis**:")
    expect(md).toContain("Bagus")
    expect(md).toContain("**Catatan Risiko**:")
    expect(md).toContain("- a")
  })
})

describe("askAssistant", () => {
  it("returns null when completeChat resolves null", async () => {
    completeChat.mockResolvedValue(null)
    expect(await askAssistant({ userId: "u1", text: "halo" })).toBeNull()
  })

  it("returns the trimmed reply and forwards context blocks + userId as the request's user field", async () => {
    completeChat.mockResolvedValue({ content: "  Tentu, saya bisa bantu.  " })
    const result = await askAssistant({
      userId: "u1",
      text: "tolong buatkan brief",
      contextBlocks: [{ title: "Brief proyek", content: "kosong" }],
    })
    expect(result).toBe("Tentu, saya bisa bantu.")
    const args = completeChat.mock.calls[0][0]
    expect(args.user).toBe("u1")
    expect(args.messages.some((m: { content: string }) => m.content.includes("Brief proyek"))).toBe(true)
    expect(args.messages.some((m: { content: string }) => m.content.includes("kosong"))).toBe(true)
    expect(args.messages.at(-1)).toEqual({ role: "user", content: "tolong buatkan brief" })
  })

  it("unwraps a raw-JSON reply into markdown", async () => {
    completeChat.mockResolvedValue({ content: JSON.stringify({ response: "Jawaban bersih" }) })
    expect(await askAssistant({ userId: "u1", text: "x" })).toBe("Jawaban bersih")
  })

  it("keeps a needs_clarify JSON payload intact instead of reformatting it", async () => {
    const payload = JSON.stringify({ reply: "butuh info", needs_clarify: [{ question: "Gaya?", suggestions: ["Modern"] }] })
    completeChat.mockResolvedValue({ content: payload })
    expect(await askAssistant({ userId: "u1", text: "x" })).toBe(payload)
  })

  it("strips <think> reasoning tags before returning", async () => {
    completeChat.mockResolvedValue({ content: "<think>internal musing</think>Jawaban final" })
    expect(await askAssistant({ userId: "u1", text: "x" })).toBe("Jawaban final")
  })
})
