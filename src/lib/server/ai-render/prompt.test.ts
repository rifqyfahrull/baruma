// @vitest-environment node
/**
 * Determinism tests untuk prompt compiler (Fase 3 acceptance criteria):
 * input sama → output byte-identik, tiap preset punya test sendiri.
 */
import { describe, expect, it } from "vitest"

import { RENDER_PRESETS, compilePrompt, projectSeed } from "./prompt"
import type { RenderSceneMeta } from "./prompt"

const sceneMeta: RenderSceneMeta = {
  facadeMaterials: ["plester putih", "kayu jati"],
  roofType: "pelana",
  floors: 2,
  landscape: "taman tropis kecil",
}

describe("RENDER_PRESETS", () => {
  it("v1 has exactly the 4 specified presets", () => {
    expect(RENDER_PRESETS.map((p) => p.id)).toEqual([
      "tropis-siang",
      "tropis-senja",
      "skandinavia-siang",
      "malam",
    ])
  })

  it("every preset has an Indonesian label and a non-empty prompt fragment", () => {
    for (const preset of RENDER_PRESETS) {
      expect(preset.label.length).toBeGreaterThan(0)
      expect(preset.promptFragment.length).toBeGreaterThan(0)
    }
  })
})

describe("compilePrompt — determinism", () => {
  it("same input produces a byte-identical prompt (called twice)", () => {
    const a = compilePrompt(sceneMeta, "tropis-siang")
    const b = compilePrompt(sceneMeta, "tropis-siang")
    expect(a).toBe(b)
  })

  it.each(RENDER_PRESETS.map((p) => p.id))(
    "produces a snapshot-stable prompt for preset %s",
    (presetId) => {
      const prompt = compilePrompt(sceneMeta, presetId)
      expect(prompt).toMatchSnapshot()
    }
  )

  it("always includes the fixed photographic base and geometry guard", () => {
    const prompt = compilePrompt(sceneMeta, "malam")
    expect(prompt).toContain("photorealistic architectural photography")
    expect(prompt).toContain("preserve the exact geometry, camera angle and building proportions")
  })

  it("includes scene facts (materials, roof, floors, landscape)", () => {
    const prompt = compilePrompt(sceneMeta, "tropis-siang")
    expect(prompt).toContain("plester putih, kayu jati")
    expect(prompt).toContain("roof type: pelana")
    expect(prompt).toContain("2 floors")
    expect(prompt).toContain("landscape: taman tropis kecil")
  })

  it("omits the landscape clause when absent", () => {
    const prompt = compilePrompt({ ...sceneMeta, landscape: undefined }, "tropis-siang")
    expect(prompt).not.toContain("landscape:")
  })

  it("falls back to the first preset for an unknown preset id (never throws)", () => {
    const known = compilePrompt(sceneMeta, "tropis-siang")
    const unknown = compilePrompt(sceneMeta, "does-not-exist")
    expect(unknown).toBe(known)
  })
})

describe("projectSeed — determinism", () => {
  it("same projectId produces the same seed every call", () => {
    expect(projectSeed("proj-abc123")).toBe(projectSeed("proj-abc123"))
  })

  it("different projectIds produce different seeds (no accidental collision on these inputs)", () => {
    expect(projectSeed("proj-a")).not.toBe(projectSeed("proj-b"))
  })

  it("returns a 32-bit unsigned integer", () => {
    const seed = projectSeed("proj-xyz")
    expect(Number.isInteger(seed)).toBe(true)
    expect(seed).toBeGreaterThanOrEqual(0)
    expect(seed).toBeLessThanOrEqual(0xffffffff)
  })
})
