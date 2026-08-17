import Link from "next/link"

import { Logo } from "@/components/shared/logo"

/* Hallmark · macrostructure: Footer · Ft5 Statement · tone: editorial · anchor hue: teal-green (178) */

// Flattened link inventory — preserves every original destination.
// ("Template" merged into "Contoh output"; both pointed at /#contoh.)
const LINKS = [
  { label: "Fitur", href: "/#fitur" },
  { label: "Cara kerja", href: "/#cara-kerja" },
  { label: "Contoh output", href: "/#contoh" },
  { label: "Harga", href: "/#harga" },
  { label: "FAQ", href: "/#faq" },
  { label: "Masuk", href: "/login" },
  { label: "Daftar", href: "/register" },
]

export function MarketingFooter() {
  return (
    <footer className="border-t bg-muted/30">
      <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
        <div className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
          <div className="max-w-xl space-y-4">
            <Logo />
            <p className="font-serif-display text-2xl font-semibold leading-tight tracking-tight text-foreground sm:text-3xl">
              Konsep rumah terukur dari ide sederhana.
            </p>
            <p className="text-sm text-muted-foreground">
              Mudah untuk user awam, jujur soal batasannya.
            </p>
          </div>

          <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2">
            {LINKS.map((l) => (
              <Link
                key={l.label}
                href={l.href}
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>

      <div className="border-t">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>© 2026 Baruma. Semua hak cipta dilindungi.</p>
          <p>Output adalah draft awal untuk diskusi — bukan gambar kerja final.</p>
        </div>
      </div>
    </footer>
  )
}
