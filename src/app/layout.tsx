import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"

import "./globals.css"
import { Providers } from "@/components/providers"
import { UmamiScript } from "@/components/analytics/umami-script"

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://baruma.tampil.dev"
const DEFAULT_TITLE = "Baruma — Bikin konsep rumah terukur dari ide sederhana"
const DEFAULT_DESCRIPTION =
  "Dapatkan denah, 3D preview, RAB awal, dan paket diskusi kontraktor dalam satu workspace. Mudah untuk user awam, jujur soal batasannya."

export const metadata: Metadata = {
  // Tanpa ini, OG image/URL relatif ("/opengraph-image.png") tak bisa
  // di-resolve jadi absolute URL — WhatsApp/Telegram/dll butuh URL absolut,
  // hasilnya link share render BLANK tanpa preview sama sekali (WS-D §3).
  metadataBase: new URL(APP_URL),
  title: {
    default: DEFAULT_TITLE,
    template: "%s · Baruma",
  },
  description: DEFAULT_DESCRIPTION,
  openGraph: {
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    siteName: "Baruma",
    locale: "id_ID",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="id"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-background text-foreground">
        <Providers>{children}</Providers>
        <UmamiScript />
      </body>
    </html>
  )
}
