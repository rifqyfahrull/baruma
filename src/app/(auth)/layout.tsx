import Link from "next/link"
import { Check } from "lucide-react"

import { Logo } from "@/components/shared/logo"

const valueProps = [
  "Jawab pertanyaan sederhana, AI menyusun konsep rumahmu.",
  "Bandingkan beberapa alternatif denah dalam sekali jalan.",
  "Dapatkan estimasi biaya dan dokumen awal untuk kontraktor.",
]

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      {/* Brand panel (desktop) */}
      <aside className="relative hidden flex-col justify-between bg-primary p-10 text-primary-foreground lg:flex">
        <Link href="/" className="inline-flex w-fit">
          <Logo showText textClassName="text-primary-foreground" />
        </Link>

        <div className="space-y-8">
          <h1 className="max-w-md text-3xl font-semibold tracking-tight text-balance">
            Bikin konsep rumah terukur dari ide sederhana.
          </h1>
          <ul className="space-y-4">
            {valueProps.map((vp) => (
              <li key={vp} className="flex items-start gap-3">
                <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-primary-foreground/15">
                  <Check className="size-3.5" />
                </span>
                <span className="text-primary-foreground/90">{vp}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-sm text-primary-foreground/90">
          Mudah untuk awam, jujur soal batasannya.
        </p>
      </aside>

      {/* Form area */}
      <main className="flex flex-col items-center justify-center bg-background p-6 sm:p-10">
        <div className="mb-8 lg:hidden">
          <Link href="/" className="inline-flex">
            <Logo showText />
          </Link>
        </div>
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  )
}
