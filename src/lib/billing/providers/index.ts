/**
 * Billing-provider registry. Baruma is a child app: it never integrates with
 * Mayar directly — all payments go through the tampil.dev parent, which owns
 * the shared Mayar merchant account (Baruma → tampil.dev → Mayar). So the one
 * and only provider is `parentBillingProvider`. See
 * docs/superpowers/specs/2026-08-22-parent-billing-orchestration-design.md.
 */
import { parentBillingProvider } from "@/lib/billing/providers/parent"
import type { BillingProvider } from "@/lib/billing/providers/types"

export function getBillingProvider(): BillingProvider {
  return parentBillingProvider
}
