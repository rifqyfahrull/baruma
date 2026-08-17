import { describe, it, expect } from "vitest"

import { safeAssetFilename, assetKey } from "@/lib/server/storage"

describe("safeAssetFilename", () => {
  it("mengganti '+' & spasi jadi '-' (penyebab SignatureDoesNotMatch 403 di S3)", () => {
    // Kasus nyata dari laporan: '+' di key → 403 → route balas 502.
    expect(safeAssetFilename("Washing+Machine+AEG.glb")).toBe("Washing-Machine-AEG.glb")
    expect(safeAssetFilename("Meja Makan (besar).glb")).toBe("Meja-Makan-besar.glb")
  })

  it("merapikan '-' beruntun & trim, lowercase ekstensi", () => {
    expect(safeAssetFilename("a  ++  b.GLB")).toBe("a-b.glb")
    expect(safeAssetFilename("--edge--.glb")).toBe("edge.glb")
  })

  it("mempertahankan karakter aman [A-Za-z0-9_-]", () => {
    expect(safeAssetFilename("bed_queen-b19.glb")).toBe("bed_queen-b19.glb")
  })

  it("fallback 'model' saat base kosong setelah sanitasi", () => {
    expect(safeAssetFilename("+++.glb")).toBe("model.glb")
  })

  it("assetKey memakai nama tersanitasi → key aman S3 (tanpa '+'/spasi)", () => {
    const key = assetKey("usr-1", "proj-1", "Washing+Machine+AEG.glb")
    expect(key).toMatch(/^uploads\/usr-1\/proj-1\/\d+-Washing-Machine-AEG\.glb$/)
    expect(key).not.toContain("+")
    expect(key).not.toContain(" ")
  })
})
