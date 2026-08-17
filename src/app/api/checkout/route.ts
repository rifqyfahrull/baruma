import { NextResponse } from "next/server"

import { requireUser } from "@/lib/server/auth-server"
import { getBillingProvider } from "@/lib/billing/providers"
import { getPlan } from "@/lib/server/repo/plans"
import { getProfileById } from "@/lib/server/repo/profiles"
import { createPendingSubscription } from "@/lib/server/repo/subscriptions"

/**
 * Creates a Stripe Checkout session for a plan and records a pending
 * subscription, activated later by the webhook (see
 * src/app/api/webhooks/payment/route.ts).
 *
 * Auth-guarded via `requireUser()` (src/lib/server/auth-server.ts) — the same
 * helper every `/api/v1/*` route uses. This is a same-origin, page-initiated
 * POST, so the browser carries the shared Supabase session cookie and
 * `requireUser` resolves it to a Baruma profile id (it also still accepts a
 * Bearer JWT for programmatic callers).
 *
 * Provider details are in src/lib/billing/providers/{types,stripe,index}.ts.
 * See also db/migrations/0001_init.sql (subscriptions) and docs/API.md.
 */
export async function POST(req: Request) {
  let userId: string
  try {
    const verified = await requireUser(req)
    userId = verified.userId
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

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

  if (!process.env.STRIPE_SECRET_KEY) {
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

  const provider = getBillingProvider()
  let result
  try {
    result = await provider.createCheckout({
      userId,
      email: profile.email,
      fullName: profile.name,
      plan: planId,
      mobile: profile.phone ?? undefined,
    })
  } catch (e) {
    // createCheckout's own error messages never include the
    // STRIPE_SECRET_KEY value — safe to surface as-is.
    return NextResponse.json(
      { error: "checkout_failed", message: (e as Error).message },
      { status: 502 }
    )
  }

  await createPendingSubscription({
    profileId: userId,
    planId,
    provider: "stripe",
    providerRef: result.providerOrderId,
  })

  return NextResponse.json({ redirectUrl: result.checkoutUrl }, { status: 200 })
}
