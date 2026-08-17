import { describe, expect, it } from "vitest"

import { buildGableFrameGeometry } from "./roof-geometry-core"
import { exteriorElementPrimitives } from "@/lib/three/exterior-primitives"
import { makeGableFrameElement } from "@/lib/exterior/factories"
import { designLayoutSchema } from "@/lib/schemas/layout"

const CTX = { centerX: 0, centerZ: 0, floorBaseY: new Map<string, number>() }

describe("W4 — bingkai gable (gable_frame)", () => {
  it("geometri: apex = heightM, dasar y=0, kaki beda tinggi valid", () => {
    const g = buildGableFrameGeometry(5, 4.5, 3.2, 2.8, -0.5, 0.45, 0.5)
    const pos = g.getAttribute("position")
    let minY = Infinity
    let maxY = -Infinity
    for (let i = 0; i < pos.count; i++) {
      minY = Math.min(minY, pos.getY(i))
      maxY = Math.max(maxY, pos.getY(i))
    }
    expect(minY).toBeCloseTo(0, 5)
    expect(maxY).toBeCloseTo(4.5, 5)
    // Extrude tebal 0.5 terpusat: z di [-0.25, 0.25].
    let minZ = Infinity
    let maxZ = -Infinity
    for (let i = 0; i < pos.count; i++) {
      minZ = Math.min(minZ, pos.getZ(i))
      maxZ = Math.max(maxZ, pos.getZ(i))
    }
    expect(minZ).toBeCloseTo(-0.25, 5)
    expect(maxZ).toBeCloseTo(0.25, 5)
  })

  it("emisi: prim exterior tunggal ber-payload gableFrame", () => {
    const el = makeGableFrameElement(4, 10, {
      id: "gfx", widthM: 5, heightM: 4.5, eaveLeftM: 3.2, eaveRightM: 2.8,
      apexOffsetM: -0.5, memberSizeM: 0.45, depthM: 0.5,
    })
    const prims = exteriorElementPrimitives([el], CTX)
    expect(prims).toHaveLength(1)
    expect(prims[0].id).toBe("ext-gfx-frame")
    expect(prims[0].kind).toBe("exterior")
    expect(prims[0].gableFrame).toEqual({
      eaveLeftM: 3.2, eaveRightM: 2.8, apexOffsetM: -0.5, memberM: 0.45,
    })
    expect(prims[0].args).toEqual([5, 4.5, 0.5])
  })

  it("emisi menolak dimensi degenerate (eave >= apex)", () => {
    const el = makeGableFrameElement(0, 0, {
      id: "gfy", heightM: 3, eaveLeftM: 3.2, eaveRightM: 2.8,
    })
    expect(exteriorElementPrimitives([el], CTX)).toHaveLength(0)
  })

  it("zod layout menerima elemen gable_frame", () => {
    const el = makeGableFrameElement(4, 10, { id: "gfz" })
    const parsed = designLayoutSchema.safeParse({
      id: "l1", projectId: "p1", versionId: "v1",
      floors: [{ id: "floor-1", level: 1, name: "L1", heightM: 3 }],
      rooms: [], walls: [], openings: [], stairs: [], pools: [],
      exteriorElements: [el],
      validation: { passed: true, issues: [] },
    })
    expect(parsed.success).toBe(true)
  })
})
