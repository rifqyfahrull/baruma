/**
 * Admin backoffice (Task 8): manual credit adjustment (± with a free-text
 * note). `credits_ledger.reason` is a machine-category column (see
 * db/migrations/0001_init.sql's comment: 'export' | 'generate' | 'topup' |
 * ...), so this always records the fixed tag "admin_adjust" as `reason` —
 * the admin's free-text note is threaded through as `ref` instead (the
 * unused-elsewhere-in-this-context `ref` column; see
 * src/lib/server/repo/credits.ts's `adjustCredits`). Split from
 * /api/v1/admin/users (role/plan) into its own subpath since this is a
 * distinct, ledger-writing action rather than a profile field update —
 * see the comment in ../route.ts for the codebase precedent this follows.
 */
import { requireAdmin } from "@/lib/server/auth-server"
import { adjustCredits } from "@/lib/server/repo/credits"
import { adjustCreditsSchema } from "@/lib/schemas/admin"
import { ok, err, handleError } from "@/lib/server/response"

export const dynamic = "force-dynamic"

export async function POST(request: Request): Promise<Response> {
  try {
    await requireAdmin(request)
    const body = await request.json().catch(() => null)
    const parsed = adjustCreditsSchema.safeParse(body)
    if (!parsed.success) {
      return err(400, parsed.error.issues[0]?.message ?? "Input tidak valid")
    }
    const { profileId, deltaTotal, reason } = parsed.data
    await adjustCredits(profileId, deltaTotal, "admin_adjust", reason)
    return ok({ success: true })
  } catch (e) {
    return handleError(e)
  }
}
