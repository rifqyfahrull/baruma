// @vitest-environment node
/**
 * Route tests for GET /api/v1/projects/[id]
 * Tests 404 for non-owner and 200 for owner.
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
  deleteProject: vi.fn(),
}))

import { GET, PATCH } from "./route"
import * as projectsRepo from "@/lib/server/repo/projects"
import { signToken } from "@/lib/server/auth-server"
import type { Project } from "@/types"

const mockProject: Project = {
  id: "proj-abc",
  name: "Test Project",
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

describe("GET /api/v1/projects/[id]", () => {
  it("returns 401 without token", async () => {
    const req = new Request("http://localhost/api/v1/projects/proj-abc")
    const res = await GET(req, { params: Promise.resolve({ id: "proj-abc" }) })
    expect(res.status).toBe(401)
  })

  it("returns 404 for a project not owned by the requester", async () => {
    const token = await signToken("other-user")
    // getOwnedProject returns null because owner_id != userId
    vi.mocked(projectsRepo.getOwnedProject).mockResolvedValueOnce(null)

    const req = new Request("http://localhost/api/v1/projects/proj-abc", {
      headers: { authorization: `Bearer ${token}` },
    })
    const res = await GET(req, { params: Promise.resolve({ id: "proj-abc" }) })
    expect(res.status).toBe(404)
  })

  it("returns 200 with project for the owner", async () => {
    const token = await signToken("user-owner")
    vi.mocked(projectsRepo.getOwnedProject).mockResolvedValueOnce(mockProject)

    const req = new Request("http://localhost/api/v1/projects/proj-abc", {
      headers: { authorization: `Bearer ${token}` },
    })
    const res = await GET(req, { params: Promise.resolve({ id: "proj-abc" }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe("proj-abc")
  })
})

describe("PATCH /api/v1/projects/[id]", () => {
  it("returns 401 without token", async () => {
    const req = new Request("http://localhost/api/v1/projects/proj-abc", {
      method: "PATCH",
      body: JSON.stringify({ name: "Rumah Baru" }),
    })
    const res = await PATCH(req, { params: Promise.resolve({ id: "proj-abc" }) })
    expect(res.status).toBe(401)
  })

  it("returns 400 when name is too short", async () => {
    const token = await signToken("user-owner")
    const req = new Request("http://localhost/api/v1/projects/proj-abc", {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ name: "A" }),
    })
    const res = await PATCH(req, { params: Promise.resolve({ id: "proj-abc" }) })
    expect(res.status).toBe(400)
  })

  it("returns 404 for a project not owned by the requester", async () => {
    const token = await signToken("other-user")
    vi.mocked(projectsRepo.updateProject).mockResolvedValueOnce(null)

    const req = new Request("http://localhost/api/v1/projects/proj-abc", {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ name: "Rumah Baru" }),
    })
    const res = await PATCH(req, { params: Promise.resolve({ id: "proj-abc" }) })
    expect(res.status).toBe(404)
  })

  it("renames the project and returns 200 with the updated project", async () => {
    const token = await signToken("user-owner")
    const renamed: Project = { ...mockProject, name: "Rumah Baru" }
    vi.mocked(projectsRepo.updateProject).mockResolvedValueOnce(renamed)

    const req = new Request("http://localhost/api/v1/projects/proj-abc", {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ name: "Rumah Baru" }),
    })
    const res = await PATCH(req, { params: Promise.resolve({ id: "proj-abc" }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.name).toBe("Rumah Baru")
    expect(projectsRepo.updateProject).toHaveBeenCalledWith("proj-abc", "user-owner", {
      name: "Rumah Baru",
    })
  })
})
