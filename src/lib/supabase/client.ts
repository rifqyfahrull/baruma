/**
 * Supabase browser client — for client components that sign in/up, start Google
 * OAuth, or read the session reactively. Uses the shared tampil.dev Supabase
 * project (same env as the server client).
 */
import { createBrowserClient } from "@supabase/ssr"

/** Cookie domain for cross-subdomain SSO (`.tampil.dev`). Must be a
 *  NEXT_PUBLIC_ var so the browser client scopes the session cookie the same
 *  way the server does. Undefined in local dev → host-scoped (fine). */
function cookieDomain(): string | undefined {
  return process.env.NEXT_PUBLIC_AUTH_COOKIE_DOMAIN || undefined
}

export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookieOptions: { domain: cookieDomain() } },
  )
}

export function supabaseBrowserConfigured(): boolean {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
}
