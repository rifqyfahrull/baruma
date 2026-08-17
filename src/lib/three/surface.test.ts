import { afterEach, describe, expect, it, vi } from "vitest"
import { CanvasTexture } from "three"

import { MATERIAL_PRESETS, SHARED_COLORS } from "./materials"
import { baseColor, primMaterial, proportionalRepeat, surfaceForKind } from "./surface"

const preset = MATERIAL_PRESETS.modern_tropis

/** Same jsdom stub the textures suite uses: a no-op 2D context recorder. */
function stubCanvas(): void {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
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
  } as unknown as CanvasRenderingContext2D)
}

// MUST run before any successful texture creation: the generators cache only a
// NON-null result, so exercising the no-canvas branch first keeps it meaningful.
describe("primMaterial — SSR / no-canvas guard", () => {
  afterEach(() => vi.restoreAllMocks())

  it("realistic mapped surface yields no map (no throw) without a 2D context", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null)
    const wall = primMaterial("wall", preset, true)
    expect(wall.map).toBeNull()
    // PBR params still adopted even without the texture bitmap.
    expect(wall.roughness).toBe(preset.pbr.wall.roughness)
    expect(wall.metalness).toBe(preset.pbr.wall.metalness)
  })
})

describe("surfaceForKind", () => {
  it("maps structural kinds to their PBR surface", () => {
    expect(surfaceForKind("wall")).toBe("wall")
    expect(surfaceForKind("riser")).toBe("wall")
    expect(surfaceForKind("slab")).toBe("floor")
    expect(surfaceForKind("tile")).toBe("floor")
    expect(surfaceForKind("roof")).toBe("roof")
    expect(surfaceForKind("roof_gable")).toBe("roof")
    expect(surfaceForKind("roof_hip")).toBe("roof")
    expect(surfaceForKind("window")).toBe("glass")
  })

  it("returns null for flat-only kinds", () => {
    for (const kind of ["garden", "pool", "door", "furniture", "rail"] as const) {
      expect(surfaceForKind(kind)).toBeNull()
    }
  })
})

describe("baseColor", () => {
  it("uses preset hues for structural surfaces, shared colors otherwise", () => {
    expect(baseColor("wall", preset)).toBe(preset.wall)
    expect(baseColor("riser", preset)).toBe(preset.wall)
    expect(baseColor("slab", preset)).toBe(preset.floor)
    expect(baseColor("tile", preset)).toBe(preset.floor)
    expect(baseColor("roof", preset)).toBe(preset.roof)
    expect(baseColor("roof_gable", preset)).toBe(preset.roof)
    expect(baseColor("roof_hip", preset)).toBe(preset.roof)
    expect(baseColor("window", preset)).toBe(SHARED_COLORS.window)
    expect(baseColor("door", preset)).toBe(SHARED_COLORS.door)
    expect(baseColor("rail", preset)).toBe(SHARED_COLORS.rail)
  })
})

describe("primMaterial — flat fallback (!realistic)", () => {
  it("never attaches a map and keeps the pre-T11 roughness/metalness", () => {
    expect(primMaterial("wall", preset, false)).toEqual({
      color: preset.wall,
      map: null,
      roughness: 0.85,
      metalness: 0,
    })
    expect(primMaterial("window", preset, false)).toMatchObject({
      map: null,
      roughness: 0.1,
      metalness: 0,
    })
    expect(primMaterial("rail", preset, false)).toMatchObject({
      map: null,
      roughness: 0.85,
      metalness: 0.6,
    })
  })

  it("uses material overrides for color and PBR values", () => {
    expect(primMaterial("tile", preset, false, { color: "#77716a", roughness: 0.32 })).toMatchObject({
      color: "#77716a",
      map: null,
      roughness: 0.32,
      metalness: 0,
    })
  })
})

describe("primMaterial — realistic (with canvas)", () => {
  afterEach(() => vi.restoreAllMocks())

  it("adopts the preset PBR params + a procedural map for mapped surfaces", () => {
    stubCanvas()
    const wall = primMaterial("wall", preset, true)
    expect(wall.color).toBe(preset.wall)
    expect(wall.roughness).toBe(preset.pbr.wall.roughness)
    expect(wall.metalness).toBe(preset.pbr.wall.metalness)
    expect(wall.map).toBeInstanceOf(CanvasTexture)
  })

  it("window adopts the glass PBR response (metalness 0.2 distinguishes it from flat)", () => {
    stubCanvas()
    const glass = primMaterial("window", preset, true)
    expect(glass.roughness).toBe(0.1)
    expect(glass.metalness).toBe(0.2)
    expect(glass.map).toBeInstanceOf(CanvasTexture)
  })

  it("flat-only kinds stay flat (no map) even when realistic", () => {
    stubCanvas()
    const rail = primMaterial("rail", preset, true)
    expect(rail.map).toBeNull()
    expect(rail.roughness).toBe(0.85)
    expect(rail.metalness).toBe(0.6)
    expect(primMaterial("door", preset, true).map).toBeNull()
  })
})

describe("proportionalRepeat — tile konsisten antar dimensi bidang", () => {
  it("dinding panjang mendapat repeat lebih besar, proporsional", () => {
    // mapRepeat 2 → tile 1.5 m. Dinding 6 m → 4 tile; 1.5 m → 1 tile.
    expect(proportionalRepeat(2, 6, 3)).toEqual([4, 2])
    expect(proportionalRepeat(2, 1.5, 3)).toEqual([1, 2])
  })

  it("quantize 0.25 + floor minimal 0.25", () => {
    const [rx] = proportionalRepeat(2, 0.1, 3)
    expect(rx).toBe(0.25)
    const [qx] = proportionalRepeat(3, 2.6, 3)
    expect(qx * 4).toBeCloseTo(Math.round(qx * 4), 9)
  })

  it("primMaterial tanpa faceDims = perilaku lama (tanpa crash SSR)", () => {
    const m = primMaterial("wall", MATERIAL_PRESETS.modern_tropis, false)
    expect(m.map ?? null).toBeNull()
  })
})
