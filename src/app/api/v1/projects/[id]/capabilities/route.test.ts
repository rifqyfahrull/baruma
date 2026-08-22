// @vitest-environment node
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

beforeAll(() => {
  process.env.BARUMA_JWT_SECRET = "test-secret-at-least-32-characters-long"
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test"
})

vi.mock("@/lib/server/db", () => ({ query: vi.fn(), getClient: vi.fn() }))

vi.mock("@/lib/server/repo/projects", () => ({
  getOwnedProject: vi.fn(),
}))

vi.mock("@/lib/server/repo/profiles", () => ({
  getProfileById: vi.fn(),
  getProfileByEmail: vi.fn(),
}))

import { GET } from "./route"
import * as projectsRepo from "@/lib/server/repo/projects"
import * as profilesRepo from "@/lib/server/repo/profiles"
import { signToken } from "@/lib/server/auth-server"

const ctx = { params: Promise.resolve({ id: "proj-xyz" }) }

const ownedProject = {
  id: "proj-xyz",
  name: "Test",
} as NonNullable<Awaited<ReturnType<typeof projectsRepo.getOwnedProject>>>

function request(token: string) {
  return new Request("http://localhost/api/v1/projects/proj-xyz/capabilities", {
    headers: { authorization: `Bearer ${token}` },
  })
}

const FLAG_ENV_KEYS = [
  "FEATURE_EXTERIOR_ELEMENTS_V1",
  "FEATURE_EXTERIOR_ELEMENTS_V1_ROLLOUT",
  "FEATURE_ROOF_ZONES_V1",
  "FEATURE_ROOF_ZONES_V1_ROLLOUT",
  "FEATURE_PRESENTATION_MODE_V1",
  "FEATURE_PRESENTATION_MODE_V1_ROLLOUT",
  "FEATURE_AI_RENDER_V1",
  "FEATURE_AI_RENDER_V1_ROLLOUT",
]

describe("GET /api/v1/projects/[id]/capabilities", () => {
  afterEach(() => {
    for (const key of FLAG_ENV_KEYS) delete process.env[key]
    vi.clearAllMocks()
  })

  it("returns the full typed capability set (default env: all enabled)", async () => {
    const token = await signToken("user-1")
    vi.mocked(projectsRepo.getOwnedProject).mockResolvedValue(ownedProject)
    vi.mocked(profilesRepo.getProfileById).mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      role: "user",
    } as NonNullable<Awaited<ReturnType<typeof profilesRepo.getProfileById>>>)

    const res = await GET(request(token), ctx)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      exterior_elements_v1: true,
      roof_zones_v1: true,
      presentation_mode_v1: true,
      ai_render_v1: true,
    })
  })

  it("respects rollout percent for regular users but not admins", async () => {
    process.env.FEATURE_ROOF_ZONES_V1_ROLLOUT = "0"
    vi.mocked(projectsRepo.getOwnedProject).mockResolvedValue(ownedProject)

    vi.mocked(profilesRepo.getProfileById).mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      role: "user",
    } as NonNullable<Awaited<ReturnType<typeof profilesRepo.getProfileById>>>)
    const userRes = await GET(request(await signToken("user-1")), ctx)
    expect(((await userRes.json()) as { roof_zones_v1: boolean }).roof_zones_v1).toBe(
      false
    )

    vi.mocked(profilesRepo.getProfileById).mockResolvedValue({
      id: "admin-1",
      email: "admin@example.com",
      role: "admin",
    } as NonNullable<Awaited<ReturnType<typeof profilesRepo.getProfileById>>>)
    const adminRes = await GET(request(await signToken("admin-1")), ctx)
    expect(((await adminRes.json()) as { roof_zones_v1: boolean }).roof_zones_v1).toBe(
      true
    )
  })

  it("kill switch disables the flag even for admins", async () => {
    process.env.FEATURE_PRESENTATION_MODE_V1 = "false"
    vi.mocked(projectsRepo.getOwnedProject).mockResolvedValue(ownedProject)
    vi.mocked(profilesRepo.getProfileById).mockResolvedValue({
      id: "admin-1",
      email: "admin@example.com",
      role: "admin",
    } as NonNullable<Awaited<ReturnType<typeof profilesRepo.getProfileById>>>)

    const res = await GET(request(await signToken("admin-1")), ctx)
    const body = (await res.json()) as { presentation_mode_v1: boolean }
    expect(body.presentation_mode_v1).toBe(false)
  })

  it("returns 404 for a project the caller does not own", async () => {
    vi.mocked(projectsRepo.getOwnedProject).mockResolvedValue(null)
    const res = await GET(request(await signToken("user-1")), ctx)
    expect(res.status).toBe(404)
  })
})
