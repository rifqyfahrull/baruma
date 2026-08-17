/**
 * Billing-provider abstraction. The wire contract (request/response shapes,
 * webhook event shape) is provider-agnostic — `src/lib/billing/providers/stripe.ts`
 * is the current implementation (branch `emergent`: Stripe Checkout replaces
 * the Mayar invoice flow the rest of the codebase used before).
 *
 * `BillingPlan` is a bare `string`, not a fixed compile-time union — Baruma
 * plan ids are arbitrary rows in the DB-driven `plans` table (see
 * src/lib/server/repo/plans.ts).
 */

export type BillingProviderName = "stripe"
export type BillingPlan = string
export type PaymentOutcome =
  | "paid"
  | "failed"
  | "expired"
  | "cancelled"
  | "ignored"

export interface CreateCheckoutInput {
  userId: string
  email?: string
  fullName?: string
  plan: BillingPlan
  /** Caller-provided phone number (e.g. profile.phone). Not required by
   *  Stripe Checkout but kept for provider-input parity / future providers. */
  mobile?: string
}

export interface CreateCheckoutResult {
  provider: BillingProviderName
  providerOrderId: string
  amountIdr: number
  checkoutToken?: string
  checkoutUrl?: string
}

export interface NormalizedWebhookEvent {
  provider: BillingProviderName
  providerOrderId: string
  providerTransactionId?: string
  amountIdr?: number
  transactionStatusRaw: string
  outcome: PaymentOutcome
}

export interface ParsedWebhookResult {
  isValid: boolean
  errorMessage?: string
  event?: NormalizedWebhookEvent
}

export interface ParseWebhookInput {
  payload: unknown
  headers?: Headers
  /** Raw request body string — Stripe's signature verification
   *  (`stripe.webhooks.constructEvent`) hashes the exact bytes sent, so the
   *  already-JSON.parsed `payload` above isn't enough on its own. */
  rawBody?: string
}

export interface BillingProvider {
  readonly name: BillingProviderName
  createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult>
  parseWebhook(input: ParseWebhookInput): ParsedWebhookResult
}
