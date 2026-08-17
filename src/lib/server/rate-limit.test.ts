// @vitest-environment node
import { describe, it, expect } from "vitest"

import { rateLimit, rateLimitGuard, clientIp } from "./rate-limit"

describe("rateLimit — fixed window", () => {
  it("mengizinkan sampai limit lalu menolak; reset setelah window", () => {
    const key = `t-${Math.random()}`
    for (let i = 0; i < 3; i++) expect(rateLimit(key, 3, 60_000).ok).toBe(true)
    const over = rateLimit(key, 3, 60_000)
    expect(over.ok).toBe(false)
    expect(over.retryAfterSec).toBeGreaterThan(0)
    // window 0 ms → langsung reset.
    expect(rateLimit(`${key}-b`, 1, 0).ok).toBe(true)
    expect(rateLimit(`${key}-b`, 1, 0).ok).toBe(true)
  })

  it("clientIp mengutamakan x-real-ip bila ada", () => {
    const req = new Request("http://x", {
      headers: { "x-real-ip": "7.7.7.7", "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    })
    expect(clientIp(req)).toBe("7.7.7.7")
  })

  it("clientIp mengambil elemen TERAKHIR x-forwarded-for (bukan pertama) — header depan bisa dipalsukan klien", () => {
    const req = new Request("http://x", { headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" } })
    expect(clientIp(req)).toBe("5.6.7.8")
  })

  it("clientIp mengabaikan XFF palsu di depan; hop tepercaya (terakhir) tetap dipakai", () => {
    // Klien mengirim X-Forwarded-For sendiri berisi banyak alamat palsu di
    // depan; hanya elemen terakhir (ditambahkan Nginx dari $remote_addr) yang
    // bisa dipercaya.
    const req = new Request("http://x", {
      headers: { "x-forwarded-for": "6.6.6.6, 9.9.9.9, 1.1.1.1, 203.0.113.9" },
    })
    expect(clientIp(req)).toBe("203.0.113.9")
  })

  it("clientIp fallback ke unknown tanpa x-real-ip maupun x-forwarded-for", () => {
    expect(clientIp(new Request("http://x"))).toBe("unknown")
  })

  it("rateLimitGuard mengembalikan 429 + Retry-After saat kuota habis", async () => {
    const mk = () => new Request("http://x", { headers: { "x-forwarded-for": "9.9.9.9" } })
    const scope = `guard-${Math.random()}`
    expect(rateLimitGuard(mk(), { scope, limit: 1, windowMs: 60_000 })).toBeNull()
    const blocked = rateLimitGuard(mk(), { scope, limit: 1, windowMs: 60_000 })!
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get("Retry-After")).toBeTruthy()
  })
})
