// @vitest-environment node
import { gunzipSync } from "node:zlib"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth/phantom-session", () => ({ getPhantomToken: vi.fn(() => null) }))

const fetchMock = vi.fn()
vi.stubGlobal("fetch", fetchMock)

import { httpSource } from "./http"
import type { ProjectAgentRequest } from "@/lib/assistant/actions"
import { makeLayout } from "@/test-utils/fixtures"

function sseResponse(frames: unknown[]): Response {
  const body = frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join("")
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } })
}

const input: ProjectAgentRequest = {
  surface: "editor",
  requestedMode: "auto",
  instruction: "x",
  clientRequestId: "r1",
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.unstubAllEnvs())

describe("sendProjectAgentMessage — SSE progress", () => {
  it("invokes onProgress for each progress frame and resolves with the result message", async () => {
    fetchMock.mockResolvedValue(sseResponse([
      { type: "ping" },
      { type: "progress", message: "Meminta usulan denah ke AI…" },
      { type: "progress", message: "Menyesuaikan tata letak agar tidak tumpang-tindih…" },
      { type: "result", data: { message: { id: "m1", content: "ok" } } },
    ]))
    const seen: string[] = []
    const result = await httpSource.sendProjectAgentMessage("p1", input, (message) => seen.push(message))

    expect(seen).toEqual([
      "Meminta usulan denah ke AI…",
      "Menyesuaikan tata letak agar tidak tumpang-tindih…",
    ])
    expect(result).toEqual({ id: "m1", content: "ok" })
  })

  it("resolves correctly without an onProgress callback (backward compatible)", async () => {
    fetchMock.mockResolvedValue(sseResponse([
      { type: "result", data: { message: { id: "m2", content: "ok2" } } },
    ]))
    const result = await httpSource.sendProjectAgentMessage("p1", { ...input, clientRequestId: "r2" })
    expect(result).toEqual({ id: "m2", content: "ok2" })
  })

  it("rejects with the real message from an error-type SSE frame instead of the generic fallback", async () => {
    fetchMock.mockResolvedValue(sseResponse([
      { type: "error", error: "LLM sedang sibuk, coba lagi" },
    ]))
    await expect(
      httpSource.sendProjectAgentMessage("p1", { ...input, clientRequestId: "r3" })
    ).rejects.toThrow("LLM sedang sibuk, coba lagi")
  })
})

describe("saveLayout — gzip request compression (G2a)", () => {
  const layout = makeLayout()

  function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }

  it("sends a gzip-compressed body with Content-Encoding: gzip when CompressionStream is available", async () => {
    expect(typeof CompressionStream).toBe("function") // sanity: node env provides it
    fetchMock.mockResolvedValue(jsonResponse({ layout, revision: 2 }))

    await httpSource.saveLayout("p1", { layout, expectedRevision: 1 })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain("/projects/p1/layout")
    expect(init.method).toBe("PUT")
    const headers = init.headers as Record<string, string>
    expect(headers["content-encoding"]).toBe("gzip")
    expect(headers["content-type"]).toBe("application/json")

    // Body should be gzip-compressed bytes that decompress back to the
    // original JSON payload — proves the server-side gunzip path works
    // against exactly what the client sends.
    const bodyBytes = init.body as ArrayBuffer
    const decompressed = gunzipSync(Buffer.from(bodyBytes))
    const parsed = JSON.parse(decompressed.toString("utf-8"))
    expect(parsed).toMatchObject({ expectedRevision: 1 })
    expect(parsed.layout.id).toBe(layout.id)

    // The whole point: gzip should shrink a real layout payload substantially.
    const plainSize = Buffer.byteLength(JSON.stringify({ layout, expectedRevision: 1 }))
    expect(bodyBytes.byteLength).toBeLessThan(plainSize)
  })

  it("falls back to a plain JSON body when CompressionStream is unavailable", async () => {
    const original = globalThis.CompressionStream
    // @ts-expect-error simulating an environment without CompressionStream
    delete globalThis.CompressionStream
    try {
      fetchMock.mockResolvedValue(jsonResponse({ layout, revision: 2 }))
      await httpSource.saveLayout("p1", { layout, expectedRevision: 1 })

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      const headers = init.headers as Record<string, string>
      expect(headers["content-encoding"]).toBeUndefined()
      expect(typeof init.body).toBe("string")
      expect(JSON.parse(init.body as string)).toMatchObject({ expectedRevision: 1 })
    } finally {
      globalThis.CompressionStream = original
    }
  })

  it("does not gzip other PUT requests (e.g. saveRAB)", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [], areaM2: 0, assumptions: [] }))
    await httpSource.saveRAB("p1", { items: [], areaM2: 0, assumptions: [] })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers["content-encoding"]).toBeUndefined()
    expect(typeof init.body).toBe("string")
  })
})
