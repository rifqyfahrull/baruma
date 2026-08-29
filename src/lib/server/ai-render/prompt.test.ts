// @vitest-environment node
/**
 * Determinism tests untuk prompt compiler (Fase 3 acceptance criteria):
 * input sama → output byte-identik, tiap preset punya test sendiri.
 */
import { describe, expect, it } from "vitest"

import {
  RENDER_PRESETS,
  compilePrompt,
  compilePromptInterior,
  compilePromptV2,
  describeRoomFacts,
  describeSceneFacts,
  interiorLightClause,
  projectSeed,
} from "./prompt"
import type { RenderSceneMeta } from "./prompt"
import type { SceneFacts } from "./analyze"
import type { RoomFacts } from "./analyze-room"

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
    hasMezzanine: false,
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
    hasMezzanine: false,
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

describe("describeSceneFacts — massing mezzanine (spec 2026-08-29)", () => {
  it("hasMezzanine true appends the mezzanine-level clause to the massing clause", () => {
    const facts: SceneFacts = {
      ...eyeLevelFacts,
      massing: { ...eyeLevelFacts.massing, hasMezzanine: true },
    }
    const out = describeSceneFacts(facts)
    expect(out).toContain("with a mezzanine level")
  })

  it("hasMezzanine false omits the mezzanine-level clause (fixture unchanged, byte-identical)", () => {
    const out = describeSceneFacts(eyeLevelFacts)
    expect(out).not.toContain("mezzanine")
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

/**
 * Fixtures Fase B Task 2 — kamar japandi lengkap (dari fixture Task 1
 * analyze-room.test.ts) dan ruang minim (tanpa interiors plan, tipe ruang
 * tak ada di peta EN → fallback ke tipe mentah, lantai kedua).
 */
const japandiBedroomFacts: RoomFacts = {
  roomId: "r1",
  roomName: "Kamar Tidur Utama",
  roomType: "kamar_tidur",
  floorIndex: 0,
  floorKind: "regular",
  widthM: 4,
  depthM: 5,
  areaM2: 20,
  ceilingHeightM: 2.8,
  doubleHeight: false,
  style: "japandi",
  colorPalette: ["#ff0000", "#dddddd", "#c0c0c0", "#ffffff", "#000000", "#a52a2a"],
  materials: [{ surface: "floor", name: "Parket kayu" }],
  furniture: [
    { name: "Bed", category: "bed", placement: "against the north wall" },
    { name: "Wardrobe", category: "storage", placement: "near the center" },
  ],
  windowSides: ["s", "e"],
  doorCount: 1,
  hasCurtains: true,
  skylightCount: 1,
  lighting: { fixtureCount: 4, warmCount: 4 },
}

const minimalWorkspaceFacts: RoomFacts = {
  roomId: "r2",
  roomName: "Ruang Kerja",
  roomType: "workspace",
  floorIndex: 1,
  floorKind: "regular",
  widthM: 3,
  depthM: 3,
  areaM2: 9,
  ceilingHeightM: 2.8,
  doubleHeight: false,
  materials: [],
  furniture: [],
  windowSides: [],
  doorCount: 1,
  hasCurtains: false,
  skylightCount: 0,
  lighting: { fixtureCount: 0, warmCount: 0 },
}

/**
 * Fixtures baru — spec 2026-08-29 (split-level/mezzanine). Ruang mezzanine
 * (overlooking + plafon rendah 2.1 m khas mezzanine), ruang double-height
 * (void tembus lantai berikutnya), dan dua varian split-level (naik/turun).
 */
const mezzanineFacts: RoomFacts = {
  ...minimalWorkspaceFacts,
  roomId: "r3",
  roomName: "Ruang Baca Mezzanine",
  roomType: "workspace",
  floorIndex: 0, // index STACKING mezzanine = index lantai induk (kompat lama)
  floorKind: "mezzanine",
  ceilingHeightM: 2.1,
  mezzanineOverlooking: "Ruang Keluarga",
}

const doubleHeightFacts: RoomFacts = {
  ...minimalWorkspaceFacts,
  roomId: "r4",
  roomName: "Ruang Keluarga",
  roomType: "ruang_keluarga",
  ceilingHeightM: 5.6,
  doubleHeight: true,
}

const splitLevelRaisedFacts: RoomFacts = {
  ...minimalWorkspaceFacts,
  roomId: "r5",
  roomName: "Ruang Santai",
  levelOffsetM: 1.2,
}

const splitLevelLoweredFacts: RoomFacts = {
  ...minimalWorkspaceFacts,
  roomId: "r6",
  roomName: "Ruang Rendah",
  levelOffsetM: -0.6,
}

describe("describeRoomFacts — determinism", () => {
  it("same facts produce a byte-identical description (called twice)", () => {
    expect(describeRoomFacts(japandiBedroomFacts)).toBe(describeRoomFacts(japandiBedroomFacts))
  })
})

describe("describeRoomFacts — mezzanine/double-height/split-level (spec 2026-08-29)", () => {
  it("mezzanine room: floor label switches to mezzanine + overlooking clause, snapshot", () => {
    const out = describeRoomFacts(mezzanineFacts)
    expect(out).toContain('on the mezzanine level, overlooking the Ruang Keluarga')
    expect(out).toContain("2.1 meter ceiling")
    expect(out).not.toContain("the ground floor")
    expect(out).toMatchSnapshot()
  })

  it("mezzanine room without an overlooking match omits the overlooking clause", () => {
    const facts = { ...mezzanineFacts, mezzanineOverlooking: undefined }
    const out = describeRoomFacts(facts)
    expect(out).toContain("on the mezzanine level,")
    expect(out).not.toContain("overlooking")
  })

  it("double-height room: dimensions clause gains the double-height suffix, snapshot", () => {
    const out = describeRoomFacts(doubleHeightFacts)
    expect(out).toContain("double-height ceiling")
    expect(out).toMatchSnapshot()
  })

  it("split-level raised: new clause with the exact offset value", () => {
    const out = describeRoomFacts(splitLevelRaisedFacts)
    expect(out).toContain("split-level, raised 1.2 m")
  })

  it("split-level lowered: new clause uses the absolute value with 'lowered'", () => {
    const out = describeRoomFacts(splitLevelLoweredFacts)
    expect(out).toContain("split-level, lowered 0.6 m")
    expect(out).not.toContain("raised")
  })

  it("regular room output is IDENTICAL whether new optional facts are absent or explicitly false-y", () => {
    const withoutOptionals = describeRoomFacts(minimalWorkspaceFacts)
    const withExplicitFalsy: RoomFacts = {
      ...minimalWorkspaceFacts,
      doubleHeight: false,
      mezzanineOverlooking: undefined,
      levelOffsetM: undefined,
    }
    expect(describeRoomFacts(withExplicitFalsy)).toBe(withoutOptionals)
  })
})

describe("compilePromptInterior — snapshot", () => {
  it("full japandi bedroom (style, palette, materials, furniture, windows+curtains, skylight), preset skandinavia-siang", () => {
    expect(compilePromptInterior(japandiBedroomFacts, "skandinavia-siang")).toMatchSnapshot()
  })

  it("minimal room without an interiors plan (no style/materials/furniture/windows), preset tropis-siang", () => {
    expect(compilePromptInterior(minimalWorkspaceFacts, "tropis-siang")).toMatchSnapshot()
  })

  it("every output ends with the fixed geometry-guard clause", () => {
    for (const [facts, presetId] of [
      [japandiBedroomFacts, "skandinavia-siang"],
      [minimalWorkspaceFacts, "malam"],
      [japandiBedroomFacts, "tropis-senja"],
    ] as const) {
      const prompt = compilePromptInterior(facts, presetId)
      expect(prompt.endsWith(`${GEOMETRY_GUARD_TEXT}.`)).toBe(true)
    }
  })

  it("uses the interior photography base (contains \"interior\"), distinct from the exterior base", () => {
    const prompt = compilePromptInterior(japandiBedroomFacts, "tropis-siang")
    expect(prompt).toContain("photorealistic interior architectural photography")
    expect(prompt.startsWith("photorealistic architectural photography of a residential house")).toBe(
      false
    )
  })

  it("interior light clause present only for preset malam with lighting.fixtureCount > 0", () => {
    const malam = compilePromptInterior(japandiBedroomFacts, "malam")
    const nonMalam = compilePromptInterior(japandiBedroomFacts, "tropis-siang")
    expect(malam).toContain("4 interior light fixtures on (4 warm)")
    expect(nonMalam).not.toContain("interior light fixtures")
  })

  it("preset malam with lighting.fixtureCount 0 has no light clause", () => {
    const prompt = compilePromptInterior(minimalWorkspaceFacts, "malam")
    expect(prompt).not.toContain("interior light fixtures")
  })

  it("polished description override replaces the deterministic description entirely", () => {
    const deterministic = describeRoomFacts(japandiBedroomFacts)
    const polished = compilePromptInterior(
      japandiBedroomFacts,
      "x-unknown-preset",
      "  POLISHED room description  "
    )
    expect(polished).toContain("POLISHED room description")
    expect(polished).not.toContain(deterministic)
  })

  it("interior light clause survives the polished-description override (preset malam)", () => {
    const polished = compilePromptInterior(japandiBedroomFacts, "malam", "POLISHED TEXT")
    expect(polished).toContain("POLISHED TEXT")
    expect(polished).toContain("4 interior light fixtures on (4 warm)")
  })

  it("falls back to the first preset for an unknown preset id (never throws)", () => {
    const known = compilePromptInterior(japandiBedroomFacts, "tropis-siang")
    const unknown = compilePromptInterior(japandiBedroomFacts, "does-not-exist")
    expect(unknown).toBe(known)
  })
})

describe("interiorLightClause", () => {
  it("null for non-malam presets regardless of fixtureCount", () => {
    expect(interiorLightClause(japandiBedroomFacts, "tropis-siang")).toBeNull()
  })

  it("null for preset malam when fixtureCount is 0", () => {
    expect(interiorLightClause(minimalWorkspaceFacts, "malam")).toBeNull()
  })

  it("returns the fixture clause for preset malam with fixtureCount > 0", () => {
    expect(interiorLightClause(japandiBedroomFacts, "malam")).toBe(
      "4 interior light fixtures on (4 warm)"
    )
  })
})


describe("describeRoomFacts — fallback tipe ruang tak terpetakan", () => {
  it("menghumanisasi snake_case (rooftop_lounge -> 'rooftop lounge'), tanpa underscore bocor", () => {
    const facts = { ...minimalWorkspaceFacts, roomType: "rooftop_lounge" }
    const out = describeRoomFacts(facts)
    expect(out).toContain("rooftop lounge")
    expect(out).not.toContain("rooftop_lounge")
  })
})
