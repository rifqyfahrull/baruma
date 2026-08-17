import { describe, it, expect } from "vitest"

import type { DesignLayout } from "@/types"
import { pickEffectiveLayout } from "./effective-layout"

const layout = (projectId: string, id: string): DesignLayout => ({
  id,
  projectId,
  versionId: "v",
  floors: [],
  rooms: [],
  walls: [],
  openings: [],
  stairs: [],
  pools: [],
  validation: { passed: true, issues: [] },
})

describe("pickEffectiveLayout", () => {
  it("uses the live editor draft when it belongs to this project", () => {
    const draft = layout("p1", "draft")
    const fetched = layout("p1", "saved")
    expect(pickEffectiveLayout(draft, fetched, "p1")).toBe(draft)
  })

  it("falls back to the fetched layout when the editor draft is for another project", () => {
    const draft = layout("p2", "draft")
    const fetched = layout("p1", "saved")
    expect(pickEffectiveLayout(draft, fetched, "p1")).toBe(fetched)
  })

  it("falls back to the fetched layout when there is no editor draft", () => {
    const fetched = layout("p1", "saved")
    expect(pickEffectiveLayout(null, fetched, "p1")).toBe(fetched)
  })

  it("returns null when neither a matching draft nor a fetched layout exists", () => {
    expect(pickEffectiveLayout(null, undefined, "p1")).toBeNull()
    expect(pickEffectiveLayout(layout("other", "d"), null, "p1")).toBeNull()
  })
})
