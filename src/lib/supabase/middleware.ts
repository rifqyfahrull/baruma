/**
 * Supabase session refresh + route protection for Next.js middleware. Reads the
 * `.tampil.dev`-scoped Supabase cookies, refreshes the session, and gates
 * `/app/*` behind an authenticated user — redirecting to /login otherwise.
 *
 * When Supabase is unconfigured (local dev/e2e without keys), it passes through
 * untouched so the app stays runnable.
 */
import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

function cookieDomain(): string | undefined {
  return process.env.NEXT_PUBLIC_AUTH_COOKIE_DOMAIN || undefined
}

export async function updateSupabaseSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request })

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return response
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value)
          response = NextResponse.next({ request })
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, { ...options, domain: cookieDomain() })
          }
        },
      },
    },
  )

  // IMPORTANT: getUser() refreshes the token cookie; do not remove.
  // RESILIENCE: corrupt/stale chunked sb-* cookies (mixed sessions/scopes under
  // the same names) make @supabase/ssr's cookie reassembly throw ("Invalid
  // UTF-8 sequence", prod 2026-07-11). Treat that as "no user" and DELETE the
  // poisoned cookies (host + apex scopes) so the browser self-heals instead of
  // being soft-locked.
  let user: Awaited<ReturnType<typeof supabase.auth.getUser>>["data"]["user"] = null
  try {
    const { data } = await supabase.auth.getUser()
    user = data.user
  } catch {
    response = NextResponse.next({ request })
    for (const cookie of request.cookies.getAll()) {
      if (!cookie.name.startsWith("sb-")) continue
      // headers.append — ResponseCookies.set is keyed by name and would keep
      // only one of the two scope variants.
      response.headers.append("Set-Cookie", `${cookie.name}=; Max-Age=0; Path=/`)
      const domain = cookieDomain()
      if (domain) {
        response.headers.append("Set-Cookie", `${cookie.name}=; Max-Age=0; Path=/; Domain=${domain}`)
      }
    }
  }

  const path = request.nextUrl.pathname
  const isApp = path.startsWith("/app")
  if (isApp && !user) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    url.searchParams.set("next", path)
    return carryCookies(NextResponse.redirect(url), response)
  }

  // Sudah login → /login & /register tidak boleh diakses lagi; lempar ke
  // tujuan `next` (path internal saja) atau dashboard. /reset-password
  // SENGAJA tidak dijaga: recovery flow mendarat di sana DENGAN sesi aktif.
  const isGuestOnly = path === "/login" || path === "/register"
  if (isGuestOnly && user) {
    const nextParam = request.nextUrl.searchParams.get("next")
    const url = request.nextUrl.clone()
    url.pathname =
      nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//")
        ? nextParam
        : "/app/dashboard"
    url.search = ""
    return carryCookies(NextResponse.redirect(url), response)
  }

  return response
}

/** Carry cookie refreshes/deletions from the pass-through response onto a redirect. */
function carryCookies(redirect: NextResponse, from: NextResponse): NextResponse {
  const setCookies = from.headers.getSetCookie?.() ?? []
  for (const c of setCookies) redirect.headers.append("Set-Cookie", c)
  return redirect
}
