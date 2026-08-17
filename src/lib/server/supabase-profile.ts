/**
 * Resolve a Supabase auth user to its Baruma profile — the single bridge
 * between the shared Supabase identity and Baruma's own data (all keyed by
 * Baruma profile id). Order:
 *   1. Already linked → by supabase_uid.
 *   2. A pre-SSO profile with the same email → link it (preserves existing data
 *      like the imported projects). This is the "map by email" strategy.
 *   3. Neither → create a fresh Baruma profile bound to this Supabase user.
 *
 * Pure orchestration over the profiles repo (each step is separately testable);
 * this function itself is exercised via the route/integration layer.
 */
import { nanoid } from "nanoid"

import {
  createSupabaseProfile,
  getProfileByEmail,
  getProfileBySupabaseUid,
  linkSupabaseUid,
  type ProfileRow,
} from "@/lib/server/repo/profiles"

export interface SupabaseIdentity {
  id: string // Supabase auth uid (uuid)
  email: string
  name?: string | null
}

/** Best-effort display name from Supabase user metadata / email local-part. */
export function displayName(identity: SupabaseIdentity): string {
  const meta = (identity.name ?? "").trim()
  if (meta) return meta
  const local = identity.email.split("@")[0] ?? "Pengguna"
  return local.charAt(0).toUpperCase() + local.slice(1)
}

/** Resolve (and lazily link/create) the Baruma profile for a Supabase user. */
export async function resolveBarumaProfile(identity: SupabaseIdentity): Promise<ProfileRow> {
  const linked = await getProfileBySupabaseUid(identity.id)
  if (linked) return linked

  const byEmail = await getProfileByEmail(identity.email)
  if (byEmail) {
    await linkSupabaseUid(byEmail.id, identity.id)
    return { ...byEmail }
  }

  return createSupabaseProfile({
    id: `usr-${nanoid(10)}`,
    email: identity.email,
    name: displayName(identity),
    supabaseUid: identity.id,
  })
}
