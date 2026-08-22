// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { oauthLoginUrl } from "./sso"

const ORIGINAL_APP_URL = process.env.NEXT_PUBLIC_APP_URL

afterEach(() => {
  if (ORIGINAL_APP_URL === undefined) delete process.env.NEXT_PUBLIC_APP_URL
  else process.env.NEXT_PUBLIC_APP_URL = ORIGINAL_APP_URL
})

describe("oauthLoginUrl", () => {
  it("sends `next` straight to the final destination for a *.tampil.dev deployment", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://baruma.tampil.dev"
    const url = oauthLoginUrl("google", "/home")
    const next = new URL(url).searchParams.get("next")!
    expect(next).toBe("https://baruma.tampil.dev/home")
  })

  it("routes `next` through /auth/handoff, carrying the real destination as `final`, for a non-tampil.dev deployment", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://proj-upgrade.emergent.host"
    const url = oauthLoginUrl("google", "/home")
    const next = new URL(url).searchParams.get("next")!
    const nextUrl = new URL(next)
    expect(nextUrl.origin + nextUrl.pathname).toBe(
      "https://proj-upgrade.emergent.host/auth/handoff"
    )
    expect(nextUrl.searchParams.get("final")).toBe("/home")
  })
})
