import { describe, expect, it } from "vitest"
import type { BufferAttribute } from "three"

import { buildGableGeometry, buildHipGeometry } from "./roof-geometry"

/**
 * The sloped-roof builders emit custom BufferGeometry. Before this fix they set
 * only `position` + computed normals, so the genteng `map` sampled UV(0,0) and
 * read as a flat tint. These assertions pin the planar `uv` attribute that makes
 * RepeatWrapping tile the texture. BufferGeometry constructs fine in node — no
 * WebGL needed.
 */
const builders = [
  ["gable", buildGableGeometry],
  ["hip", buildHipGeometry],
] as const

describe("roof geometry planar UVs", () => {
  for (const [name, build] of builders) {
    it(`${name}: exposes a uv attribute matching the position count`, () => {
      const geo = build(8, 2, 6)
      const pos = geo.getAttribute("position")
      const uv = geo.getAttribute("uv") as BufferAttribute | undefined

      expect(uv).toBeDefined()
      expect(uv!.itemSize).toBe(2)
      expect(uv!.count).toBe(pos.count)
      // Positions and normals are untouched by the UV pass.
      expect(pos.count).toBe(6)
      expect(geo.getAttribute("normal")).toBeDefined()

      for (let i = 0; i < uv!.array.length; i++) {
        expect(Number.isFinite(uv!.array[i])).toBe(true)
      }
    })

    it(`${name}: uv spans more than one unit so RepeatWrapping tiles`, () => {
      const geo = build(8, 2, 6)
      const uv = geo.getAttribute("uv") as BufferAttribute

      let uMin = Infinity
      let uMax = -Infinity
      let vMin = Infinity
      let vMax = -Infinity
      for (let i = 0; i < uv.count; i++) {
        const u = uv.getX(i)
        const v = uv.getY(i)
        uMin = Math.min(uMin, u)
        uMax = Math.max(uMax, u)
        vMin = Math.min(vMin, v)
        vMax = Math.max(vMax, v)
      }

      // Eave axis (u) of an 8 m-wide roof spans > 1 UV unit → the texture repeats.
      expect(uMax - uMin).toBeGreaterThan(1)
      // Up-slope axis (v) has a real, non-degenerate spread (eave 0 → ridge > 0).
      expect(vMax - vMin).toBeGreaterThan(0)
    })
  }
})
