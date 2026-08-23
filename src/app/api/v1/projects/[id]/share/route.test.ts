// @vitest-environment node
/**
 * Route tests for /api/v1/projects/[id]/share — owner-only create/read/revoke.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest"

beforeAll(() => {
  process.env.BARUMA_JWT_SECRET = "test-secret-at-least-32-characters-long"
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test"
  process.env.NEXT_PUBLIC_APP_URL = "https://baruma.example"
})

vi.mock("@/lib/server/db", () => ({
  query: vi.fn(),
  getClient: vi.fn(),
}))

vi.mock("@/lib/server/repo/projects", () => ({
  getOwnedProject: vi.fn(),
}))

vi.mock("@/lib/server/repo/share-links", () => ({
  getActiveShareLink: vi.fn(),
  createOrReuseShareLink: vi.fn(),
  revokeShareLinks: vi.fn(),
}))

import { GET, POST, DELETE } from "./route"
import * as projectsRepo from "@/lib/server/repo/projects"
import * as shareLinksRepo from "@/lib/server/repo/share-links"
import { signToken } from "@/lib/server/auth-server"

afterEach(() => {
  vi.mocked(projectsRepo.getOwnedProject).mockReset()
  vi.mocked(shareLinksRepo.getActiveShareLink).mockReset()
  vi.mocked(shareLinksRepo.createOrReuseShareLink).mockReset()
  vi.mocked(shareLinksRepo.revokeShareLinks).mockReset()
})

function reqFor(method: string, token?: string): Request {
  return new Request("http://localhost/api/v1/projects/proj-1/share", {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  })
}

const ctx = { params: Promise.resolve({ id: "proj-1" }) }

describe("GET/POST/DELETE /api/v1/projects/[id]/share", () => {
  it("401s every method without a token", async () => {
    expect((await GET(reqFor("GET"), ctx)).status).toBe(401)
    expect((await POST(reqFor("POST"), ctx)).status).toBe(401)
    expect((await DELETE(reqFor("DELETE"), ctx)).status).toBe(401)
  })

  it("404s for a project the caller doesn't own", async () => {
    const token = await signToken("someone-else")
    vi.mocked(projectsRepo.getOwnedProject).mockResolvedValueOnce(null)
    const res = await POST(reqFor("POST", token), ctx)
    expect(res.status).toBe(404)
    expect(shareLinksRepo.createOrReuseShareLink).not.toHaveBeenCalled()
  })

  it("GET returns {url: null} when no active link exists yet", async () => {
    const token = await signToken("owner-1")
    vi.mocked(projectsRepo.getOwnedProject).mockResolvedValueOnce({ id: "proj-1" } as never)
    vi.mocked(shareLinksRepo.getActiveShareLink).mockResolvedValueOnce(null)
    const res = await GET(reqFor("GET", token), ctx)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ url: null })
  })

  it("POST creates/reuses a link and returns its absolute URL built from NEXT_PUBLIC_APP_URL", async () => {
    const token = await signToken("owner-1")
    vi.mocked(projectsRepo.getOwnedProject).mockResolvedValueOnce({ id: "proj-1" } as never)
    vi.mocked(shareLinksRepo.createOrReuseShareLink).mockResolvedValueOnce({
      id: "shr-1",
      projectId: "proj-1",
      token: "tok-abc123",
      createdAt: "2026-01-01T00:00:00.000Z",
      revokedAt: null,
    })
    const res = await POST(reqFor("POST", token), ctx)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ url: "https://baruma.example/s/tok-abc123" })
  })

  it("DELETE revokes the project's active link(s)", async () => {
    const token = await signToken("owner-1")
    vi.mocked(projectsRepo.getOwnedProject).mockResolvedValueOnce({ id: "proj-1" } as never)
    const res = await DELETE(reqFor("DELETE", token), ctx)
    expect(res.status).toBe(200)
    expect(shareLinksRepo.revokeShareLinks).toHaveBeenCalledWith("proj-1")
  })
})
