// @vitest-environment node
/**
 * Unit test postprocess.ts (Fase 6 — watermark & WebP). sharp diimpor lazy
 * di dalam fungsi yang diuji, jadi test ini butuh binary sharp asli
 * ter-install (@img/sharp-<platform>) — bila tak tersedia di lingkungan
 * (mis. runner CI tanpa prebuilt utk arch tsb), skip anggun daripada gagal
 * merah utk alasan infra, bukan bug kode.
 */
import { describe, it, expect, beforeAll } from "vitest"

let sharpAvailable = true
let sharpMod: typeof import("sharp") | null = null

beforeAll(async () => {
  try {
    sharpMod = (await import("sharp")).default as unknown as typeof import("sharp")
  } catch {
    sharpAvailable = false
  }
})

async function makeTestPng(width: number, height: number): Promise<Uint8Array> {
  const sharp = sharpMod as unknown as (opts: unknown) => {
    png: () => { toBuffer: () => Promise<Buffer> }
  }
  const buf = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 100, g: 150, b: 200, alpha: 1 },
    },
  })
    .png()
    .toBuffer()
  return new Uint8Array(buf)
}

describe("postprocess", () => {
  it("applyWatermark: output decodes & dimensi tak berubah", async () => {
    if (!sharpAvailable) {
      console.warn("[postprocess.test] sharp binary tak tersedia — skip")
      return
    }
    const { applyWatermark } = await import("./postprocess")
    const src = await makeTestPng(200, 150)

    const out = await applyWatermark(src)
    expect(out.length).toBeGreaterThan(0)

    const sharp = (await import("sharp")).default
    const meta = await sharp(Buffer.from(out)).metadata()
    expect(meta.width).toBe(200)
    expect(meta.height).toBe(150)
    expect(meta.format).toBe("png")
  })

  it("toWebp: output ber-format webp, dimensi tak berubah", async () => {
    if (!sharpAvailable) {
      console.warn("[postprocess.test] sharp binary tak tersedia — skip")
      return
    }
    const { toWebp } = await import("./postprocess")
    const src = await makeTestPng(64, 48)

    const out = await toWebp(src, 80)
    expect(out.length).toBeGreaterThan(0)

    const sharp = (await import("sharp")).default
    const meta = await sharp(Buffer.from(out)).metadata()
    expect(meta.width).toBe(64)
    expect(meta.height).toBe(48)
    expect(meta.format).toBe("webp")
  })
})
