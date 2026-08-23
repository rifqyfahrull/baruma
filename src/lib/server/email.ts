/**
 * Email transaksional via Resend — dipanggil lewat `fetch` polos (TANPA SDK
 * `resend`, sesuai keputusan WS-B: satu dependensi lebih sedikit untuk
 * fungsi yang cuma butuh satu POST).
 *
 * Kontrak: `sendEmail` TIDAK PERNAH throw. Kegagalan (env kosong, network,
 * atau respons non-2xx dari Resend) dicatat via `console.error` +
 * `Sentry.captureException` (no-op sepenuhnya tanpa SENTRY_DSN, sama seperti
 * src/lib/server/response.ts) dan hanya mengembalikan `false` — pengiriman
 * email TIDAK BOLEH pernah menggagalkan alur bisnis yang memicunya
 * (registrasi, aktivasi pembayaran, cron maintenance). Caller selalu
 * memanggil ini dari dalam `after()` (lihat src/app/api/v1/auth/register/
 * route.ts dan src/app/api/webhooks/payment/route.ts) — bukan sebelum
 * response dikirim.
 *
 * Env kosong (`RESEND_API_KEY` atau `EMAIL_FROM`) = fitur email nonaktif
 * total, no-op senyap (bukan error) — pola yang sama dengan
 * `isParentBillingConfigured()` di lib/billing/providers/parent.ts.
 */
import * as Sentry from "@sentry/nextjs"

const RESEND_ENDPOINT = "https://api.resend.com/emails"

function getEnv(name: string): string | undefined {
  const value = process.env[name]
  if (!value) return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/** True iff RESEND_API_KEY + EMAIL_FROM keduanya terisi — sends bisa jalan. */
export function emailEnabled(): boolean {
  return Boolean(getEnv("RESEND_API_KEY") && getEnv("EMAIL_FROM"))
}

export type SendEmailInput = {
  to: string
  subject: string
  html: string
}

/**
 * Kirim satu email transaksional via Resend. Selalu resolve (tidak pernah
 * reject) — `true` bila Resend menerima permintaan (2xx), `false` untuk
 * setiap kegagalan lain (termasuk env kosong).
 */
export async function sendEmail(input: SendEmailInput): Promise<boolean> {
  const apiKey = getEnv("RESEND_API_KEY")
  const from = getEnv("EMAIL_FROM")
  if (!apiKey || !from) return false

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from,
        to: input.to,
        subject: input.subject,
        html: input.html,
      }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      const err = new Error(
        `Resend send failed (${res.status}): ${body.slice(0, 300) || "no body"}`
      )
      console.error("[email] send failed:", err.message)
      Sentry.captureException(err, {
        tags: { route: "email-send" },
        extra: { to: input.to, subject: input.subject, status: res.status },
      })
      return false
    }
    return true
  } catch (e) {
    console.error("[email] send failed:", e instanceof Error ? e.message : e)
    Sentry.captureException(e, {
      tags: { route: "email-send" },
      extra: { to: input.to, subject: input.subject },
    })
    return false
  }
}
