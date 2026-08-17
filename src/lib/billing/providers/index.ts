/**
 * Billing-provider registry — Baruma only ever wires one provider at a time
 * (no per-request provider selection needed).
 */
import { stripeBillingProvider } from "@/lib/billing/providers/stripe"
import type { BillingProvider } from "@/lib/billing/providers/types"

export function getBillingProvider(): BillingProvider {
  return stripeBillingProvider
}
