import { NextResponse, after } from "next/server"
import * as Sentry from "@sentry/nextjs"

import { rateLimitGuard } from "@/lib/server/rate-limit"
import { getBillingProvider } from "@/lib/billing/providers"
import { grantPeriodCredits } from "@/lib/server/repo/credits"
import {
  markPaymentEventProcessed,
  recordPaymentEvent,
} from "@/lib/server/repo/payment-events"
import { getPlan } from "@/lib/server/repo/plans"
import { getProfileById, setProfilePlan } from "@/lib/server/repo/profiles"
import {
  activateSubscription,
  expireOtherActiveSubscriptions,
  expireSubscription,
  getSubscriptionByProviderRef,
} from "@/lib/server/repo/subscriptions"
import { sendEmail } from "@/lib/server/email"
import { receiptEmail } from "@/lib/server/email-templates"
import type { Plan } from "@/types"

/**
 * Payment webhook — Baruma is a CHILD app, so this endpoint is NOT called by
 * Mayar. It is called by the tampil.dev PARENT, which receives the Mayar
 * webhook, resolves that the order belongs to Baruma, and relays a normalized
 * event here (Baruma → tampil.dev → Mayar, in reverse). The gate is therefore
 * the parent's shared secret, verified in `parentBillingProvider.parseWebhook`
 * (src/lib/billing/providers/parent.ts), not a Mayar token.
 *
 * There is no separate `invoices` table here — the `subscriptions` row created
 * 'pending' by checkout, keyed by `provider_ref`, IS the equivalent "invoice"
 * record we look up.
 *
 * SECURITY: this endpoint is NOT protected by requireUser. Verifying the parent
 * relay signature (provider.parseWebhook) is the only gate.
 *
 * Failure handling (deliberate):
 *  - Invalid signature → 401. This is the ONE failure that is NOT swallowed to
 *    200 — a bad signature is a caller-auth problem, not a downstream
 *    side-effect problem. It's a plain `return` inside the try block below
 *    (not a `throw`), so it never reaches the catch-all.
 *  - Everything else — including a malformed JSON body — is swallowed to
 *    200 {ok:true}: JSON.parse throws → caught below → 200. This (plus every
 *    other exception) prevents the parent's relay from retry-storming.
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
  // Rate-limit LONGGAR per IP (60/menit) — hanya untuk meredam banjir/flood
  // anomali, BUKAN menghalangi retry sah dari relay parent (yang bisa retry
  // beberapa kali per order saat Baruma lambat). 429 di sini masih aman:
  // idempotency guard di activateSubscription/expireSubscription membuat
  // retry berikutnya dari parent tetap idempoten begitu limit reset.
  const limited = rateLimitGuard(req, {
    scope: "webhook-payment",
    limit: 60,
    windowMs: 60_000,
  })
  if (limited) return limited
  try {
    const raw = await req.text()
    const payload = JSON.parse(raw) as unknown

    const provider = getBillingProvider()
    const parsed = provider.parseWebhook({ payload, headers: req.headers })

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
      // The parent only relays orders it resolved to Baruma, but an
      // unrecognized ref (stale/replayed relay) is still a safe silent no-op.
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

        // Kuitansi via email di BACKGROUND (after response) — sendEmail
        // sendiri tidak pernah throw dan sudah no-op tanpa RESEND_API_KEY/
        // EMAIL_FROM; after() memastikan latensi/kegagalan provider email
        // tidak pernah menunda balasan 200 ke relay parent (lihat komentar
        // besar di atas soal retry-storm). `orderId` di-const-kan dulu — TS
        // tak bisa menyempitkan `let providerOrderId: string | undefined`
        // (dideklarasikan di atas try) menembus closure `after()`.
        const orderId = providerOrderId
        after(async () => {
          const receiptProfile = await getProfileById(sub.profileId)
          if (!receiptProfile) return
          await sendEmail({
            to: receiptProfile.email,
            subject: "Pembayaran berhasil — kuitansi Baruma",
            html: receiptEmail({
              planName: plan?.name ?? sub.planId,
              priceIdr: plan?.priceIdr ?? 0,
              periodEnd: currentPeriodEnd,
              orderId,
            }),
          })
        })
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
    // outcome "ignored" (Mayar's own "testing" event) → no-op, fall through.

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(
      `[webhook/payment] handler error (providerOrderId=${providerOrderId ?? "?"}, outcome=${outcome ?? "?"}):`,
      e
    )
    // Kegagalan di sini TIDAK BOLEH senyap (lihat komentar besar di atas: 200
    // dibalas untuk mencegah retry-storm dari relay parent, tapi itu berarti
    // "user bayar tapi tak ter-upgrade" hanya kelihatan di log pm2 kalau
    // tidak dikirim ke sini). No-op sepenuhnya tanpa SENTRY_DSN.
    Sentry.captureException(e, {
      tags: { route: "webhook-payment", orderId: providerOrderId ?? "unknown" },
      extra: { outcome: outcome ?? "unknown" },
    })
    return NextResponse.json({ ok: true }) // Prevent provider retry storm.
  }
}
