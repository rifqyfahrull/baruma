/**
 * Plan entitlements resolution + feature gating — the server-side source of
 * truth for what a profile's current plan allows (credits/period, project
 * quota, export PDF, GLB upload). See
 * docs/superpowers/specs/2026-07-05-mayar-billing-admin-design.md §Enforcement.
 */
import { getPlan } from "@/lib/server/repo/plans"
import { getProfileById } from "@/lib/server/repo/profiles"
import type { Entitlements } from "@/types"

/**
 * Safe free-tier fallback used when the profile or its plan row can't be
 * resolved (should not happen in steady state — a missing profile/plan must
 * never silently grant unlimited access). Mirrors the `free` plan seed in
 * src/lib/server/repo/plan-defaults.ts.
 */
const FALLBACK_ENTITLEMENTS: Entitlements = {
  creditsPerPeriod: 10,
  maxProjects: 1,
  exportPdf: false,
  glbUpload: false,
}

/** Resolve the entitlements for a profile's current plan (fallback-safe). */
export async function getEntitlements(profileId: string): Promise<Entitlements> {
  const profile = await getProfileById(profileId)
  const plan = profile ? await getPlan(profile.plan) : null
  return plan?.entitlements ?? FALLBACK_ENTITLEMENTS
}

/**
 * Thrown by requirePlanFeature. Wired into src/lib/server/response.ts's
 * handleError → 403 `{error: "plan_feature_locked", message}`.
 */
export class PlanFeatureLockedError extends Error {
  constructor(public feature: string) {
    super(`Fitur ${feature} tidak tersedia di plan Anda.`)
    this.name = "PlanFeatureLockedError"
  }
}

/** Throws PlanFeatureLockedError when the profile's plan doesn't have `feature`. */
export async function requirePlanFeature(
  profileId: string,
  feature: "exportPdf" | "glbUpload"
): Promise<void> {
  const ent = await getEntitlements(profileId)
  if (!ent[feature]) throw new PlanFeatureLockedError(feature)
}
