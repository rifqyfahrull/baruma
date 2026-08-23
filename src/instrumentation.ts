/**
 * Boot hook — Next.js menjalankan `register()` SEKALI sebelum server siap
 * menerima request (Node & Edge runtime; lihat
 * node_modules/next/dist/docs/.../file-conventions/instrumentation.md).
 * Dua tanggung jawab di sini:
 *
 *  1. Validasi env produksi (env-check.ts) — crash keras sebelum server mulai
 *     menerima traffic bila DATABASE_URL/BARUMA_JWT_SECRET/AUTH_SECRET kosong
 *     atau NEXT_PUBLIC_DATA_SOURCE="mock" di produksi.
 *  2. Inisialisasi Sentry server/edge — SEPENUHNYA no-op tanpa SENTRY_DSN
 *     (guard eksplisit di bawah, bukan mengandalkan default SDK), jadi dev
 *     lokal & CI tanpa akun Sentry tetap jalan normal.
 */
import * as Sentry from "@sentry/nextjs"
import { assertProductionEnv } from "@/lib/server/env-check"

function sentryDsn(): string | undefined {
  const dsn = process.env.SENTRY_DSN?.trim()
  return dsn && dsn.length > 0 ? dsn : undefined
}

export function register() {
  assertProductionEnv()

  const dsn = sentryDsn()
  if (!dsn) return // No-op sepenuhnya tanpa DSN — tidak ada network call, tidak ada overhead.

  if (process.env.NEXT_RUNTIME === "nodejs") {
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV,
      // Bundle/overhead minimal dengan sengaja: tanpa session replay (hanya
      // relevan di browser), sampling performa rendah — error tracking
      // adalah tujuan utama, bukan APM penuh.
      tracesSampleRate: 0.05,
      integrations: [],
    })
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV,
      tracesSampleRate: 0.05,
      integrations: [],
    })
  }
}

// Aman dipanggil tanpa DSN — Sentry.captureRequestError adalah no-op saat
// belum ada client terdaftar (init tidak pernah jalan di atas).
export const onRequestError = Sentry.captureRequestError
