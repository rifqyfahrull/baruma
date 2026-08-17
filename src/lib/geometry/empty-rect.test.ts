import { describe, expect, it } from "vitest"

import { emptyRectAt } from "./empty-rect"

const site = { widthM: 10, depthM: 10 }

describe("emptyRectAt", () => {
  it("celah vertikal antar dua kamar → rect selebar celah", () => {
    // Kamar kiri 0..4, kamar kanan 5..10 (keduanya setinggi penuh) → celah x 4..5.
    const rooms = [
      { x: 0, y: 0, width: 4, depth: 10 },
      { x: 5, y: 0, width: 5, depth: 10 },
    ]
    const rect = emptyRectAt({ x: 4.5, y: 5 }, rooms, site)
    expect(rect).not.toBeNull()
    expect(rect!.x).toBeCloseTo(4, 2)
    expect(rect!.width).toBeCloseTo(1, 2)
    expect(rect!.y).toBeCloseTo(0, 2)
    expect(rect!.depth).toBeCloseTo(10, 2)
  })

  it("titik di dalam ruang → null", () => {
    const rooms = [{ x: 0, y: 0, width: 4, depth: 10 }]
    expect(emptyRectAt({ x: 2, y: 5 }, rooms, site)).toBeNull()
  })

  it("titik di luar site → null", () => {
    expect(emptyRectAt({ x: 12, y: 5 }, [], site)).toBeNull()
  })

  it("lantai kosong → seluruh site", () => {
    const rect = emptyRectAt({ x: 5, y: 5 }, [], site)
    expect(rect).toEqual({ x: 0, y: 0, width: 10, depth: 10 })
  })

  it("rect hasil tidak menimpa ruang manapun (pojok L)", () => {
    // Ruang di pojok kiri-atas; klik di kanan-bawahnya.
    const rooms = [{ x: 0, y: 0, width: 6, depth: 6 }]
    const rect = emptyRectAt({ x: 8, y: 8 }, rooms, site)!
    expect(rect).not.toBeNull()
    // Tidak beririsan dgn ruang: entah mulai setelah x=6 ATAU setelah y=6.
    const overlapX = Math.min(rect.x + rect.width, 6) - Math.max(rect.x, 0)
    const overlapY = Math.min(rect.y + rect.depth, 6) - Math.max(rect.y, 0)
    expect(overlapX <= 0.05 || overlapY <= 0.05).toBe(true)
    // Memuat titik klik.
    expect(rect.x).toBeLessThanOrEqual(8)
    expect(rect.x + rect.width).toBeGreaterThanOrEqual(8)
  })

  it("celah horizontal di bawah satu kamar penuh-lebar", () => {
    const rooms = [{ x: 0, y: 0, width: 10, depth: 4 }]
    const rect = emptyRectAt({ x: 5, y: 7 }, rooms, site)!
    expect(rect.y).toBeCloseTo(4, 2)
    expect(rect.depth).toBeCloseTo(6, 2)
    expect(rect.width).toBeCloseTo(10, 2)
  })
})
