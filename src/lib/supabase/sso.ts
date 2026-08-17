/**
 * SSO broker helpers. Any Supabase flow that needs a redirect (Google OAuth,
 * password recovery) is brokered through tampil.dev — it already has the
 * provider + `/auth/callback` allowlisted in Supabase, so Baruma initiates
 * nothing redirect-bound and needs zero Supabase dashboard changes.
 *
 * Why broker instead of calling Supabase from Baruma directly? PKCE. The code
 * verifier is stored where the flow is *initiated*; the callback must land on
 * the *same origin* to exchange it. So Baruma redirects the browser to
 * tampil.dev's broker, which initiates the flow on its own origin, receives the
 * callback there, sets the shared `.tampil.dev` session cookie, then forwards
 * back to `next` on this app (the cookie rides along cross-subdomain).
 *
 * Email/password login is NOT brokered — signInWithPassword needs no redirect,
 * so Baruma runs it natively and the resulting cookie is `.tampil.dev`-scoped.
 */
export function ssoOrigin(): string {
  return process.env.NEXT_PUBLIC_SSO_ORIGIN || "https://tampil.dev"
}

/** Absolute URL on this app to return to after a brokered flow. */
export function absoluteUrl(path: string): string {
  if (typeof window !== "undefined") return new URL(path, window.location.origin).toString()
  const base = process.env.NEXT_PUBLIC_APP_URL || "https://baruma.tampil.dev"
  return new URL(path, base).toString()
}

/** Broker URL that starts an OAuth login and returns to `nextPath` on this app. */
export function oauthLoginUrl(provider: "google" | "github", nextPath: string): string {
  const next = absoluteUrl(nextPath)
  return `${ssoOrigin()}/sso?action=oauth&provider=${provider}&next=${encodeURIComponent(next)}`
}

/** Broker URL that sends a password-recovery email whose link returns to
 *  `nextPath` (a reset-password page) on this app with a recovery session. */
export function recoverUrl(email: string, nextPath: string): string {
  const next = absoluteUrl(nextPath)
  return `${ssoOrigin()}/sso?action=recover&email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`
}
