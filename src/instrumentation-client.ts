/**
 * Instrumentasi sisi klien — Next menjalankan file ini setelah HTML dimuat,
 * sebelum hidrasi React (lihat node_modules/next/dist/docs/.../
 * instrumentation-client.md). Dipakai untuk inisialisasi Sentry browser.
 *
 * SEPENUHNYA no-op tanpa NEXT_PUBLIC_SENTRY_DSN — env var ini WAJIB prefix
 * NEXT_PUBLIC_ karena hanya itu yang di-inline Next ke bundle klien saat
 * build (server-only SENTRY_DSN tidak terlihat di browser).
 */
import * as Sentry from "@sentry/nextjs"

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim()

if (dsn && dsn.length > 0) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    // Minimal dengan sengaja: tanpa session replay (biaya bundle & privasi),
    // sampling performa rendah — error tracking adalah tujuan utama.
    tracesSampleRate: 0.05,
    integrations: [],
  })
}
