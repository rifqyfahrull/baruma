/**
 * Helper MURNI untuk capture pass AI renderer (Fase 2 — lihat
 * `docs/plan-integrasi-ai-renderer-2026-08.md`). Tanpa import three.js atau
 * akses DOM di level modul — supaya bisa diunit-test tanpa jsdom/WebGL, dan
 * tetap keluar dari initial bundle (orkestrasi WebGL hidup di
 * `ScreenshotBridge`, house-scene.tsx, yang mengimpor modul ini).
 *
 * Alur precision depth (didokumentasikan di sini karena helper unpack ada di
 * modul ini, dipakai oleh ScreenshotBridge):
 * - MeshDepthMaterial default (`BasicDepthPacking`) menulis `1 - fragCoordZ`
 *   ke SATU channel 8-bit → cuma 256 level di seluruh rentang near..far.
 *   Dengan far=300 dan rumah ~15 m dalam, itu banding parah (FLUX Depth
 *   sangat sensitif ke gradien halus).
 * - `RGBADepthPacking` (three.js `packDepthToRGBA`, lihat
 *   `node_modules/three/src/renderers/shaders/ShaderChunk/packing.glsl.js`)
 *   menyebar depth float ke 4 channel RGBA 8-bit → presisi efektif ~24 bit,
 *   dan tetap bisa dibaca lewat `readRenderTargetPixels` di target
 *   `UnsignedByteType` biasa (tanpa perlu depthTexture + fullscreen unpack
 *   pass, opsi yang lebih rumit). Ini pilihan yang dipakai — lihat
 *   `unpackRGBADepth` di bawah, cermin persis rumus `unpackRGBAToDepth` GLSL.
 */

/** Kunci hash parameter render — dipetakan ke kolom `params_hash`. */
export type RenderParamsInput = {
  layoutRevision: string | number
  view: string
  lighting: string
  preset: string
  seed: number
  mode: string
}

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0
  return Math.min(1, Math.max(0, v))
}

/**
 * Balikkan depth window-space non-linear (gl_FragCoord.z, [0,1], hasil
 * proyeksi perspektif — makin rapat ke kamera makin padat presisinya) ke
 * depth linear ruang-pandang, lalu normalisasi ke [0,1] atas rentang
 * [near,far] (0 = di near plane, 1 = di far plane).
 *
 * Rumus baku (lihat mis. learnopengl.com/Advanced-OpenGL/Depth-testing):
 *   z_ndc  = 2*d - 1
 *   z_view = (2 * near * far) / (far + near - z_ndc * (far - near))
 * `z_view` sudah berada di [near, far] (jarak linear dari kamera), tinggal
 * dinormalisasi.
 */
export function linearizeDepth(rawDepth: number, near: number, far: number): number {
  const d = clamp01(rawDepth)
  const zNdc = d * 2 - 1
  const zView = (2 * near * far) / (far + near - zNdc * (far - near))
  if (far === near) return 0
  return clamp01((zView - near) / (far - near))
}

/**
 * Inversi gaya MiDaS: dekat = terang (1), jauh = gelap (0) — kebalikan dari
 * konvensi depth-buffer baku (yang dipakai `linearizeDepth`). Ini ekspektasi
 * FLUX.1 Depth ControlNet (dilatih di atas peta depth MiDaS).
 */
export function invertDepthMidas(linear: number): number {
  return clamp01(1 - clamp01(linear))
}

/**
 * Unpack nilai depth float [0,1] yang dipak ke 4 channel RGBA 8-bit oleh
 * shader `packDepthToRGBA` three.js (MeshDepthMaterial dgn
 * `depthPacking: THREE.RGBADepthPacking`). Cermin ALGEBRA persis dari
 * `unpackRGBAToDepth` GLSL:
 *
 *   UnpackFactors4 = ( (255/256)/1, (255/256)/256, (255/256)/65536, 1/16777216 )
 *   depth = dot(rgba_normalized, UnpackFactors4)
 *
 * `r,g,b,a` adalah byte mentah 0..255 (persis keluaran `readRenderTargetPixels`
 * pada target `UnsignedByteType`), bukan float 0..1 — pembagian /255 per
 * channel sudah dilakukan di dalam fungsi ini.
 */
export function unpackRGBADepth(r: number, g: number, b: number, a: number): number {
  const rf = r / 255
  const gf = g / 255
  const bf = b / 255
  const af = a / 255
  const unpackDownscale = 255 / 256
  return (
    rf * unpackDownscale +
    (gf * unpackDownscale) / 256 +
    (bf * unpackDownscale) / 65536 +
    af / 16777216
  )
}

/**
 * Konversi buffer depth mentah (satu sampel per pixel, hasil
 * `unpackRGBADepth` atau readback single-channel) menjadi grayscale RGBA
 * (A=255 tetap) siap `putImageData` → PNG. Menerapkan `linearizeDepth` +
 * `invertDepthMidas` per pixel, DAN membalik urutan baris secara vertikal:
 * `readRenderTargetPixels`/WebGL mengembalikan baris dari BAWAH ke ATAS,
 * sedangkan kanvas 2D/PNG mengharapkan ATAS ke BAWAH.
 *
 * `pixels` boleh `Uint8Array` (byte 0..255, dinormalisasi /255 di sini) atau
 * `Float32Array` (sudah dianggap berada di [0,1]) — dua bentuk ini menutup
 * baik jalur "unpack RGBA lalu simpan Float32Array sementara" maupun jalur
 * single-channel sederhana.
 */
export function depthPixelsToGrayscale(
  pixels: Float32Array | Uint8Array,
  width: number,
  height: number,
  near: number,
  far: number
): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(width * height * 4)
  const isByteBuffer = pixels instanceof Uint8Array
  for (let y = 0; y < height; y++) {
    // Baris sumber (GL, bawah→atas) untuk baris tujuan y (kanvas, atas→bawah).
    const srcY = height - 1 - y
    for (let x = 0; x < width; x++) {
      const srcIdx = srcY * width + x
      const raw = pixels[srcIdx] ?? 0
      const rawNormalized = isByteBuffer ? raw / 255 : raw
      const linear = linearizeDepth(rawNormalized, near, far)
      const inverted = invertDepthMidas(linear)
      const gray = Math.round(inverted * 255)
      const dstIdx = (y * width + x) * 4
      out[dstIdx] = gray
      out[dstIdx + 1] = gray
      out[dstIdx + 2] = gray
      out[dstIdx + 3] = 255
    }
  }
  return out
}

/**
 * Hash FNV-1a 32-bit stabil atas parameter render — famili algoritma sama
 * dengan `stableRolloutBucket` (`src/lib/features.ts`). Dipakai sebagai
 * `params_hash` untuk cache lookup (`findCachedRender`, Fase 5a): render
 * dgn parameter identik → hit cache, tanpa potong kredit lagi. Deterministik
 * lintas proses/deploy — TIDAK boleh memakai `Math.random`/waktu.
 */
export function renderParamsHash(input: RenderParamsInput): string {
  const key = [
    String(input.layoutRevision),
    input.view,
    input.lighting,
    input.preset,
    String(input.seed),
    input.mode,
  ].join(":")
  let hash = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}
