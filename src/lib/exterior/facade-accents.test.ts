import { describe, expect, it } from "vitest"

import { buildWallAccent, isAccentOf } from "./facade-accents"

const room = { id: "r1", floorId: "f1", x: 2, y: 1, width: 4.5, depth: 3 }

describe("facade-accents — generator aksen dinding", () => {
  it("vertical_fins: jumlah = floor(len/pitch), di garis dinding + offset keluar, ber-tag", () => {
    const fins = buildWallAccent(room, "s", {
      mode: "vertical_fins", pitchM: 0.5, heightM: 2.2, sillM: 0.3, materialId: "beton_ekspos",
    })
    expect(fins).toHaveLength(9)
    for (const f of fins) {
      expect(f.kind).toBe("facade_panel")
      // Sisi s: garis y = room.y + depth + offset keluar (> 4).
      expect(f.y).toBeGreaterThan(4)
      expect(f.x).toBeGreaterThan(2)
      expect(f.x).toBeLessThan(6.5)
      expect(f.zM).toBe(0.3)
      expect(f.heightM).toBe(2.2)
      expect(f.material?.materialId).toBe("beton_ekspos")
      expect(isAccentOf(f.label, "r1", "s")).toBe(true)
    }
  })

  it("horizontal_bands: bilah selebar dinding bertumpuk per pitch (zM naik)", () => {
    const bands = buildWallAccent(room, "e", {
      mode: "horizontal_bands", pitchM: 0.5, heightM: 1.5, sillM: 0.4, materialId: "kayu_ulin",
    })
    expect(bands).toHaveLength(3)
    expect(bands.map((b) => b.zM)).toEqual([0.4, 0.9, 1.4])
    // Sisi e vertikal → panjang bilah = depth ruang, rotasi 90.
    expect(bands[0].widthM).toBe(3)
    expect(bands[0].rotationDeg).toBe(90)
    expect(bands[0].x).toBeGreaterThan(6.5)
  })

  it("dinding lebih pendek dari pitch → []", () => {
    expect(
      buildWallAccent({ ...room, width: 0.3 }, "s", {
        mode: "vertical_fins", pitchM: 0.5, heightM: 2, sillM: 0, materialId: "x",
      }),
    ).toEqual([])
  })
})
