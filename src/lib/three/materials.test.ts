import { describe, expect, it } from "vitest"

import {
  glassMaterialProps,
  MATERIAL_PRESETS,
  SURFACE_PBR,
  type PbrSurface,
} from "./materials"

const SURFACES: PbrSurface[] = ["wall", "floor", "roof", "glass"]

describe("MATERIAL_PRESETS web-PBR params", () => {
  it("every preset exposes roughness/metalness for every surface in [0,1]", () => {
    for (const [id, preset] of Object.entries(MATERIAL_PRESETS)) {
      expect(preset.pbr, `${id} missing pbr`).toBeDefined()
      for (const surface of SURFACES) {
        const s = preset.pbr[surface]
        expect(s, `${id}.${surface} missing`).toBeDefined()
        expect(typeof s.roughness).toBe("number")
        expect(typeof s.metalness).toBe("number")
        expect(s.roughness).toBeGreaterThanOrEqual(0)
        expect(s.roughness).toBeLessThanOrEqual(1)
        expect(s.metalness).toBeGreaterThanOrEqual(0)
        expect(s.metalness).toBeLessThanOrEqual(1)
      }
    }
  })

  it("keeps the flat preset colors intact (map modulates these in T11)", () => {
    for (const preset of Object.values(MATERIAL_PRESETS)) {
      expect(preset.wall).toMatch(/^#[0-9a-f]{6}$/i)
      expect(preset.floor).toMatch(/^#[0-9a-f]{6}$/i)
      expect(preset.roof).toMatch(/^#[0-9a-f]{6}$/i)
      expect(preset.accent).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it("each surface names a procedural texture kind matching its key", () => {
    for (const surface of SURFACES) {
      expect(SURFACE_PBR[surface].texture).toBe(surface)
    }
  })

  it("pins the specified physical response per surface", () => {
    expect(SURFACE_PBR.wall).toMatchObject({ roughness: 0.9, metalness: 0 })
    expect(SURFACE_PBR.floor).toMatchObject({ roughness: 0.4, metalness: 0 })
    expect(SURFACE_PBR.roof).toMatchObject({ roughness: 0.8, metalness: 0 })
    expect(SURFACE_PBR.glass).toMatchObject({ roughness: 0.1, metalness: 0.2 })
  })
})

describe("glassMaterialProps — toggle 'Kaca realistis' (transmission, opsional & default OFF)", () => {
  it("OFF (default) → null, pemanggil tetap pakai meshStandardMaterial lama (byte-identical)", () => {
    expect(glassMaterialProps(false)).toBeNull()
  })

  it("ON → transmission/ior/thickness/clearcoat ter-set untuk meshPhysicalMaterial", () => {
    const props = glassMaterialProps(true)
    expect(props).not.toBeNull()
    expect(props!.transmission).toBeGreaterThanOrEqual(0.9)
    expect(props!.ior).toBe(1.5)
    expect(props!.thickness).toBeCloseTo(0.4)
    expect(props!.clearcoat).toBeGreaterThan(0)
    expect(props!.roughness).toBeLessThan(SURFACE_PBR.glass.roughness)
  })
})
