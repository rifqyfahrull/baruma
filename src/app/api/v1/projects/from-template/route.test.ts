// @vitest-environment node
/**
 * Route tests for POST /api/v1/projects/from-template — plan quota gate
 * (tolerant of `maxProjects: number | null`) + clone integrity (brief/layout
 * copied under a NEW project id, source template untouched).
 */
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest"

beforeAll(() => {
  process.env.BARUMA_JWT_SECRET = "test-secret-at-least-32-characters-long"
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test"
})

vi.mock("@/lib/server/db", () => ({
  query: vi.fn(),
  getClient: vi.fn(),
}))

vi.mock("@/lib/server/repo/templates", () => ({
  getTemplateBySlug: vi.fn(),
}))

vi.mock("@/lib/server/repo/projects", () => ({
  createProject: vi.fn(),
  listProjectsByOwner: vi.fn(),
}))

vi.mock("@/lib/server/repo/briefs", () => ({
  upsertBrief: vi.fn(),
}))

vi.mock("@/lib/server/repo/layouts", () => ({
  insertLayoutIfAbsent: vi.fn(),
}))

vi.mock("@/lib/server/entitlements", () => ({
  getEntitlements: vi.fn(),
}))

import { POST } from "./route"
import * as templatesRepo from "@/lib/server/repo/templates"
import * as projectsRepo from "@/lib/server/repo/projects"
import * as briefsRepo from "@/lib/server/repo/briefs"
import * as layoutsRepo from "@/lib/server/repo/layouts"
import * as entitlementsLib from "@/lib/server/entitlements"
import { signToken } from "@/lib/server/auth-server"
import type { DesignLayout, Entitlements } from "@/types"
import type { TemplateDetail } from "@/types/templates"

afterEach(() => {
  vi.mocked(templatesRepo.getTemplateBySlug).mockReset()
  vi.mocked(projectsRepo.createProject).mockReset()
  vi.mocked(projectsRepo.listProjectsByOwner).mockReset()
  vi.mocked(briefsRepo.upsertBrief).mockReset()
  vi.mocked(layoutsRepo.insertLayoutIfAbsent).mockReset()
  vi.mocked(entitlementsLib.getEntitlements).mockReset()
})

function entitlements(overrides: Partial<Entitlements> = {}): Entitlements {
  return { creditsPerPeriod: 10, maxProjects: 1, exportPdf: false, glbUpload: false, ...overrides }
}

const FAKE_LAYOUT = {
  id: "layout-tpl",
  projectId: "proj-source",
  versionId: "v1",
  floors: [{ id: "floor-1", level: 1, name: "Lantai 1", heightM: 3.2 }],
  rooms: [
    { id: "r1", floorId: "floor-1", name: "Ruang tamu", type: "ruang_tamu", x: 0, y: 0, width: 3, depth: 3, areaM2: 9 },
    { id: "r2", floorId: "floor-1", name: "Dapur", type: "dapur", x: 3, y: 0, width: 3, depth: 3, areaM2: 9 },
    { id: "r3", floorId: "floor-1", name: "Kamar", type: "kamar_tidur", x: 6, y: 0, width: 3, depth: 3, areaM2: 9 },
  ],
  walls: [],
  openings: [],
  stairs: [],
  pools: [],
  validation: { passed: true, issues: [] },
} as unknown as DesignLayout

function fakeTemplate(overrides: Partial<TemplateDetail> = {}): TemplateDetail {
  return {
    id: "tpl-a",
    slug: "template-a",
    name: "Template A",
    description: "Deskripsi",
    style: "modern_tropis",
    city: "Bandung",
    province: "Jawa Barat",
    floors: 1,
    rooftop: false,
    thumbnail: "family",
    site: { widthM: 9, depthM: 15, areaM2: 135 },
    layout: FAKE_LAYOUT,
    brief: { projectId: "proj-source", summary: "Ringkasan brief." } as never,
    interior: null,
    sortOrder: 1,
    active: true,
    sourceProjectId: "proj-source",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  }
}

function postRequest(token: string, body: unknown) {
  return new Request("http://localhost/api/v1/projects/from-template", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
}

describe("POST /api/v1/projects/from-template", () => {
  it("returns 401 without a token", async () => {
    const res = await POST(new Request("http://localhost/api/v1/projects/from-template", {
      method: "POST",
      body: JSON.stringify({ slug: "template-a" }),
    }))
    expect(res.status).toBe(401)
  })

  it("returns 404 for an unknown/inactive template slug", async () => {
    const token = await signToken("user-1")
    vi.mocked(templatesRepo.getTemplateBySlug).mockResolvedValueOnce(null)
    const res = await POST(postRequest(token, { slug: "nope" }))
    expect(res.status).toBe(404)
  })

  it("returns 403 plan_limit_projects when maxProjects is a finite number already reached", async () => {
    const token = await signToken("user-at-limit")
    vi.mocked(templatesRepo.getTemplateBySlug).mockResolvedValueOnce(fakeTemplate())
    vi.mocked(entitlementsLib.getEntitlements).mockResolvedValueOnce(entitlements({ maxProjects: 1 }))
    vi.mocked(projectsRepo.listProjectsByOwner).mockResolvedValueOnce([{ id: "proj-existing" } as never])

    const res = await POST(postRequest(token, { slug: "template-a" }))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe("plan_limit_projects")
    expect(projectsRepo.createProject).not.toHaveBeenCalled()
  })

  it("skips the quota check entirely when maxProjects is null (unlimited plan)", async () => {
    const token = await signToken("user-unlimited")
    vi.mocked(templatesRepo.getTemplateBySlug).mockResolvedValueOnce(fakeTemplate())
    vi.mocked(entitlementsLib.getEntitlements).mockResolvedValueOnce(
      entitlements({ maxProjects: null as unknown as number })
    )
    vi.mocked(projectsRepo.createProject).mockResolvedValueOnce({
      id: "proj-new",
      name: "Template A (salinan)",
      status: "editing",
      readiness: "concept_ready",
      projectType: "new",
      thumbnail: "family",
      floors: 1,
      rooftop: false,
      site: { widthM: 9, depthM: 15, areaM2: 135 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    vi.mocked(briefsRepo.upsertBrief).mockResolvedValueOnce(undefined as never)
    vi.mocked(layoutsRepo.insertLayoutIfAbsent).mockResolvedValueOnce(undefined as never)

    const res = await POST(postRequest(token, { slug: "template-a" }))
    expect(res.status).toBe(200)
    // The tolerant `!= null` quota check must never touch listProjectsByOwner
    // once maxProjects is null — proves it's actually skipped, not just
    // coincidentally passing.
    expect(projectsRepo.listProjectsByOwner).not.toHaveBeenCalled()
  })

  it("clones brief + full layout (all 3 rooms) under the NEW project id, named '<template> (salinan)'", async () => {
    const token = await signToken("user-clone")
    const template = fakeTemplate()
    vi.mocked(templatesRepo.getTemplateBySlug).mockResolvedValueOnce(template)
    vi.mocked(entitlementsLib.getEntitlements).mockResolvedValueOnce(entitlements({ maxProjects: 5 }))
    vi.mocked(projectsRepo.listProjectsByOwner).mockResolvedValueOnce([])
    vi.mocked(projectsRepo.createProject).mockResolvedValueOnce({
      id: "proj-new-1",
      name: "Template A (salinan)",
      status: "editing",
      readiness: "concept_ready",
      projectType: "new",
      thumbnail: "family",
      floors: 1,
      rooftop: false,
      site: template.site,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    vi.mocked(briefsRepo.upsertBrief).mockResolvedValueOnce(undefined as never)
    vi.mocked(layoutsRepo.insertLayoutIfAbsent).mockResolvedValueOnce(undefined as never)

    const res = await POST(postRequest(token, { slug: "template-a" }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ projectId: "proj-new-1" })

    const createCall = vi.mocked(projectsRepo.createProject).mock.calls.at(-1)![0]
    expect(createCall.name).toBe("Template A (salinan)")
    expect(createCall.ownerId).toBe("user-clone")
    expect(createCall.id).not.toBe(template.sourceProjectId)

    const briefCall = vi.mocked(briefsRepo.upsertBrief).mock.calls.at(-1)!
    expect(briefCall[0]).toBe("proj-new-1")
    expect(briefCall[1].projectId).toBe("proj-new-1")

    const layoutCall = vi.mocked(layoutsRepo.insertLayoutIfAbsent).mock.calls.at(-1)!
    expect(layoutCall[0]).toBe("proj-new-1")
    expect((layoutCall[2] as DesignLayout).rooms).toHaveLength(3)
    expect((layoutCall[2] as DesignLayout).rooms).toEqual(FAKE_LAYOUT.rooms)
  })
})
