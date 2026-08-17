// @vitest-environment node
/**
 * Route tests for POST /api/v1/assets/upload-url — the glbUpload feature
 * gate (Task 6). Checked BEFORE the storage-config check (a locked-feature
 * 403 is clearer than an unrelated 503 for a user who can't use this
 * feature anyway).
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

vi.mock("@/lib/server/storage", () => ({
  storageEnabled: vi.fn(),
  assetKey: vi.fn(() => "u1/p1/file.glb"),
  assetPublicUrl: vi.fn((key: string) => `https://cdn.test/${key}`),
}))

import { POST } from "./route"
import * as entitlementsLib from "@/lib/server/entitlements"
import * as storageLib from "@/lib/server/storage"
import { signToken } from "@/lib/server/auth-server"

function bodyReq(token: string | null, body: unknown) {
  return new Request("http://localhost/api/v1/assets/upload-url", {
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
  filename: "sofa.glb",
  contentType: "model/gltf-binary",
  fileSizeBytes: 1_000_000,
}

beforeEach(() => {
  vi.mocked(entitlementsLib.requirePlanFeature).mockReset()
  vi.mocked(storageLib.storageEnabled).mockReset()
})

describe("POST /api/v1/assets/upload-url", () => {
  it("returns 401 without token", async () => {
    const res = await POST(bodyReq(null, validBody))
    expect(res.status).toBe(401)
  })

  it("returns 403 plan_feature_locked when glbUpload is not entitled, before checking storage config", async () => {
    const token = await signToken("user-free")
    vi.mocked(entitlementsLib.requirePlanFeature).mockRejectedValueOnce(
      new entitlementsLib.PlanFeatureLockedError("glbUpload")
    )

    const res = await POST(bodyReq(token, validBody))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe("plan_feature_locked")
    expect(vi.mocked(storageLib.storageEnabled)).not.toHaveBeenCalled()
  })

  it("proceeds to the existing logic when glbUpload is entitled", async () => {
    const token = await signToken("user-pro")
    vi.mocked(entitlementsLib.requirePlanFeature).mockResolvedValueOnce(undefined)
    vi.mocked(storageLib.storageEnabled).mockReturnValueOnce(true)

    const res = await POST(bodyReq(token, validBody))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.uploadUrl).toBeTruthy()
    expect(vi.mocked(entitlementsLib.requirePlanFeature)).toHaveBeenCalledWith("user-pro", "glbUpload")
  })

  it("still returns 503 when glbUpload is entitled but storage isn't configured", async () => {
    const token = await signToken("user-pro-2")
    vi.mocked(entitlementsLib.requirePlanFeature).mockResolvedValueOnce(undefined)
    vi.mocked(storageLib.storageEnabled).mockReturnValueOnce(false)

    const res = await POST(bodyReq(token, validBody))
    expect(res.status).toBe(503)
  })
})
