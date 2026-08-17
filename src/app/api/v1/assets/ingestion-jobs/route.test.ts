// @vitest-environment node
/**
 * Route tests for POST /api/v1/assets/ingestion-jobs — the glbUpload feature
 * gate (Task 6).
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest"

beforeAll(() => {
  process.env.BARUMA_JWT_SECRET = "test-secret-at-least-32-characters-long"
})

vi.mock("@/lib/server/db", () => ({ query: vi.fn(), getClient: vi.fn() }))

vi.mock("@/lib/server/entitlements", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/entitlements")>()
  return { ...actual, requirePlanFeature: vi.fn() }
})

vi.mock("@/lib/server/repo/assets", () => ({
  createUserAsset: vi.fn(),
  createIngestionJob: vi.fn(),
}))

import { POST } from "./route"
import * as entitlementsLib from "@/lib/server/entitlements"
import * as assetsRepo from "@/lib/server/repo/assets"
import { signToken } from "@/lib/server/auth-server"

function bodyReq(token: string | null, body: unknown) {
  return new Request("http://localhost/api/v1/assets/ingestion-jobs", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

const validBody = {
  projectId: "proj-1",
  roomId: "room-1",
  slotId: "slot-1",
  expectedCategory: "sofa",
  // fileUrl WAJIB proxy same-origin milik user (user-pro) & proyek ini —
  // URL eksternal/asal sembarang ditolak (cegah SSRF/model_url arbitrer).
  fileUrl: "/api/v1/assets/file/uploads/user-pro/proj-1/123-sofa.glb",
  originalFilename: "sofa.glb",
}

beforeEach(() => {
  vi.mocked(entitlementsLib.requirePlanFeature).mockReset()
  vi.mocked(assetsRepo.createUserAsset).mockReset()
  vi.mocked(assetsRepo.createIngestionJob).mockReset()
})

describe("POST /api/v1/assets/ingestion-jobs", () => {
  it("returns 401 without token", async () => {
    const res = await POST(bodyReq(null, validBody))
    expect(res.status).toBe(401)
  })

  it("returns 403 plan_feature_locked when glbUpload is not entitled, before touching the repo", async () => {
    const token = await signToken("user-free")
    vi.mocked(entitlementsLib.requirePlanFeature).mockRejectedValueOnce(
      new entitlementsLib.PlanFeatureLockedError("glbUpload")
    )

    const res = await POST(bodyReq(token, validBody))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe("plan_feature_locked")
    expect(vi.mocked(assetsRepo.createUserAsset)).not.toHaveBeenCalled()
    expect(vi.mocked(assetsRepo.createIngestionJob)).not.toHaveBeenCalled()
  })

  it("proceeds to the existing logic when glbUpload is entitled", async () => {
    const token = await signToken("user-pro")
    vi.mocked(entitlementsLib.requirePlanFeature).mockResolvedValueOnce(undefined)
    vi.mocked(assetsRepo.createUserAsset).mockResolvedValueOnce(undefined as never)
    vi.mocked(assetsRepo.createIngestionJob).mockResolvedValueOnce(undefined as never)

    const res = await POST(bodyReq(token, validBody))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.status).toBe("uploaded")
    expect(vi.mocked(entitlementsLib.requirePlanFeature)).toHaveBeenCalledWith("user-pro", "glbUpload")
  })

  it("REGRESI keamanan: menolak fileUrl eksternal / prefix user lain (cegah model_url arbitrer)", async () => {
    const token = await signToken("user-pro")
    vi.mocked(entitlementsLib.requirePlanFeature).mockResolvedValue(undefined)
    for (const fileUrl of [
      "https://cdn.test/u1/p1/sofa.glb", // eksternal
      "/api/v1/assets/file/uploads/user-lain/proj-1/1-sofa.glb", // user lain
      "/api/v1/assets/file/uploads/user-pro/proj-2/1-sofa.glb", // proyek lain
      "/api/v1/assets/file/uploads/user-pro/proj-1/1-sofa.png", // bukan glb
    ]) {
      const res = await POST(bodyReq(token, { ...validBody, fileUrl }))
      expect(res.status, fileUrl).toBe(400)
    }
    expect(vi.mocked(assetsRepo.createUserAsset)).not.toHaveBeenCalled()
  })
})
