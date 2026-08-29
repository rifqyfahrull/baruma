// @vitest-environment node
/**
 * Determinism tests untuk prompt compiler (Fase 3 acceptance criteria):
 * input sama → output byte-identik, tiap preset punya test sendiri.
 */
import { describe, expect, it } from "vitest"

import {
  RENDER_PRESETS,
  compilePrompt,
  compilePromptV2,
  describeSceneFacts,
  projectSeed,
} from "./prompt"
import type { RenderSceneMeta } from "./prompt"
import type { SceneFacts } from "./analyze"

/** Substring persis dari `PROMPT_GEOMETRY_GUARD` (private di prompt.ts) —
 *  dipakai untuk assert semua output compilePromptV2 diakhiri klausa ini,
 *  tanpa mengekspor konstanta legacy yang dilarang diubah. */
const GEOMETRY_GUARD_TEXT =
  "preserve the exact geometry, camera angle and building proportions from the reference image; " +
  "do not add, remove, or resize any structural elements"

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

/**
 * Fixtures Task 3 — dibangun manual (BUKAN via analyzeScene), supaya snapshot
 * test ini independen dari analyzer (Task 2). `camera.visibleSides` primer
 * dulu, sesuai catatan koreksi di brief.
 */
const eyeLevelFacts: SceneFacts = {
  camera: {
    heightClass: "eye-level",
    distanceClass: "medium",
    lensMm: 35,
    visibleSides: ["s"],
  },
  massing: {
    siteWidthM: 15,
    siteDepthM: 20,
    footprintWidthM: 10,
    footprintDepthM: 12,
    floors: 2,
    approxHeightM: 6.4,
    hasRooftopDeck: false,
  },
  sides: [
    {
      side: "s",
      claddings: ["Batu Alam", "Plester Putih"],
      windowCount: 4,
      doorCount: 1,
      garageDoorCount: 1,
      facadeElements: ["louver_band"],
      balconyCount: 1,
    },
  ],
  exteriorInFrame: ["driveway", "tree"],
  roof: { zoneTypes: ["pelana"], globalType: "pelana", skylightCount: 0 },
  lighting: { exteriorLampCount: 0 },
  vegetationPresent: true,
}

const aerialTwoSideFacts: SceneFacts = {
  camera: {
    heightClass: "aerial",
    distanceClass: "wide",
    lensMm: 24,
    visibleSides: ["e", "s"],
  },
  massing: {
    siteWidthM: 18,
    siteDepthM: 25,
    footprintWidthM: 12,
    footprintDepthM: 14,
    floors: 2,
    approxHeightM: 8.2,
    hasRooftopDeck: true,
    rooftopRailing: "kaca",
  },
  sides: [
    {
      side: "e",
      claddings: ["Kayu Jati"],
      windowCount: 2,
      doorCount: 0,
      garageDoorCount: 0,
      facadeElements: [],
      balconyCount: 0,
    },
    {
      side: "s",
      claddings: ["Plester Putih"],
      windowCount: 3,
      doorCount: 1,
      garageDoorCount: 1,
      facadeElements: ["louver_band", "roster_screen"],
      balconyCount: 2,
    },
  ],
  exteriorInFrame: ["garden_bed", "pergola"],
  roof: { zoneTypes: ["dak", "pelana"], globalType: "pelana", skylightCount: 2 },
  lighting: { exteriorLampCount: 3 },
  vegetationPresent: true,
}

describe("describeSceneFacts — determinism", () => {
  it("same facts produce a byte-identical description (called twice)", () => {
    expect(describeSceneFacts(eyeLevelFacts)).toBe(describeSceneFacts(eyeLevelFacts))
  })
})

describe("compilePromptV2 — snapshot", () => {
  it("eye-level single-side facade, preset tropis-siang", () => {
    expect(compilePromptV2(eyeLevelFacts, "tropis-siang")).toMatchSnapshot()
  })

  it("aerial two-side facade + rooftop deck, preset malam (lampCount 3)", () => {
    expect(compilePromptV2(aerialTwoSideFacts, "malam")).toMatchSnapshot()
  })

  it("every output ends with the fixed geometry-guard clause", () => {
    for (const [facts, presetId] of [
      [eyeLevelFacts, "tropis-siang"],
      [aerialTwoSideFacts, "malam"],
      [aerialTwoSideFacts, "skandinavia-siang"],
    ] as const) {
      const prompt = compilePromptV2(facts, presetId)
      expect(prompt.endsWith(`${GEOMETRY_GUARD_TEXT}.`)).toBe(true)
    }
  })

  it("night-lamp clause present only for preset malam with exteriorLampCount > 0", () => {
    const malam = compilePromptV2(aerialTwoSideFacts, "malam")
    const nonMalam = compilePromptV2(aerialTwoSideFacts, "tropis-siang")
    expect(malam).toContain("3 warm exterior lamps glowing")
    expect(nonMalam).not.toContain("warm exterior lamps glowing")
  })

  it("polished description override replaces the deterministic description entirely", () => {
    const deterministic = describeSceneFacts(eyeLevelFacts)
    const polished = compilePromptV2(eyeLevelFacts, "x-unknown-preset", "  POLISHED scene description  ")
    expect(polished).toContain("POLISHED scene description")
    expect(polished).not.toContain(deterministic)
  })

  it("falls back to the first preset for an unknown preset id (never throws)", () => {
    const known = compilePromptV2(eyeLevelFacts, "tropis-siang")
    const unknown = compilePromptV2(eyeLevelFacts, "does-not-exist")
    expect(unknown).toBe(known)
  })

  it("night-lamp clause survives the polished-description override (preset malam)", () => {
    const polished = compilePromptV2(aerialTwoSideFacts, "malam", "POLISHED TEXT")
    expect(polished).toContain("POLISHED TEXT")
    expect(polished).toContain("3 warm exterior lamps glowing")
  })

  it("preset malam with exteriorLampCount 0 has no lamp clause", () => {
    const prompt = compilePromptV2(eyeLevelFacts, "malam")
    expect(prompt).not.toContain("warm exterior lamps glowing")
  })
})

