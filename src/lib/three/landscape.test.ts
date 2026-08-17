import { describe, it, expect } from "vitest"
import { landscapeClearanceIssues, landscapePlacements } from "./landscape"
import { makeAssetElement, makeSurfaceElement } from "@/lib/exterior/factories"
import { makeLayout } from "@/test-utils/fixtures"
import type { Room } from "@/types"

const taman = (over: Partial<Room> = {}): Room => ({
  id: "taman-1", floorId: "floor-1", name: "Taman", type: "taman",
  x: 1, y: 1, width: 4, depth: 3, areaM2: 12, ...over,
})

describe("landscapePlacements — vegetasi taman", () => {
  it("deterministic, inside the garden rect, trees + bushes scale with area", () => {
    const layout = makeLayout()
    layout.rooms = [taman()]
    const a = landscapePlacements(layout)
    const b = landscapePlacements(layout)
    expect(a).toEqual(b) // seeded — stabil antar render/undo

    expect(a.some((p) => p.kind === "tree")).toBe(true)
    expect(a.some((p) => p.kind === "bush")).toBe(true)
    for (const p of a) {
      expect(p.x).toBeGreaterThanOrEqual(1)
      expect(p.x).toBeLessThanOrEqual(5)
      expect(p.y).toBeGreaterThanOrEqual(1)
      expect(p.y).toBeLessThanOrEqual(4)
      expect(p.floorId).toBe("floor-1")
    }
  })

  it("non-taman rooms produce nothing; tiny garden gets bushes but no tree", () => {
    const layout = makeLayout() // ruang tamu + dapur bawaan
    expect(landscapePlacements(layout)).toEqual([])

    const tiny = makeLayout()
    tiny.rooms = [taman({ width: 1.5, depth: 1.5, areaM2: 2.25 })]
    const placements = landscapePlacements(tiny)
    expect(placements.some((p) => p.kind === "tree")).toBe(false)
    expect(placements.filter((p) => p.kind === "bush").length).toBeGreaterThanOrEqual(2)
  })

  it("scatters deterministic vegetation inside semantic exterior garden beds", () => {
    const layout = makeLayout()
    layout.exteriorElements = [
      makeSurfaceElement(
        "garden_bed",
        [
          { x: 0, y: 0 },
          { x: 4, y: 0 },
          { x: 3, y: 2 },
          { x: 0, y: 2 },
        ],
        { id: "bed-1", scatterSeed: 42 },
      ),
    ]

    const a = landscapePlacements(layout)
    const b = landscapePlacements(layout)
    expect(a).toEqual(b)
    expect(a.length).toBeGreaterThan(0)
    expect(a.every((p) => p.sourceType === "garden_bed")).toBe(true)
    expect(a.every((p) => p.sourceId === "bed-1")).toBe(true)
    for (const p of a) {
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x).toBeLessThanOrEqual(4)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeLessThanOrEqual(2)
    }
  })

  it("skips hidden garden beds and lets explicit scatterSeed change the pattern", () => {
    const base = makeLayout()
    base.exteriorElements = [
      makeSurfaceElement("garden_bed", [
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { x: 3, y: 3 },
        { x: 0, y: 3 },
      ], { id: "bed-seeded", scatterSeed: 1 }),
    ]
    const changed = structuredClone(base)
    changed.exteriorElements![0] = {
      ...changed.exteriorElements![0],
      scatterSeed: 2,
    }
    const hidden = structuredClone(base)
    hidden.exteriorElements![0] = {
      ...hidden.exteriorElements![0],
      hidden: true,
    }

    expect(landscapePlacements(base)).not.toEqual(landscapePlacements(changed))
    expect(landscapePlacements(hidden)).toEqual([])
  })

  it("flags landscape/decor assets that overlap hardscape access", () => {
    const layout = makeLayout()
    layout.exteriorElements = [
      makeSurfaceElement("walkway", [
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { x: 3, y: 1 },
        { x: 0, y: 1 },
      ], { id: "walk-1" }),
      makeAssetElement("tree", 1.5, 0.5, { modelUrl: null, fitMode: "fit_envelope" }, {
        id: "tree-blocking",
        label: "Pohon blocking",
        widthM: 1,
        depthM: 1,
        heightM: 3,
      }),
      makeAssetElement("plant", 5, 5, { modelUrl: null, fitMode: "fit_envelope" }, {
        id: "plant-safe",
        widthM: 0.5,
        depthM: 0.5,
        heightM: 0.8,
      }),
    ]

    expect(landscapeClearanceIssues(layout)).toEqual([
      {
        id: "landscape-clearance:tree-blocking:walk-1",
        elementId: "tree-blocking",
        conflictElementId: "walk-1",
        message: "Pohon blocking overlap jalur akses walkway.",
      },
    ])
  })
})
