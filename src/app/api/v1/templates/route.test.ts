// @vitest-environment node
/**
 * Route test for the public `/api/v1/templates` endpoint — no auth, memory
 * mode (no DATABASE_URL), returns only active seeded templates.
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

describe("GET /api/v1/templates", () => {
  it("returns 200 with only the active templates, no auth required", async () => {
    seedTemplateForFallback(fakeTemplate({ id: "tpl-active", slug: "active", active: true }))
    seedTemplateForFallback(fakeTemplate({ id: "tpl-hidden", slug: "hidden", active: false }))

    const res = await GET()
    expect(res.status).toBe(200)

    const body = (await res.json()) as { templates: Array<{ id: string; active: boolean }> }
    expect(Array.isArray(body.templates)).toBe(true)
    expect(body.templates.map((t) => t.id)).toEqual(["tpl-active"])
    expect(body.templates.every((t) => t.active)).toBe(true)
  })

  it("returns an empty list when nothing is seeded", async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const body = (await res.json()) as { templates: unknown[] }
    expect(body.templates).toEqual([])
  })
})
