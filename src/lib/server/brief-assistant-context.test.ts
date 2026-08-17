import { describe, expect, it } from "vitest"
import { buildAssistantContextBlocks } from "./brief-assistant-context"
import type { Brief } from "@/types"

const brief = {
  summary: "Rumah 2 lantai", site: { area: 90 }, building: { floors: 2 },
  priorities: ["hemat"], spaceProgram: [{ roomType: "kamar", name: "Kamar Utama", quantity: 1 }],
  constraints: [], risks: [{ title: "tanah sempit" }],
} as unknown as Brief

describe("buildAssistantContextBlocks", () => {
  it("always includes a Brief block first", () => {
    const blocks = buildAssistantContextBlocks({ brief })
    expect(blocks[0].title).toMatch(/brief/i)
    expect(blocks[0].content).toContain("Rumah 2 lantai")
  })

  it("includes optional notes as their own blocks when present, skips when absent", () => {
    const withNotes = buildAssistantContextBlocks({
      brief, standardsNote: "AUDIT: skor 64", designKnowledgeNote: "KB: ventilasi",
      assetSuggestionsNote: "Sofa A",
    })
    const titles = withNotes.map((b) => b.title.toLowerCase())
    expect(titles.some((t) => t.includes("standar"))).toBe(true)
    expect(titles.some((t) => t.includes("knowledge") || t.includes("pengetahuan"))).toBe(true)
    expect(titles.some((t) => t.includes("aset"))).toBe(true)

    const bare = buildAssistantContextBlocks({ brief })
    expect(bare.length).toBe(2) // Brief + Format JSON block
  })

  it("folds history into a single 'Percakapan sebelumnya' block, last turns only", () => {
    const history = Array.from({ length: 12 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `turn${i}`,
    }))
    const blocks = buildAssistantContextBlocks({ brief, history })
    const hist = blocks.find((b) => b.title.toLowerCase().includes("percakapan"))
    expect(hist).toBeTruthy()
    expect(hist!.content).toContain("turn11")
    expect(hist!.content).not.toContain("turn0") // trimmed to last 8
  })

  it("returns at most 8 blocks", () => {
    const blocks = buildAssistantContextBlocks({
      brief, history: [{ role: "user", content: "h" }],
      standardsNote: "s", designKnowledgeNote: "k", assetSuggestionsNote: "a",
    })
    expect(blocks.length).toBeLessThanOrEqual(8)
  })
})
