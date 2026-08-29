import { describe, expect, it } from "vitest"

import {
  depthPixelsToGrayscale,
  invertDepthMidas,
  linearizeDepth,
  poseKey,
  renderParamsHash,
  unpackRGBADepth,
  type RenderParamsInput,
} from "./render-capture"

const NEAR = 0.3
const FAR = 300

describe("linearizeDepth", () => {
  it("near plane (raw=0) menormalisasi ke 0", () => {
    expect(linearizeDepth(0, NEAR, FAR)).toBeCloseTo(0, 6)
  })
  it("far plane (raw=1) menormalisasi ke 1", () => {
    expect(linearizeDepth(1, NEAR, FAR)).toBeCloseTo(1, 6)
  })
  it("monoton naik seiring raw depth naik (non-linear tapi searah)", () => {
    const samples = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1].map((r) => linearizeDepth(r, NEAR, FAR))
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeGreaterThan(samples[i - 1])
    }
  })
  it("nilai raw pertengahan (0.5) linear-view masih dekat kamera (bias presisi perspektif)", () => {
    // Rumus non-linear: separuh rentang raw ada di sebagian kecil rentang jarak
    // dekat kamera. raw=0.5 harus jatuh JAUH di bawah 0.5 setelah normalisasi.
    expect(linearizeDepth(0.5, NEAR, FAR)).toBeLessThan(0.05)
  })
  it("mengembalikan 0 saat near === far (hindari pembagian nol)", () => {
    expect(linearizeDepth(0.5, 10, 10)).toBe(0)
  })
})

describe("invertDepthMidas", () => {
  it("gaya MiDaS: near plane (linear=0) menjadi terang (1)", () => {
    expect(invertDepthMidas(0)).toBe(1)
  })
  it("far plane (linear=1) menjadi gelap (0)", () => {
    expect(invertDepthMidas(1)).toBe(0)
  })
  it("gabungan linearize+invert: raw=0 (near) → 1, raw=1 (far) → 0", () => {
    expect(invertDepthMidas(linearizeDepth(0, NEAR, FAR))).toBeCloseTo(1, 6)
    expect(invertDepthMidas(linearizeDepth(1, NEAR, FAR))).toBeCloseTo(0, 6)
  })
})

describe("unpackRGBADepth", () => {
  it("(0,0,0,0) → 0", () => {
    expect(unpackRGBADepth(0, 0, 0, 0)).toBe(0)
  })
  it("(255,255,255,255) → mendekati 1 (kuantisasi 8-bit, sedikit di bawah)", () => {
    const v = unpackRGBADepth(255, 255, 255, 255)
    expect(v).toBeLessThanOrEqual(1)
    expect(v).toBeGreaterThan(0.999)
  })
  it("channel R mendominasi (paling signifikan) — R=128 mendekati 0.5", () => {
    expect(unpackRGBADepth(128, 0, 0, 0)).toBeCloseTo(0.5, 2)
  })
  it("channel G/B/A menambah presisi sub-langkah R (monoton naik)", () => {
    const base = unpackRGBADepth(10, 0, 0, 0)
    expect(unpackRGBADepth(10, 128, 0, 0)).toBeGreaterThan(base)
    expect(unpackRGBADepth(10, 128, 128, 0)).toBeGreaterThan(unpackRGBADepth(10, 128, 0, 0))
    expect(unpackRGBADepth(10, 128, 128, 128)).toBeGreaterThan(
      unpackRGBADepth(10, 128, 128, 0)
    )
  })
})

describe("depthPixelsToGrayscale", () => {
  it("membalik urutan baris vertikal (GL bawah→atas → kanvas atas→bawah)", () => {
    // 2x2, Float32Array — indeks GL: [baris0(bawah): (0,0)=0 (0,1)=1 | baris1(atas): (1,0)=1 (1,1)=0]
    // raw=0 (near) → invert → gray 255 (terang); raw=1 (far) → gray 0 (gelap).
    const pixels = new Float32Array([0, 1, 1, 0])
    const out = depthPixelsToGrayscale(pixels, 2, 2, NEAR, FAR)

    // Baris tujuan y=0 (atas kanvas) HARUS berasal dari baris GL atas (index 2,3 → [1,0])
    expect(out[0]).toBe(0) // (x=0,y=0): raw 1 (far) → gelap
    expect(out[4]).toBe(255) // (x=1,y=0): raw 0 (near) → terang

    // Baris tujuan y=1 (bawah kanvas) HARUS berasal dari baris GL bawah (index 0,1 → [0,1])
    expect(out[8]).toBe(255) // (x=0,y=1): raw 0 (near) → terang
    expect(out[12]).toBe(0) // (x=1,y=1): raw 1 (far) → gelap
  })

  it("alpha selalu 255 (opaque) dan R=G=B (grayscale sejati)", () => {
    const pixels = new Float32Array([0, 0.3, 0.7, 1])
    const out = depthPixelsToGrayscale(pixels, 2, 2, NEAR, FAR)
    for (let p = 0; p < 4; p++) {
      const i = p * 4
      expect(out[i]).toBe(out[i + 1])
      expect(out[i + 1]).toBe(out[i + 2])
      expect(out[i + 3]).toBe(255)
    }
  })

  it("menerima Uint8Array (dinormalisasi /255) — hasil setara Float32Array yang setara", () => {
    const asFloat = depthPixelsToGrayscale(new Float32Array([0, 1, 1, 0]), 2, 2, NEAR, FAR)
    const asByte = depthPixelsToGrayscale(new Uint8Array([0, 255, 255, 0]), 2, 2, NEAR, FAR)
    expect(Array.from(asByte)).toEqual(Array.from(asFloat))
  })

  it("ukuran output = width*height*4", () => {
    const pixels = new Float32Array(9).fill(0.5)
    const out = depthPixelsToGrayscale(pixels, 3, 3, NEAR, FAR)
    expect(out.length).toBe(3 * 3 * 4)
  })
})

describe("renderParamsHash", () => {
  const base: RenderParamsInput = {
    layoutRevision: "rev-1",
    view: "iso",
    lighting: "siang",
    preset: "tropis-siang",
    seed: 42,
    mode: "cepat",
  }

  it("deterministik: input sama → hash byte-identik lintas panggilan", () => {
    expect(renderParamsHash(base)).toBe(renderParamsHash({ ...base }))
  })

  it("format hex 8-karakter stabil", () => {
    expect(renderParamsHash(base)).toMatch(/^[0-9a-f]{8}$/)
  })

  it("perubahan pada field mana pun mengubah hash", () => {
    const h0 = renderParamsHash(base)
    expect(renderParamsHash({ ...base, seed: 43 })).not.toBe(h0)
    expect(renderParamsHash({ ...base, view: "front" })).not.toBe(h0)
    expect(renderParamsHash({ ...base, lighting: "senja" })).not.toBe(h0)
    expect(renderParamsHash({ ...base, preset: "malam" })).not.toBe(h0)
    expect(renderParamsHash({ ...base, mode: "presisi" })).not.toBe(h0)
    expect(renderParamsHash({ ...base, layoutRevision: "rev-2" })).not.toBe(h0)
  })

  it("layoutRevision numerik vs string yang berbeda representasi tetap konsisten dgn String()", () => {
    expect(renderParamsHash({ ...base, layoutRevision: 7 })).toBe(
      renderParamsHash({ ...base, layoutRevision: "7" })
    )
  })
})

describe("poseKey", () => {
  it("poseKey mengkuantisasi 0.1 m/0.5° — jitter kecil tidak mengubah kunci", () => {
    const a = poseKey({ position: [1.234, 5.678, -3.21], target: [0, 1.5, 0], fov: 50 })
    const b = poseKey({ position: [1.26, 5.66, -3.24], target: [0.04, 1.5, 0], fov: 50.2 })
    expect(a).toBe(b)
    const c = poseKey({ position: [2.4, 5.7, -3.2], target: [0, 1.5, 0], fov: 50 })
    expect(a).not.toBe(c)
  })
})
