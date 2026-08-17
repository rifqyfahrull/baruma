/**
 * Supabase server client (SSR, cookie-based). Baruma shares tampil.dev's
 * Supabase Auth project, so a session established on either app (cookie scoped
 * to `.tampil.dev` via NEXT_PUBLIC_AUTH_COOKIE_DOMAIN) authenticates the user
 * here too.
 *
 * Env:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   NEXT_PUBLIC_AUTH_COOKIE_DOMAIN   (e.g. ".tampil.dev" in prod; unset in local dev)
 */
import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"

export function supabaseConfigured(): boolean {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
}

function cookieDomain(): string | undefined {
  return process.env.NEXT_PUBLIC_AUTH_COOKIE_DOMAIN || undefined
}

/** Server client bound to the request cookie store (Server Components, route
 *  handlers). Writes are ignored when called from a Server Component (Next
 *  throws) — the middleware client refreshes cookies instead. */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, {
                ...options,
                domain: cookieDomain(),
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: "lax",
              })
            }
          } catch {
            // Called from a Server Component — cookie writes happen in middleware.
          }
        },
      },
    },
  )
}

/** The current Supabase auth user (or null), read from the request cookies.
 *  Returns null (rather than throwing) when the chunked session cookies are
 *  corrupt — mixed-scope/mixed-session chunks reassemble into invalid UTF-8
 *  and @supabase/ssr throws; the middleware handles deleting them. */
export async function getSupabaseUser() {
  if (!supabaseConfigured()) return null
  try {
    const supabase = await createSupabaseServerClient()
    const { data } = await supabase.auth.getUser()
    return data.user ?? null
  } catch {
    return null
  }
}
