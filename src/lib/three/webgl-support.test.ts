import { afterEach, describe, expect, it, vi } from "vitest"
import { __resetWebGLAvailabilityCacheForTests, isWebGLAvailable } from "./webgl-support"

function mockGetContext(impl: (id: string) => unknown) {
  return vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(impl as never)
}

describe("isWebGLAvailable", () => {
  afterEach(() => {
    __resetWebGLAvailabilityCacheForTests()
    vi.restoreAllMocks()
  })

  it("returns true when the browser hands back a webgl2 context", () => {
    mockGetContext((id) => (id === "webgl2" ? { getExtension: () => null } : null))
    expect(isWebGLAvailable()).toBe(true)
  })

  it("falls back to legacy webgl when webgl2 is unavailable", () => {
    mockGetContext((id) => (id === "webgl" ? { getExtension: () => null } : null))
    expect(isWebGLAvailable()).toBe(true)
  })

  it("returns false when every context id resolves to null (disabled via policy/flag)", () => {
    mockGetContext(() => null)
    expect(isWebGLAvailable()).toBe(false)
  })

  it("returns false instead of throwing when getContext itself throws", () => {
    mockGetContext(() => {
      throw new Error("SecurityError")
    })
    expect(isWebGLAvailable()).toBe(false)
  })

  it("releases the probe context via WEBGL_lose_context so it doesn't hold a slot", () => {
    const loseContext = vi.fn()
    mockGetContext((id) => (id === "webgl2" ? { getExtension: () => ({ loseContext }) } : null))
    isWebGLAvailable()
    expect(loseContext).toHaveBeenCalledOnce()
  })

  it("caches the result — a second call does not probe the DOM again", () => {
    const spy = mockGetContext((id) => (id === "webgl2" ? { getExtension: () => null } : null))
    expect(isWebGLAvailable()).toBe(true)
    expect(isWebGLAvailable()).toBe(true)
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
