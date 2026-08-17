import { describe, it, expect } from "vitest"

import {
  bandCovering,
  facadeBandsForWall,
  facadeKeysForWall,
  formatFacadeKey,
  parseFacadeKey,
  wallCutYs,
} from "./facade-bands"

describe("facade-bands — parser/format key", () => {
  it("key lama roomId:side = band null (kompat penuh)", () => {
    expect(parseFacadeKey("room-Ab12Cd34:s")).toEqual({
      roomId: "room-Ab12Cd34",
      side: "s",
      band: null,
    })
  })

  it("key band round-trip format → parse", () => {
    const key = formatFacadeKey("r1", "n", { sillM: 0.9, headM: 2.1 })
    expect(key).toBe("r1:n@0.90-2.10")
    expect(parseFacadeKey(key)).toEqual({ roomId: "r1", side: "n", band: { sillM: 0.9, headM: 2.1 } })
  })

  it("key rusak (head ≤ sill, sisi salah) → null", () => {
    expect(parseFacadeKey("r1:n@2.00-1.00")).toBeNull()
    expect(parseFacadeKey("r1:x")).toBeNull()
    expect(parseFacadeKey("tanpa-sisi")).toBeNull()
  })

  it("roomId sintetis edge-{floorId} ikut ter-parse", () => {
    expect(parseFacadeKey("edge-floor-2:w@0.00-1.00")).toMatchObject({
      roomId: "edge-floor-2",
      side: "w",
    })
  })
})

describe("facade-bands — bands per dinding", () => {
  const facade = {
    "r1:s": "beton_ekspos", // polos — bukan band
    "r1:s@0.90-2.10": "granit_hitam",
    "r1:s@2.00-2.60": "kayu_ulin", // overlap → di-clip mulai 2.10
    "r1:n@0.00-1.00": "bata_merah", // sisi lain
    "r2:s@0.00-1.00": "bata_merah", // ruang lain
  }

  it("filter per (roomId, side), urut, overlap di-clip deterministik", () => {
    const bands = facadeBandsForWall(facade, "r1", "s", 2.8)
    expect(bands).toHaveLength(2)
    expect(bands[0]).toMatchObject({ sillM: 0.9, headM: 2.1, claddingId: "granit_hitam" })
    expect(bands[1]).toMatchObject({ sillM: 2.1, headM: 2.6, claddingId: "kayu_ulin" })
  })

  it("wallCutYs menghasilkan boundary unik termasuk 0 & wallH", () => {
    const bands = facadeBandsForWall(facade, "r1", "s", 2.8)
    expect(wallCutYs(bands, 2.8)).toEqual([0, 0.9, 2.1, 2.6, 2.8])
  })

  it("bandCovering meresolusi segmen ke band (atau null di gap)", () => {
    const bands = facadeBandsForWall(facade, "r1", "s", 2.8)
    expect(bandCovering(bands, 0.9, 2.1)?.claddingId).toBe("granit_hitam")
    expect(bandCovering(bands, 0, 0.9)).toBeNull()
    expect(bandCovering(bands, 2.6, 2.8)).toBeNull()
  })

  it("facadeKeysForWall mengembalikan key polos + band milik dinding itu", () => {
    expect(facadeKeysForWall(facade, "r1", "s").sort()).toEqual([
      "r1:s",
      "r1:s@0.90-2.10",
      "r1:s@2.00-2.60",
    ])
  })

  it("band di luar tinggi dinding ter-clamp; degenerate dibuang", () => {
    const bands = facadeBandsForWall({ "r1:s@2.70-9.00": "x", "r1:s@5.00-6.00": "y" }, "r1", "s", 2.8)
    expect(bands).toHaveLength(1)
    expect(bands[0]).toMatchObject({ sillM: 2.7, headM: 2.8 })
  })
})
