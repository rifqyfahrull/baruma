import { describe, expect, it } from "vitest"

import { joinAssetFileKey, assetKeyOwnerId } from "./[...key]/route"

describe("asset file route key allowlist", () => {
  it("allows browser upload keys and curated asset-library keys", () => {
    expect(joinAssetFileKey(["uploads", "user-1", "proj-1", "123-model.glb"])).toBe(
      "uploads/user-1/proj-1/123-model.glb"
    )
    expect(joinAssetFileKey(["asset-library", "user-1", "buildings", "rumah-tipe-36.glb"])).toBe(
      "asset-library/user-1/buildings/rumah-tipe-36.glb"
    )
    // thumbnail WebP katalog global
    expect(joinAssetFileKey(["asset-library", "objaverse", "thumbnails", "abc123.webp"])).toBe(
      "asset-library/objaverse/thumbnails/abc123.webp"
    )
    // input (PNG) & output (WebP) AI Render — renders/<userId>/<projectId>/…
    expect(joinAssetFileKey(["renders", "user-1", "proj-1", "123-beauty.png"])).toBe(
      "renders/user-1/proj-1/123-beauty.png"
    )
    expect(joinAssetFileKey(["renders", "user-1", "proj-1", "rnd-abc123-output.webp"])).toBe(
      "renders/user-1/proj-1/rnd-abc123-output.webp"
    )
  })

  it("rejects traversal, wrong folders, and non-glb keys", () => {
    expect(joinAssetFileKey(["asset-library", "user-1", "secrets", "x.glb"])).toBeNull()
    expect(joinAssetFileKey(["asset-library", "..", "buildings", "x.glb"])).toBeNull()
    expect(joinAssetFileKey(["uploads", "user-1", "proj-1", "123-model.obj"])).toBeNull()
    // webp hanya di folder thumbnails, bukan furniture/buildings
    expect(joinAssetFileKey(["asset-library", "objaverse", "furniture", "x.webp"])).toBeNull()
    expect(joinAssetFileKey(["uploads", "user-1", "proj-1", "123-x.webp"])).toBeNull()
    // renders/ hanya png/webp, bukan glb/obj lain
    expect(joinAssetFileKey(["renders", "user-1", "proj-1", "123-beauty.glb"])).toBeNull()
    expect(joinAssetFileKey(["renders", "..", "proj-1", "x.png"])).toBeNull()
  })

  it("assetKeyOwnerId: userId dari kunci uploads/ ATAU renders/, null utk katalog publik", () => {
    // Otorisasi proxy: uploads/<userId> & renders/<userId> = privat milik
    // userId; asset-library = publik.
    expect(assetKeyOwnerId("uploads/usr-ABC/proj-1/123-x.glb")).toBe("usr-ABC")
    expect(assetKeyOwnerId("renders/usr-ABC/proj-1/123-beauty.png")).toBe("usr-ABC")
    expect(assetKeyOwnerId("asset-library/global/furniture/w2-x.glb")).toBeNull()
    expect(assetKeyOwnerId("asset-library/user-1/buildings/x.glb")).toBeNull()
  })
})
