import { describe, expect, it, vi } from "vitest"
import { askAgentLab } from "@/lib/server/agent-lab"

describe("askAgentLab JSON unwrapping", () => {
  it("unwraps JSON-wrapped response strings into clean text", async () => {
    process.env.AGENT_LAB_KEY = "test-key"
    const mockJson = {
      mode: "answer",
      answer: JSON.stringify({
        response: "Tentu, saya bisa bantu menyusun brief desain. Mari kita mulai...",
      }),
    }

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => mockJson,
    } as Response)

    const result = await askAgentLab("baruma-assistant", {
      userId: "user-1",
      text: "tolong buatkan brief",
    })

    expect(result).toBe("Tentu, saya bisa bantu menyusun brief desain. Mari kita mulai...")
  })

  it("converts arbitrary JSON objects into clean markdown", async () => {
    process.env.AGENT_LAB_KEY = "test-key"
    const mockJson = {
      mode: "answer",
      answer: JSON.stringify({
        analisis: "Brief ini sudah cukup lengkap.",
        catatan_risiko: ["KDB 92% melebihi 60%", "Ruang makan tanpa jendela"],
      }),
    }

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => mockJson,
    } as Response)

    const result = await askAgentLab("baruma-assistant", {
      userId: "user-1",
      text: "tolong analisa risiko",
    })

    expect(result).toContain("**Analisis**:")
    expect(result).toContain("Brief ini sudah cukup lengkap.")
    expect(result).toContain("**Catatan Risiko**:")
    expect(result).toContain("- KDB 92% melebihi 60%")
  })

  it("preserves JSON structure when needs_clarify array is present in answer", async () => {
    process.env.AGENT_LAB_KEY = "test-key"
    const payload = {
      reply: "Saya butuh beberapa konfirmasi untuk menyusun brief...",
      needs_clarify: [
        {
          question: "Gaya & Konsep Arsitektur",
          suggestions: ["Modern Tropis", "Minimalis", "Japandi"],
        },
        {
          question: "Kebutuhan Utama Ruang",
          suggestions: ["3 Kamar & Carport", "4 Kamar & Workspace"],
        },
      ],
    }

    const mockJson = {
      mode: "answer",
      answer: JSON.stringify(payload),
    }

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => mockJson,
    } as Response)

    const result = await askAgentLab("baruma-assistant", {
      userId: "user-1",
      text: "buatkan brief",
    })

    expect(result).toBe(JSON.stringify(payload))
    const parsed = JSON.parse(result!)
    expect(parsed.needs_clarify).toHaveLength(2)
    expect(parsed.needs_clarify[0].question).toBe("Gaya & Konsep Arsitektur")
  })
})

import { chatJSON } from "@/lib/server/llm"

describe("chatJSON resilience & codeblock stripping", () => {
  it("parses JSON wrapped in markdown ```json ``` codeblocks", async () => {
    process.env.AGENT_LAB_KEY = "test-key"
    const rawContent = "```json\n" + JSON.stringify({
      reply: "Baik, untuk menambahkan koridor...",
      actions: [],
      needs_clarify: [
        {
          question: "Ruang mana yang boleh diperkecil?",
          suggestions: ["Perkecil Kamar tidur 3", "Pindahkan Laundry"],
        },
      ],
    }) + "\n```"

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: rawContent }),
    } as Response)

    const res = await chatJSON<{ reply: string; needs_clarify: Array<{ question: string; suggestions: string[] }> }>([
      { role: "user", content: "tambahkan koridor" },
    ])

    expect(res).not.toBeNull()
    expect(res?.reply).toBe("Baik, untuk menambahkan koridor...")
    expect(res?.needs_clarify).toHaveLength(1)
    expect(res?.needs_clarify[0].suggestions).toEqual(["Perkecil Kamar tidur 3", "Pindahkan Laundry"])
  })
})
