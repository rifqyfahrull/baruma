// @vitest-environment node
/**
 * polish.ts kontrak NEVER-THROW + cache + timeout. Mock `@/lib/server/llm`
 * (chatText) & `@/lib/server/repo/render-polish-cache` (getPolishCache/
 * setPolishCache) — meniru pola vi.mock di repo lain (bukan fetch nyata).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { SceneFacts } from "./analyze"
import type { RoomFacts } from "./analyze-room"

const chatTextMock = vi.fn()
const getPolishCacheMock = vi.fn()
const setPolishCacheMock = vi.fn()

vi.mock("@/lib/server/llm", () => ({
  chatText: (...args: unknown[]) => chatTextMock(...args),
}))

vi.mock("@/lib/server/repo/render-polish-cache", () => ({
  getPolishCache: (...args: unknown[]) => getPolishCacheMock(...args),
  setPolishCache: (...args: unknown[]) => setPolishCacheMock(...args),
}))

import { factsHash, polishEnabled, polishScene } from "./polish"

const ORIGINAL_ENV = process.env.AI_RENDER_POLISH

function baseFacts(): SceneFacts {
  return {
    camera: {
      heightClass: "eye-level",
      distanceClass: "medium",
      lensMm: 35,
      visibleSides: ["s"],
    },
    massing: {
      siteWidthM: 10,
      siteDepthM: 15,
      footprintWidthM: 8,
      footprintDepthM: 12,
      floors: 2,
      approxHeightM: 6.6,
      hasRooftopDeck: false,
    },
    sides: [
      {
        side: "s",
        claddings: ["Batu alam"],
        windowCount: 2,
        doorCount: 1,
        garageDoorCount: 0,
        facadeElements: [],
        balconyCount: 0,
      },
    ],
    exteriorInFrame: [],
    roof: { zoneTypes: [], globalType: "datar", skylightCount: 0 },
    lighting: { exteriorLampCount: 0 },
    vegetationPresent: false,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.AI_RENDER_POLISH
})

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.AI_RENDER_POLISH
  else process.env.AI_RENDER_POLISH = ORIGINAL_ENV
  vi.useRealTimers()
})

describe("polishEnabled", () => {
  it("is false when AI_RENDER_POLISH unset", () => {
    expect(polishEnabled()).toBe(false)
  })

  it("is true when AI_RENDER_POLISH=1", () => {
    process.env.AI_RENDER_POLISH = "1"
    expect(polishEnabled()).toBe(true)
  })
})

describe("polishScene", () => {
  it("(a) resolves null without calling chatText when flag is unset", async () => {
    const result = await polishScene(baseFacts())
    expect(result).toBeNull()
    expect(chatTextMock).not.toHaveBeenCalled()
    expect(getPolishCacheMock).not.toHaveBeenCalled()
  })

  it("(b) returns cached description on cache hit without calling chatText", async () => {
    process.env.AI_RENDER_POLISH = "1"
    getPolishCacheMock.mockResolvedValue("cached paragraph")
    const result = await polishScene(baseFacts())
    expect(result).toBe("cached paragraph")
    expect(chatTextMock).not.toHaveBeenCalled()
  })

  it("(c) on cache miss + chatText success, returns trimmed text and caches it under the same hash", async () => {
    process.env.AI_RENDER_POLISH = "1"
    getPolishCacheMock.mockResolvedValue(null)
    chatTextMock.mockResolvedValue("  a fluent paragraph.  ")
    const facts = baseFacts()
    const result = await polishScene(facts)
    expect(result).toBe("a fluent paragraph.")
    expect(chatTextMock).toHaveBeenCalledTimes(1)
    expect(setPolishCacheMock).toHaveBeenCalledTimes(1)
    const [hashArg, textArg] = setPolishCacheMock.mock.calls[0]
    expect(hashArg).toBe(factsHash(facts))
    expect(textArg).toBe("a fluent paragraph.")
  })

  it("(d) resolves null (never throws) when chatText rejects", async () => {
    process.env.AI_RENDER_POLISH = "1"
    getPolishCacheMock.mockResolvedValue(null)
    chatTextMock.mockRejectedValue(new Error("upstream boom"))
    const result = await polishScene(baseFacts())
    expect(result).toBeNull()
    // Buktikan jalur reject benar-benar tereksekusi (bukan short-circuit
    // sebelum sampai ke chatText).
    expect(chatTextMock).toHaveBeenCalledTimes(1)
    expect(setPolishCacheMock).not.toHaveBeenCalled()
  })

  it("(e) resolves null when chatText hangs past the timeout", async () => {
    vi.useFakeTimers()
    process.env.AI_RENDER_POLISH = "1"
    getPolishCacheMock.mockResolvedValue(null)
    chatTextMock.mockReturnValue(new Promise(() => {})) // never resolves
    const promise = polishScene(baseFacts())
    await vi.advanceTimersByTimeAsync(5000)
    const result = await promise
    expect(result).toBeNull()
    expect(setPolishCacheMock).not.toHaveBeenCalled()
  })
})

describe("factsHash", () => {
  it("(f) is deterministic for identical facts objects", () => {
    const a = factsHash(baseFacts())
    const b = factsHash(baseFacts())
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{8}$/)
  })
})

/** Fixture Fase B Task 2 — `polishScene`/`factsHash` kini menerima
 *  `SceneFacts | RoomFacts`; ini membuktikan RoomFacts diterima end-to-end
 *  (bukan cuma type-checks) & hash tetap deterministik untuk bentuk baru. */
function baseRoomFacts(): RoomFacts {
  return {
    roomId: "r1",
    roomName: "Kamar Tidur Utama",
    roomType: "kamar_tidur",
    floorIndex: 0,
    widthM: 4,
    depthM: 5,
    areaM2: 20,
    ceilingHeightM: 2.8,
    style: "japandi",
    materials: [{ surface: "floor", name: "Parket kayu" }],
    furniture: [],
    windowSides: ["s"],
    doorCount: 1,
    hasCurtains: false,
    skylightCount: 0,
    lighting: { fixtureCount: 0, warmCount: 0 },
  }
}

describe("polishScene — RoomFacts (Fase B)", () => {
  it("(g) accepts RoomFacts end-to-end on cache miss + chatText success", async () => {
    process.env.AI_RENDER_POLISH = "1"
    getPolishCacheMock.mockResolvedValue(null)
    chatTextMock.mockResolvedValue("  a fluent room paragraph.  ")
    const facts = baseRoomFacts()
    const result = await polishScene(facts)
    expect(result).toBe("a fluent room paragraph.")
    expect(chatTextMock).toHaveBeenCalledTimes(1)
    const [hashArg, textArg] = setPolishCacheMock.mock.calls[0]
    expect(hashArg).toBe(factsHash(facts))
    expect(textArg).toBe("a fluent room paragraph.")
  })

  it("(h) factsHash is deterministic for identical RoomFacts objects", () => {
    const a = factsHash(baseRoomFacts())
    const b = factsHash(baseRoomFacts())
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{8}$/)
  })
})
