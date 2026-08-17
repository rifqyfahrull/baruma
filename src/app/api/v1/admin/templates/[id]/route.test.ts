// @vitest-environment node
/**
 * Route tests for /api/v1/admin/templates/[id]. Every handler is
 * requireAdmin-gated (DB-fresh role check). PATCH/DELETE revalidate the
 * public ISR pages (/, /templates, /templates/[slug]) so admin edits don't
 * wait out the 5-minute revalidate window — PATCH must revalidate BOTH the
 * old and new slug when a slug change is part of the edit.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest"

beforeAll(() => {
  process.env.BARUMA_JWT_SECRET = "test-secret-at-least-32-characters-long"
})

vi.mock("@/lib/server/repo/profiles", () => ({
  getProfileById: vi.fn(),
}))

vi.mock("@/lib/server/repo/templates", () => ({
  deleteTemplate: vi.fn(),
  getTemplateSlugById: vi.fn(),
  resyncTemplateFromSource: vi.fn(),
  updateTemplateMeta: vi.fn(),
}))

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}))

import { PATCH, DELETE } from "./route"
import { signToken } from "@/lib/server/auth-server"
import * as profilesRepo from "@/lib/server/repo/profiles"
import * as templatesRepo from "@/lib/server/repo/templates"
import { revalidatePath } from "next/cache"
import type { ProfileRow } from "@/lib/server/repo/profiles"
import type { TemplateDetail, TemplateSummary } from "@/types/templates"

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

function fakeSummary(overrides: Partial<TemplateSummary> = {}): TemplateSummary {
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
    ...overrides,
  }
}

function fakeDetail(overrides: Partial<TemplateDetail> = {}): TemplateDetail {
  return {
    ...fakeSummary(),
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
  return new Request("http://localhost/api/v1/admin/templates/tpl-a", {
    ...init,
    headers: { ...(init?.headers ?? {}), authorization: `Bearer ${token}` },
  })
}

function ctx(id = "tpl-a") {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.ADMIN_EMAILS
})

describe("PATCH /api/v1/admin/templates/[id]", () => {
  it("returns 403 for a non-admin", async () => {
    const req = await requestAs("user", {
      method: "PATCH",
      body: JSON.stringify({ name: "New name" }),
    })
    const res = await PATCH(req, ctx())
    expect(res.status).toBe(403)
    expect(templatesRepo.updateTemplateMeta).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it("returns 400 when no field is provided", async () => {
    const req = await requestAs("admin", { method: "PATCH", body: JSON.stringify({}) })
    const res = await PATCH(req, ctx())
    expect(res.status).toBe(400)
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it("meta-only edit revalidates the (unchanged) slug once", async () => {
    vi.mocked(templatesRepo.getTemplateSlugById).mockResolvedValueOnce(
      "dg-01-dua-tona"
    )
    vi.mocked(templatesRepo.updateTemplateMeta).mockResolvedValueOnce(
      fakeSummary({ name: "Nama Baru" })
    )
    const req = await requestAs("admin", {
      method: "PATCH",
      body: JSON.stringify({ name: "Nama Baru" }),
    })
    const res = await PATCH(req, ctx())
    expect(res.status).toBe(200)
    expect(revalidatePath).toHaveBeenCalledWith("/templates")
    expect(revalidatePath).toHaveBeenCalledWith("/")
    expect(revalidatePath).toHaveBeenCalledWith("/templates/dg-01-dua-tona")
  })

  it("a slug-changing edit revalidates BOTH the old and new slug pages", async () => {
    vi.mocked(templatesRepo.getTemplateSlugById).mockResolvedValueOnce(
      "old-slug"
    )
    vi.mocked(templatesRepo.updateTemplateMeta).mockResolvedValueOnce(
      fakeSummary({ slug: "new-slug" })
    )
    const req = await requestAs("admin", {
      method: "PATCH",
      body: JSON.stringify({ slug: "new-slug" }),
    })
    const res = await PATCH(req, ctx())
    expect(res.status).toBe(200)
    expect(revalidatePath).toHaveBeenCalledWith("/templates/old-slug")
    expect(revalidatePath).toHaveBeenCalledWith("/templates/new-slug")
  })

  it("a resync revalidates the slug too", async () => {
    vi.mocked(templatesRepo.getTemplateSlugById).mockResolvedValueOnce(
      "dg-01-dua-tona"
    )
    vi.mocked(templatesRepo.resyncTemplateFromSource).mockResolvedValueOnce(
      fakeDetail()
    )
    const req = await requestAs("admin", {
      method: "PATCH",
      body: JSON.stringify({ resync: true }),
    })
    const res = await PATCH(req, ctx())
    expect(res.status).toBe(200)
    expect(revalidatePath).toHaveBeenCalledWith("/templates/dg-01-dua-tona")
  })

  it("returns 404 (and does not revalidate) when the template doesn't exist", async () => {
    vi.mocked(templatesRepo.getTemplateSlugById).mockResolvedValueOnce(null)
    vi.mocked(templatesRepo.updateTemplateMeta).mockResolvedValueOnce(null)
    const req = await requestAs("admin", {
      method: "PATCH",
      body: JSON.stringify({ name: "x" }),
    })
    const res = await PATCH(req, ctx())
    expect(res.status).toBe(404)
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

describe("DELETE /api/v1/admin/templates/[id]", () => {
  it("returns 403 for a non-admin", async () => {
    const req = await requestAs("user", { method: "DELETE" })
    const res = await DELETE(req, ctx())
    expect(res.status).toBe(403)
    expect(templatesRepo.deleteTemplate).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it("looks up the slug BEFORE deleting, then revalidates its page", async () => {
    vi.mocked(templatesRepo.getTemplateSlugById).mockResolvedValueOnce(
      "dg-01-dua-tona"
    )
    vi.mocked(templatesRepo.deleteTemplate).mockResolvedValueOnce(true)
    const req = await requestAs("admin", { method: "DELETE" })
    const res = await DELETE(req, ctx())
    expect(res.status).toBe(200)
    expect(revalidatePath).toHaveBeenCalledWith("/templates")
    expect(revalidatePath).toHaveBeenCalledWith("/")
    expect(revalidatePath).toHaveBeenCalledWith("/templates/dg-01-dua-tona")
  })

  it("returns 404 (and does not revalidate) when the template doesn't exist", async () => {
    vi.mocked(templatesRepo.getTemplateSlugById).mockResolvedValueOnce(null)
    vi.mocked(templatesRepo.deleteTemplate).mockResolvedValueOnce(false)
    const req = await requestAs("admin", { method: "DELETE" })
    const res = await DELETE(req, ctx())
    expect(res.status).toBe(404)
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})
