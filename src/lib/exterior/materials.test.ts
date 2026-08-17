import { describe, expect, it } from "vitest"

import { exteriorSurfaceKindForMaterial, resolveExteriorMaterial } from "./materials"

describe("resolveExteriorMaterial", () => {
  it("keeps legacy facade cladding catalog ids valid", () => {
    const resolved = resolveExteriorMaterial({ materialId: "bata_ekspos", color: "#000000" }, "wall")

    expect(resolved).toMatchObject({
      id: "bata_ekspos",
      label: "Bata ekspos",
      source: "catalog",
    })
    expect(resolved.visual.mapUrl).toBe("/textures/tex-bata-merah.jpg")
    expect(resolved.visual.color).not.toBe("#000000")
  })

  it("accepts and normalizes custom hex colors", () => {
    expect(resolveExteriorMaterial({ color: "#ABC", finish: "Cat aksen" }, "wall")).toMatchObject({
      id: "custom-aabbcc",
      label: "Cat aksen",
      source: "custom",
      visual: { color: "#aabbcc", texture: "wall" },
    })

    expect(resolveExteriorMaterial({ materialId: "brand-blue", color: "#3366FF" }, "metal")).toMatchObject({
      id: "brand-blue",
      source: "custom",
      visual: { color: "#3366ff", texture: null, metalness: 0.35 },
    })
  })

  it("falls back deterministically for unknown ids or invalid colors", () => {
    expect(resolveExteriorMaterial({ materialId: "missing", color: "blue" }, "floor")).toMatchObject({
      id: "fallback-floor",
      label: "Material lantai default",
      source: "fallback",
      visual: { texture: "floor" },
    })
  })

  it("resolves sub-surface overrides without losing the base material fallback", () => {
    const ref = {
      materialId: "beton_ekspos",
      color: "#111111",
      surfaces: {
        top: { color: "#f0f" },
        underside: { materialId: "kayu_cladding" },
      },
    }

    expect(resolveExteriorMaterial(ref, "wall")).toMatchObject({
      id: "beton_ekspos",
      source: "catalog",
    })
    expect(resolveExteriorMaterial(ref, "roof", { slot: "top" })).toMatchObject({
      id: "custom-ff00ff",
      source: "custom",
      visual: { color: "#ff00ff", texture: "roof" },
    })
    expect(resolveExteriorMaterial(ref, "wood", { slot: "underside" })).toMatchObject({
      id: "kayu_cladding",
      source: "catalog",
    })
    expect(resolveExteriorMaterial(ref, "wall", { slot: "side" })).toMatchObject({
      id: "beton_ekspos",
      source: "catalog",
    })
  })

  it("maps exterior element kinds to material surface kinds", () => {
    expect(exteriorSurfaceKindForMaterial("sliding_gate")).toBe("metal")
    expect(exteriorSurfaceKindForMaterial("canopy")).toBe("roof")
    expect(exteriorSurfaceKindForMaterial("driveway")).toBe("floor")
    expect(exteriorSurfaceKindForMaterial("facade_panel")).toBe("wall")
    expect(exteriorSurfaceKindForMaterial("unknown")).toBe("generic")
  })
})
