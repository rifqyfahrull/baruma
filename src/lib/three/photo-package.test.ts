import { describe, expect, it } from "vitest"

import { PHOTO_SHOTS, photoFilename, slugifyProjectName } from "./photo-package"

describe("PHOTO_SHOTS", () => {
  it("punya beberapa bidikan dengan id unik", () => {
    expect(PHOTO_SHOTS.length).toBeGreaterThanOrEqual(3)
    const ids = PHOTO_SHOTS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
  it("hanya memakai view preset & lighting yang valid", () => {
    const views = new Set(["iso", "front", "top", "rooftop"])
    const lights = new Set(["siang", "senja"])
    for (const s of PHOTO_SHOTS) {
      expect(views.has(s.view)).toBe(true)
      expect(lights.has(s.lighting)).toBe(true)
      expect(s.label.length).toBeGreaterThan(0)
    }
  })
  it("mencakup minimal satu siang dan satu senja", () => {
    expect(PHOTO_SHOTS.some((s) => s.lighting === "siang")).toBe(true)
    expect(PHOTO_SHOTS.some((s) => s.lighting === "senja")).toBe(true)
  })
})

describe("slugifyProjectName / photoFilename", () => {
  it("membuat slug aman dari nama proyek", () => {
    expect(slugifyProjectName("Rumah Qyfa")).toBe("rumah-qyfa")
    expect(slugifyProjectName("Villa  A/B #2")).toBe("villa-a-b-2")
    expect(slugifyProjectName("   ")).toBe("proyek")
  })
  it("nama file PNG dari nama proyek + id bidikan", () => {
    expect(photoFilename("Rumah Qyfa", "iso-senja")).toBe("rumah-qyfa-iso-senja.png")
  })
})
