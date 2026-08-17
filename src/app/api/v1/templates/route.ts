/**
 * Public templates endpoint — no auth required. Lists the active, curated
 * templates a new project can be started from.
 */
import { listTemplates } from "@/lib/server/repo/templates"
import { ok, handleError } from "@/lib/server/response"

// Admins can edit templates at any time — never let this route (or a future
// Cache Components build) freeze a stale response.
export const dynamic = "force-dynamic"

export async function GET(): Promise<Response> {
  try {
    const templates = await listTemplates(true)
    return ok({ templates })
  } catch (e) {
    return handleError(e)
  }
}
