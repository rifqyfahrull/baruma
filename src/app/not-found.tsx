import Link from "next/link"
import { Home, LayoutDashboard } from "lucide-react"

import { Logo } from "@/components/shared/logo"
import { Button } from "@/components/ui/button"

export default function NotFound() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 px-6 text-center">
      <Logo />
      <div className="space-y-2">
        <p className="text-5xl font-semibold tracking-tight text-primary">404</p>
        <h1 className="text-xl font-semibold">Halaman tidak ditemukan</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Halaman yang kamu cari mungkin sudah dipindah atau tidak ada.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button asChild variant="outline">
          <Link href="/">
            <Home /> Beranda
          </Link>
        </Button>
        <Button asChild>
          <Link href="/app/dashboard">
            <LayoutDashboard /> Dashboard
          </Link>
        </Button>
      </div>
    </div>
  )
}
