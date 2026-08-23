// @vitest-environment node
/**
 * Route tests for /api/v1/projects — ownership check + 404 for non-owner.
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
  listProjectsByOwner: vi.fn(),
  createProject: vi.fn(),
  getOwnedProject: vi.fn(),
  updateProject: vi.fn(),
}))

vi.mock("@/lib/server/repo/briefs", () => ({
  upsertBrief: vi.fn(),
  getBriefPayload: vi.fn(),
  patchBrief: vi.fn(),
}))

vi.mock("@/lib/server/entitlements", () => ({
  getEntitlements: vi.fn(),
}))

import { GET, POST } from "./route"
import * as projectsRepo from "@/lib/server/repo/projects"
import * as briefsRepo from "@/lib/server/repo/briefs"
import * as entitlementsLib from "@/lib/server/entitlements"
import { signToken } from "@/lib/server/auth-server"
import type { Entitlements } from "@/types"

describe("GET /api/v1/projects", () => {
  it("returns 401 without token", async () => {
    const req = new Request("http://localhost/api/v1/projects")
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it("returns 200 with project list for authed user", async () => {
    const token = await signToken("user-owner")
    vi.mocked(projectsRepo.listProjectsByOwner).mockResolvedValueOnce([])

    const req = new Request("http://localhost/api/v1/projects", {
      headers: { authorization: `Bearer ${token}` },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
  })
})

/* ---- POST — plan quota gate (Task 6) ---- */

const validBody = {
  name: "Rumah Test",
  city: "Jakarta",
  projectType: "new" as const,
  style: "modern_tropis" as const,
  widthM: 8,
  depthM: 10,
  frontOrientation: "north" as const,
  sidesAttached: 0,
  frontRoadWidthM: 4,
  carport: true,
  floors: 1,
  rooftop: false,
  budgetMinIDR: 500_000_000,
  budgetMaxIDR: 800_000_000,
  finishingLevel: "menengah" as const,
  priorities: ["hemat_biaya" as const],
  rooms: [
    { roomType: "kamar_tidur" as const, name: "Kamar Utama", required: true, quantity: 1 },
  ],
}

function entitlements(overrides: Partial<Entitlements> = {}): Entitlements {
  return {
    creditsPerPeriod: 10,
    maxProjects: 1,
    exportPdf: false,
    glbUpload: false,
    aiRenderHd: false,
    ...overrides,
  }
}

function postRequest(token: string, body: unknown) {
  return new Request("http://localhost/api/v1/projects", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
}

describe("POST /api/v1/projects — plan quota gate", () => {
  it("returns 403 plan_limit_projects when the owner is already at their maxProjects", async () => {
    const token = await signToken("user-at-limit")
    vi.mocked(entitlementsLib.getEntitlements).mockResolvedValueOnce(entitlements({ maxProjects: 1 }))
    vi.mocked(projectsRepo.listProjectsByOwner).mockResolvedValueOnce([
      { id: "proj-existing" } as never,
    ])

    const res = await POST(postRequest(token, validBody))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe("plan_limit_projects")
    expect(vi.mocked(projectsRepo.createProject)).not.toHaveBeenCalled()
  })

  it("proceeds to create when the owner is under their maxProjects", async () => {
    const token = await signToken("user-under-limit")
    vi.mocked(entitlementsLib.getEntitlements).mockResolvedValueOnce(entitlements({ maxProjects: 5 }))
    vi.mocked(projectsRepo.listProjectsByOwner).mockResolvedValueOnce([{ id: "proj-1" } as never])
    vi.mocked(projectsRepo.createProject).mockResolvedValueOnce({
      id: "proj-new",
      name: validBody.name,
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
    vi.mocked(briefsRepo.upsertBrief).mockResolvedValueOnce(undefined as never)

    const res = await POST(postRequest(token, validBody))
    expect(res.status).toBe(200)
    expect(vi.mocked(projectsRepo.createProject)).toHaveBeenCalledTimes(1)
  })

  it("copies the wizard's site.regulation override into Project.site and Brief.site (audit reads Project.site)", async () => {
    const token = await signToken("user-with-regulation")
    vi.mocked(entitlementsLib.getEntitlements).mockResolvedValueOnce(entitlements({ maxProjects: 5 }))
    vi.mocked(projectsRepo.listProjectsByOwner).mockResolvedValueOnce([])
    vi.mocked(projectsRepo.createProject).mockResolvedValueOnce({
      id: "proj-new",
      name: validBody.name,
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
    vi.mocked(briefsRepo.upsertBrief).mockResolvedValueOnce(undefined as never)

    const bodyWithRegulation = {
      ...validBody,
      regulation: { maxKdb: 0.6, maxKlb: 1.8, gsbM: 3, minKdh: 0.15 },
    }
    const res = await POST(postRequest(token, bodyWithRegulation))
    expect(res.status).toBe(200)

    const createCall = vi.mocked(projectsRepo.createProject).mock.calls.at(-1)![0]
    expect(createCall.site.regulation).toEqual(bodyWithRegulation.regulation)

    const upsertCall = vi.mocked(briefsRepo.upsertBrief).mock.calls.at(-1)!
    expect(upsertCall[1].site.regulation).toEqual(bodyWithRegulation.regulation)
  })

  it("skips the quota gate entirely when maxProjects is null (unlimited — Pro)", async () => {
    const token = await signToken("user-unlimited")
    vi.mocked(entitlementsLib.getEntitlements).mockResolvedValueOnce(
      entitlements({ maxProjects: null })
    )
    // Deliberately a large existing count — null must bypass the check
    // regardless of how many projects the owner already has.
    vi.mocked(projectsRepo.listProjectsByOwner).mockResolvedValueOnce(
      Array.from({ length: 500 }, (_, i) => ({ id: `proj-${i}` }) as never)
    )
    vi.mocked(projectsRepo.createProject).mockResolvedValueOnce({
      id: "proj-new-unlimited",
      name: validBody.name,
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
    vi.mocked(briefsRepo.upsertBrief).mockResolvedValueOnce(undefined as never)

    const res = await POST(postRequest(token, validBody))
    expect(res.status).toBe(200)
    const createCall = vi.mocked(projectsRepo.createProject).mock.calls.at(-1)![0]
    expect(createCall.name).toBe(validBody.name)
  })
})
