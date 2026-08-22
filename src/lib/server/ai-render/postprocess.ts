/**
 * Pasca-proses gambar AI Render (Fase 6 — docs/plan-integrasi-ai-renderer-2026-08.md
 * §Fase 6): watermark server-side untuk user free + konversi ke WebP.
 *
 * `sharp` diimpor LAZY (dynamic `await import`) di dalam tiap fungsi, bukan
 * di top-level module — ini satu-satunya dependensi native repo (binary
 * prebuilt per-platform via `@img/sharp-*`), jadi modul lain yang mengimpor
 * file ini (mis. lewat index barrel) tidak ikut menyeret native binding ke
 * bundle klien / lingkungan test tanpa binary yang cocok. Bila binary tak
 * tersedia, `import("sharp")` melempar — caller (finalize.ts) menangkapnya
 * sebagai kegagalan job biasa (-> failed + refund), bukan crash proses.
 *
 * Watermark WAJIB server-side (bukan overlay CSS/canvas di klien) — pelajaran
 * dari export-card.tsx yang mengakui gate client-side "bypassable" via
 * devtools; untuk fitur berbayar ini (unlock watermark-free = plan Pro/
 * Studio) itu tidak boleh terulang.
 */

/** Domain riil produk — dipakai di teks watermark. Fallback ke label polos
 *  bila NEXT_PUBLIC_APP_URL belum diset (dev lokal tanpa .env). */
function watermarkText(): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!appUrl) return "dibuat dengan Baruma"
  const host = appUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")
  return `dibuat dengan Baruma — ${host}`
}

/**
 * Composite watermark teks semi-transparan di sudut kanan-bawah, ukuran
 * relatif terhadap lebar gambar (supaya tetap proporsional di berbagai
 * resolusi output provider). Diimplementasikan sebagai overlay SVG
 * (bukan font raster) — sharp merender SVG via librsvg yang sudah jadi
 * bagian binary prebuilt-nya, tanpa dependensi font tambahan.
 */
export async function applyWatermark(png: Uint8Array): Promise<Uint8Array> {
  const sharp = (await import("sharp")).default
  const image = sharp(Buffer.from(png))
  const meta = await image.metadata()
  const width = meta.width ?? 1024
  const height = meta.height ?? 1024

  // Skala teks ~2.2% lebar gambar — cukup terbaca tanpa mendominasi foto.
  const fontSize = Math.max(12, Math.round(width * 0.022))
  const label = escapeXml(watermarkText())
  const paddingX = Math.round(fontSize * 0.8)
  const paddingY = Math.round(fontSize * 1.4)
  // Perkiraan lebar teks (monospace-ish) supaya kotak latar cukup lebar —
  // sharp/librsvg tidak punya text-measurement API murah di sini.
  const approxTextWidth = Math.round(label.length * fontSize * 0.56)
  const boxWidth = approxTextWidth + paddingX * 2
  const boxHeight = Math.round(fontSize * 2.2)

  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect
        x="${Math.max(0, width - boxWidth)}"
        y="${Math.max(0, height - boxHeight)}"
        width="${boxWidth}" height="${boxHeight}"
        fill="black" fill-opacity="0.38" />
      <text
        x="${width - paddingX}" y="${height - paddingY / 2}"
        text-anchor="end" dominant-baseline="text-after-edge"
        font-family="sans-serif" font-size="${fontSize}"
        fill="white" fill-opacity="0.92">${label}</text>
    </svg>`

  const out = await image
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer()
  return new Uint8Array(out)
}

/** Konversi ke WebP (hemat storage & bandwidth tablet — target device). */
export async function toWebp(bytes: Uint8Array, quality = 85): Promise<Uint8Array> {
  const sharp = (await import("sharp")).default
  const out = await sharp(Buffer.from(bytes)).webp({ quality }).toBuffer()
  return new Uint8Array(out)
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}
