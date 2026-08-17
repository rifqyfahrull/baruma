// @vitest-environment node
import { gzipSync } from "node:zlib"
import { beforeAll, describe, expect, it, vi } from "vitest"

beforeAll(() => {
  process.env.BARUMA_JWT_SECRET = "test-secret-at-least-32-characters-long"
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test"
})

vi.mock("@/lib/server/db", () => ({ query: vi.fn(), getClient: vi.fn() }))

vi.mock("@/lib/server/repo/projects", () => ({
  getOwnedProject: vi.fn(),
}))

vi.mock("@/lib/server/repo/briefs", () => ({
  getBriefPayload: vi.fn(),
}))

vi.mock("@/lib/server/repo/layouts", () => ({
  getLayoutDocument: vi.fn(),
  insertLayoutIfAbsent: vi.fn(),
  updateLayoutAtRevision: vi.fn(),
}))

import { GET, PUT } from "./route"
import * as projectsRepo from "@/lib/server/repo/projects"
import * as briefsRepo from "@/lib/server/repo/briefs"
import * as layoutsRepo from "@/lib/server/repo/layouts"
import { signToken } from "@/lib/server/auth-server"
import { makeLayout, sampleBrief } from "@/test-utils/fixtures"

const ctx = { params: Promise.resolve({ id: "proj-xyz" }) }

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
  currentVersionId: "ver-1",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

describe("GET /api/v1/projects/[id]/layout", () => {
  it("returns a layout document when layout already exists", async () => {
    const token = await signToken("user-1")
    const layout = makeLayout()
    vi.mocked(projectsRepo.getOwnedProject).mockResolvedValueOnce(ownedProject)
    vi.mocked(layoutsRepo.getLayoutDocument).mockResolvedValueOnce({ layout, revision: 7 })

    const res = await GET(
      new Request("http://localhost/api/v1/projects/proj-xyz/layout", {
        headers: { authorization: `Bearer ${token}` },
      }),
      ctx
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ revision: 7, layout: { id: layout.id } })
  })

  it("creates a missing layout with insert-only persistence", async () => {
    const token = await signToken("user-2")
    const layout = makeLayout()
    vi.mocked(projectsRepo.getOwnedProject).mockResolvedValueOnce(ownedProject)
    vi.mocked(layoutsRepo.getLayoutDocument).mockResolvedValueOnce(null)
    vi.mocked(briefsRepo.getBriefPayload).mockResolvedValueOnce(sampleBrief)
    vi.mocked(layoutsRepo.insertLayoutIfAbsent).mockResolvedValueOnce({ layout, revision: 1 })

    const res = await GET(
      new Request("http://localhost/api/v1/projects/proj-xyz/layout", {
        headers: { authorization: `Bearer ${token}` },
      }),
      ctx
    )

    expect(res.status).toBe(200)
    expect(layoutsRepo.insertLayoutIfAbsent).toHaveBeenCalled()
  })
})

describe("PUT /api/v1/projects/[id]/layout", () => {
  it("returns 400 for invalid payload", async () => {
    const token = await signToken("user-3")
    vi.mocked(projectsRepo.getOwnedProject).mockResolvedValueOnce(ownedProject)

    const res = await PUT(
      new Request("http://localhost/api/v1/projects/proj-xyz/layout", {
        method: "PUT",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(makeLayout()),
      }),
      ctx
    )

    expect(res.status).toBe(400)
  })

  it("returns 409 when expected revision is stale", async () => {
    const token = await signToken("user-4")
    const layout = makeLayout()
    vi.mocked(projectsRepo.getOwnedProject).mockResolvedValueOnce(ownedProject)
    vi.mocked(layoutsRepo.updateLayoutAtRevision).mockResolvedValueOnce(null)

    const res = await PUT(
      new Request("http://localhost/api/v1/projects/proj-xyz/layout", {
        method: "PUT",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ layout, expectedRevision: 2 }),
      }),
      ctx
    )

    expect(res.status).toBe(409)
  })

  it("persists a valid layout at the expected revision", async () => {
    const token = await signToken("user-5")
    const layout = makeLayout()
    vi.mocked(projectsRepo.getOwnedProject).mockResolvedValueOnce(ownedProject)
    vi.mocked(layoutsRepo.updateLayoutAtRevision).mockResolvedValueOnce({
      layout,
      revision: 3,
    })

    const res = await PUT(
      new Request("http://localhost/api/v1/projects/proj-xyz/layout", {
        method: "PUT",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ layout, expectedRevision: 2 }),
      }),
      ctx
    )

    expect(res.status).toBe(200)
    expect(layoutsRepo.updateLayoutAtRevision).toHaveBeenCalledWith(
      "proj-xyz",
      "v1",
      expect.objectContaining({ id: layout.id }),
      2
    )
    expect(await res.json()).toMatchObject({ revision: 3 })
  })

  // G2a: autosave client gzips the body when CompressionStream is available
  // and marks it with Content-Encoding: gzip (src/lib/data/http.ts). The
  // route must transparently decompress that on the way in.
  describe("gzip-compressed body (G2a)", () => {
    it("persists a layout sent as a gzip-compressed body", async () => {
      const token = await signToken("user-6")
      const layout = makeLayout()
      vi.mocked(projectsRepo.getOwnedProject).mockResolvedValueOnce(ownedProject)
      vi.mocked(layoutsRepo.updateLayoutAtRevision).mockResolvedValueOnce({
        layout,
        revision: 3,
      })

      const compressed = gzipSync(JSON.stringify({ layout, expectedRevision: 2 }))

      const res = await PUT(
        new Request("http://localhost/api/v1/projects/proj-xyz/layout", {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            "content-encoding": "gzip",
            authorization: `Bearer ${token}`,
          },
          body: compressed,
        }),
        ctx
      )

      expect(res.status).toBe(200)
      expect(layoutsRepo.updateLayoutAtRevision).toHaveBeenCalledWith(
        "proj-xyz",
        "v1",
        expect.objectContaining({ id: layout.id }),
        2
      )
      expect(await res.json()).toMatchObject({ revision: 3 })
    })

    it("returns 400 for a corrupt gzip body", async () => {
      const token = await signToken("user-7")
      vi.mocked(projectsRepo.getOwnedProject).mockResolvedValueOnce(ownedProject)
      const callsBefore = vi.mocked(layoutsRepo.updateLayoutAtRevision).mock.calls.length

      const res = await PUT(
        new Request("http://localhost/api/v1/projects/proj-xyz/layout", {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            "content-encoding": "gzip",
            authorization: `Bearer ${token}`,
          },
          body: new Uint8Array([1, 2, 3, 4, 5]), // not valid gzip
        }),
        ctx
      )

      expect(res.status).toBe(400)
      expect(vi.mocked(layoutsRepo.updateLayoutAtRevision).mock.calls.length).toBe(callsBefore)
    })

    it("returns 413 when the compressed body itself is too large", async () => {
      const token = await signToken("user-7b")
      vi.mocked(projectsRepo.getOwnedProject).mockResolvedValueOnce(ownedProject)
      const callsBefore = vi.mocked(layoutsRepo.updateLayoutAtRevision).mock.calls.length

      // Content-Length isn't set by the test `Request`, so this exercises the
      // buffered-size fallback check (not the Content-Length fast path) —
      // still oversized, need not even be valid gzip since the size cap is
      // checked before gunzipSync ever runs.
      const oversizedBody = new Uint8Array(5 * 1024 * 1024 + 1)

      const res = await PUT(
        new Request("http://localhost/api/v1/projects/proj-xyz/layout", {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            "content-encoding": "gzip",
            authorization: `Bearer ${token}`,
          },
          body: oversizedBody,
        }),
        ctx
      )

      expect(res.status).toBe(413)
      expect(vi.mocked(layoutsRepo.updateLayoutAtRevision).mock.calls.length).toBe(callsBefore)
    })

    it("returns 413 for a zip bomb (small gzip that would inflate past the decompressed cap)", async () => {
      const token = await signToken("user-7c")
      vi.mocked(projectsRepo.getOwnedProject).mockResolvedValueOnce(ownedProject)
      const callsBefore = vi.mocked(layoutsRepo.updateLayoutAtRevision).mock.calls.length

      // 20 MB of zeros compresses to a few KB, well under MAX_GZIP_BODY_BYTES,
      // but would inflate past the 15 MB decompressed cap.
      const bomb = gzipSync(Buffer.alloc(20 * 1024 * 1024, 0))

      const res = await PUT(
        new Request("http://localhost/api/v1/projects/proj-xyz/layout", {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            "content-encoding": "gzip",
            authorization: `Bearer ${token}`,
          },
          body: bomb,
        }),
        ctx
      )

      expect(res.status).toBe(413)
      expect(vi.mocked(layoutsRepo.updateLayoutAtRevision).mock.calls.length).toBe(callsBefore)
    })

    it("returns 409 when expected revision is stale even for a gzip body", async () => {
      const token = await signToken("user-8")
      const layout = makeLayout()
      vi.mocked(projectsRepo.getOwnedProject).mockResolvedValueOnce(ownedProject)
      vi.mocked(layoutsRepo.updateLayoutAtRevision).mockResolvedValueOnce(null)

      const compressed = gzipSync(JSON.stringify({ layout, expectedRevision: 2 }))

      const res = await PUT(
        new Request("http://localhost/api/v1/projects/proj-xyz/layout", {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            "content-encoding": "gzip",
            authorization: `Bearer ${token}`,
          },
          body: compressed,
        }),
        ctx
      )

      expect(res.status).toBe(409)
    })
  })
})
