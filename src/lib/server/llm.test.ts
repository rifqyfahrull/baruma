// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { chatJSON, chatText, llmEnabled } from "./llm"

const fetchMock = vi.fn()
vi.stubGlobal("fetch", fetchMock)

beforeEach(() => {
  vi.clearAllMocks()
  process.env.AGENT_LAB_URL = "http://lab.local"
  process.env.AGENT_LAB_KEY = "alk_baruma"
})

afterEach(() => {
  delete process.env.AGENT_LAB_URL
  delete process.env.AGENT_LAB_KEY
  delete process.env.AGENT_LAB_KEY_FLOORPLAN_ACTIONS
})

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

describe("central Agent Lab LLM facade", () => {
  it("is disabled without the Agent Lab product key", async () => {
    delete process.env.AGENT_LAB_KEY
    expect(llmEnabled()).toBe(false)
    expect(await chatJSON([{ role: "user", content: "x" }])).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("parses JSON returned by Agent Lab", async () => {
    fetchMock.mockResolvedValue(response({
      content: '{"a":1}', tool_calls: [], finish_reason: "stop",
    }))
    expect(await chatJSON<{ a: number }>([{ role: "user", content: "x" }])).toEqual({ a: 1 })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("http://lab.local/v1/agents/baruma-floorplan-actions/complete")
    expect((init.headers as Record<string, string>)["X-API-Key"]).toBe("alk_baruma")
    const body = JSON.parse(init.body as string)
    expect(body.response_format).toBe("json")
    expect(body).not.toHaveProperty("provider")
    expect(body).not.toHaveProperty("model")
    expect(body).not.toHaveProperty("api_key")
  })

  it("returns null on service error or malformed JSON content", async () => {
    fetchMock.mockResolvedValueOnce(response({}, 502))
    expect(await chatJSON([{ role: "user", content: "x" }])).toBeNull()
    fetchMock.mockResolvedValueOnce(response({ content: "not-json", tool_calls: [] }))
    expect(await chatJSON([{ role: "user", content: "x" }])).toEqual({ reply: "not-json", actions: [] })
  })

  it("returns trimmed text from Agent Lab", async () => {
    fetchMock.mockResolvedValue(response({ content: "  Halo  ", tool_calls: [] }))
    expect(await chatText([{ role: "user", content: "x" }])).toBe("Halo")
  })

  it("chatText uses the prose slug, distinct from chatJSON's actions slug", async () => {
    fetchMock.mockResolvedValue(response({ content: "halo", tool_calls: [] }))
    await chatText([{ role: "user", content: "x" }])
    const [url] = fetchMock.mock.calls[0]
    expect(url).toBe("http://lab.local/v1/agents/baruma-assistant/complete")
  })

  it("chatJSON posts to an explicit opts.slug override instead of the default actions slug", async () => {
    fetchMock.mockResolvedValue(response({ content: '{"a":1}', tool_calls: [] }))
    await chatJSON([{ role: "user", content: "x" }], { slug: "some-other-slug" })
    const [url] = fetchMock.mock.calls[0]
    expect(url).toBe("http://lab.local/v1/agents/some-other-slug/complete")
  })

  it("chatJSON uses the dedicated AGENT_LAB_KEY_FLOORPLAN_ACTIONS key when set", async () => {
    process.env.AGENT_LAB_KEY_FLOORPLAN_ACTIONS = "alk_actions_only"
    fetchMock.mockResolvedValue(response({ content: '{"a":1}', tool_calls: [] }))
    await chatJSON([{ role: "user", content: "x" }])
    const [, init] = fetchMock.mock.calls[0]
    expect((init.headers as Record<string, string>)["X-API-Key"]).toBe("alk_actions_only")
  })

  it("chatJSON falls back to AGENT_LAB_KEY when no dedicated actions key is set", async () => {
    fetchMock.mockResolvedValue(response({ content: '{"a":1}', tool_calls: [] }))
    await chatJSON([{ role: "user", content: "x" }])
    const [, init] = fetchMock.mock.calls[0]
    expect((init.headers as Record<string, string>)["X-API-Key"]).toBe("alk_baruma")
  })

  it("chatText always uses AGENT_LAB_KEY, ignoring the dedicated actions key", async () => {
    process.env.AGENT_LAB_KEY_FLOORPLAN_ACTIONS = "alk_actions_only"
    fetchMock.mockResolvedValue(response({ content: "halo", tool_calls: [] }))
    await chatText([{ role: "user", content: "x" }])
    const [, init] = fetchMock.mock.calls[0]
    expect((init.headers as Record<string, string>)["X-API-Key"]).toBe("alk_baruma")
  })
})
