/**
 * Server-side auth utilities: argon2 password hashing, JWT sign/verify (HS256),
 * and requireUser() middleware helper for route handlers.
 */
import { hash, verify } from "@node-rs/argon2"
import { SignJWT, jwtVerify } from "jose"

import { getProfileById, getProfileByEmail } from "@/lib/server/repo/profiles"
import { getSupabaseUser } from "@/lib/supabase/server"
import { resolveBarumaProfile } from "@/lib/server/supabase-profile"

const ALGORITHM = "HS256"
const EXPIRES_IN = "30d"

function getJwtSecret(): Uint8Array {
  const secret = process.env.BARUMA_JWT_SECRET
  if (!secret) throw new Error("BARUMA_JWT_SECRET is not set")
  return new TextEncoder().encode(secret)
}

/* ---- password ---- */

/**
 * A pre-computed argon2id hash of a throwaway password.
 * Used by verifyPasswordConstantTime to ensure the no-user path
 * takes the same amount of time as the user-found path, preventing
 * timing oracle attacks that leak which emails are registered.
 *
 * Value: argon2id hash of "dummy-constant-time-password"
 */
export const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHRzb21lc2FsdA$ZiLgKzAzIiVLDagJUhWkSGl0J9YiXvNzGkb7D5fVrSE"

/**
 * Call this when no user profile is found so that the login path
 * always runs an argon2 verification regardless of whether the email exists.
 * This prevents timing-based user enumeration attacks.
 */
export async function verifyPasswordConstantTime(
  candidatePassword: string
): Promise<false> {
  // Always run verification against the dummy hash; always returns false.
  await verifyPassword(DUMMY_PASSWORD_HASH, candidatePassword)
  return false
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password)
}

export async function verifyPassword(
  hash: string,
  password: string
): Promise<boolean> {
  try {
    return await verify(hash, password)
  } catch {
    return false
  }
}

/* ---- JWT ---- */

export async function signToken(
  sub: string,
  expiresIn: string | number = EXPIRES_IN
): Promise<string> {
  return new SignJWT({ sub })
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(getJwtSecret())
}

export async function verifyToken(jwt: string): Promise<{ userId: string }> {
  const { payload } = await jwtVerify(jwt, getJwtSecret(), {
    algorithms: [ALGORITHM],
  })
  const userId = payload.sub
  if (!userId) throw new Error("JWT missing sub")
  return { userId }
}

/* ---- requireUser ---- */

/** Marker error so route handlers can produce a clean 401. */
export class UnauthorizedError extends Error {
  constructor(message = "Unauthorized") {
    super(message)
    this.name = "UnauthorizedError"
  }
}

/**
 * Marker error so route handlers can produce a clean 403. Distinct from
 * UnauthorizedError: the caller IS authenticated (valid Bearer token) but
 * lacks the permission the route requires (e.g. admin-only).
 */
export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message)
    this.name = "ForbiddenError"
  }
}

/**
 * Authenticate the request → the Baruma profile id. Two sources, in order:
 *
 *  1. `Authorization: Bearer <jwt>` — a Baruma-signed JWT. Kept for programmatic
 *     API access and as the stable contract exercised by route tests.
 *  2. The Supabase session cookie (shared `.tampil.dev` SSO). Same-origin app
 *     requests carry it automatically; the Supabase user is mapped to (or
 *     lazily linked/created as) a Baruma profile via `resolveBarumaProfile`.
 *
 * Throws UnauthorizedError (→ 401) when neither yields a user. Bearer is tried
 * first so it stays a pure header check with no cookie/Supabase dependency.
 */
export async function requireUser(
  request: Request
): Promise<{ userId: string }> {
  const authHeader = request.headers.get("authorization") ?? ""
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    const token = authHeader.slice(7).trim()
    if (!token) throw new UnauthorizedError("Missing Bearer token")
    try {
      return await verifyToken(token)
    } catch {
      throw new UnauthorizedError("Invalid or expired token")
    }
  }

  const supaUser = await getSupabaseUser()
  if (supaUser?.email) {
    const meta = (supaUser.user_metadata ?? {}) as { full_name?: string; name?: string }
    const profile = await resolveBarumaProfile({
      id: supaUser.id,
      email: supaUser.email,
      name: meta.full_name ?? meta.name ?? null,
    })
    return { userId: profile.id }
  }

  throw new UnauthorizedError("Not authenticated")
}

/** Parse ADMIN_EMAILS into a normalized (lowercase, trimmed) allowlist. */
export function adminEmailAllowlist(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

/**
 * Bearer-auth + admin gate for admin-only API routes.
 *
 * Always re-fetches the profile from the DB — the Auth.js session `role` is
 * UI-only (show/hide the Admin nav item) and must never be trusted for
 * authorization; this is the actual gate.
 *
 * Throws UnauthorizedError (→ 401, via requireUser) when the Bearer token
 * itself is missing/invalid/expired — the caller isn't authenticated at all.
 * Throws ForbiddenError (→ 403) when the token is valid but the profile is
 * not an admin — the caller IS authenticated, just not permitted, which is
 * what 403 means.
 *
 * The `ADMIN_EMAILS` bootstrap fallback additionally requires `supabase_uid`
 * to be set (i.e. the account is linked to a `.tampil.dev` SSO identity), NOT
 * just a `profiles.email` match. `email` on a self-registered (local
 * password) profile is caller-chosen at `POST /api/v1/auth/register` — with
 * no ownership check — so trusting a bare email match there would let anyone
 * register with an admin's email and be granted admin. `supabase_uid` is only
 * ever set by `resolveBarumaProfile()`/Supabase SSO, which the caller cannot
 * forge, so it's the actual "this really is that email's owner" signal. A
 * profile with a DB `role === 'admin'` is exempt from this check — that's an
 * explicit grant by an existing admin (or seed data) and must keep working
 * regardless of how the account authenticates.
 */
export async function requireAdmin(
  request: Request
): Promise<{ userId: string }> {
  const { userId } = await requireUser(request)
  const profile = await getProfileById(userId)
  const isAdmin =
    profile?.role === "admin" ||
    (!!profile?.supabase_uid &&
      !!profile?.email &&
      adminEmailAllowlist().includes(profile.email.toLowerCase()))
  if (!isAdmin) throw new ForbiddenError("Admin access required")
  return { userId }
}

/**
 * DB-fresh admin check by email — the counterpart to `requireAdmin` for
 * contexts that only have a Supabase session (not a Bearer token), namely
 * the `/app/admin` layout. Same rule as `requireAdmin`: a profile whose
 * `role` column is `'admin'`, OR an `ADMIN_EMAILS`-listed bootstrap admin.
 *
 * Takes an email and re-fetches the profile because the Supabase session
 * carries no role claim — authorization must come from the DB (or the
 * ADMIN_EMAILS allowlist), never the client-held session. This makes the
 * layout's authorization boundary identical in spirit to every
 * `/api/v1/admin/*` route's `requireAdmin` call.
 *
 * Checks the `ADMIN_EMAILS` allowlist FIRST (free, no DB) and short-circuits
 * on a match; only falls through to the DB profile-role lookup otherwise.
 * That DB call is wrapped and fails closed (returns `false`) on any error —
 * unlike `/api/v1/admin/*` routes (which the client-side mock data layer
 * never actually calls in DB-less dev/e2e mode), this function backs a
 * Server Component layout that runs as real server code on every navigation
 * in every mode, so it must degrade to "not admin" rather than crash the
 * whole page when there's no `DATABASE_URL` (or the DB is unreachable).
 */
export async function isAdminEmail(
  email: string | null | undefined
): Promise<boolean> {
  if (!email) return false
  const normalized = email.toLowerCase()
  if (adminEmailAllowlist().includes(normalized)) return true
  try {
    const profile = await getProfileByEmail(email)
    return profile?.role === "admin"
  } catch {
    // No DB configured (or a transient DB error) — fail closed. This function
    // backs the /app/admin layout, which runs as real server code on every
    // navigation in every mode (no mock-data-layer bypass exists for a Server
    // Component the way there is for client-side API calls), so it must
    // degrade gracefully to "not admin" rather than crash the whole page.
    return false
  }
}
