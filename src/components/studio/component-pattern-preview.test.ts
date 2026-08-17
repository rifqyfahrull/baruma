import { describe, expect, it } from "vitest"

import { componentPatternPreviewRects } from "./component-pattern-preview"

describe("componentPatternPreviewRects", () => {
  it("widthM/heightM tak positif → array kosong", () => {
    expect(componentPatternPreviewRects({ widthM: 0, heightM: 2 })).toEqual([])
    expect(componentPatternPreviewRects({ widthM: 2, heightM: -1 })).toEqual([])
  })

  it("orientasi v (default): bilah vertikal setinggi penuh, jumlah sesuai patternBarOffsets", () => {
    const rects = componentPatternPreviewRects({
      widthM: 2.4,
      heightM: 2,
      pattern: { pitchM: 0.4, barWidthM: 0.1 },
    })
    expect(rects).toHaveLength(6)
    for (const r of rects) {
      expect(r.h).toBeCloseTo(2, 6)
      expect(r.w).toBeCloseTo(0.1, 6)
      expect(r.y).toBe(0)
    }
    // Bilah pertama di tepi kiri: offset -1.0 (span/2=1.2) → x = 1.2-1.0-0.05 = 0.15
    expect(rects[0].x).toBeCloseTo(0.15, 6)
  })

  it("orientasi h: bilah horizontal selebar penuh", () => {
    const rects = componentPatternPreviewRects({
      widthM: 2,
      heightM: 1.2,
      pattern: { orientation: "h", pitchM: 0.4, barWidthM: 0.1 },
    })
    expect(rects.length).toBeGreaterThan(0)
    for (const r of rects) {
      expect(r.w).toBeCloseTo(2, 6)
      expect(r.x).toBe(0)
    }
  })

  it("orientasi grid/cross: gabungan bilah v + h", () => {
    const vOnly = componentPatternPreviewRects({
      widthM: 2,
      heightM: 2,
      pattern: { orientation: "v", pitchM: 0.5, barWidthM: 0.08 },
    })
    const hOnly = componentPatternPreviewRects({
      widthM: 2,
      heightM: 2,
      pattern: { orientation: "h", pitchM: 0.5, barWidthM: 0.08 },
    })
    const grid = componentPatternPreviewRects({
      widthM: 2,
      heightM: 2,
      pattern: { orientation: "grid", pitchM: 0.5, barWidthM: 0.08 },
    })
    expect(grid).toHaveLength(vOnly.length + hOnly.length)
  })

  it("frame: menambah 4 rect keliling saat pattern.frame true", () => {
    const withoutFrame = componentPatternPreviewRects({
      widthM: 2,
      heightM: 2,
      pattern: { pitchM: 0.5, barWidthM: 0.08 },
    })
    const withFrame = componentPatternPreviewRects({
      widthM: 2,
      heightM: 2,
      pattern: { pitchM: 0.5, barWidthM: 0.08, frame: true },
    })
    expect(withFrame).toHaveLength(withoutFrame.length + 4)
  })

  it("absen pattern → memakai fallback orientasi/pitch/lebar bilah pemanggil", () => {
    const rects = componentPatternPreviewRects({
      widthM: 2.4,
      heightM: 2,
      fallbackOrientation: "v",
      fallbackPitchM: 0.4,
      fallbackBarWidthM: 0.1,
    })
    expect(rects).toHaveLength(6)
  })

  it("lebar bilah dijepit agar tak melebihi separuh envelope (elemen kecil)", () => {
    // barWidthM diminta 0.5 tapi envelope hanya 0.3×0.3 — resolver harus
    // menjepitnya ke widthM/2 = heightM/2 = 0.15 (bukan overlap negatif).
    const rects = componentPatternPreviewRects({
      widthM: 0.3,
      heightM: 0.3,
      pattern: { orientation: "v", pitchM: 0.5, barWidthM: 0.5 },
    })
    expect(rects).toHaveLength(1)
    expect(rects[0].w).toBeCloseTo(0.15, 6)
    expect(rects[0].h).toBeCloseTo(0.3, 6)
  })
})
