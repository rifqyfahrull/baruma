// @vitest-environment node
/**
 * Route tests for GET/PUT /api/v1/projects/[id]/interior
 */
import { describe, it, expect, vi, beforeAll } from "vitest"

beforeAll(() => {
  process.env.BARUMA_JWT_SECRET = "test-secret-at-least-32-characters-long"
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test"
})

vi.mock("@/lib/server/db", () => ({ query: vi.fn(), getClient: vi.fn() }))

vi.mock("@/lib/server/repo/projects", () => ({
  getOwnedProject: vi.fn(),
  listProjectsByOwner: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
}))

vi.mock("@/lib/server/repo/interiors", () => ({
  getInteriorPayload: vi.fn(),
  upsertInterior: vi.fn(),
}))

import { GET, PUT } from "./route"
import * as projectsRepo from "@/lib/server/repo/projects"
import * as interiorsRepo from "@/lib/server/repo/interiors"
import { signToken } from "@/lib/server/auth-server"
import type { SavedInterior } from "@/lib/schemas/interior"

const ctx = { params: Promise.resolve({ id: "proj-xyz" }) }

// Mirror the proven fixture shape from brief/route.test.ts exactly, typed via
// the repo's own return type so it can't drift from the Project shape.
const ownedProject: NonNullable<Awaited<ReturnType<typeof projectsRepo.getOwnedProject>>> = {
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
}

const validPayload: SavedInterior = {
  schemaVersion: 1,
  versionId: "ver-1",
  style: "modern_tropical",
  rooms: [],
}

describe("PUT /api/v1/projects/[id]/interior", () => {
  it("returns 401 without token", async () => {
    const req = new Request("http://localhost/api/v1/projects/proj-xyz/interior", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validPayload),
    })
    expect((await PUT(req, ctx)).status).toBe(401)
  })

  it("returns 400 for an invalid payload", async () => {
    const token = await signToken("user-1")
    vi.mocked(projectsRepo.getOwnedProject).mockResolvedValueOnce(ownedProject)
    const req = new Request("http://localhost/api/v1/projects/proj-xyz/interior", {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ schemaVersion: 1, style: "nope" }),
    })
    expect((await PUT(req, ctx)).status).toBe(400)
  })

  it("returns 200 and persists a valid payload", async () => {
    const token = await signToken("user-2")
    vi.mocked(projectsRepo.getOwnedProject).mockResolvedValueOnce(ownedProject)
    vi.mocked(interiorsRepo.upsertInterior).mockResolvedValueOnce(validPayload)
    const req = new Request("http://localhost/api/v1/projects/proj-xyz/interior", {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(validPayload),
    })
    const res = await PUT(req, ctx)
    expect(res.status).toBe(200)
    expect(vi.mocked(interiorsRepo.upsertInterior)).toHaveBeenCalledWith(
      "proj-xyz",
      "ver-1",
      validPayload
    )
  })
})

describe("GET /api/v1/projects/[id]/interior", () => {
  it("returns 200 with null when no interior saved yet", async () => {
    const token = await signToken("user-3")
    vi.mocked(projectsRepo.getOwnedProject).mockResolvedValueOnce(ownedProject)
    vi.mocked(interiorsRepo.getInteriorPayload).mockResolvedValueOnce(null)
    const req = new Request("http://localhost/api/v1/projects/proj-xyz/interior", {
      headers: { authorization: `Bearer ${token}` },
    })
    const res = await GET(req, ctx)
    expect(res.status).toBe(200)
    expect(await res.json()).toBeNull()
  })

  it("returns 200 with the saved interior for owner", async () => {
    const token = await signToken("user-4")
    vi.mocked(projectsRepo.getOwnedProject).mockResolvedValueOnce(ownedProject)
    vi.mocked(interiorsRepo.getInteriorPayload).mockResolvedValueOnce(validPayload)
    const req = new Request("http://localhost/api/v1/projects/proj-xyz/interior", {
      headers: { authorization: `Bearer ${token}` },
    })
    const res = await GET(req, ctx)
    expect(res.status).toBe(200)
    expect((await res.json()).versionId).toBe("ver-1")
  })
})
