// @vitest-environment node
/**
 * Route test POST /api/v1/projects/[id]/renders/upload-url — meniru pola
 * assets/upload-url/route.test.ts, minus feature gate (input render PNG tak
 * digerbangi entitlement, hanya auth+ownership+storageEnabled).
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest"

beforeAll(() => {
  process.env.BARUMA_JWT_SECRET = "test-secret-at-least-32-characters-long"
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test"
})

vi.mock("@/lib/server/db", () => ({ query: vi.fn(), getClient: vi.fn() }))
vi.mock("@/lib/server/repo/projects", () => ({ getOwnedProject: vi.fn() }))
vi.mock("@/lib/server/storage", () => ({
  storageEnabled: vi.fn(),
  renderInputKey: vi.fn((userId: string, projectId: string, filename: string) =>
    `renders/${userId}/${projectId}/1700000000000-${filename}`
  ),
}))

import { POST } from "./route"
import * as projectsRepo from "@/lib/server/repo/projects"
import * as storageLib from "@/lib/server/storage"
import { signToken } from "@/lib/server/auth-server"
import type { Project } from "@/types"

const PROJECT_ID = "proj-xyz"
const ctx = { params: Promise.resolve({ id: PROJECT_ID }) }
const ownedProject = { id: PROJECT_ID, name: "Test" } as Project

function bodyReq(token: string | null, body: unknown) {
  return new Request(`http://localhost/api/v1/projects/${PROJECT_ID}/renders/upload-url`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

const validBody = { filename: "beauty.png", contentType: "image/png" }

beforeEach(() => {
  vi.mocked(projectsRepo.getOwnedProject).mockReset().mockResolvedValue(ownedProject)
  vi.mocked(storageLib.storageEnabled).mockReset()
})

describe("POST /api/v1/projects/[id]/renders/upload-url", () => {
  it("401 tanpa token", async () => {
    const res = await POST(bodyReq(null, validBody), ctx)
    expect(res.status).toBe(401)
  })

  it("404 saat proyek bukan milik pemanggil", async () => {
    vi.mocked(projectsRepo.getOwnedProject).mockResolvedValueOnce(null)
    const token = await signToken("user-1")
    const res = await POST(bodyReq(token, validBody), ctx)
    expect(res.status).toBe(404)
  })

  it("400 saat contentType bukan image/png", async () => {
    const token = await signToken("user-1")
    const res = await POST(bodyReq(token, { ...validBody, contentType: "image/jpeg" }), ctx)
    expect(res.status).toBe(400)
  })

  it("503 saat storage belum dikonfigurasi", async () => {
    const token = await signToken("user-1")
    vi.mocked(storageLib.storageEnabled).mockReturnValueOnce(false)
    const res = await POST(bodyReq(token, validBody), ctx)
    expect(res.status).toBe(503)
  })

  it("200 mengembalikan key+uploadUrl proxy same-origin", async () => {
    const token = await signToken("user-1")
    vi.mocked(storageLib.storageEnabled).mockReturnValueOnce(true)
    const res = await POST(bodyReq(token, validBody), ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.key).toBe("renders/user-1/proj-xyz/1700000000000-beauty.png")
    expect(body.uploadUrl).toBe("/api/v1/assets/file/renders/user-1/proj-xyz/1700000000000-beauty.png")
  })
})
