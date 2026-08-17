import { describe, expect, it } from "vitest"

import { getInterior, saveInterior } from "@/lib/mock"
import type { SavedInterior } from "@/lib/schemas/interior"

const payload: SavedInterior = {
  schemaVersion: 1,
  versionId: "ver-1",
  style: "japandi",
  rooms: [{ roomId: "room-1", furniture: [] }],
}

describe("mock interior persistence", () => {
  it("returns null before any save", async () => {
    expect(await getInterior("proj-empty-interior")).toBeNull()
  })

  it("persists and returns the saved interior within the session", async () => {
    await saveInterior("proj-i1", payload)
    const got = await getInterior("proj-i1")
    expect(got?.style).toBe("japandi")
    expect(got?.versionId).toBe("ver-1")
  })
})
