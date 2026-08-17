/**
 * Admin backoffice (Task 8): users listing + role/plan management.
 *
 * Credit adjustment is a distinct action (POST /api/v1/admin/users/credits)
 * rather than a third verb here — following this codebase's existing
 * convention of splitting a distinct action into its own route/subpath
 * (e.g. review/comments/[cid]/toggle vs. review/comments, or
 * editor/assistant/[msgId] PATCH vs. editor/assistant GET/POST) rather than
 * cramming unrelated actions onto one resource file.
 */
import { requireAdmin } from "@/lib/server/auth-server"
import {
  countAdmins,
  getProfileById,
  listProfiles,
  setProfilePlan,
  setProfileRole,
} from "@/lib/server/repo/profiles"
import { patchUserSchema } from "@/lib/schemas/admin"
import { ok, err, errCode, handleError } from "@/lib/server/response"
import type { AdminUserRow } from "@/types"

export const dynamic = "force-dynamic"

/** GET — every profile, mapped to the safe client-facing shape. */
export async function GET(request: Request): Promise<Response> {
  try {
    await requireAdmin(request)
    const profiles = await listProfiles()
    // ProfileRow never carries password_hash/credential fields (those live
    // on the separate CredentialRow — see profiles.ts), but we still map to
    // an explicit, minimal client shape rather than return DB rows verbatim.
    const users: AdminUserRow[] = profiles.map((p) => ({
      id: p.id,
      name: p.name,
      email: p.email,
      plan: p.plan,
      role: p.role,
      creditsUsed: p.credits_used,
      creditsTotal: p.credits_total,
    }))
    return ok(users)
  } catch (e) {
    return handleError(e)
  }
}

/**
 * PATCH — set role and/or plan for a profile (at least one required).
 *
 * Two guards run before a role change to "user" is ever applied (Task 8
 * review, I1) — both protect the same failure mode: nobody left with
 * `role==='admin'` in the DB, which (absent an ADMIN_EMAILS bootstrap entry)
 * permanently locks everyone out of /app/admin and every /api/v1/admin/*
 * route, with no way back in short of direct DB access.
 *   1. An admin can never demote themselves (`cannot_demote_self`).
 *   2. The last remaining admin can never be demoted by anyone
 *      (`last_admin`) — only checked when actually changing role to
 *      non-admin, not on every PATCH.
 *
 * Also 404s when `profileId` doesn't exist (Task 8 review, M2) instead of
 * silently no-op'ing — `setProfileRole`/`setProfilePlan` don't check
 * rowCount, so an UPDATE matching zero rows would otherwise still return 200.
 * This fetch doubles as the "target's current role" the last-admin guard
 * needs, so the two compose without a second round-trip.
 */
export async function PATCH(request: Request): Promise<Response> {
  try {
    const { userId } = await requireAdmin(request)
    const body = await request.json().catch(() => null)
    const parsed = patchUserSchema.safeParse(body)
    if (!parsed.success) {
      return err(400, parsed.error.issues[0]?.message ?? "Input tidak valid")
    }
    const { profileId, role, plan } = parsed.data

    if (role === "user" && profileId === userId) {
      return errCode(
        400,
        "cannot_demote_self",
        "Anda tidak bisa menurunkan role diri sendiri."
      )
    }

    const target = await getProfileById(profileId)
    if (!target) {
      return err(404, "Profil tidak ditemukan")
    }

    if (role === "user" && target.role === "admin") {
      const adminCount = await countAdmins()
      if (adminCount <= 1) {
        return errCode(
          400,
          "last_admin",
          "Tidak bisa menurunkan admin terakhir."
        )
      }
    }

    if (role !== undefined) await setProfileRole(profileId, role)
    if (plan !== undefined) await setProfilePlan(profileId, plan)
    return ok({ success: true })
  } catch (e) {
    return handleError(e)
  }
}
