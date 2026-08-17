import { NextResponse } from "next/server"

import { getBillingProvider } from "@/lib/billing/providers"
import { grantPeriodCredits } from "@/lib/server/repo/credits"
import {
  markPaymentEventProcessed,
  recordPaymentEvent,
} from "@/lib/server/repo/payment-events"
import { getPlan } from "@/lib/server/repo/plans"
import { setProfilePlan } from "@/lib/server/repo/profiles"
import {
  activateSubscription,
  expireOtherActiveSubscriptions,
  expireSubscription,
  getSubscriptionByProviderRef,
} from "@/lib/server/repo/subscriptions"
import type { Plan } from "@/types"

/**
 * Stripe payment webhook. The `subscriptions` row created 'pending' by
 * checkout, keyed by `provider_ref`, is the record this activates/expires.
 *
 * SECURITY: this endpoint is NOT protected by requireUser. Verifying the
 * Stripe webhook signature (provider.parseWebhook, HMAC over the raw body —
 * see stripe.ts) is the only gate.
 *
 * Fidelity notes:
 *  - Invalid signature → 401. This is the ONE failure that is NOT swallowed
 *    to 200 — a bad signature is a caller-auth problem, not a downstream
 *    side-effect problem. It's a plain `return` inside the try block below
 *    (not a `throw`), so it never reaches the catch-all.
 *  - Everything else — including a malformed JSON body — is swallowed to
 *    200 {ok:true}, which prevents Stripe's own retry storm on transient
 *    failures.
 *
 * IDEMPOTENCY (post Task 5 CRITICAL fix): `recordPaymentEvent` is an AUDIT
 * LOG ONLY — its "duplicate" result must never gate whether this handler
 * processes the event. The real idempotency guard is the atomic
 * `UPDATE ... WHERE status = ...` inside `activateSubscription` /
 * `expireSubscription` (subscriptions.ts): whichever delivery actually flips
 * the row is the one that runs the once-only side effects (plan upgrade,
 * credit grant, superseding other active subs); every other delivery
 * (replayed, or an earlier "ignored" ping for the same order) sees a
 * null/false result and safely no-ops. See payment-events.ts for the bug
 * this replaced (dedup keyed on providerOrderId alone let an "ignored" event
 * block a later genuine "paid" event for the same order).
 */
export async function POST(req: Request): Promise<Response> {
  // Hoisted above the try block (not `const` inside it) so the catch-all
  // below can reference them for debugging even when something throws
  // before we'd otherwise have captured them.
  let providerOrderId: string | undefined
  let outcome: string | undefined
  try {
    const raw = await req.text()
    const payload = JSON.parse(raw) as unknown

    const provider = getBillingProvider()
    const parsed = provider.parseWebhook({ payload, headers: req.headers, rawBody: raw })

    if (!parsed.isValid || !parsed.event) {
      console.error(
        "[webhook/payment] invalid webhook:",
        parsed.errorMessage ?? "unknown reason"
      )
      return NextResponse.json(
        { error: parsed.errorMessage ?? "Invalid webhook payload" },
        { status: 401 }
      )
    }

    const providerName = parsed.event.provider
    providerOrderId = parsed.event.providerOrderId
    outcome = parsed.event.outcome

    // Audit trail only — see payment-events.ts. Keyed by order+outcome (not
    // order alone) so an earlier "ignored" delivery for this order can never
    // collide with, and thereby block, a later genuine "paid" delivery.
    // Intentionally not branching on the result ("duplicate" is expected and
    // fine for a replayed delivery — it must not short-circuit processing).
    await recordPaymentEvent({
      id: `${providerOrderId}:${outcome}`,
      provider: providerName,
      eventType: outcome,
      signatureOk: true,
      payload,
    })

    const sub = await getSubscriptionByProviderRef(providerOrderId)
    if (!sub) {
      // No matching pending/active subscription (e.g. a Stripe event type
      // Baruma doesn't act on, mapped to a synthetic order id) — silent no-op.
      return NextResponse.json({ ok: true })
    }

    if (outcome === "paid") {
      const plan = await getPlan(sub.planId)
      const periodDays = plan?.period === "year" ? 365 : 30
      const currentPeriodEnd = new Date(
        Date.now() + periodDays * 24 * 60 * 60 * 1000
      ).toISOString()

      // Atomic idempotency guard: only flips a row that is still 'pending'.
      // null means someone already processed this order (a concurrent or
      // earlier delivery, or this exact delivery replayed) — no-op, and
      // critically, do NOT re-run the grants below.
      const activated = await activateSubscription({
        providerRef: providerOrderId,
        currentPeriodEnd,
      })
      if (activated) {
        // This delivery is THE one that flipped pending → active — safe to
        // run the once-only side effects.
        await expireOtherActiveSubscriptions(sub.profileId, activated.id)
        // profiles.plan is DB-constrained to the fixed free|pro|studio union
        // (0001_init.sql CHECK); this webhook only ever activates a plan id
        // that a pending subscription already carries, which itself only ever
        // came from a valid plan id accepted by /api/checkout.
        await setProfilePlan(sub.profileId, sub.planId as Plan)
        if (plan) {
          await grantPeriodCredits(
            sub.profileId,
            plan.entitlements.creditsPerPeriod,
            "period_grant"
          )
        }
        await markPaymentEventProcessed(`${providerOrderId}:${outcome}`)
      }
    } else if (
      outcome === "failed" ||
      outcome === "expired" ||
      outcome === "cancelled"
    ) {
      // Mark it dead; the user stays on their current plan (they never had
      // the new one — no downgrade needed, they just don't get upgraded).
      // expireSubscription's own `WHERE status = 'active'` guard makes
      // repeat calls safe/idempotent — no extra status check needed here.
      await expireSubscription(sub.id)
      await markPaymentEventProcessed(`${providerOrderId}:${outcome}`)
    }
    // outcome "ignored" (a Stripe event type Baruma doesn't act on) → no-op, fall through.

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(
      `[webhook/payment] handler error (providerOrderId=${providerOrderId ?? "?"}, outcome=${outcome ?? "?"}):`,
      e
    )
    return NextResponse.json({ ok: true }) // Prevent provider retry storm.
  }
}
