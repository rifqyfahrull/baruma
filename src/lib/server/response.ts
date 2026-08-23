/**
 * Route handler response helpers. Never leak DB/pg errors to the client.
 */
import { NextResponse } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { ForbiddenError, UnauthorizedError } from "./auth-server"
import { PlanFeatureLockedError } from "./entitlements"

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status })
}

export function err(status: number, message: string): NextResponse {
  return NextResponse.json({ error: message }, { status })
}

/**
 * Error response carrying a machine-readable `code` alongside a human
 * `message` — used by billing enforcement (402 insufficient_credits, 403
 * plan_limit_projects/plan_feature_locked) so clients can match on `error`
 * while still showing `message`. Mirrors the shape already used by
 * src/app/api/checkout/route.ts (`{error: "payment_not_configured", message}`).
 */
export function errCode(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: code, message }, { status })
}

/** Handle a caught error in a route handler, sanitizing pg messages. */
export function handleError(e: unknown): NextResponse {
  if (e instanceof UnauthorizedError) {
    return err(401, e.message)
  }
  if (e instanceof ForbiddenError) {
    return err(403, e.message)
  }
  if (e instanceof PlanFeatureLockedError) {
    return errCode(403, "plan_feature_locked", e.message)
  }
  // Never expose DSN or pg internals.
  const message =
    e instanceof Error && !isPgError(e) ? e.message : "Internal server error"
  console.error("[api]", e)
  // Hanya jalur 500 tak terduga yang dikirim ke Sentry (bukan 401/403/plan-
  // locked yang sudah di-return di atas — itu bukan bug, itu perilaku
  // normal). No-op sepenuhnya tanpa SENTRY_DSN (lihat instrumentation.ts).
  Sentry.captureException(e)
  return err(500, message)
}

function isPgError(e: Error): boolean {
  // pg errors have a 'code' property (e.g. '23505')
  return "code" in e && typeof (e as { code: unknown }).code === "string"
}
