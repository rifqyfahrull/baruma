import { afterEach, describe, expect, it, vi } from "vitest"
import { CanvasTexture, RepeatWrapping } from "three"

import {
  makeFloorTexture,
  makeGlassTexture,
  makeRoofTexture,
  makeWallTexture,
  textureFor,
  type TextureKind,
} from "./textures"

/**
 * jsdom ships no canvas 2D backend, so we stub `getContext` with a no-op recorder
 * that implements exactly the ops the generators use. This lets us exercise the real
 * `CanvasTexture` construction + memoization path. The generators only cache a
 * NON-null result, so the SSR/no-canvas branch is order-independent from these.
 */
function stubContext(): CanvasRenderingContext2D {
  return {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    fillRect: () => {},
    strokeRect: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    save: () => {},
    restore: () => {},
  } as unknown as CanvasRenderingContext2D
}

const GENERATORS: Array<[string, () => CanvasTexture | null]> = [
  ["wall", makeWallTexture],
  ["floor", makeFloorTexture],
  ["roof", makeRoofTexture],
  ["glass", makeGlassTexture],
]

describe("procedural textures — no-canvas guard", () => {
  afterEach(() => vi.restoreAllMocks())

  it("returns null gracefully (no throw) when there is no 2D context", () => {
    // Run this BEFORE any successful creation: null is never cached, so later
    // happy-path tests still create + memoize their own textures.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null)
    for (const [, make] of GENERATORS) {
      expect(() => make()).not.toThrow()
      expect(make()).toBeNull()
    }
  })
})

describe("procedural textures — with a canvas 2D context", () => {
  afterEach(() => vi.restoreAllMocks())

  it.each(GENERATORS)("%s: builds a repeating CanvasTexture", (_name, make) => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(stubContext())
    const tex = make()
    expect(tex).toBeInstanceOf(CanvasTexture)
    expect(tex!.wrapS).toBe(RepeatWrapping)
    expect(tex!.wrapT).toBe(RepeatWrapping)
  })

  it.each(GENERATORS)("%s: is memoized (same reference across calls)", (_name, make) => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(stubContext())
    const a = make()
    const b = make()
    expect(a).not.toBeNull()
    expect(a).toBe(b)
  })

  it("textureFor dispatches to the matching generator", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(stubContext())
    const kinds: TextureKind[] = ["wall", "floor", "roof", "glass"]
    const direct = [makeWallTexture(), makeFloorTexture(), makeRoofTexture(), makeGlassTexture()]
    kinds.forEach((kind, i) => {
      expect(textureFor(kind)).toBe(direct[i])
    })
  })
})
