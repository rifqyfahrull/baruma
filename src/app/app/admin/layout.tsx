import { redirect } from "next/navigation"

import { getSupabaseUser, supabaseConfigured } from "@/lib/supabase/server"
import { isAdminEmail } from "@/lib/server/auth-server"

/**
 * Admin backoffice gate — a DB-fresh check, the same authorization boundary
 * as `requireAdmin` (see src/lib/server/auth-server.ts): a profile whose
 * `role` column is `'admin'`, OR an `ADMIN_EMAILS`-listed bootstrap admin.
 *
 * The Supabase session carries no role claim, so authorization can only come
 * from the DB. We read the caller's email from the Supabase user and
 * `isAdminEmail()` re-verifies against the DB (or the ADMIN_EMAILS allowlist)
 * on every request, exactly like every /api/v1/admin/* route does via
 * `requireAdmin`.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Mock/dev/e2e (no Supabase keys): the app runs open — the middleware passes
  // /app/* through and there is no server session to read. Mirror that here so
  // the layout stays reachable. Prod always has Supabase configured, so this
  // branch never runs there and the full gate below applies.
  if (!supabaseConfigured()) {
    return <>{children}</>
  }

  const user = await getSupabaseUser()
  const email = user?.email
  if (!email) {
    redirect("/app/dashboard")
  }

  const allowed = await isAdminEmail(email)
  if (!allowed) {
    redirect("/app/dashboard")
  }

  return <>{children}</>
}
