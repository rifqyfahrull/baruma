// @vitest-environment node
/**
 * gemini.ts request-shape + never-throw contract tests. Meniru pola mocking
 * fetch di src/lib/data/http.test.ts (vi.stubGlobal("fetch", ...)).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const fetchMock = vi.fn()
vi.stubGlobal("fetch", fetchMock)

import { GEMINI_IMAGE_MODEL, geminiProviderEnabled, geminiRenderProvider } from "./gemini"

beforeEach(() => {
  vi.clearAllMocks()
  process.env.GEMINI_API_KEY = "gemini-test-key"
})

afterEach(() => {
  delete process.env.GEMINI_API_KEY
  vi.unstubAllEnvs()
})

function imageResponse(bytes: Uint8Array): Response {
  return new Response(bytes, { status: 200, headers: { "content-type": "image/png" } })
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const beautyBytes = new Uint8Array([1, 2, 3, 4])

describe("geminiProviderEnabled", () => {
  it("is false without GEMINI_API_KEY", () => {
    delete process.env.GEMINI_API_KEY
    expect(geminiProviderEnabled()).toBe(false)
  })

  it("is true with GEMINI_API_KEY", () => {
    expect(geminiProviderEnabled()).toBe(true)
  })
})

describe("geminiRenderProvider.submit", () => {
  it("returns null without an API key, never touching fetch", async () => {
    delete process.env.GEMINI_API_KEY
    const result = await geminiRenderProvider.submit({
      prompt: "p",
      seed: 1,
      beautyUrl: "https://example.test/beauty.png",
    })
    expect(result).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("posts to the generateContent endpoint with x-goog-api-key and the prompt + inline_data image", async () => {
    const generatedBase64 = Buffer.from("fake-png-bytes").toString("base64")
    fetchMock
      .mockResolvedValueOnce(imageResponse(beautyBytes)) // unduh beautyUrl
      .mockResolvedValueOnce(
        jsonResponse({
          candidates: [
            {
              content: {
                parts: [{ inlineData: { mimeType: "image/png", data: generatedBase64 } }],
              },
            },
          ],
        })
      )

    const result = await geminiRenderProvider.submit({
      prompt: "a house at golden hour",
      seed: 1,
      beautyUrl: "https://storage.test/beauty.png",
    })

    expect(result).toEqual({
      kind: "done",
      imageBytes: Buffer.from("fake-png-bytes"),
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [genUrl, genInit] = fetchMock.mock.calls[1]
    expect(String(genUrl)).toBe(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent`
    )
    expect(genInit.headers["x-goog-api-key"]).toBe("gemini-test-key")

    const body = JSON.parse(genInit.body as string)
    expect(body.contents[0].parts[0]).toEqual({ text: "a house at golden hour" })
    expect(body.contents[0].parts[1].inline_data.mime_type).toBe("image/png")
    expect(typeof body.contents[0].parts[1].inline_data.data).toBe("string")
  })

  it("returns null (never throws) when the beauty image download fails", async () => {
    fetchMock.mockResolvedValueOnce(new Response("not found", { status: 404 }))
    const result = await geminiRenderProvider.submit({
      prompt: "p",
      seed: 1,
      beautyUrl: "https://storage.test/missing.png",
    })
    expect(result).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("returns null (never throws) on a non-200 generateContent response", async () => {
    fetchMock
      .mockResolvedValueOnce(imageResponse(beautyBytes))
      .mockResolvedValueOnce(jsonResponse({ error: "quota" }, 429))
    const result = await geminiRenderProvider.submit({
      prompt: "p",
      seed: 1,
      beautyUrl: "https://storage.test/beauty.png",
    })
    expect(result).toBeNull()
  })

  it("returns null when the response has no image part", async () => {
    fetchMock
      .mockResolvedValueOnce(imageResponse(beautyBytes))
      .mockResolvedValueOnce(
        jsonResponse({ candidates: [{ content: { parts: [{ text: "sorry, no image" }] } }] })
      )
    const result = await geminiRenderProvider.submit({
      prompt: "p",
      seed: 1,
      beautyUrl: "https://storage.test/beauty.png",
    })
    expect(result).toBeNull()
  })

  it("returns null (never throws) when fetch rejects with a network error", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"))
    const result = await geminiRenderProvider.submit({
      prompt: "p",
      seed: 1,
      beautyUrl: "https://storage.test/beauty.png",
    })
    expect(result).toBeNull()
  })
})
