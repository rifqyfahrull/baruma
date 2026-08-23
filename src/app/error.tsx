"use client"

import * as React from "react"
import Link from "next/link"
import * as Sentry from "@sentry/nextjs"
import { Home, RotateCcw, TriangleAlert } from "lucide-react"

import { Button } from "@/components/ui/button"

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
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="grid size-14 place-items-center rounded-2xl bg-destructive/10 text-destructive">
        <TriangleAlert className="size-7" />
      </div>
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">Terjadi kesalahan</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Maaf, ada yang tidak beres. Data project kamu tetap aman. Coba muat
          ulang halaman ini.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={reset}>
          <RotateCcw /> Coba lagi
        </Button>
        <Button asChild variant="outline">
          <Link href="/app/dashboard">
            <Home /> Dashboard
          </Link>
        </Button>
      </div>
    </div>
  )
}
