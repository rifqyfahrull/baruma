import type { Metadata } from "next"

import { getPlans } from "@/lib/server/repo/plans"
import { PricingPlans } from "@/components/marketing/pricing-plans"

/* Hallmark · macrostructure: Asymmetric Pricing · tone: editorial · anchor hue: teal-green (178) */
export const metadata: Metadata = {
  title: "Harga",
  description:
    "Mulai gratis untuk eksplorasi konsep, upgrade ke Pro untuk export profesional.",
}

// Admin (T8) mengedit plans di DB kapan saja — ISR 5 menit (bukan
// force-dynamic) supaya request publik tidak selalu hit DB. Perubahan plan
// muncul dalam <=5 menit; tidak ada revalidatePath eksplisit di sini karena
// route admin plans belum bagian dari scope Gelombang 1.
export const revalidate = 300

export default async function PricingPage() {
  const plans = await getPlans(true)

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
      <header className="max-w-2xl">
        <h1 className="font-serif-display text-balance text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
          Pilih paket yang sesuai tahapmu
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Mulai gratis untuk eksplorasi konsep. Upgrade saat butuh export
          profesional dan kolaborasi.
        </p>
      </header>

      <PricingPlans plans={plans} />

      <p className="mt-10 max-w-2xl text-sm text-muted-foreground">
        Semua paket termasuk warning kesiapan & label batasan pada setiap
        output. Harga dapat berubah selama masa beta.
      </p>
    </div>
  )
}
