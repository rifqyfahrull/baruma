/**
 * Admin backoffice (Task 8): read-only subscriptions listing ("Transaksi"
 * tab) — every subscription joined with its owner's email + plan name.
 */
import { requireAdmin } from "@/lib/server/auth-server"
import { listSubscriptionsAdmin } from "@/lib/server/repo/subscriptions"
import { ok, handleError } from "@/lib/server/response"

export const dynamic = "force-dynamic"

export async function GET(request: Request): Promise<Response> {
  try {
    await requireAdmin(request)
    const subs = await listSubscriptionsAdmin()
    return ok(subs)
  } catch (e) {
    return handleError(e)
  }
}
