import { describe, expect, it } from "vitest"

import {
  patternBarOffsets,
  resolveBarDepthM,
  resolveBarWidthM,
  resolveOrientation,
  resolvePitchM,
  wantsFrame,
  wantsInset,
} from "./component-pattern"

describe("resolvePitchM/resolveBarWidthM/resolveBarDepthM", () => {
  it("absen pattern → fallback persis", () => {
    expect(resolvePitchM(undefined, 0.25)).toBe(0.25)
    expect(resolveBarWidthM(undefined, 0.08)).toBe(0.08)
    expect(resolveBarDepthM(undefined, 0.15)).toBe(0.15)
  })

  it("nilai dalam rentang dipakai apa adanya", () => {
    expect(resolvePitchM({ pitchM: 0.4 }, 0.25)).toBe(0.4)
    expect(resolveBarWidthM({ barWidthM: 0.12 }, 0.08)).toBe(0.12)
    expect(resolveBarDepthM({ barDepthM: 0.2 }, 0.15)).toBe(0.2)
  })

  it("clamp nilai di luar rentang (0.05-1.5 / 0.02-0.5 / 0.01-0.6)", () => {
    expect(resolvePitchM({ pitchM: 5 }, 0.25)).toBe(1.5)
    expect(resolvePitchM({ pitchM: 0.001 }, 0.25)).toBe(0.05)
    expect(resolveBarWidthM({ barWidthM: 10 }, 0.08)).toBe(0.5)
    expect(resolveBarDepthM({ barDepthM: 0 }, 0.15)).toBe(0.01)
  })

  it("barDepthM menerima nilai tipis nat beton (0.012) tanpa dipaksa naik", () => {
    // Batas bawah diturunkan 0.02 → 0.01 supaya preset "Nat beton / reveal
    // line" (barDepthM 0.012) tidak ikut ter-clamp naik.
    expect(resolveBarDepthM({ barDepthM: 0.012 }, 0.15)).toBe(0.012)
  })
})

describe("resolveOrientation/wantsFrame", () => {
  it("absen orientation → fallback pemanggil", () => {
    expect(resolveOrientation(undefined, "v")).toBe("v")
    expect(resolveOrientation({}, "h")).toBe("h")
  })

  it("orientation eksplisit menang atas fallback", () => {
    expect(resolveOrientation({ orientation: "grid" }, "v")).toBe("grid")
  })

  it("frame hanya true bila eksplisit true", () => {
    expect(wantsFrame(undefined)).toBe(false)
    expect(wantsFrame({})).toBe(false)
    expect(wantsFrame({ frame: false })).toBe(false)
    expect(wantsFrame({ frame: true })).toBe(true)
  })

  it("inset hanya true bila eksplisit true", () => {
    expect(wantsInset(undefined)).toBe(false)
    expect(wantsInset({})).toBe(false)
    expect(wantsInset({ inset: false })).toBe(false)
    expect(wantsInset({ inset: true })).toBe(true)
  })
})

describe("patternBarOffsets", () => {
  it("span/pitch tak positif → array kosong", () => {
    expect(patternBarOffsets(0, 0.5)).toEqual([])
    expect(patternBarOffsets(2, 0)).toEqual([])
    expect(patternBarOffsets(-1, 0.5)).toEqual([])
  })

  it("tanpa rhythm: grid seragam pitch tetap, jumlah = floor(span/pitch)", () => {
    // span 2.4 / pitch 0.4 = 6 pas (pembagi bulat) — kasus bersih.
    const offsets = patternBarOffsets(2.4, 0.4)
    expect(offsets).toHaveLength(6)
    expect(offsets[0]).toBeCloseTo(-1.0, 6)
    expect(offsets.at(-1)).toBeCloseTo(1.0, 6)
    // Berjarak pitch konstan.
    for (let i = 1; i < offsets.length; i++) {
      expect(offsets[i] - offsets[i - 1]).toBeCloseTo(0.4, 6)
    }
  })

  it("pitch lebih besar → bilah lebih sedikit (sesuai rumus floor(span/pitch))", () => {
    expect(patternBarOffsets(2.4, 0.4)).toHaveLength(6)
    expect(patternBarOffsets(2.4, 0.8)).toHaveLength(3)
    expect(patternBarOffsets(2.4, 1.2)).toHaveLength(2)
  })

  it("rhythm [1,1]: fill,gap berselang — offset persis dihitung tangan", () => {
    // span=2, pitch=0.5 → grid mulai -1+0.25=-0.75, step 0.5:
    // slot0 -0.75 FILL, slot1 -0.25 GAP(skip), slot2 0.25 FILL, slot3 0.75 GAP(skip).
    const offsets = patternBarOffsets(2, 0.5, [1, 1])
    expect(offsets).toEqual([-0.75, 0.25])
  })

  it("rhythm [3,1]: 3 bilah rapat lalu 1 slot pitch kosong, berulang", () => {
    // span=4, pitch=0.5 → grid start -2+0.25=-1.75, cycle FFFG (4 slot/cycle).
    const offsets = patternBarOffsets(4, 0.5, [3, 1])
    // slot idx: 0F -1.75,1F -1.25,2F -0.75,3G(skip),4F -0.25... dst.
    expect(offsets[0]).toBeCloseTo(-1.75, 6)
    expect(offsets[1]).toBeCloseTo(-1.25, 6)
    expect(offsets[2]).toBeCloseTo(-0.75, 6)
    // Lompat dari bilah ke-3 (-0.75) ke bilah ke-4 = 2 pitch (0-(-0.75)=... )
    // karena slot#3 (index 3) adalah GAP: bilah berikutnya di slot#4 = -1.75+4*0.5=0.25.
    expect(offsets[3]).toBeCloseTo(0.25, 6)
    expect(offsets[3] - offsets[2]).toBeCloseTo(1.0, 6) // 2x pitch normal (gap ekstra)
  })

  it("rhythm disanitasi: maks 8 angka, dibulatkan & clamp 1-10", () => {
    // 9 angka → hanya 8 pertama dipakai (index 8 "9" diabaikan).
    const withExtra = patternBarOffsets(4, 0.5, [3, 1, 3, 1, 3, 1, 3, 1, 9])
    const withoutExtra = patternBarOffsets(4, 0.5, [3, 1, 3, 1, 3, 1, 3, 1])
    expect(withExtra).toEqual(withoutExtra)
  })

  it("hasil kosong (rhythm/pitch terlalu lebar) fallback 1 bilah di tengah", () => {
    // rhythm [1,10]: slot pertama fill lalu 10 gap — span kecil tak pernah
    // sampai ke fill berikutnya, tapi slot pertama SELALU fill jadi tak
    // pernah benar-benar kosong; uji lewat span sangat kecil relatif pitch.
    const offsets = patternBarOffsets(0.1, 1.4)
    expect(offsets).toEqual([0])
  })
})
