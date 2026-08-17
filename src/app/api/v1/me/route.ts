import { requireUser } from "@/lib/server/auth-server"
import { grantPeriodCredits } from "@/lib/server/repo/credits"
import {
  getProfileById,
  setProfileName,
  setProfilePlan,
  type ProfileRow,
} from "@/lib/server/repo/profiles"
import { getPlan } from "@/lib/server/repo/plans"
import {
  expireSubscription,
  getActiveSubscription,
} from "@/lib/server/repo/subscriptions"
import { updateProfileSchema } from "@/lib/schemas/profile"
import { ok, err, handleError } from "@/lib/server/response"
import type { User } from "@/types"

/** Builds the GET/PATCH response shape from a profile row + its plan's entitlements + active subscription. */
async function toUserResponse(profile: ProfileRow): Promise<User> {
  const plan = await getPlan(profile.plan)
  const activeSubscription = await getActiveSubscription(profile.id)
  return {
    id: profile.id,
    name: profile.name,
    email: profile.email,
    plan: profile.plan,
    creditsUsed: profile.credits_used,
    creditsTotal: profile.credits_total,
    role: profile.role,
    phone: profile.phone,
    entitlements: plan?.entitlements ?? null,
    subscription: activeSubscription
      ? {
          status: activeSubscription.status,
          currentPeriodEnd: activeSubscription.currentPeriodEnd ?? "",
        }
      : null,
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
    const { userId } = await requireUser(request)
    let profile = await getProfileById(userId)
    if (!profile) return err(404, "User not found")

    let activeSubscription = await getActiveSubscription(profile.id)

    // Lazy expiry (manual-renew billing, no cron/email in v1): a subscription
    // whose period has lapsed is downgraded to free right here, on read — see
    // docs/superpowers/specs/2026-07-05-mayar-billing-admin-design.md
    // §"Expiry lazy". Runs before `plan`/entitlements are computed below so
    // the response reflects the just-applied downgrade instead of stale data.
    if (
      activeSubscription?.currentPeriodEnd &&
      new Date(activeSubscription.currentPeriodEnd) < new Date()
    ) {
      // Atomic guard (see subscriptions.ts): only the request that actually
      // flips active → expired runs the downgrade side effects. Two
      // concurrent requests for the same lapsed subscription both reach
      // here, but only one gets `true` back — the other must not re-grant
      // free credits (grantPeriodCredits sets absolute totals so the final
      // numbers are harmless either way, but re-running it would duplicate
      // the credits_ledger "downgrade" audit row).
      const didExpire = await expireSubscription(activeSubscription.id)
      activeSubscription = null
      if (didExpire) {
        await setProfilePlan(userId, "free")
        const freePlan = await getPlan("free")
        if (freePlan) {
          await grantPeriodCredits(
            userId,
            freePlan.entitlements.creditsPerPeriod,
            "downgrade"
          )
        }
        profile = await getProfileById(userId)
        if (!profile) return err(404, "User not found")
      }
    }

    const plan = await getPlan(profile.plan)

    const user: User = {
      id: profile.id,
      name: profile.name,
      email: profile.email,
      plan: profile.plan,
      creditsUsed: profile.credits_used,
      creditsTotal: profile.credits_total,
      role: profile.role,
      phone: profile.phone,
      entitlements: plan?.entitlements ?? null,
      subscription: activeSubscription
        ? {
            status: activeSubscription.status,
            currentPeriodEnd: activeSubscription.currentPeriodEnd ?? "",
          }
        : null,
    }
    return ok(user)
  } catch (e) {
    return handleError(e)
  }
}

/** Ganti nama tampilan (profile page — halaman profile). */
export async function PATCH(request: Request): Promise<Response> {
  try {
    const { userId } = await requireUser(request)

    let rawBody: unknown
    try {
      rawBody = await request.json()
    } catch {
      return err(400, "Invalid JSON body")
    }

    const parsed = updateProfileSchema.safeParse(rawBody)
    if (!parsed.success) {
      return err(400, parsed.error.issues[0]?.message ?? "Invalid request body")
    }

    await setProfileName(userId, parsed.data.name)
    const profile = await getProfileById(userId)
    if (!profile) return err(404, "User not found")

    return ok(await toUserResponse(profile))
  } catch (e) {
    return handleError(e)
  }
}
