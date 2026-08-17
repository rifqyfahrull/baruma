/**
 * Admin backoffice (Task 8): plans CRUD. Every handler re-checks admin via
 * `requireAdmin` (DB-fresh — see src/lib/server/auth-server.ts), independent
 * of the Auth.js session role used only for the `/app/admin` layout's fast
 * UX redirect.
 */
import { requireAdmin } from "@/lib/server/auth-server"
import { getPlans, upsertPlan } from "@/lib/server/repo/plans"
import { planRowSchema } from "@/lib/schemas/admin"
import { ok, err, handleError } from "@/lib/server/response"

// Admin edits must always be visible immediately on re-fetch — never let a
// build/runtime cache freeze this route (mirrors /api/v1/plans/route.ts).
export const dynamic = "force-dynamic"

/** GET — ALL plans (active + inactive) so admins can see/reactivate hidden ones. */
export async function GET(request: Request): Promise<Response> {
  try {
    await requireAdmin(request)
    const plans = await getPlans(false)
    return ok(plans)
  } catch (e) {
    return handleError(e)
  }
}

/** PUT — create or update a plan (body = a full PlanRow). */
export async function PUT(request: Request): Promise<Response> {
  try {
    await requireAdmin(request)
    const body = await request.json().catch(() => null)
    const parsed = planRowSchema.safeParse(body)
    if (!parsed.success) {
      return err(400, parsed.error.issues[0]?.message ?? "Input tidak valid")
    }
    await upsertPlan(parsed.data)
    return ok(parsed.data)
  } catch (e) {
    return handleError(e)
  }
}
