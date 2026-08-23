// @vitest-environment node
/**
 * Unit tests for src/lib/server/email.ts — mocked fetch, no real Resend call.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }))

import * as Sentry from "@sentry/nextjs"
import { emailEnabled, sendEmail } from "./email"

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal("fetch", vi.fn())
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.unstubAllGlobals()
})

describe("emailEnabled", () => {
  it("is false when RESEND_API_KEY is unset", () => {
    delete process.env.RESEND_API_KEY
    process.env.EMAIL_FROM = "Baruma <no-reply@baruma.app>"
    expect(emailEnabled()).toBe(false)
  })

  it("is false when EMAIL_FROM is unset", () => {
    process.env.RESEND_API_KEY = "re_test_123"
    delete process.env.EMAIL_FROM
    expect(emailEnabled()).toBe(false)
  })

  it("is true when both are set", () => {
    process.env.RESEND_API_KEY = "re_test_123"
    process.env.EMAIL_FROM = "Baruma <no-reply@baruma.app>"
    expect(emailEnabled()).toBe(true)
  })
})

describe("sendEmail", () => {
  it("no-ops (returns false, never calls fetch) when env is unset", async () => {
    delete process.env.RESEND_API_KEY
    delete process.env.EMAIL_FROM
    const ok = await sendEmail({ to: "a@b.com", subject: "Hi", html: "<p>hi</p>" })
    expect(ok).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })

  it("posts to the Resend API with the bearer token + from address", async () => {
    process.env.RESEND_API_KEY = "re_test_123"
    process.env.EMAIL_FROM = "Baruma <no-reply@baruma.app>"
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "email-1" }), { status: 200 })
    )

    const ok = await sendEmail({ to: "user@example.com", subject: "Halo", html: "<p>Halo</p>" })
    expect(ok).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe("https://api.resend.com/emails")
    expect(init?.method).toBe("POST")
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer re_test_123"
    )
    const body = JSON.parse(init?.body as string)
    expect(body.from).toBe("Baruma <no-reply@baruma.app>")
    expect(body.to).toBe("user@example.com")
    expect(body.subject).toBe("Halo")
  })

  it("returns false and reports to Sentry on a non-2xx response (never throws)", async () => {
    process.env.RESEND_API_KEY = "re_test_123"
    process.env.EMAIL_FROM = "Baruma <no-reply@baruma.app>"
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("invalid api key", { status: 401 })
    )

    const ok = await sendEmail({ to: "user@example.com", subject: "Halo", html: "<p>Halo</p>" })
    expect(ok).toBe(false)
    expect(Sentry.captureException).toHaveBeenCalledTimes(1)
  })

  it("returns false and reports to Sentry when fetch throws (network error)", async () => {
    process.env.RESEND_API_KEY = "re_test_123"
    process.env.EMAIL_FROM = "Baruma <no-reply@baruma.app>"
    vi.mocked(fetch).mockRejectedValueOnce(new Error("network down"))

    const ok = await sendEmail({ to: "user@example.com", subject: "Halo", html: "<p>Halo</p>" })
    expect(ok).toBe(false)
    expect(Sentry.captureException).toHaveBeenCalledTimes(1)
  })
})
