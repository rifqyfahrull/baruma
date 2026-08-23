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
 * so Baruma runs it natively and the resulting cookie is `.tampil.dev`-scoped
 * (or host-scoped, off a *.tampil.dev deployment — see client.ts).
 *
 * CROSS-DOMAIN DEPLOYMENTS (e.g. Baruma hosted on Emergent, NOT under
 * *.tampil.dev): the `.tampil.dev` cookie tampil.dev sets during the broker
 * flow can never reach a different real domain — that's a browser rule, not
 * something any redirect allowlist can change. For those deployments,
 * oauthLoginUrl() sends the browser back to THIS app's own /auth/handoff page
 * (src/app/auth/handoff/page.tsx) instead of the final destination directly;
 * tampil.dev's /auth/callback recognizes the origin (see
 * docs/superpowers/plans/2026-08-22-cross-domain-sso-handoff.md, tampil.dev
 * repo) and mints a one-time Supabase magic-link token for /auth/handoff to
 * verify with Baruma's OWN client — producing a session scoped to Baruma's own
 * origin instead of `.tampil.dev`.
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

/** True when this deployment's own app URL is a *.tampil.dev subdomain — the
 *  shared-cookie broker path works directly for those; anything else needs
 *  the cross-domain handoff (see module doc comment above). */
function isUnderTampilDev(): boolean {
  const base = typeof window !== "undefined"
    ? window.location.origin
    : process.env.NEXT_PUBLIC_APP_URL || "https://baruma.tampil.dev"
  try {
    const host = new URL(base).hostname
    return host === "tampil.dev" || host.endsWith(".tampil.dev")
  } catch {
    return true
  }
}

/** Broker URL that starts an OAuth login and returns to `nextPath` on this app. */
export function oauthLoginUrl(provider: "google" | "github", nextPath: string): string {
  const finalUrl = absoluteUrl(nextPath)
  const next = isUnderTampilDev()
    ? finalUrl
    : absoluteUrl(`/auth/handoff?final=${encodeURIComponent(nextPath)}`)
  return `${ssoOrigin()}/sso?action=oauth&provider=${provider}&next=${encodeURIComponent(next)}`
}

/** Broker URL that sends a password-recovery email whose link returns to
 *  `nextPath` (a reset-password page) on this app with a recovery session. */
export function recoverUrl(email: string, nextPath: string): string {
  const next = absoluteUrl(nextPath)
  return `${ssoOrigin()}/sso?action=recover&email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`
}
