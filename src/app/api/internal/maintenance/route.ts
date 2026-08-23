/**
 * Daily maintenance cron target — called by a crontab entry installed by
 * deploy.yml (`curl -X POST .../api/internal/maintenance -H "x-maintenance-
 * secret: ..."`, WS-A's cron idiom: idempotent, secret via GitHub Actions
 * secret written into .env.local). Two jobs, both idempotent under repeat/
 * overlapping runs:
 *
 *  (a) expiry sweep — proactively downgrades every 'active' subscription
 *      whose period has lapsed (gantikan lazy-only expiry di GET /api/v1/me;
 *      lihat src/lib/server/billing-lifecycle.ts's `expireIfLapsed`, dipakai
 *      di SINI juga supaya kedua jalur tak pernah berbeda perilaku), lalu
 *      kirim `expiredEmail`.
 *  (b) renewal reminders — subscriptions aktif yang berakhir dalam 7 hari
 *      dan belum pernah diingatkan (`reminder_sent_at IS NULL`) → kirim
 *      `renewalReminderEmail` + stamp `reminder_sent_at` ATOMIK (guard di
 *      `markReminderSent`, hanya jalur yang benar-benar men-stamp yang
 *      mengirim email — cron yang tumpang tindih tetap kirim SEKALI saja).
 *
 * SECURITY: gated by MAINTENANCE_SECRET, dibandingkan dengan timingSafeEqual
 * (pola sama dengan parentBillingProvider.parseWebhook —
 * src/lib/billing/providers/parent.ts). 401 tanpa secret yang cocok. Kosong
 * MAINTENANCE_SECRET = endpoint MENOLAK SEMUA request (bukan open — fail
 * closed, beda dengan email/billing yang fail-open-ke-no-op).
 */
import { timingSafeEqual } from "crypto"
import { NextResponse } from "next/server"
import * as Sentry from "@sentry/nextjs"

import { expireIfLapsed } from "@/lib/server/billing-lifecycle"
import { sendEmail } from "@/lib/server/email"
import { expiredEmail, renewalReminderEmail } from "@/lib/server/email-templates"
import {
  listExpiredActiveSubscriptions,
  listSubscriptionsNeedingReminder,
  markReminderSent,
} from "@/lib/server/repo/subscriptions"

/** H-berapa reminder dikirim sebelum current_period_end. */
const REMINDER_DAYS_AHEAD = 7

function getEnv(name: string): string | undefined {
  const value = process.env[name]
  if (!value) return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/** Constant-time secret comparison (length-guarded so timingSafeEqual never throws). */
function secretMatches(received: string | undefined, expected: string): boolean {
  if (!received || received.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(received), Buffer.from(expected))
}

function isAuthorized(request: Request): boolean {
  const expected = getEnv("MAINTENANCE_SECRET")
  if (!expected) return false
  const received =
    request.headers.get("x-maintenance-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
  return secretMatches(received ?? undefined, expected)
}

export async function POST(request: Request): Promise<Response> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let expiredCount = 0
  let reminderCount = 0

  try {
    // (a) expiry sweep
    const expiredCandidates = await listExpiredActiveSubscriptions()
    for (const sub of expiredCandidates) {
      const didExpire = await expireIfLapsed(sub.profileId)
      if (!didExpire) continue
      expiredCount += 1
      const sent = await sendEmail({
        to: sub.email,
        subject: "Langganan Anda telah berakhir",
        html: expiredEmail({ planName: sub.planName }),
      })
      if (!sent) {
        console.error(
          `[maintenance] gagal kirim expiredEmail ke ${sub.email} (sub ${sub.id})`
        )
      }
    }

    // (b) renewal reminders
    const reminderCandidates = await listSubscriptionsNeedingReminder(
      REMINDER_DAYS_AHEAD
    )
    for (const sub of reminderCandidates) {
      // Stamp FIRST (atomic guard) — only the caller that actually flips
      // reminder_sent_at from null sends the email, mirroring the
      // activateSubscription/expireSubscription idempotency pattern.
      const stamped = await markReminderSent(sub.id)
      if (!stamped) continue
      reminderCount += 1
      if (!sub.currentPeriodEnd) continue
      const daysLeft = Math.max(
        0,
        Math.ceil(
          (new Date(sub.currentPeriodEnd).getTime() - Date.now()) /
            (24 * 60 * 60 * 1000)
        )
      )
      const sent = await sendEmail({
        to: sub.email,
        subject: "Langganan Anda akan segera berakhir",
        html: renewalReminderEmail({
          planName: sub.planName,
          daysLeft,
          periodEnd: sub.currentPeriodEnd,
        }),
      })
      if (!sent) {
        console.error(
          `[maintenance] gagal kirim renewalReminderEmail ke ${sub.email} (sub ${sub.id})`
        )
      }
    }

    return NextResponse.json({
      ok: true,
      expiredCount,
      reminderCount,
    })
  } catch (e) {
    console.error("[maintenance] handler error:", e)
    Sentry.captureException(e, { tags: { route: "internal-maintenance" } })
    return NextResponse.json(
      { ok: false, error: "Internal server error", expiredCount, reminderCount },
      { status: 500 }
    )
  }
}
