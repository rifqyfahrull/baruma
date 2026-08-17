// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const create = vi.fn()
const ctorSpy = vi.fn()

vi.mock("openai", () => {
  class MockOpenAI {
    chat = { completions: { create } }
    constructor(opts: unknown) {
      ctorSpy(opts)
    }
  }
  return { default: MockOpenAI }
})

import { completeChat, llmProviderEnabled } from "./openai-client"

beforeEach(() => {
  vi.clearAllMocks()
  process.env.OPENAI_API_KEY = "sk-test"
})

afterEach(() => {
  delete process.env.OPENAI_API_KEY
  delete process.env.OPENAI_BASE_URL
})

describe("llmProviderEnabled", () => {
  it("is false without OPENAI_API_KEY", () => {
    delete process.env.OPENAI_API_KEY
    expect(llmProviderEnabled()).toBe(false)
  })

  it("is true with OPENAI_API_KEY", () => {
    expect(llmProviderEnabled()).toBe(true)
  })
})

describe("completeChat", () => {
  it("returns null without an API key, never touching the SDK", async () => {
    delete process.env.OPENAI_API_KEY
    const result = await completeChat({
      messages: [{ role: "user", content: "hi" }],
      model: "gpt-4o-mini",
    })
    expect(result).toBeNull()
    expect(create).not.toHaveBeenCalled()
  })

  it("passes OPENAI_BASE_URL through to the SDK client for OpenAI-compatible providers", async () => {
    process.env.OPENAI_BASE_URL = "https://api.deepseek.com/v1"
    create.mockResolvedValueOnce({ choices: [{ message: { content: "halo" } }] })
    await completeChat({ messages: [{ role: "user", content: "hi" }], model: "deepseek-chat" })
    expect(ctorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "sk-test", baseURL: "https://api.deepseek.com/v1" })
    )
  })

  it("returns the completion content on success", async () => {
    create.mockResolvedValueOnce({ choices: [{ message: { content: "  halo  " } }] })
    const result = await completeChat({ messages: [{ role: "user", content: "hi" }], model: "gpt-4o-mini" })
    expect(result).toEqual({ content: "  halo  " })
  })

  it("requests json_object response_format when responseFormat is 'json'", async () => {
    create.mockResolvedValueOnce({ choices: [{ message: { content: '{"a":1}' } }] })
    await completeChat({
      messages: [{ role: "user", content: "hi" }],
      model: "gpt-4o-mini",
      responseFormat: "json",
    })
    expect(create.mock.calls[0][0].response_format).toEqual({ type: "json_object" })
  })

  it("retries once without response_format when the provider rejects json mode, and succeeds", async () => {
    create.mockRejectedValueOnce(new Error("400 response_format not supported"))
    create.mockResolvedValueOnce({ choices: [{ message: { content: "plain text fallback" } }] })
    const result = await completeChat({
      messages: [{ role: "user", content: "hi" }],
      model: "deepseek-chat",
      responseFormat: "json",
    })
    expect(result).toEqual({ content: "plain text fallback" })
    expect(create).toHaveBeenCalledTimes(2)
    expect(create.mock.calls[1][0]).not.toHaveProperty("response_format")
  })

  it("returns null when both the primary call and the compatibility retry fail", async () => {
    create.mockRejectedValueOnce(new Error("boom"))
    create.mockRejectedValueOnce(new Error("boom again"))
    const result = await completeChat({
      messages: [{ role: "user", content: "hi" }],
      model: "gpt-4o-mini",
      responseFormat: "json",
    })
    expect(result).toBeNull()
  })

  it("returns null on failure without retrying when responseFormat is 'text'", async () => {
    create.mockRejectedValueOnce(new Error("boom"))
    const result = await completeChat({ messages: [{ role: "user", content: "hi" }], model: "gpt-4o-mini" })
    expect(result).toBeNull()
    expect(create).toHaveBeenCalledTimes(1)
  })
})
