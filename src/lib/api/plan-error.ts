"use client"

import { toast } from "sonner"

import { ApiError } from "@/lib/data/http"

/**
 * The 3 billing-enforcement error codes (server = source of truth — see
 * docs/superpowers/specs/2026-07-05-mayar-billing-admin-design.md
 * §Enforcement). Kept as a Set so recognizing a code is a single lookup.
 */
const PLAN_ERROR_CODES = new Set([
  "insufficient_credits",
  "plan_limit_projects",
  "plan_feature_locked",
])

/** Fallback copy in case the server response didn't include a `message`. */
const FALLBACK_MESSAGE: Record<string, string> = {
  insufficient_credits: "Kredit AI Anda telah habis.",
  plan_limit_projects: "Batas jumlah proyek pada plan Anda sudah tercapai.",
  plan_feature_locked: "Fitur ini tidak tersedia di plan Anda.",
}

/**
 * Recognize a plan-related 402/403 (insufficient_credits, plan_limit_projects,
 * plan_feature_locked) and surface it as an upsell toast linking to
 * /app/billing. Returns true when it handled `error`, so the caller can skip
 * its own generic error toast; returns false for anything else so the caller
 * can fall back to normal error handling.
 */
export function handlePlanError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false
  if (!error.code || !PLAN_ERROR_CODES.has(error.code)) return false

  const body = error.body as { message?: unknown } | undefined
  const message =
    (typeof body?.message === "string" && body.message) || FALLBACK_MESSAGE[error.code]

  toast.error(message, {
    action: {
      label: "Upgrade plan",
      onClick: () => {
        window.location.href = "/app/billing"
      },
    },
  })
  return true
}
