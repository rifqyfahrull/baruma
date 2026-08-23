// @vitest-environment node
/**
 * Route tests for the public POST /api/v1/share/[token]/comments — no auth,
 * rate-limited 5/min/IP, 404 for an unknown/revoked token.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("@/lib/server/repo/share-links", () => ({
  getShareLinkByToken: vi.fn(),
}))

vi.mock("@/lib/server/repo/review", () => ({
  insertComment: vi.fn(),
}))

import { POST } from "./route"
import * as shareLinksRepo from "@/lib/server/repo/share-links"
import * as reviewRepo from "@/lib/server/repo/review"
import { __resetRateLimitStore } from "@/lib/server/rate-limit"

beforeEach(() => {
  __resetRateLimitStore()
})

afterEach(() => {
  vi.mocked(shareLinksRepo.getShareLinkByToken).mockReset()
  vi.mocked(reviewRepo.insertComment).mockReset()
})

function postFor(token: string, body: unknown, ip = "1.2.3.4"): Request {
  return new Request(`http://localhost/api/v1/share/${token}/comments`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": ip },
    body: JSON.stringify(body),
  })
}

const ctxFor = (token: string) => ({ params: Promise.resolve({ token }) })

describe("POST /api/v1/share/[token]/comments", () => {
  it("404s for an unknown/revoked token", async () => {
    vi.mocked(shareLinksRepo.getShareLinkByToken).mockResolvedValueOnce(null)
    const res = await POST(postFor("nope", { name: "Budi", body: "Bagus!" }), ctxFor("nope"))
    expect(res.status).toBe(404)
    expect(reviewRepo.insertComment).not.toHaveBeenCalled()
  })

  it("inserts the comment with the submitted name as author (not 'Kamu')", async () => {
    vi.mocked(shareLinksRepo.getShareLinkByToken).mockResolvedValue({
      id: "shr-1",
      projectId: "proj-1",
      token: "tok-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      revokedAt: null,
    })
    vi.mocked(reviewRepo.insertComment).mockResolvedValueOnce({
      id: "c-1",
      author: "Budi",
      body: "Bagus!",
      createdAt: "2026-01-01T00:00:00.000Z",
      resolved: false,
    })
    const res = await POST(postFor("tok-1", { name: "Budi", body: "Bagus!" }), ctxFor("tok-1"))
    expect(res.status).toBe(200)
    expect(reviewRepo.insertComment).toHaveBeenCalledWith("proj-1", "Bagus!", "Budi")
  })

  it("400s on missing name/body", async () => {
    vi.mocked(shareLinksRepo.getShareLinkByToken).mockResolvedValue({
      id: "shr-1",
      projectId: "proj-1",
      token: "tok-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      revokedAt: null,
    })
    const res = await POST(postFor("tok-1", { name: "", body: "" }), ctxFor("tok-1"))
    expect(res.status).toBe(400)
  })

  it("rate-limits after 5 requests/min from the same IP", async () => {
    vi.mocked(shareLinksRepo.getShareLinkByToken).mockResolvedValue({
      id: "shr-1",
      projectId: "proj-1",
      token: "tok-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      revokedAt: null,
    })
    vi.mocked(reviewRepo.insertComment).mockResolvedValue({
      id: "c-1",
      author: "Budi",
      body: "Halo",
      createdAt: "2026-01-01T00:00:00.000Z",
      resolved: false,
    })
    const ip = "9.9.9.9"
    for (let i = 0; i < 5; i++) {
      const res = await POST(postFor("tok-1", { name: "Budi", body: "Halo" }, ip), ctxFor("tok-1"))
      expect(res.status).toBe(200)
    }
    const sixth = await POST(postFor("tok-1", { name: "Budi", body: "Halo" }, ip), ctxFor("tok-1"))
    expect(sixth.status).toBe(429)
  })
})
