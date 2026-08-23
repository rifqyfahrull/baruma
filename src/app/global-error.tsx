"use client"

/**
 * Boundary error PALING LUAR — menggantikan seluruh root layout (termasuk
 * <html>/<body>) saat error terjadi DI DALAM root layout itu sendiri (bukan
 * di halaman biasa; itu ditangani src/app/error.tsx). Next hanya memakai
 * file ini untuk kasus langka tsb, jadi sengaja mandiri (tanpa Providers/
 * globals.css yang mungkin justru sumber errornya).
 */
import * as React from "react"
import * as Sentry from "@sentry/nextjs"

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  React.useEffect(() => {
    console.error(error)
    // No-op sepenuhnya tanpa NEXT_PUBLIC_SENTRY_DSN (lihat instrumentation-client.ts).
    Sentry.captureException(error)
  }, [error])

  return (
    <html lang="id">
      <body
        style={{
          display: "flex",
          minHeight: "100svh",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1rem",
          padding: "1.5rem",
          textAlign: "center",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <h1 style={{ fontSize: "1.25rem", fontWeight: 600 }}>
          Terjadi kesalahan fatal
        </h1>
        <p style={{ maxWidth: "24rem", fontSize: "0.875rem", color: "#666" }}>
          Maaf, aplikasi gagal dimuat. Data project kamu tetap aman. Coba muat
          ulang halaman ini.
        </p>
        <button
          onClick={reset}
          style={{
            borderRadius: "0.5rem",
            border: "1px solid #ccc",
            padding: "0.5rem 1rem",
            fontSize: "0.875rem",
            cursor: "pointer",
          }}
        >
          Coba lagi
        </button>
      </body>
    </html>
  )
}
