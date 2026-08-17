// @vitest-environment node
/**
 * Route tests for /api/v1/admin/templates. Every handler is
 * requireAdmin-gated (DB-fresh role check — see src/lib/server/auth-server.ts).
 * POST also revalidates the public ISR pages (/, /templates, /templates/[slug])
 * so a newly-created template doesn't wait out the 5-minute revalidate window.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest"

beforeAll(() => {
  process.env.BARUMA_JWT_SECRET = "test-secret-at-least-32-characters-long"
})

vi.mock("@/lib/server/repo/profiles", () => ({
  getProfileById: vi.fn(),
}))

vi.mock("@/lib/server/repo/templates", () => ({
  createTemplateFromProject: vi.fn(),
  listTemplates: vi.fn(),
  TemplateSourceNotFoundError: class TemplateSourceNotFoundError extends Error {},
}))

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}))

import { GET, POST } from "./route"
import { signToken } from "@/lib/server/auth-server"
import * as profilesRepo from "@/lib/server/repo/profiles"
import * as templatesRepo from "@/lib/server/repo/templates"
import { revalidatePath } from "next/cache"
import type { ProfileRow } from "@/lib/server/repo/profiles"
import type { TemplateDetail } from "@/types/templates"

function fakeProfile(overrides: Partial<ProfileRow> = {}): ProfileRow {
  return {
    id: "user-1",
    email: "someone@baruma.id",
    name: "Someone",
    plan: "free",
    role: "user",
    phone: null,
    credits_used: 0,
    credits_total: 10,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

function fakeTemplate(overrides: Partial<TemplateDetail> = {}): TemplateDetail {
  return {
    id: "tpl-a",
    slug: "dg-01-dua-tona",
    name: "Dua Tona",
    description: null,
    floors: 1,
    rooftop: false,
    thumbnail: "layout-a",
    site: { widthM: 6, depthM: 12, areaM2: 72 },
    sortOrder: 0,
    active: true,
    sourceProjectId: "proj-1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    layout: { rooms: [], walls: [] } as unknown as TemplateDetail["layout"],
    brief: null,
    interior: null,
    ...overrides,
  }
}

async function requestAs(
  role: "user" | "admin",
  init?: RequestInit
): Promise<Request> {
  vi.mocked(profilesRepo.getProfileById).mockResolvedValueOnce(
    fakeProfile({ role })
  )
  const token = await signToken("user-1")
  return new Request("http://localhost/api/v1/admin/templates", {
    ...init,
    headers: { ...(init?.headers ?? {}), authorization: `Bearer ${token}` },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.ADMIN_EMAILS
})

describe("GET /api/v1/admin/templates", () => {
  it("returns 403 for an authenticated non-admin", async () => {
    const req = await requestAs("user")
    const res = await GET(req)
    expect(res.status).toBe(403)
    expect(templatesRepo.listTemplates).not.toHaveBeenCalled()
  })

  it("returns ALL templates (active + inactive) for an admin", async () => {
    vi.mocked(templatesRepo.listTemplates).mockResolvedValueOnce([
      fakeTemplate({ id: "tpl-a" }),
      fakeTemplate({ id: "tpl-b", active: false }),
    ])
    const req = await requestAs("admin")
    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(templatesRepo.listTemplates).toHaveBeenCalledWith(false)
  })
})

describe("POST /api/v1/admin/templates", () => {
  it("returns 403 for a non-admin", async () => {
    const req = await requestAs("user", {
      method: "POST",
      body: JSON.stringify({ projectId: "proj-1", slug: "new-tpl" }),
    })
    const res = await POST(req)
    expect(res.status).toBe(403)
    expect(templatesRepo.createTemplateFromProject).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it("returns 400 for a malformed body (invalid slug)", async () => {
    const req = await requestAs("admin", {
      method: "POST",
      body: JSON.stringify({ projectId: "proj-1", slug: "Not A Slug!" }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    expect(templatesRepo.createTemplateFromProject).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it("creates the template and revalidates /, /templates and the new slug page", async () => {
    const created = fakeTemplate({ slug: "new-tpl" })
    vi.mocked(templatesRepo.createTemplateFromProject).mockResolvedValueOnce(created)
    const req = await requestAs("admin", {
      method: "POST",
      body: JSON.stringify({ projectId: "proj-1", slug: "new-tpl" }),
    })
    const res = await POST(req)
    expect(res.status).toBe(201)
    expect(revalidatePath).toHaveBeenCalledWith("/templates")
    expect(revalidatePath).toHaveBeenCalledWith("/")
    expect(revalidatePath).toHaveBeenCalledWith("/templates/new-tpl")
  })
})
