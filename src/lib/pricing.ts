import type { PlanRow } from "@/types"

/**
 * Pricing display helpers.
 *
 * Plan CONTENT (name/tagline/features/limits/entitlements) is DB-driven — see
 * `src/lib/server/repo/plans.ts` (DB-backed) and `plan-defaults.ts` (in-memory
 * seed, mirrored by `db/migrations/0007_billing_admin.sql`). This module only
 * formats plan numbers for display; it no longer owns a hardcoded plan list
 * (that was `PRICING_PLANS`, removed once landing/billing moved to `GET
 * /api/v1/plans` + the repo — see plans.test.ts for the content-parity lock).
 */

/**
 * Format a plan price (IDR) for display.
 *   0            → "Gratis"
 *   < 1,000,000  → "Rp {ribuan}rb"  (e.g. 149000 → "Rp 149rb")
 *   ≥ 1,000,000  → "Rp {juta}jt"    (one decimal, trimmed when whole —
 *                                    1_500_000 → "Rp 1.5jt", 2_000_000 → "Rp 2jt")
 */
export function formatPlanPrice(priceIdr: number): string {
  if (priceIdr <= 0) return "Gratis"
  if (priceIdr >= 1_000_000) {
    const jt = Math.round((priceIdr / 1_000_000) * 10) / 10
    return `Rp ${Number.isInteger(jt) ? jt : jt.toFixed(1)}jt`
  }
  return `Rp ${Math.round(priceIdr / 1000)}rb`
}

/**
 * Format the billing period shown next to a plan's price. Free plans always
 * read "selamanya" regardless of the stored billing cycle; paid plans read
 * "/bulan" or "/tahun".
 */
export function formatPlanPeriod(
  plan: Pick<PlanRow, "priceIdr" | "period">
): string {
  if (plan.priceIdr <= 0) return "selamanya"
  return plan.period === "year" ? "/tahun" : "/bulan"
}

/** CTA button copy for a plan card — "Mulai gratis" for free, "Pilih {Name}" otherwise. */
export function planCtaLabel(plan: Pick<PlanRow, "priceIdr" | "name">): string {
  return plan.priceIdr <= 0 ? "Mulai gratis" : `Pilih ${plan.name}`
}
