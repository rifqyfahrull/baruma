/**
 * Pure mismatch derivation for the admin "Rekonsiliasi pembayaran" listing
 * (GET /api/v1/admin/payments) — extracted so the heuristic is unit-testable
 * without a database. Two signals flag a row as `mismatch: true`:
 *
 *  1. A `paid` webhook event that WAS processed (see webhooks/payment/
 *     route.ts's `markPaymentEventProcessed` — only called after a winning
 *     `activateSubscription`), but the subscription it belongs to is no
 *     longer `active` right now. This is a heuristic, not a hard bug signal
 *     — a subscription can legitimately go non-active later via normal
 *     expiry/renewal — but it's exactly the "bayar tapi tak aktif" symptom
 *     an admin wants surfaced for review.
 *  2. A subscription stuck `pending` for over an hour with no matching
 *     `paid` event ever recorded — checkout started but the payment webhook
 *     never arrived (or arrived and was lost).
 */

export type ReconciliationCandidate = {
  /** "event" = a real payment_events row; "pending_stale" = a synthetic row
   *  for a stuck-pending subscription with no payment_events row at all. */
  kind: "event" | "pending_stale"
  eventType: string | null
  processed: boolean
  subscriptionStatus: string | null
}

export function computePaymentMismatch(candidate: ReconciliationCandidate): boolean {
  if (candidate.kind === "pending_stale") return true
  return (
    candidate.eventType === "paid" &&
    candidate.processed &&
    candidate.subscriptionStatus !== "active"
  )
}
