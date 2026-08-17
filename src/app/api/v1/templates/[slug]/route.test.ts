// @vitest-environment node
/**
 * Route test for the public `/api/v1/templates/[slug]` endpoint — no auth,
 * memory mode (no DATABASE_URL).
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest"

import type { DesignLayout } from "@/types"
import type { TemplateDetail } from "@/types/templates"

import {
  clearTemplatesFallback,
  seedTemplateForFallback,
} from "@/lib/server/repo/templates"

beforeAll(() => {
  delete process.env.DATABASE_URL
})

beforeEach(() => {
  clearTemplatesFallback()
})

import { GET } from "./route"

const FAKE_LAYOUT = { id: "layout-1" } as unknown as DesignLayout

function fakeTemplate(overrides: Partial<TemplateDetail> = {}): TemplateDetail {
  const now = new Date().toISOString()
  return {
    id: "tpl-a",
    slug: "template-a",
    name: "Template A",
    description: null,
    style: "modern_tropis",
    city: "Bandung",
    province: "Jawa Barat",
    floors: 2,
    rooftop: false,
    thumbnail: "vertical",
    site: { widthM: 9, depthM: 15, areaM2: 135 },
    layout: FAKE_LAYOUT,
    brief: null,
    interior: null,
    sortOrder: 1,
    active: true,
    sourceProjectId: "proj-dg-01",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function requestFor(slug: string): Request {
  return new Request(`http://localhost/api/v1/templates/${slug}`)
}

describe("GET /api/v1/templates/[slug]", () => {
  it("returns 200 with the full detail (layout included) for an active template", async () => {
    seedTemplateForFallback(fakeTemplate())
    const res = await GET(requestFor("template-a"), {
      params: Promise.resolve({ slug: "template-a" }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as TemplateDetail
    expect(body.id).toBe("tpl-a")
    expect(body.layout).toEqual(FAKE_LAYOUT)
  })

  it("returns 404 for an unknown slug", async () => {
    const res = await GET(requestFor("nope"), {
      params: Promise.resolve({ slug: "nope" }),
    })
    expect(res.status).toBe(404)
  })

  it("returns 404 for an inactive template (public route is active-only)", async () => {
    seedTemplateForFallback(fakeTemplate({ active: false }))
    const res = await GET(requestFor("template-a"), {
      params: Promise.resolve({ slug: "template-a" }),
    })
    expect(res.status).toBe(404)
  })
})
