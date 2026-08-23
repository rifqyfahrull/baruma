"use client"

import Script from "next/script"

/**
 * Backend analytics — Umami (WS-E §1). Dipilih di antara Umami/PostHog:
 * script ringan (~2KB), tanpa cookie sehingga tanpa consent-banner, dan
 * tier cloud self-serve gratis (cloud.umami.is) cukup untuk skala G1.
 *
 * SEPENUHNYA no-op tanpa `NEXT_PUBLIC_UMAMI_SRC`/`NEXT_PUBLIC_UMAMI_WEBSITE_ID`
 * — keduanya WAJIB prefix NEXT_PUBLIC_ karena dibaca di browser (Next hanya
 * meng-inline env berprefix itu ke bundle klien saat build). Kosong = render
 * null, tidak ada request keluar sama sekali.
 *
 * `strategy="afterInteractive"`: analytics bukan skrip kritis-render, boleh
 * menunggu hidrasi selesai (lihat node_modules/next/dist/docs/.../script.md).
 * `track()` (src/lib/analytics/index.ts) memanggil `window.umami.track(...)`
 * begitu skrip ini siap — dataLayer push tetap jalan sebagai fallback selama
 * skrip belum/gagal dimuat.
 */
export function UmamiScript() {
  const src = process.env.NEXT_PUBLIC_UMAMI_SRC?.trim()
  const websiteId = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID?.trim()

  if (!src || !websiteId) return null

  return (
    <Script
      defer
      src={src}
      data-website-id={websiteId}
      strategy="afterInteractive"
    />
  )
}
