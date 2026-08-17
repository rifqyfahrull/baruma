"use client"

import * as React from "react"
import Link from "next/link"
import { useTheme } from "next-themes"
import {
  AlertTriangle,
  ArrowRight,
  Box,
  Calculator,
  Check,
  Eye,
  FileDown,
  FileText,
  Home,
  LayoutGrid,
  Menu,
  MessageSquare,
  Moon,
  Play,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Star,
  Sun,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react"

import type { TemplateSummary } from "@/types/templates"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import { LayoutThumbnail } from "@/components/shared/layout-thumbnail"
import { HOUSE_STYLES } from "@/lib/constants"

const navLinks = [
  { label: "Fitur", href: "#fitur" },
  { label: "Cara kerja", href: "#cara-kerja" },
  { label: "Contoh", href: "#contoh" },
  { label: "Harga", href: "#harga" },
  { label: "FAQ", href: "#faq" },
]

const problems = [
  {
    title: "Susah membayangkan",
    desc: "Ide rumah di kepala sulit dijelaskan ke kontraktor tanpa gambar yang konkret.",
  },
  {
    title: "Mahal di awal",
    desc: "Sewa arsitek untuk fase eksplorasi konsep terasa berat di tahap paling awal.",
  },
  {
    title: "Takut salah",
    desc: "Tanpa estimasi & denah, mudah salah anggaran dan salah ekspektasi pekerjaan.",
  },
]

const steps = [
  {
    n: "01",
    title: "Isi brief",
    desc: "Jawab pertanyaan sederhana soal ukuran tanah, gaya hidup, dan kebutuhan ruang.",
  },
  {
    n: "02",
    title: "Pilih alternatif",
    desc: "AI menyusun 3–5 opsi layout yang bisa langsung dibandingkan berdampingan.",
  },
  {
    n: "03",
    title: "Edit denah",
    desc: "Geser, ubah ukuran, dan tukar ruang langsung di editor 2D yang ringan.",
  },
  {
    n: "04",
    title: "Lihat 3D & RAB",
    desc: "Pahami bentuk rumah secara visual, lengkap dengan estimasi biaya awal.",
  },
  {
    n: "05",
    title: "Paket kontraktor",
    desc: "Export dokumen awal—DXF, IFC, PDF—untuk diskusi yang lebih jelas.",
  },
]

const features: Array<{
  icon: LucideIcon
  title: string
  desc: string
}> = [
  {
    icon: LayoutGrid,
    title: "Editor denah 2D",
    desc: "Geser, putar, dan atur ulang ruang dengan snap grid yang akurat dan terukur.",
  },
  {
    icon: Box,
    title: "Preview 3D",
    desc: "Lihat bentuk rumah secara isometrik, depan, atas, dan rooftop — instan.",
  },
  {
    icon: Calculator,
    title: "RAB otomatis",
    desc: "Estimasi biaya awal berdasarkan luas, material, dan tingkat finishing yang dipilih.",
  },
  {
    icon: FileDown,
    title: "Export profesional",
    desc: "DXF untuk CAD, IFC untuk BIM, dan contractor pack siap diskusi.",
  },
  {
    icon: Sparkles,
    title: "AI assistant",
    desc: "Minta perubahan dengan bahasa sehari-hari: “geser dapur ke utara”.",
  },
  {
    icon: ShieldAlert,
    title: "Warning jujur",
    desc: "Setiap output diberi label kesiapan: kapan aman, kapan perlu ditinjau ahli.",
  },
]

const examples = [
  {
    name: "Compact Courtyard Pool",
    score: 88,
    status: "Cek struktur",
    rooms: ["Plunge pool", "Family room", "Rooftop"],
    tag: "Modern Tropis",
  },
  {
    name: "Family Gathering Priority",
    score: 84,
    status: "Cek struktur",
    rooms: ["Open kitchen", "Living lounge", "Roof terrace"],
    tag: "Warm Wood",
  },
  {
    name: "Cost Efficient Vertical",
    score: 80,
    status: "Aman",
    rooms: ["Compact stair", "Shared bath", "Service yard"],
    tag: "Minimalis Putih",
  },
]

const outputs = [
  "Denah 2D",
  "Preview 3D",
  "RAB / BOQ",
  "DXF (CAD)",
  "IFC (BIM)",
  "Contractor Pack",
  "Material list",
  "Brief PDF",
]

const plans = [
  {
    name: "Free",
    price: "Rp 0",
    period: "selamanya",
    desc: "Untuk mencoba dan eksplorasi konsep awal.",
    features: [
      "1 project aktif",
      "3 alternatif AI / project",
      "Preview 3D dasar",
      "Export watermark",
    ],
    cta: "Mulai gratis",
    highlight: false,
  },
  {
    name: "Pro",
    price: "Rp 149rb",
    period: "/bulan",
    desc: "Untuk yang serius menyiapkan diskusi dengan kontraktor.",
    features: [
      "Unlimited project",
      "Unlimited alternatif",
      "Export DXF & IFC",
      "RAB lengkap",
      "Contractor pack",
    ],
    cta: "Pilih Pro",
    highlight: true,
  },
  {
    name: "Studio",
    price: "Rp 499rb",
    period: "/bulan",
    desc: "Untuk studio & kontraktor dengan banyak proyek.",
    features: [
      "Multi-user (sampai 5)",
      "Brand & template custom",
      "Priority AI compute",
      "Whitelabel export",
      "Support prioritas",
    ],
    cta: "Pilih Studio",
    highlight: false,
  },
]

const faqs = [
  {
    q: "Apakah hasilnya bisa langsung dibangun?",
    a: "Belum. Output Baruma adalah dokumen awal untuk diskusi. Untuk konstruksi, kamu tetap perlu review dari arsitek, structural engineer, atau MEP. Setiap output kami beri label kesiapan agar jujur soal batasannya.",
  },
  {
    q: "Saya bukan arsitek, apakah bisa pakai?",
    a: "Justru itu target utama kami. Brief dipandu pertanyaan sederhana, editor 2D pakai snap grid, dan AI assistant bisa diajak ngobrol pakai bahasa sehari-hari.",
  },
  {
    q: "Apa saja yang bisa di-export?",
    a: "Denah 2D (PDF/PNG), preview 3D, RAB/BOQ (Excel), DXF untuk CAD, IFC untuk BIM, dan contractor pack berisi brief + denah + RAB siap kirim.",
  },
  {
    q: "Apakah estimasi biayanya akurat?",
    a: "Estimasi berbasis luas, material, dan tingkat finishing dengan database harga regional. Akurasinya ada di kisaran ±15–20% untuk fase konsep — cukup untuk diskusi awal, bukan kontrak final.",
  },
  {
    q: "Bagaimana dengan keamanan data project saya?",
    a: "Setiap project di-enkripsi dan hanya bisa diakses dari akunmu. Kamu bisa export & hapus kapan saja. Kami tidak melatih AI dari data project pribadi tanpa persetujuan eksplisit.",
  },
]

export function LandingPage({
  templates = [],
}: {
  /** Real, curated templates (public gallery) — when present, the "Contoh"
   *  section shows these instead of the hardcoded placeholder cards below. */
  templates?: TemplateSummary[]
}) {
  const { resolvedTheme, setTheme } = useTheme()
  const mounted = React.useSyncExternalStore(
    React.useCallback(() => () => {}, []),
    () => true,
    () => false
  )

  const dark = mounted && resolvedTheme === "dark"

  return (
    <div className="landing-page min-h-screen bg-background text-[#1a1f1b] selection:bg-[#1f5f4a] selection:text-[#f7f3ec] dark:bg-background dark:text-[#f3efe7]">
      <Navbar dark={dark} onToggleTheme={() => setTheme(dark ? "light" : "dark")} />
      <Hero />
      <Problems />
      <HowItWorks />
      <Features />
      <Example templates={templates} />
      <Outputs />
      <Honest />
      <Pricing />
      <FAQ />
      <CTA />
      <Footer />
    </div>
  )
}

function Navbar({
  dark,
  onToggleTheme,
}: {
  dark: boolean
  onToggleTheme: () => void
}) {
  const [open, setOpen] = React.useState(false)

  return (
    <header className="sticky top-0 z-50 border-b border-[#e7e0d0] bg-[#f7f3ec]/80 backdrop-blur-md dark:border-[#1d2520] dark:bg-[#0f1411]/80">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 lg:px-8">
        <Link href="/" className="group flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#1f5f4a] text-[#f7f3ec] shadow-sm transition-transform duration-300 group-hover:rotate-6 dark:bg-[#3d8b6f]">
            <Home className="h-[18px] w-[18px]" strokeWidth={2.2} />
          </span>
          <span className="font-serif-display text-[22px] font-semibold tracking-tight">
            Baruma
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {navLinks.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className="rounded-md px-3.5 py-2 text-[14px] font-medium text-[#3a4a3f] transition-colors hover:bg-[#ece5d6] hover:text-[#1f5f4a] dark:text-[#cbd3c9] dark:hover:bg-[#1a2420] dark:hover:text-[#7dc4a6]"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label="Ganti tema"
            className="flex h-9 w-9 items-center justify-center rounded-full text-[#3a4a3f] transition-colors hover:bg-[#ece5d6] dark:text-[#cbd3c9] dark:hover:bg-[#1a2420]"
          >
            {dark ? (
              <Sun className="h-[18px] w-[18px]" />
            ) : (
              <Moon className="h-[18px] w-[18px]" />
            )}
          </button>
          <Link
            href="/login"
            className="hidden rounded-md px-3.5 py-2 text-[14px] font-medium text-[#3a4a3f] transition-colors hover:bg-[#ece5d6] hover:text-[#1f5f4a] sm:inline-flex dark:text-[#cbd3c9] dark:hover:bg-[#1a2420] dark:hover:text-[#7dc4a6]"
          >
            Masuk
          </Link>
          <Button
            asChild
            className="h-9 rounded-lg bg-[#1f5f4a] px-4 text-[13.5px] font-medium text-[#f7f3ec] shadow-sm hover:bg-[#174636] dark:bg-[#3d8b6f] dark:hover:bg-[#4ea282]"
          >
            <Link href="/register">Mulai gratis</Link>
          </Button>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-[#ece5d6] md:hidden dark:hover:bg-[#1a2420]"
            aria-label="Buka menu"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="flex flex-col gap-1 border-t border-[#e7e0d0] bg-[#f7f3ec] px-5 py-4 md:hidden dark:border-[#1d2520] dark:bg-[#0f1411]">
          {navLinks.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              onClick={() => setOpen(false)}
              className="rounded-md px-3 py-2.5 text-[15px] font-medium text-[#3a4a3f] hover:bg-[#ece5d6] dark:text-[#cbd3c9] dark:hover:bg-[#1a2420]"
            >
              {link.label}
            </Link>
          ))}
          <Link
            href="/login"
            onClick={() => setOpen(false)}
            className="rounded-md px-3 py-2.5 text-[15px] font-medium text-[#3a4a3f] hover:bg-[#ece5d6] dark:text-[#cbd3c9] dark:hover:bg-[#1a2420]"
          >
            Masuk
          </Link>
        </div>
      )}
    </header>
  )
}

function Hero() {
  return (
    <section className="relative overflow-hidden pt-12 pb-20 lg:pt-20 lg:pb-28">
      <div className="absolute -top-32 -left-20 h-[480px] w-[480px] rounded-full bg-[#dfeede] opacity-60 blur-3xl dark:bg-[#1a2a23]" />
      <div className="absolute top-40 -right-20 h-[420px] w-[420px] rounded-full bg-[#f1e6cf] opacity-60 blur-3xl dark:bg-[#1f2017]" />

      <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-5 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:px-8">
        <div className="fade-up">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#1f5f4a]/15 bg-[#1f5f4a]/8 px-3 py-1.5 text-[12.5px] font-medium text-[#1f5f4a] dark:border-[#3d8b6f]/25 dark:bg-[#3d8b6f]/15 dark:text-[#7dc4a6]">
            <Sparkles className="h-3.5 w-3.5" />
            AI workspace untuk desain rumah
          </div>

          <h1 className="font-serif-display mt-6 text-[44px] leading-[1.02] font-semibold tracking-tight sm:text-[56px] lg:text-[68px]">
            Bikin konsep rumah{" "}
            <span className="text-[#1f5f4a] italic dark:text-[#7dc4a6]">
              terukur
            </span>
            <br className="hidden sm:block" /> dari ide sederhana.
          </h1>

          <p className="mt-6 max-w-xl text-[17px] leading-[1.65] text-[#52605a] dark:text-[#b6beb6]">
            Dapatkan denah, 3D preview, RAB awal, dan paket diskusi kontraktor
            dalam satu workspace. Mudah dipakai meski kamu bukan arsitek.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button
              asChild
              className="group h-12 rounded-xl bg-[#1f5f4a] px-5 text-[15px] font-medium text-[#f7f3ec] shadow-md shadow-[#1f5f4a]/15 hover:bg-[#174636] dark:bg-[#3d8b6f] dark:hover:bg-[#4ea282]"
            >
              <Link href="/register">
                Mulai desain rumah
                <ArrowRight className="ml-1.5 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              className="h-12 rounded-xl border-[#d8d0bd] bg-white/60 px-5 text-[15px] font-medium hover:bg-white dark:border-[#2a342e] dark:bg-[#161c19] dark:hover:bg-[#1c2420]"
            >
              <Link href="#contoh">
                <Play className="mr-2 h-4 w-4 text-[#1f5f4a] dark:text-[#7dc4a6]" />
                Lihat contoh output
              </Link>
            </Button>
          </div>

          <p className="mt-5 text-[13px] text-[#52605a] dark:text-[#8e978c]">
            Gratis untuk mulai &middot; Tanpa kartu kredit &middot; Output jujur
            soal batasannya
          </p>

          <div className="mt-10 flex items-center gap-6 text-[12px] text-[#52605a] dark:text-[#8e978c]">
            <div className="-space-x-2 flex">
              {["#d8c79a", "#a5c3a7", "#c9a78a", "#9ab2c5"].map((color) => (
                <div
                  key={color}
                  className="h-7 w-7 rounded-full border-2 border-[#f7f3ec] dark:border-[#0f1411]"
                  style={{ background: color }}
                />
              ))}
            </div>
            <span>
              Dipakai oleh 1.200+ pemilik tanah, kontraktor & studio kecil.
            </span>
          </div>
        </div>

        <div className="fade-up relative [animation-delay:120ms]">
          <FloorPlanCard />
        </div>
      </div>
    </section>
  )
}

function FloorPlanCard() {
  return (
    <div className="relative">
      <div className="relative overflow-hidden rounded-2xl border border-[#e7e0d0] bg-white shadow-[0_30px_60px_-20px_rgba(31,95,74,0.18)] dark:border-[#22302a] dark:bg-[#141a17]">
        <div className="flex h-9 items-center gap-2 border-b border-[#e7e0d0] bg-[#faf6ee] px-4 dark:border-[#22302a] dark:bg-[#101714]">
          <span className="h-2.5 w-2.5 rounded-full bg-[#e7b3a6]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#e8d39a]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#a5c3a7]" />
          <span className="ml-3 text-[11.5px] font-medium text-[#52605a] dark:text-[#b6beb6]">
            Rumah 8×8 Modern Tropis · Sidoarjo
          </span>
        </div>

        <div className="floor-grid bg-[#f9f5ec] p-5 dark:bg-[#0e1411]">
          <div className="grid aspect-[3/4] grid-cols-3 gap-2">
            <div className="rounded-md border-2 border-[#9ab8a4] bg-[#eef5ea] dark:border-[#3a5b4a] dark:bg-[#1a2520]" />
            <div className="row-span-2 rounded-md border-2 border-dashed border-[#c7a672] bg-[#f4ead0] dark:border-[#6b5a36] dark:bg-[#251f10]" />
            <div className="rounded-md border-2 border-[#9ab8a4] bg-[#eef5ea] dark:border-[#3a5b4a] dark:bg-[#1a2520]" />
            <div className="rounded-md border-2 border-[#9ab8a4] bg-[#eef5ea] dark:border-[#3a5b4a] dark:bg-[#1a2520]" />
            <div className="rounded-md border-2 border-[#9ab8a4] bg-[#eef5ea] dark:border-[#3a5b4a] dark:bg-[#1a2520]" />
            <div className="rounded-md border-2 border-[#9ab8a4] bg-[#eef5ea] dark:border-[#3a5b4a] dark:bg-[#1a2520]" />
            <div className="rounded-md border-2 border-[#7d9cb9] bg-[#e5edf4] dark:border-[#3a5168] dark:bg-[#162028]" />
            <div className="rounded-md border-2 border-[#9ab8a4] bg-[#eef5ea] dark:border-[#3a5b4a] dark:bg-[#1a2520]" />
          </div>

          <div className="mt-4 flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#e9d49a]/60 bg-[#fbf1d9] px-2.5 py-1 text-[11px] font-medium text-[#705729] dark:bg-[#2a2310] dark:text-[#d5b770]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#c7a672]" />
              Perlu Review Engineer
            </span>
            <div className="flex items-center gap-2 text-[11.5px] text-[#52605a] dark:text-[#b6beb6]">
              <span>3 lantai · 168 m²</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-[#dff0e2] px-2 py-0.5 font-semibold text-[#1f5f4a] dark:bg-[#1a2a23] dark:text-[#7dc4a6]">
                <Sparkles className="h-3 w-3" />
                88
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="floaty absolute -bottom-6 -left-4 rounded-xl border border-[#e7e0d0] bg-white px-4 py-3 shadow-xl sm:-left-6 dark:border-[#22302a] dark:bg-[#141a17]">
        <p className="text-[10.5px] font-medium tracking-wider text-[#52605a] uppercase">
          Estimasi biaya
        </p>
        <p className="font-serif-display mt-0.5 text-[18px] font-semibold text-[#1a1f1b] dark:text-[#f3efe7]">
          Rp 1,25 M – Rp 1,52 M
        </p>
      </div>

      <div className="floaty absolute -top-4 right-6 flex items-center gap-1.5 rounded-full bg-[#1f5f4a] px-3.5 py-1.5 text-[11.5px] font-medium text-[#f7f3ec] shadow-lg [animation-delay:1.2s] dark:bg-[#3d8b6f]">
        <Sparkles className="h-3.5 w-3.5" />
        Auto-generated
      </div>
    </div>
  )
}

function Problems() {
  const icons = [Eye, Wallet, AlertTriangle]

  return (
    <section className="border-t border-[#ece5d6] py-20 lg:py-28 dark:border-[#1d2520]">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <div className="max-w-2xl">
          <p className="text-[12.5px] font-semibold tracking-[0.18em] text-[#1f5f4a] uppercase dark:text-[#7dc4a6]">
            Masalahnya
          </p>
          <h2 className="font-serif-display mt-3 text-[36px] leading-[1.05] font-semibold tracking-tight sm:text-[44px] lg:text-[52px]">
            Dari ide di kepala ke dokumen yang jelas.
          </h2>
          <p className="mt-4 text-[16px] leading-relaxed text-[#52605a] dark:text-[#b6beb6]">
            Sebelum bertemu kontraktor, kebanyakan orang macet di tiga hal yang
            sama. Baruma dibuat untuk menyelesaikan tepat tiga itu.
          </p>
        </div>

        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {problems.map((problem, index) => {
            const Icon = icons[index]

            return (
              <div
                key={problem.title}
                className="group relative rounded-2xl border border-[#ece5d6] bg-white p-7 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-[#1f5f4a]/40 hover:shadow-lg hover:shadow-[#1f5f4a]/5 dark:border-[#22302a] dark:bg-[#141a17] dark:hover:border-[#3d8b6f]/50"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#eef5ea] text-[#1f5f4a] transition-transform group-hover:scale-110 dark:bg-[#1a2a23] dark:text-[#7dc4a6]">
                  <Icon className="h-5 w-5" strokeWidth={2.1} />
                </div>
                <h3 className="font-serif-display mt-5 text-[22px] font-semibold tracking-tight">
                  {problem.title}
                </h3>
                <p className="mt-2.5 text-[14.5px] leading-[1.6] text-[#52605a] dark:text-[#b6beb6]">
                  {problem.desc}
                </p>
                <span
                  aria-hidden="true"
                  className="absolute top-6 right-6 text-[11px] font-semibold text-[#705729] dark:text-[#c7a672]/70"
                >
                  0{index + 1}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function HowItWorks() {
  return (
    <section
      id="cara-kerja"
      className="border-t border-[#ece5d6] bg-[#f1ecdf] py-20 lg:py-28 dark:border-[#1d2520] dark:bg-[#0c100e]"
    >
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <div className="max-w-3xl">
          <p className="text-[12.5px] font-semibold tracking-[0.18em] text-[#1f5f4a] uppercase dark:text-[#7dc4a6]">
            Cara kerja
          </p>
          <h2 className="font-serif-display mt-3 text-[36px] leading-[1.05] font-semibold tracking-tight sm:text-[44px] lg:text-[52px]">
            Lima langkah dari ide ke paket diskusi.
          </h2>
        </div>

        <div className="relative mt-14">
          <div className="absolute top-9 right-0 left-0 hidden h-px bg-gradient-to-r from-transparent via-[#1f5f4a]/30 to-transparent lg:block" />

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-5">
            {steps.map((step) => (
              <div key={step.n} className="relative">
                <div className="flex items-start gap-4 lg:flex-col lg:gap-3">
                  <div className="relative shrink-0">
                    <div className="font-serif-display flex h-[68px] w-[68px] items-center justify-center rounded-2xl border border-[#e7e0d0] bg-white text-[26px] font-semibold text-[#1f5f4a] shadow-sm dark:border-[#22302a] dark:bg-[#141a17] dark:text-[#7dc4a6]">
                      {step.n}
                    </div>
                  </div>
                  <div className="lg:mt-2">
                    <h3 className="font-serif-display text-[20px] font-semibold tracking-tight">
                      {step.title}
                    </h3>
                    <p className="mt-1.5 text-[14px] leading-[1.55] text-[#52605a] dark:text-[#b6beb6]">
                      {step.desc}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function Features() {
  return (
    <section
      id="fitur"
      className="border-t border-[#ece5d6] py-20 lg:py-28 dark:border-[#1d2520]"
    >
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <div className="flex max-w-5xl flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div>
            <p className="text-[12.5px] font-semibold tracking-[0.18em] text-[#1f5f4a] uppercase dark:text-[#7dc4a6]">
              Fitur
            </p>
            <h2 className="font-serif-display mt-3 text-[36px] leading-[1.05] font-semibold tracking-tight sm:text-[44px] lg:text-[52px]">
              Semua yang kamu butuhkan untuk konsep rumah.
            </h2>
          </div>
          <p className="max-w-md text-[15.5px] leading-relaxed text-[#52605a] dark:text-[#b6beb6]">
            Workspace yang fokus pada fase paling awal: dari brief, ide, sampai
            dokumen siap dibawa diskusi.
          </p>
        </div>

        <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-[#ece5d6] bg-[#ece5d6] sm:grid-cols-2 lg:grid-cols-3 dark:border-[#1d2520] dark:bg-[#1d2520]">
          {features.map((feature) => {
            const Icon = feature.icon

            return (
              <div
                key={feature.title}
                className="group bg-[#f7f3ec] p-7 transition-colors hover:bg-white dark:bg-[#0f1411] dark:hover:bg-[#141a17]"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#1f5f4a] text-[#f7f3ec] transition-transform group-hover:scale-105 group-hover:rotate-[-6deg] dark:bg-[#3d8b6f]">
                  <Icon className="h-[22px] w-[22px]" strokeWidth={2} />
                </div>
                <h3 className="font-serif-display mt-5 text-[22px] font-semibold tracking-tight">
                  {feature.title}
                </h3>
                <p className="mt-2 text-[14.5px] leading-[1.6] text-[#52605a] dark:text-[#b6beb6]">
                  {feature.desc}
                </p>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function PlanSketch({ accent }: { accent: string }) {
  return (
    <div className="floor-grid aspect-[4/3] rounded-xl border border-[#e7e0d0] bg-[#faf6ee] p-3 dark:border-[#22302a] dark:bg-[#0e1411]">
      <div className="grid h-full grid-cols-3 gap-1.5">
        <div
          className="rounded border-2 bg-white/60 dark:bg-[#161c19]"
          style={{ borderColor: accent }}
        />
        <div
          className="row-span-2 rounded border-2 border-dashed bg-[#f4ead0] dark:bg-[#251f10]"
          style={{ borderColor: "#c7a672" }}
        />
        <div
          className="rounded border-2 bg-white/60 dark:bg-[#161c19]"
          style={{ borderColor: accent }}
        />
        <div
          className="rounded border-2 bg-white/60 dark:bg-[#161c19]"
          style={{ borderColor: accent }}
        />
        <div
          className="rounded border-2 bg-white/60 dark:bg-[#161c19]"
          style={{ borderColor: accent }}
        />
        <div
          className="rounded border-2 bg-[#e5edf4] dark:bg-[#162028]"
          style={{ borderColor: "#7d9cb9" }}
        />
        <div
          className="rounded border-2 bg-white/60 dark:bg-[#161c19]"
          style={{ borderColor: accent }}
        />
      </div>
    </div>
  )
}

function Example({ templates }: { templates: TemplateSummary[] }) {
  const accents = ["#9ab8a4", "#c9a78a", "#a8b4c0"]
  const hasTemplates = templates.length > 0
  const shown = templates.slice(0, 6)

  return (
    <section
      id="contoh"
      className="border-t border-[#ece5d6] py-20 lg:py-28 dark:border-[#1d2520]"
    >
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <div className="grid items-start gap-10 lg:grid-cols-[1fr_1.4fr] lg:gap-16">
          <div className="lg:sticky lg:top-24">
            <p className="text-[12.5px] font-semibold tracking-[0.18em] text-[#1f5f4a] uppercase dark:text-[#7dc4a6]">
              Contoh nyata
            </p>
            <h2 className="font-serif-display mt-3 text-[34px] leading-[1.08] font-semibold tracking-tight sm:text-[40px] lg:text-[46px]">
              Rumah 8×8 m, 3 lantai + rooftop di Sidoarjo.
            </h2>
            <p className="mt-4 text-[15.5px] leading-relaxed text-[#52605a] dark:text-[#b6beb6]">
              Lahan sempit dengan banyak keinginan: plunge pool, area kumpul
              keluarga, dan rooftop lounge. Baruma menyusun beberapa alternatif
              yang bisa langsung dibandingkan.
            </p>

            <dl className="mt-7 grid grid-cols-3 gap-4">
              {[
                ["Tanah", "8 × 8 m"],
                ["Lantai", "3 + rooftop"],
                ["Prioritas", "Lega & terang"],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-xl border border-[#ece5d6] bg-white p-3.5 dark:border-[#22302a] dark:bg-[#141a17]"
                >
                  <dt className="text-[11px] font-medium tracking-wider text-[#52605a] uppercase">
                    {label}
                  </dt>
                  <dd className="font-serif-display mt-1 text-[16px] font-semibold">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>

            <div className="mt-8 flex flex-wrap gap-3">
              <Button
                asChild
                className="group h-11 rounded-xl bg-[#1f5f4a] px-5 text-[14.5px] font-medium text-[#f7f3ec] hover:bg-[#174636] dark:bg-[#3d8b6f] dark:hover:bg-[#4ea282]"
              >
                <Link href="/register">
                  Coba dengan rumahmu
                  <ArrowRight className="ml-1.5 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </Link>
              </Button>
              {hasTemplates && (
                <Button
                  asChild
                  variant="outline"
                  className="h-11 rounded-xl border-[#d8d0bd] bg-white/60 px-5 text-[14.5px] font-medium hover:bg-white dark:border-[#2a342e] dark:bg-[#161c19] dark:hover:bg-[#1c2420]"
                >
                  <Link href="/templates">Lihat Semua Template</Link>
                </Button>
              )}
            </div>
          </div>

          {hasTemplates ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {shown.map((t) => (
                <Link
                  key={t.id}
                  href={`/templates/${t.slug}`}
                  className="group block rounded-2xl border border-[#ece5d6] bg-white p-4 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-[#1f5f4a]/5 dark:border-[#22302a] dark:bg-[#141a17]"
                >
                  <LayoutThumbnail
                    variant={t.thumbnail}
                    label={`Denah ${t.name}`}
                    className="aspect-[4/3]"
                  />
                  <div className="mt-4 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      {t.style && (
                        <p className="text-[11px] font-medium tracking-wider text-[#52605a] uppercase dark:text-[#8e978c]">
                          {HOUSE_STYLES[t.style]}
                        </p>
                      )}
                      <h3 className="font-serif-display mt-0.5 truncate text-[20px] font-semibold tracking-tight group-hover:text-[#1f5f4a] dark:group-hover:text-[#7dc4a6]">
                        {t.name}
                      </h3>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5 text-[11.5px] text-[#52605a] dark:text-[#b6beb6]">
                    <span className="rounded-md border border-[#e7e0d0] bg-[#f1ecdf] px-2 py-0.5 dark:border-[#22302a] dark:bg-[#1a2420]">
                      {t.floors} lantai{t.rooftop ? " + rooftop" : ""}
                    </span>
                    {t.city && (
                      <span className="rounded-md border border-[#e7e0d0] bg-[#f1ecdf] px-2 py-0.5 dark:border-[#22302a] dark:bg-[#1a2420]">
                        {t.city}
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {examples.map((example, index) => (
                <div
                  key={example.name}
                  className={`rounded-2xl border border-[#ece5d6] bg-white p-4 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-[#1f5f4a]/5 dark:border-[#22302a] dark:bg-[#141a17] ${
                    index === 0 ? "sm:col-span-2" : ""
                  }`}
                >
                  <PlanSketch accent={accents[index]} />
                  <div className="mt-4 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-medium tracking-wider text-[#52605a] uppercase">
                        {example.tag}
                      </p>
                      <h3 className="font-serif-display mt-0.5 text-[20px] font-semibold tracking-tight">
                        {example.name}
                      </h3>
                    </div>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${
                        example.status === "Aman"
                          ? "bg-[#dff0e2] text-[#1f5f4a] dark:bg-[#1a2a23] dark:text-[#7dc4a6]"
                          : "bg-[#fbf1d9] text-[#705729] dark:bg-[#2a2310] dark:text-[#d5b770]"
                      }`}
                    >
                      <Sparkles className="h-3 w-3" />
                      {example.score} &middot; {example.status}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {example.rooms.map((room) => (
                      <span
                        key={room}
                        className="rounded-md border border-[#e7e0d0] bg-[#f1ecdf] px-2 py-0.5 text-[11.5px] text-[#52605a] dark:border-[#22302a] dark:bg-[#1a2420] dark:text-[#b6beb6]"
                      >
                        {room}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function Outputs() {
  const list = [...outputs, ...outputs]

  return (
    <section className="overflow-hidden border-t border-[#ece5d6] bg-[#1f5f4a] py-20 text-[#f7f3ec] lg:py-24 dark:border-[#1d2520] dark:bg-[#0c100e]">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <h2 className="font-serif-display max-w-3xl text-[32px] leading-[1.08] font-semibold tracking-tight sm:text-[40px] lg:text-[48px]">
          Satu brief, banyak output siap pakai.
        </h2>
        <p className="mt-4 max-w-xl text-[15.5px] leading-relaxed text-[#cfe3d6] dark:text-[#8e978c]">
          Setiap project menghasilkan dokumen yang relevan untuk tahap diskusi
          awal sampai handover ke tim teknis.
        </p>
      </div>

      <div className="relative mt-10">
        <div className="marquee-track flex w-max gap-3">
          {list.map((output, index) => (
            <span
              key={`${output}-${index}`}
              className="inline-flex items-center gap-2 rounded-full border border-[#f7f3ec]/15 bg-[#f7f3ec]/5 px-5 py-3 text-[14.5px] font-medium whitespace-nowrap backdrop-blur-sm"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-[#a5c3a7]" />
              {output}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}

function Honest() {
  const items: Array<{
    icon: LucideIcon
    title: string
    desc: string
  }> = [
    {
      icon: ShieldCheck,
      title: "Label kesiapan",
      desc: "Aman, perlu review struktur, atau perlu engineer — selalu jelas.",
    },
    {
      icon: MessageSquare,
      title: "Warning yang jujur",
      desc: "Setiap output diberi catatan asumsi & batas akurasinya.",
    },
    {
      icon: FileText,
      title: "Dokumen yang lengkap",
      desc: "Brief, denah, visual, dan RAB siap dibawa diskusi.",
    },
  ]

  return (
    <section className="border-t border-[#ece5d6] py-20 lg:py-28 dark:border-[#1d2520]">
      <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 lg:grid-cols-[1fr_1.2fr] lg:gap-20 lg:px-8">
        <div>
          <p className="text-[12.5px] font-semibold tracking-[0.18em] text-[#1f5f4a] uppercase dark:text-[#7dc4a6]">
            Filosofi
          </p>
          <h2 className="font-serif-display mt-3 text-[36px] leading-[1.05] font-semibold tracking-tight sm:text-[44px] lg:text-[50px]">
            Mudah untuk awam,{" "}
            <span className="text-[#1f5f4a] italic dark:text-[#7dc4a6]">
              jujur
            </span>{" "}
            soal batasannya.
          </h2>
          <p className="mt-5 text-[16px] leading-[1.7] text-[#52605a] dark:text-[#b6beb6]">
            Kami tidak membuatmu merasa desain ini &ldquo;pasti bisa langsung
            dibangun&rdquo;. Setiap output diberi label kesiapan dan warning
            yang jelas. Sekarang kamu punya brief, denah, visual, dan dokumen
            awal yang jauh lebih jelas untuk dibawa ke kontraktor, arsitek,
            atau engineer.
          </p>
        </div>

        <div className="grid gap-4">
          {items.map((item) => {
            const Icon = item.icon

            return (
              <div
                key={item.title}
                className="flex gap-4 rounded-2xl border border-[#ece5d6] bg-white p-5 transition-colors hover:border-[#1f5f4a]/40 dark:border-[#22302a] dark:bg-[#141a17]"
              >
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#eef5ea] text-[#1f5f4a] dark:bg-[#1a2a23] dark:text-[#7dc4a6]">
                  <Icon className="h-[22px] w-[22px]" strokeWidth={2.1} />
                </div>
                <div>
                  <h3 className="font-serif-display text-[20px] font-semibold tracking-tight">
                    {item.title}
                  </h3>
                  <p className="mt-1 text-[14.5px] leading-[1.6] text-[#52605a] dark:text-[#b6beb6]">
                    {item.desc}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function Pricing() {
  return (
    <section
      id="harga"
      className="border-t border-border bg-background py-20 lg:py-28 dark:border-border dark:bg-background"
    >
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <div className="max-w-2xl">
          <p className="text-[12.5px] font-semibold tracking-[0.18em] text-primary uppercase dark:text-primary">
            Harga
          </p>
          <h2 className="font-serif-display mt-3 text-[36px] leading-[1.05] font-semibold tracking-tight sm:text-[44px] lg:text-[52px]">
            Mulai gratis, upgrade saat siap.
          </h2>
          <p className="mt-4 text-[16px] leading-relaxed text-muted-foreground dark:text-muted-foreground">
            Tidak ada kartu kredit di awal. Bayar saat kamu benar-benar butuh
            fitur lanjutan.
          </p>
        </div>

        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`relative flex flex-col rounded-2xl p-7 ${
                plan.highlight
                  ? "bg-panel border-panel-border dark:bg-panel"
                  : "border border-border bg-card dark:border-border dark:bg-card"
              }`}
            >
              {plan.highlight && (
                <span className="absolute top-5 right-5 inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[11px] font-semibold tracking-wider text-primary-foreground uppercase dark:bg-primary dark:text-primary-foreground">
                  <Star className="h-3 w-3" />
                  Populer
                </span>
              )}
              <h3 className="font-serif-display text-[28px] font-semibold tracking-tight">
                {plan.name}
              </h3>
              <div className="mt-3 flex items-baseline gap-1.5">
                <span className="font-serif-display text-[40px] font-semibold tracking-tight">
                  {plan.price}
                </span>
                <span
                  className={`text-[14px] ${
                    plan.highlight
                      ? "text-muted-foreground dark:text-muted-foreground"
                      : "text-muted-foreground dark:text-muted-foreground"
                  }`}
                >
                  {plan.period}
                </span>
              </div>
              <p
                className={`mt-3 text-[14.5px] leading-relaxed ${
                  plan.highlight
                    ? "text-muted-foreground dark:text-muted-foreground"
                    : "text-muted-foreground dark:text-muted-foreground"
                }`}
              >
                {plan.desc}
              </p>

              <ul className="mt-6 flex-1 space-y-3">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5 text-[14px]">
                    <Check
                      className={`mt-0.5 h-4 w-4 shrink-0 ${
                        plan.highlight
                           ? "text-primary dark:text-primary"
                           : "text-primary dark:text-primary"
                      }`}
                      strokeWidth={2.5}
                    />
                    <span className={plan.highlight ? "" : ""}>
                      {feature}
                    </span>
                  </li>
                ))}
              </ul>

              <Button
                asChild
                className={`mt-7 h-11 rounded-xl text-[14.5px] font-medium ${
                  plan.highlight
                    ? "bg-primary text-primary-foreground hover:bg-primary/90 dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary/80"
                    : "bg-primary text-primary-foreground hover:bg-primary/90 dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary/80"
                }`}
              >
                <Link href="/register">{plan.cta}</Link>
              </Button>
            </div>
          ))}
        </div>

        <p className="mt-8 text-center text-[14px] text-muted-foreground dark:text-muted-foreground">
          <Link
            href="/pricing"
            className="underline underline-offset-4 hover:text-primary dark:hover:text-primary"
          >
            Lihat perbandingan lengkap →
          </Link>
        </p>
      </div>
    </section>
  )
}

function FAQ() {
  return (
    <section
      id="faq"
      className="border-t border-[#ece5d6] py-20 lg:py-28 dark:border-[#1d2520]"
    >
      <div className="mx-auto max-w-4xl px-5 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-[12.5px] font-semibold tracking-[0.18em] text-[#1f5f4a] uppercase dark:text-[#7dc4a6]">
            FAQ
          </p>
          <h2 className="font-serif-display mt-3 text-[36px] leading-[1.05] font-semibold tracking-tight sm:text-[44px] lg:text-[50px]">
            Pertanyaan yang sering ditanyakan.
          </h2>
        </div>

        <Accordion type="single" collapsible className="mt-12 space-y-3">
          {faqs.map((faq, index) => (
            <AccordionItem
              key={faq.q}
              value={`item-${index}`}
              className="rounded-2xl border border-[#ece5d6] bg-white px-5 data-[state=open]:border-[#1f5f4a]/40 dark:border-[#22302a] dark:bg-[#141a17]"
            >
              <AccordionTrigger className="font-serif-display py-5 text-left text-[18px] font-semibold tracking-tight hover:no-underline sm:text-[20px]">
                {faq.q}
              </AccordionTrigger>
              <AccordionContent className="pb-5 text-[15px] leading-[1.7] text-[#52605a] dark:text-[#b6beb6]">
                {faq.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  )
}

function CTA() {
  return (
    <section className="border-t border-[#ece5d6] py-20 lg:py-28 dark:border-[#1d2520]">
      <div className="mx-auto max-w-5xl px-5 lg:px-8">
        <div className="relative overflow-hidden rounded-3xl bg-[#1f5f4a] px-8 py-14 text-[#f7f3ec] sm:px-14 sm:py-20 dark:bg-[#1a3d30]">
          <div className="absolute -top-24 -right-20 h-80 w-80 rounded-full bg-[#3d8b6f]/30 blur-3xl" />
          <div className="absolute -bottom-32 -left-24 h-96 w-96 rounded-full bg-[#c7a672]/20 blur-3xl" />

          <div className="relative max-w-2xl">
            <h2 className="font-serif-display text-[36px] leading-[1.05] font-semibold tracking-tight sm:text-[46px] lg:text-[54px]">
              Mulai dari ukuran tanah dan kebutuhan rumahmu.
            </h2>
            <p className="mt-5 max-w-xl text-[16px] leading-[1.7] text-[#cfe3d6]">
              Dalam beberapa menit, kamu punya brief, denah, dan dokumen awal
              yang jauh lebih jelas untuk dibawa ke kontraktor.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button
                asChild
                className="group h-12 rounded-xl bg-[#f7f3ec] px-5 text-[15px] font-medium text-[#1f5f4a] hover:bg-white"
              >
                <Link href="/register">
                  Buat project pertama
                  <ArrowRight className="ml-1.5 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                className="h-12 rounded-xl border-[#f7f3ec]/30 bg-transparent px-5 text-[15px] font-medium text-[#f7f3ec] hover:bg-[#f7f3ec]/10 hover:text-[#f7f3ec]"
              >
                <Link href="#contoh">Lihat contoh output</Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function Footer() {
  const columns = [
    {
      title: "Produk",
      links: ["Fitur", "Cara kerja", "Contoh", "Harga", "Roadmap"],
    },
    {
      title: "Sumber daya",
      links: ["Dokumentasi", "Panduan brief", "Glossary RAB", "Blog", "Changelog"],
    },
    {
      title: "Perusahaan",
      links: ["Tentang", "Kontak", "Karir", "Press kit"],
    },
    {
      title: "Legal",
      links: ["Syarat", "Privasi", "Lisensi", "Keamanan"],
    },
  ]

  return (
    <footer className="border-t border-[#ece5d6] bg-[#f1ecdf] dark:border-[#1d2520] dark:bg-[#0c100e]">
      <div className="mx-auto max-w-7xl px-5 py-16 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_repeat(4,1fr)] lg:gap-8">
          <div>
            <Link href="/" className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#1f5f4a] text-[#f7f3ec] dark:bg-[#3d8b6f]">
                <Home className="h-[18px] w-[18px]" strokeWidth={2.2} />
              </span>
              <span className="font-serif-display text-[22px] font-semibold tracking-tight">
                Baruma
              </span>
            </Link>
            <p className="mt-4 max-w-xs text-[14px] leading-[1.6] text-[#52605a] dark:text-[#b6beb6]">
              AI workspace untuk konsep rumah — dari brief sederhana ke dokumen
              siap diskusi.
            </p>
            <p className="mt-6 text-[12px] text-[#52605a]">
              Made in Indonesia &middot; 2026
            </p>
          </div>

          {columns.map((column) => (
            <div key={column.title}>
              <h4 className="text-[12.5px] font-semibold tracking-[0.16em] text-[#1f5f4a] uppercase dark:text-[#7dc4a6]">
                {column.title}
              </h4>
              <ul className="mt-4 space-y-2.5">
                {column.links.map((label) => (
                  <li key={label}>
                    <Link
                      href="#"
                      className="text-[14px] text-[#52605a] transition-colors hover:text-[#1f5f4a] dark:text-[#b6beb6] dark:hover:text-[#7dc4a6]"
                    >
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-14 flex flex-col items-start justify-between gap-3 border-t border-[#e7e0d0] pt-6 sm:flex-row sm:items-center dark:border-[#1d2520]">
          <p className="text-[12.5px] text-[#52605a]">
            © 2026 Baruma. Semua hak dilindungi.
          </p>
          <p className="text-[12px] text-[#52605a]">
            Output bersifat konsep awal — bukan pengganti review tenaga ahli.
          </p>
        </div>
      </div>
    </footer>
  )
}
