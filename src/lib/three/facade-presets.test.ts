import { describe, expect, it } from "vitest"

import {
  FACADE_PRESETS,
  buildFacadePreset,
  facadePresetById,
  orientationToFrontSide,
} from "./facade-presets"
import { facadeCladdingById } from "./facade-claddings"
import type { DesignLayout, Room } from "@/types"

const room = (over: Partial<Room>): Room => ({
  id: "r", floorId: "f1", name: "R", type: "kamar_tidur",
  x: 0, y: 0, width: 4, depth: 3, areaM2: 12, ...over,
})
const layout = (rooms: Room[]): DesignLayout => ({
  id: "l", projectId: "p", versionId: "v",
  floors: [{ id: "f1", level: 1, name: "L1", heightM: 3 }, { id: "f2", level: 2, name: "L2", heightM: 3 }],
  rooms, walls: [], openings: [], stairs: [], pools: [],
  validation: { passed: true, issues: [] },
})

describe("orientationToFrontSide", () => {
  it("memetakan orientasi → sisi denah; default s", () => {
    expect(orientationToFrontSide("south")).toBe("s")
    expect(orientationToFrontSide("north")).toBe("n")
    expect(orientationToFrontSide("east")).toBe("e")
    expect(orientationToFrontSide("west")).toBe("w")
    expect(orientationToFrontSide("unknown")).toBe("s")
    expect(orientationToFrontSide(undefined)).toBe("s")
  })
})

describe("FACADE_PRESETS", () => {
  it("semua id material preset valid (ada di katalog cladding)", () => {
    for (const p of FACADE_PRESETS) {
      for (const id of [p.hero, p.accent, p.base]) {
        expect(facadeCladdingById(id), `${p.id}:${id}`).not.toBeNull()
      }
    }
  })
})

describe("buildFacadePreset", () => {
  const l = layout([
    room({ id: "a", floorId: "f1", width: 4 }),
    room({ id: "b", floorId: "f1", width: 3 }),
    room({ id: "carport", floorId: "f1", type: "carport", width: 3 }),
    room({ id: "c", floorId: "f2", width: 5 }),
  ])

  it("muka depan sadar-LANTAI: lantai 1 hero, lantai 2 accent; sisi lain base", () => {
    const preset = facadePresetById("modern_dua_tona")!
    const { facade } = buildFacadePreset(l, "modern_dua_tona", "s")
    // Podium vs atas: SEMUA ruang f1 → depan hero; f2 → depan accent.
    expect(facade["a:s"]).toBe(preset.hero)
    expect(facade["b:s"]).toBe(preset.hero)
    expect(facade["c:s"]).toBe(preset.accent)
    expect(facade["a:n"]).toBe(preset.base)
    // Carport (terbuka) tak diberi cladding.
    expect(facade["carport:s"]).toBeUndefined()
  })

  it("dinding INTERIOR (menempel ruang solid) dilewati — tak ada key mati", () => {
    const l2 = layout([
      room({ id: "kiri", x: 0, y: 0, width: 3, depth: 3 }),
      room({ id: "kanan", x: 3, y: 0, width: 3, depth: 3 }),
    ])
    const { facade } = buildFacadePreset(l2, "modern_dua_tona", "s")
    // Batas kiri|kanan: sisi e kiri & sisi w kanan interior → tak ditulis.
    expect(facade["kiri:e"]).toBeUndefined()
    expect(facade["kanan:w"]).toBeUndefined()
    expect(facade["kiri:w"]).toBeDefined()
    expect(facade["kanan:e"]).toBeDefined()
  })

  it("dinding menghadap ruang TERBUKA yang sudah di-clad manual dipertahankan (kontrak courtyard)", () => {
    const l3 = layout([
      room({ id: "solid", x: 0, y: 0, width: 3, depth: 3 }),
      room({ id: "taman1", x: 3, y: 0, width: 3, depth: 3, type: "taman" }),
    ])
    const existing = {
      "solid:e": "bata_ekspos",
      "solid:e@0.00-1.00": "granit_hitam",
    }
    const { facade } = buildFacadePreset(l3, "modern_dua_tona", "s", existing)
    expect(facade["solid:e"]).toBe("bata_ekspos")
    expect(facade["solid:e@0.00-1.00"]).toBe("granit_hitam")
    // Dinding lain tetap di-reset preset.
    expect(facade["solid:s"]).toBe(facadePresetById("modern_dua_tona")!.hero)
  })

  it("menambah louver band di dinding depan ruang TERLEBAR tiap lantai", () => {
    const { facadeElements } = buildFacadePreset(l, "modern_dua_tona", "s")
    // f1 terlebar = a (4>3), f2 = c. → 2 louver band.
    const walls = facadeElements.map((fe) => fe.wallId).sort()
    expect(walls).toEqual(["a:s", "c:s"])
    expect(facadeElements.every((fe) => fe.kind === "louver_band")).toBe(true)
    expect(facadeElements.every((fe) => fe.finish === "kayu")).toBe(true)
  })

  it("front e/w memakai depth ruang utk panjang muka", () => {
    const { facade } = buildFacadePreset(l, "modern_dua_tona", "e")
    expect(facade["a:e"]).toBeDefined()
    expect(facade["a:s"]).toBe(facadePresetById("modern_dua_tona")!.base) // s bukan depan → base
  })
})
