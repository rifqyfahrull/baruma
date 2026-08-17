// @vitest-environment node
/**
 * Route tests for GET/PATCH /api/v1/projects/[id]/brief
 */
import { describe, it, expect, vi, beforeAll } from "vitest"

beforeAll(() => {
  process.env.BARUMA_JWT_SECRET = "test-secret-at-least-32-characters-long"
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test"
})

vi.mock("@/lib/server/db", () => ({
  query: vi.fn(),
  getClient: vi.fn(),
}))

vi.mock("@/lib/server/repo/projects", () => ({
  getOwnedProject: vi.fn(),
  listProjectsByOwner: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  updateProjectSite: vi.fn(),
}))

vi.mock("@/lib/server/repo/briefs", () => ({
  getBriefPayload: vi.fn(),
  upsertBrief: vi.fn(),
  patchBrief: vi.fn(),
}))

import { GET, PATCH } from "./route"
import * as projectsRepo from "@/lib/server/repo/projects"
import * as briefsRepo from "@/lib/server/repo/briefs"
import { signToken } from "@/lib/server/auth-server"
import type { Brief } from "@/types"

const mockBrief: Brief = {
  projectId: "proj-xyz",
  summary: "Test brief",
  site: { widthM: 8, depthM: 10, areaM2: 80 },
  building: {
    floors: 2,
    rooftop: false,
    budget: { minIDR: 500_000_000, maxIDR: 900_000_000 },
    finishingLevel: "standar",
  },
  priorities: ["hemat_biaya"],
  spaceProgram: [],
  assumptions: [],
  constraints: [],
  risks: [],
}

const ctx = { params: Promise.resolve({ id: "proj-xyz" }) }

describe("PATCH /api/v1/projects/[id]/brief", () => {
  it("returns 401 without token", async () => {
    const req = new Request("http://localhost/api/v1/projects/proj-xyz/brief", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ summary: "Updated" }),
    })
    const res = await PATCH(req, ctx)
    expect(res.status).toBe(401)
  })

  it("returns 400 when body is not an object (array)", async () => {
    const token = await signToken("user-patch")
    vi.mocked(projectsRepo.getOwnedProject).mockResolvedValueOnce({
      id: "proj-xyz",
      name: "Test",
      status: "brief",
      readiness: "concept_ready",
      projectType: "new",
      thumbnail: "family",
      floors: 1,
      rooftop: false,
      site: { widthM: 8, depthM: 10, areaM2: 80 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    const req = new Request("http://localhost/api/v1/projects/proj-xyz/brief", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(["not", "an", "object"]),
    })
    const res = await PATCH(req, ctx)
    expect(res.status).toBe(400)
  })

  it("returns 400 for invalid JSON body", async () => {
    const token = await signToken("user-patch2")
    vi.mocked(projectsRepo.getOwnedProject).mockResolvedValueOnce({
      id: "proj-xyz",
      name: "Test",
      status: "brief",
      readiness: "concept_ready",
      projectType: "new",
      thumbnail: "family",
      floors: 1,
      rooftop: false,
      site: { widthM: 8, depthM: 10, areaM2: 80 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    const req = new Request("http://localhost/api/v1/projects/proj-xyz/brief", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: "this is not json",
    })
    const res = await PATCH(req, ctx)
    expect(res.status).toBe(400)
  })

  it("returns 200 with updated brief on valid patch", async () => {
    const token = await signToken("user-patch3")
    vi.mocked(projectsRepo.getOwnedProject).mockResolvedValueOnce({
      id: "proj-xyz",
      name: "Test",
      status: "brief",
      readiness: "concept_ready",
      projectType: "new",
      thumbnail: "family",
      floors: 1,
      rooftop: false,
      site: { widthM: 8, depthM: 10, areaM2: 80 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    vi.mocked(briefsRepo.patchBrief).mockResolvedValueOnce({
      ...mockBrief,
      summary: "Updated summary",
    })

    const req = new Request("http://localhost/api/v1/projects/proj-xyz/brief", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ summary: "Updated summary" }),
    })
    const res = await PATCH(req, ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.summary).toBe("Updated summary")
  })

  it("syncs Project.site (incl. regulation) when the patch includes site — audit reads Project.site, not Brief.site", async () => {
    const token = await signToken("user-patch4")
    vi.mocked(projectsRepo.getOwnedProject).mockResolvedValueOnce({
      id: "proj-xyz",
      name: "Test",
      status: "brief",
      readiness: "concept_ready",
      projectType: "new",
      thumbnail: "family",
      floors: 1,
      rooftop: false,
      site: { widthM: 8, depthM: 10, areaM2: 80 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    const nextSite = {
      widthM: 8,
      depthM: 10,
      areaM2: 80,
      regulation: { maxKdb: 0.6, maxKlb: 1.8, gsbM: 3, minKdh: 0.15 },
    }
    vi.mocked(briefsRepo.patchBrief).mockResolvedValueOnce({
      ...mockBrief,
      site: nextSite,
    })

    const req = new Request("http://localhost/api/v1/projects/proj-xyz/brief", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ site: nextSite }),
    })
    const res = await PATCH(req, ctx)
    expect(res.status).toBe(200)
    expect(projectsRepo.updateProjectSite).toHaveBeenCalledWith(
      "proj-xyz",
      "user-patch4",
      nextSite
    )
  })

  it("does not call updateProjectSite when the patch has no site field", async () => {
    vi.mocked(projectsRepo.updateProjectSite).mockClear()
    const token = await signToken("user-patch5")
    vi.mocked(projectsRepo.getOwnedProject).mockResolvedValueOnce({
      id: "proj-xyz",
      name: "Test",
      status: "brief",
      readiness: "concept_ready",
      projectType: "new",
      thumbnail: "family",
      floors: 1,
      rooftop: false,
      site: { widthM: 8, depthM: 10, areaM2: 80 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    vi.mocked(briefsRepo.patchBrief).mockResolvedValueOnce({
      ...mockBrief,
      summary: "Only summary changed",
    })

    const req = new Request("http://localhost/api/v1/projects/proj-xyz/brief", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ summary: "Only summary changed" }),
    })
    const res = await PATCH(req, ctx)
    expect(res.status).toBe(200)
    expect(projectsRepo.updateProjectSite).not.toHaveBeenCalled()
  })
})

describe("GET /api/v1/projects/[id]/brief", () => {
  it("returns 200 with brief for owner", async () => {
    const token = await signToken("user-get-brief")
    vi.mocked(projectsRepo.getOwnedProject).mockResolvedValueOnce({
      id: "proj-xyz",
      name: "Test",
      status: "brief",
      readiness: "concept_ready",
      projectType: "new",
      thumbnail: "family",
      floors: 1,
      rooftop: false,
      site: { widthM: 8, depthM: 10, areaM2: 80 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    vi.mocked(briefsRepo.getBriefPayload).mockResolvedValueOnce(mockBrief)

    const req = new Request("http://localhost/api/v1/projects/proj-xyz/brief", {
      headers: { authorization: `Bearer ${token}` },
    })
    const res = await GET(req, ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.projectId).toBe("proj-xyz")
  })
})
