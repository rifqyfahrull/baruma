import { existsSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"
import { resolveFurnitureSource, FURNITURE_MODEL_REGISTRY, registeredModelUrls } from "./furniture-models"

describe("resolveFurnitureSource", () => {
  it("returns a glb source for a registered furnitureId", () => {
    const src = resolveFurnitureSource({ furnitureId: "queen-bed", category: "bed" })
    expect(src).toEqual({ kind: "glb", url: FURNITURE_MODEL_REGISTRY["queen-bed"] })
    expect(FURNITURE_MODEL_REGISTRY["queen-bed"]).toBe("/models/bed-queen-b19.glb")
  })

  it("registers the 2026-07 asset-bank batch (curated SKP→GLB conversions)", () => {
    for (const id of [
      "sofa-3-seat", "sofa-l", "coffee-table", "tv-cabinet", "tv-55",
      "rug-large", "side-table", "dining-table-4", "fridge",
      "bathroom-shower", "bathroom-vanity", "toilet", "prayer-rug-area",
      "laundry-machine", "outdoor-sofa", "work-desk", "kitchen-linear",
      "quran-shelf",
    ]) {
      expect(FURNITURE_MODEL_REGISTRY[id], id).toMatch(/^\/models\/.+\.glb$/)
    }
  })

  it("falls back to a procedural archetype by category when no glb is registered", () => {
    // wardrobe-2m stays procedural — no honest single-object wardrobe in the bank.
    const src = resolveFurnitureSource({ furnitureId: "wardrobe-2m", category: "wardrobe" })
    expect(src).toEqual({ kind: "procedural", archetype: "wardrobe" })
  })

  it("maps seating/table/appliance/etc to their archetypes", () => {
    expect(resolveFurnitureSource({ furnitureId: "x", category: "seating" })).toEqual({ kind: "procedural", archetype: "seating" })
    expect(resolveFurnitureSource({ furnitureId: "x", category: "table" })).toEqual({ kind: "procedural", archetype: "table" })
    expect(resolveFurnitureSource({ furnitureId: "x", category: "wardrobe" })).toEqual({ kind: "procedural", archetype: "wardrobe" })
    expect(resolveFurnitureSource({ furnitureId: "x", category: "decor" })).toEqual({ kind: "procedural", archetype: "decor_flat" })
  })

  it("registeredModelUrls returns each registered url once", () => {
    const urls = registeredModelUrls()
    expect(urls).toContain("/models/bed.glb")
    expect(new Set(urls).size).toBe(urls.length)
  })

  it("every registered url is a well-formed /models/<name>.glb path", () => {
    for (const url of registeredModelUrls()) {
      expect(url, url).toMatch(/^\/models\/[\w.-]+\.glb$/)
    }
  })

  it("registered models exist locally when synced (GLBs live in storage, not git)", () => {
    // GLB binaries are gitignored (scripts/sync-catalog-models.mjs downloads
    // them from object storage at deploy). On a machine that has run `sync
    // download`/`upload`, ALL must be present — a registry entry with no
    // corresponding file would 404 at runtime and silently fall back to
    // procedural. On a fresh clone that never synced, public/models has no
    // GLBs at all — skip rather than fail (nothing to verify yet).
    const urls = registeredModelUrls()
    const present = urls.filter((url) =>
      existsSync(join(process.cwd(), "public", ...url.split("/").filter(Boolean)))
    )
    if (present.length === 0) return // never synced on this machine — nothing to check
    for (const url of urls) {
      const onDisk = join(process.cwd(), "public", ...url.split("/").filter(Boolean))
      expect(existsSync(onDisk), `${url} missing at ${onDisk} — run: node scripts/sync-catalog-models.mjs download`).toBe(true)
    }
  })
})
