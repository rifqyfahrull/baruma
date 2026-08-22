// @vitest-environment node
/**
 * fal.ts request-shape + never-throw contract tests. Meniru pola mocking
 * fetch di src/lib/data/http.test.ts (vi.stubGlobal("fetch", ...)).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const fetchMock = vi.fn()
vi.stubGlobal("fetch", fetchMock)

import { FAL_DEPTH_MODEL, falProviderEnabled, falRenderProvider } from "./fal"

beforeEach(() => {
  vi.clearAllMocks()
  process.env.FAL_KEY = "fal-test-key"
})

afterEach(() => {
  delete process.env.FAL_KEY
  vi.unstubAllEnvs()
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

describe("falProviderEnabled", () => {
  it("is false without FAL_KEY", () => {
    delete process.env.FAL_KEY
    expect(falProviderEnabled()).toBe(false)
  })

  it("is true with FAL_KEY", () => {
    expect(falProviderEnabled()).toBe(true)
  })
})

describe("falRenderProvider.submit", () => {
  it("returns null without an API key, never touching fetch", async () => {
    delete process.env.FAL_KEY
    const result = await falRenderProvider.submit({
      prompt: "p",
      seed: 1,
      beautyUrl: "https://example.test/beauty.png",
    })
    expect(result).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("submits to queue.fal.run/{model} with the Key auth header and prompt/seed/image fields", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ request_id: "req-1" }))

    const result = await falRenderProvider.submit({
      prompt: "a house",
      seed: 42,
      beautyUrl: "https://storage.test/beauty.png",
      depthUrl: "https://storage.test/depth.png",
    })

    expect(result).toEqual({ kind: "async", providerRequestId: "req-1" })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [calledUrl, init] = fetchMock.mock.calls[0]
    expect(String(calledUrl)).toBe(`https://queue.fal.run/${FAL_DEPTH_MODEL}`)
    expect(init.method).toBe("POST")
    expect(init.headers.Authorization).toBe("Key fal-test-key")

    const body = JSON.parse(init.body as string)
    expect(body).toEqual({
      prompt: "a house",
      seed: 42,
      image_url: "https://storage.test/beauty.png",
      control_lora_image_url: "https://storage.test/depth.png",
    })
  })

  it("appends ?fal_webhook= when webhookUrl is provided", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ request_id: "req-2" }))

    await falRenderProvider.submit({
      prompt: "a house",
      seed: 1,
      beautyUrl: "https://storage.test/beauty.png",
      webhookUrl: "https://baruma.test/api/webhooks/ai-render",
    })

    const [calledUrl] = fetchMock.mock.calls[0]
    const url = new URL(String(calledUrl))
    expect(url.searchParams.get("fal_webhook")).toBe(
      "https://baruma.test/api/webhooks/ai-render"
    )
  })

  it("returns null (never throws) on a non-200 response", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "bad request" }, 400))
    const result = await falRenderProvider.submit({
      prompt: "p",
      seed: 1,
      beautyUrl: "https://example.test/beauty.png",
    })
    expect(result).toBeNull()
  })

  it("returns null (never throws) when fetch rejects with a network error", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"))
    const result = await falRenderProvider.submit({
      prompt: "p",
      seed: 1,
      beautyUrl: "https://example.test/beauty.png",
    })
    expect(result).toBeNull()
  })

  it("returns null when the response is missing request_id", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}))
    const result = await falRenderProvider.submit({
      prompt: "p",
      seed: 1,
      beautyUrl: "https://example.test/beauty.png",
    })
    expect(result).toBeNull()
  })
})

describe("falRenderProvider.checkStatus", () => {
  it("returns 'processing' while IN_QUEUE/IN_PROGRESS", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: "IN_QUEUE" }))
    const result = await falRenderProvider.checkStatus?.("req-1")
    expect(result).toBe("processing")
  })

  it("fetches the result payload and returns imageUrl once COMPLETED", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ status: "COMPLETED" }))
      .mockResolvedValueOnce(jsonResponse({ images: [{ url: "https://fal.test/out.png" }] }))

    const result = await falRenderProvider.checkStatus?.("req-1")
    expect(result).toEqual({ imageUrl: "https://fal.test/out.png" })

    const [statusUrl] = fetchMock.mock.calls[0]
    expect(String(statusUrl)).toBe(
      `https://queue.fal.run/${FAL_DEPTH_MODEL}/requests/req-1/status`
    )
    const [resultUrl] = fetchMock.mock.calls[1]
    expect(String(resultUrl)).toBe(`https://queue.fal.run/${FAL_DEPTH_MODEL}/requests/req-1`)
  })

  it("returns 'failed' for a terminal non-COMPLETED status", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: "ERROR" }))
    const result = await falRenderProvider.checkStatus?.("req-1")
    expect(result).toBe("failed")
  })

  it("returns null (never throws) on a network error", async () => {
    fetchMock.mockRejectedValueOnce(new Error("boom"))
    const result = await falRenderProvider.checkStatus?.("req-1")
    expect(result).toBeNull()
  })
})
