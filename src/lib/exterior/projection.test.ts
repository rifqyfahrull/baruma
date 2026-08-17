import { describe, expect, it } from "vitest"

import { makeBoxElement, makeFrameElement, makeSurfaceElement } from "./factories"
import { projectExteriorElevation, projectExteriorPlan } from "./projection"

describe("exterior drawing projection", () => {
  it("projects plan polygons with stable semantic references", () => {
    const driveway = makeSurfaceElement("driveway", [
      { x: 1, y: 1 },
      { x: 5, y: 1 },
      { x: 5, y: 4 },
      { x: 1, y: 4 },
    ], { id: "drive-1", label: "Driveway depan" })
    const result = projectExteriorPlan([driveway], "f1")

    expect(result.lines).toHaveLength(4)
    expect(result.lines.every((line) => line.refId === "drive-1")).toBe(true)
    expect(result.labels).toContainEqual(expect.objectContaining({
      text: "Driveway depan",
      refId: "drive-1",
    }))
  })

  it("projects a portal outer envelope and clear opening", () => {
    const portal = makeFrameElement(4, 1, {
      id: "portal-1",
      floorId: "f1",
      widthM: 5,
      heightM: 3,
      memberSizeM: 0.3,
    })
    const result = projectExteriorElevation([portal], {
      side: "s",
      totalW: 8,
      totalD: 12,
      floorBaseY: new Map([["f1", 0]]),
    })

    expect(result.lines.filter((line) => line.kind === "outline")).toHaveLength(4)
    expect(result.lines.filter((line) => line.kind === "opening")).toHaveLength(3)
    expect(result.topY).toBe(3)
    expect(result.lines.every((line) => line.refId === "portal-1")).toBe(true)
  })

  it("ignores hidden elements in both plan and elevation", () => {
    const hidden = makeBoxElement("facade_panel", 3, 3, { id: "hidden", hidden: true })
    expect(projectExteriorPlan([hidden], "f1").lines).toEqual([])
    expect(projectExteriorElevation([hidden], {
      side: "s",
      totalW: 8,
      totalD: 12,
      floorBaseY: new Map(),
    }).lines).toEqual([])
  })
})
