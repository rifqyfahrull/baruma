import { NextResponse } from "next/server"

import { requireUser } from "@/lib/server/auth-server"
import { getBillingProvider } from "@/lib/billing/providers"
import { isParentBillingConfigured } from "@/lib/billing/providers/parent"
import { getPlan } from "@/lib/server/repo/plans"
import { getProfileById } from "@/lib/server/repo/profiles"
import { createPendingSubscription } from "@/lib/server/repo/subscriptions"
import { rateLimitGuard } from "@/lib/server/rate-limit"

/**
 * Creates a checkout for a plan and records a pending subscription, activated
 * later by the webhook (see src/app/api/webhooks/payment/route.ts).
 *
 * Baruma is a CHILD app: it does NOT talk to Mayar directly. The checkout is
 * delegated to the tampil.dev parent, which owns the shared Mayar merchant
 * account and is the financial manager for every VibeCoding.ID child
 * (Baruma → tampil.dev → Mayar). Baruma still owns its plan catalogue, so it
 * sends the parent the price/name to charge. Provider details:
 * src/lib/billing/providers/{types,parent,index}.ts.
 *
 * Auth-guarded via `requireUser()` (src/lib/server/auth-server.ts) — the same
 * helper every `/api/v1/*` route uses. This is a same-origin, page-initiated
 * POST, so the browser carries the shared Supabase session cookie and
 * `requireUser` resolves it to a Baruma profile id (it also still accepts a
 * Bearer JWT for programmatic callers).
 *
 * See docs/superpowers/specs/2026-08-22-parent-billing-orchestration-design.md,
 * db/migrations/0001_init.sql (subscriptions) and docs/API.md.
 */
export async function POST(req: Request) {
  let userId: string
  try {
    const verified = await requireUser(req)
    userId = verified.userId
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  // Rate-limit: 5 percobaan checkout / menit / user — cukup untuk klik ganda
  // & retry wajar, ketat terhadap penyalahgunaan (spam order ke provider parent).
  const limited = rateLimitGuard(req, {
    scope: "checkout",
    limit: 5,
    windowMs: 60_000,
    keyExtra: userId,
  })
  if (limited) return limited

  const { planId } = (await req.json().catch(() => ({}))) as {
    planId?: string
  }
  if (!planId) {
    return NextResponse.json({ error: "invalid_plan" }, { status: 400 })
  }

  // priceIdr <= 0 excludes the free plan generically — no hardcoded "free"
  // id check, so this stays correct if an admin ever adds another
  // free-tier plan (Task 8).
  const plan = await getPlan(planId)
  if (!plan || !plan.active || plan.priceIdr <= 0) {
    return NextResponse.json({ error: "invalid_plan" }, { status: 400 })
  }

  // appUrl is required, not just nice-to-have: the parent needs a real
  // webhookUrl to relay payment results back to (self-reported here rather
  // than configured on the parent — see parent.ts's header comment), and
  // there's no safe fallback for that the way there is for redirectUrl. If
  // it's unset, checkout can never actually complete, so fail the same way
  // as "not configured" rather than let it 502 later from the parent.
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? undefined
  if (!isParentBillingConfigured() || !appUrl) {
    return NextResponse.json(
      {
        error: "payment_not_configured",
        message: "Pembayaran belum aktif.",
      },
      { status: 503 }
    )
  }

  const profile = await getProfileById(userId)
  if (!profile) {
    return NextResponse.json({ error: "profile_not_found" }, { status: 404 })
  }

  // Land the user back on the billing page after paying (parent forwards this
  // to Mayar as the invoice redirect). Built with new URL() so a trailing
  // slash on NEXT_PUBLIC_APP_URL/APP_URL can't produce "//app/billing".
  const redirectUrl = new URL("/app/billing", appUrl).toString()
  // Where the parent should relay this order's payment result. Self-reported
  // per-request (not configured on the parent) so Baruma's domain can change
  // without ever touching the parent's config — see parent.ts.
  const webhookUrl = new URL("/api/webhooks/payment", appUrl).toString()

  const provider = getBillingProvider()
  let result
  try {
    result = await provider.createCheckout({
      userId,
      email: profile.email,
      fullName: profile.name,
      plan: planId,
      mobile: profile.phone ?? undefined,
      amountIdr: plan.priceIdr,
      planName: plan.name,
      period: plan.period,
      redirectUrl,
      webhookUrl,
    })
  } catch (e) {
    // The provider's error messages never include the shared secret — safe to
    // surface as-is.
    return NextResponse.json(
      { error: "checkout_failed", message: (e as Error).message },
      { status: 502 }
    )
  }

  await createPendingSubscription({
    profileId: userId,
    planId,
    provider: "parent",
    providerRef: result.providerOrderId,
  })

  return NextResponse.json({ redirectUrl: result.checkoutUrl }, { status: 200 })
}
