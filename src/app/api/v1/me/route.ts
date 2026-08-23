import { requireUser } from "@/lib/server/auth-server"
import {
  getProfileById,
  setProfileName,
  type ProfileRow,
} from "@/lib/server/repo/profiles"
import { getPlan } from "@/lib/server/repo/plans"
import { getActiveSubscription } from "@/lib/server/repo/subscriptions"
import { expireIfLapsed } from "@/lib/server/billing-lifecycle"
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

    // Lazy expiry (belt-and-suspenders alongside the daily maintenance cron
    // — POST /api/internal/maintenance — which sweeps lapsed subscriptions
    // proactively): a subscription whose period has lapsed is downgraded to
    // free right here too, on read, in case the cron hasn't caught it yet.
    // Shared logic lives in src/lib/server/billing-lifecycle.ts's
    // `expireIfLapsed` (used by both this route and the cron) so the two
    // paths can never drift on what "downgrade a lapsed subscription" means.
    // Runs before `plan`/entitlements are computed below so the response
    // reflects the just-applied downgrade instead of stale data.
    if (
      activeSubscription?.currentPeriodEnd &&
      new Date(activeSubscription.currentPeriodEnd) < new Date()
    ) {
      // `activeSubscription` is known-lapsed regardless of which caller
      // (this request, a concurrent one, or the cron) ends up being the one
      // that actually flips the row — see expireIfLapsed's doc comment for
      // the atomic idempotency guard.
      activeSubscription = null
      if (await expireIfLapsed(userId)) {
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
