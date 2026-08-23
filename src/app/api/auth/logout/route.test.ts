import { describe, expect, it } from "vitest"
import { NextRequest } from "next/server"
import { POST } from "./route"

describe("POST /api/auth/logout", () => {
  it("clears sb-* auth cookies with Max-Age=0", async () => {
    const req = new NextRequest("http://localhost:3000/api/auth/logout", {
      method: "POST",
      headers: {
        cookie: "sb-mock-auth-token=token123; other_cookie=val",
      },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)

    const setCookieHeaders = res.headers.getSetCookie()
    expect(setCookieHeaders.some((c) => c.includes("sb-mock-auth-token=") && c.includes("Max-Age=0"))).toBe(true)
  })
})
