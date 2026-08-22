/**
 * Billing-provider abstraction.
 *
 * Baruma is a CHILD of the tampil.dev parent app. It does NOT talk to Mayar
 * directly — the parent owns the single shared Mayar merchant account and acts
 * as the financial/subscription manager for every VibeCoding.ID child. The
 * money path is therefore:
 *
 *     Baruma  →  tampil.dev (parent)  →  Mayar
 *
 * So the only provider Baruma wires is `parentBillingProvider`
 * (src/lib/billing/providers/parent.ts): `createCheckout` calls the parent's
 * child-billing endpoint, and `parseWebhook` verifies a relay POST the parent
 * fans out after Mayar notifies it. See
 * docs/superpowers/specs/2026-08-22-parent-billing-orchestration-design.md.
 *
 * `BillingPlan` is a bare `string` (Baruma plan ids are arbitrary rows in the
 * DB-driven `plans` table, not a fixed compile-time union).
 */

export type BillingProviderName = "mayar" | "parent"
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
  /** Caller-provided phone number (e.g. profile.phone). Mayar requires
   *  `mobile`; when absent the parent falls back to an env default. */
  mobile?: string
  /** Price in IDR — Baruma is the source of truth for its own (admin-editable)
   *  plan prices, so it tells the parent how much to charge rather than the
   *  parent guessing from a hardcoded catalog. */
  amountIdr: number
  /** Human-readable plan name for the Mayar invoice description. */
  planName?: string
  /** Billing period ("month" | "year") — controls the invoice label. */
  period?: string
  /** Where Mayar should return the user after paying. Defaults, on the parent
   *  side, to Baruma's `/app/billing` when omitted. */
  redirectUrl?: string
  /** Where the parent should relay this order's payment result — Baruma's
   *  own `/api/webhooks/payment`, computed from its own env, the same way
   *  `redirectUrl` is. Required: the parent has no fallback for it (unlike
   *  redirectUrl), by design — see providers/parent.ts's header comment for
   *  why this is self-reported per-request rather than parent-side config. */
  webhookUrl: string
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
}

export interface BillingProvider {
  readonly name: BillingProviderName
  createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult>
  parseWebhook(input: ParseWebhookInput): ParsedWebhookResult
}
