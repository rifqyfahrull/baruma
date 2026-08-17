/**
 * Public plans endpoint — no auth required. Single source of truth for
 * pricing consumed by the landing page (server-side, direct repo import) and
 * by `/app/billing` (via the client data-source → `usePlans()`).
 */
import { getPlans } from "@/lib/server/repo/plans"
import { ok, handleError } from "@/lib/server/response"

// Admins (T8) can edit plan prices/content at any time — never let this
// route (or a future Cache Components build) freeze a stale response.
export const dynamic = "force-dynamic"

export async function GET(): Promise<Response> {
  try {
    const plans = await getPlans(true)
    return ok({ plans })
  } catch (e) {
    return handleError(e)
  }
}
