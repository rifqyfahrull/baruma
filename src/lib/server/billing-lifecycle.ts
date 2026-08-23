/**
 * Shared subscription-lifecycle helper — extracted from GET /api/v1/me's
 * lazy-expiry block so the SAME logic runs from two places: the lazy check
 * on read (unchanged behaviour) AND the daily maintenance cron
 * (POST /api/internal/maintenance), which sweeps lapsed subscriptions even
 * for profiles that never hit GET /me again after their period ended.
 */
import { grantPeriodCredits } from "@/lib/server/repo/credits"
import { getPlan } from "@/lib/server/repo/plans"
import { setProfilePlan } from "@/lib/server/repo/profiles"
import {
  expireSubscription,
  getActiveSubscription,
} from "@/lib/server/repo/subscriptions"

/**
 * If `profileId`'s active subscription has lapsed (`currentPeriodEnd` in the
 * past), retire it, downgrade the profile to `free`, and grant free-tier
 * credits. No-op (returns `false`) when there is no active subscription, or
 * it hasn't lapsed yet, or it lapsed but a concurrent caller already flipped
 * it (see below).
 *
 * Idempotency: `expireSubscription`'s atomic `UPDATE ... WHERE status =
 * 'active'` guard (subscriptions.ts) means only the ONE caller that actually
 * flips active → expired runs the downgrade side effects — two concurrent
 * calls for the same lapsed subscription (a lazy `GET /me` racing the cron,
 * or the cron re-scanning a profile the lazy path already caught) are safe:
 * at most one of them sees `true`. Returns whether THIS call performed the
 * downgrade, so callers (route + cron) can gate their own once-only side
 * effects (profile re-fetch, expiry email) on it.
 */
export async function expireIfLapsed(profileId: string): Promise<boolean> {
  const activeSubscription = await getActiveSubscription(profileId)
  if (
    !activeSubscription?.currentPeriodEnd ||
    new Date(activeSubscription.currentPeriodEnd) >= new Date()
  ) {
    return false
  }

  const didExpire = await expireSubscription(activeSubscription.id)
  if (!didExpire) return false

  await setProfilePlan(profileId, "free")
  const freePlan = await getPlan("free")
  if (freePlan) {
    await grantPeriodCredits(
      profileId,
      freePlan.entitlements.creditsPerPeriod,
      "downgrade"
    )
  }
  return true
}
