// @vitest-environment node
/**
 * Templates repo — memory-fallback paths (no DATABASE_URL). The in-memory
 * store starts empty (unlike plans' DEFAULT_PLANS), so tests seed it
 * directly via seedTemplateForFallback — createTemplateFromProject requires
 * a real projects/design_layouts join and always throws in memory mode
 * (there's no in-memory equivalent of those tables).
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest"

import type { DesignLayout, Brief } from "@/types"
import type { TemplateDetail } from "@/types/templates"

import {
  clearTemplatesFallback,
  createTemplateFromProject,
  deleteTemplate,
  getTemplateBySlug,
  listTemplates,
  resyncTemplateFromSource,
  seedTemplateForFallback,
  TemplateSourceNotFoundError,
  updateTemplateMeta,
} from "./templates"

beforeAll(() => {
  // Force the in-memory fallback even if a previous test file in this worker
  // set DATABASE_URL (repos check the env at call time).
  delete process.env.DATABASE_URL
})

beforeEach(() => {
  clearTemplatesFallback()
})

const FAKE_LAYOUT = { id: "layout-1", projectId: "proj-1" } as unknown as DesignLayout
const FAKE_BRIEF = { projectId: "proj-1", summary: "Ringkasan." } as unknown as Brief

function fakeTemplate(overrides: Partial<TemplateDetail> = {}): TemplateDetail {
  const now = new Date().toISOString()
  return {
    id: "tpl-a",
    slug: "template-a",
    name: "Template A",
    description: "Deskripsi A",
    style: "modern_tropis",
    city: "Bandung",
    province: "Jawa Barat",
    floors: 2,
    rooftop: false,
    thumbnail: "vertical",
    site: { widthM: 9, depthM: 15, areaM2: 135 },
    layout: FAKE_LAYOUT,
    brief: FAKE_BRIEF,
    interior: null,
    sortOrder: 1,
    active: true,
    sourceProjectId: "proj-dg-01",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe("listTemplates (memory fallback)", () => {
  it("returns an empty list when nothing is seeded", async () => {
    expect(await listTemplates(false)).toEqual([])
    expect(await listTemplates(true)).toEqual([])
  })

  it("returns summaries (no layout/brief/interior) sorted by sortOrder then name", async () => {
    seedTemplateForFallback(fakeTemplate({ id: "tpl-b", slug: "b", name: "B", sortOrder: 2 }))
    seedTemplateForFallback(fakeTemplate({ id: "tpl-a", slug: "a", name: "A", sortOrder: 1 }))

    const all = await listTemplates(false)
    expect(all.map((t) => t.id)).toEqual(["tpl-a", "tpl-b"])
    for (const t of all) {
      expect(t).not.toHaveProperty("layout")
      expect(t).not.toHaveProperty("brief")
      expect(t).not.toHaveProperty("interior")
    }
  })

  it("activeOnly filters out inactive templates", async () => {
    seedTemplateForFallback(fakeTemplate({ id: "tpl-active", slug: "active", active: true }))
    seedTemplateForFallback(fakeTemplate({ id: "tpl-hidden", slug: "hidden", active: false }))

    const active = await listTemplates(true)
    expect(active.map((t) => t.id)).toEqual(["tpl-active"])

    const all = await listTemplates(false)
    expect(all).toHaveLength(2)
  })

  it("returns clones — mutating a result never touches the store", async () => {
    seedTemplateForFallback(fakeTemplate())
    const [first] = await listTemplates(false)
    first.name = "HACKED"
    const [fresh] = await listTemplates(false)
    expect(fresh.name).toBe("Template A")
  })
})

describe("getTemplateBySlug (memory fallback)", () => {
  it("returns the full detail (including layout/brief) for a known slug", async () => {
    seedTemplateForFallback(fakeTemplate())
    const found = await getTemplateBySlug("template-a")
    expect(found?.id).toBe("tpl-a")
    expect(found?.layout).toEqual(FAKE_LAYOUT)
    expect(found?.brief).toEqual(FAKE_BRIEF)
  })

  it("returns null for an unknown slug", async () => {
    expect(await getTemplateBySlug("nope")).toBeNull()
  })

  it("activeOnly:true excludes an inactive template", async () => {
    seedTemplateForFallback(fakeTemplate({ active: false }))
    expect(await getTemplateBySlug("template-a", { activeOnly: true })).toBeNull()
    expect(await getTemplateBySlug("template-a", { activeOnly: false })).not.toBeNull()
  })
})

describe("createTemplateFromProject (memory fallback)", () => {
  it("throws TemplateSourceNotFoundError — no in-memory projects table to snapshot from", async () => {
    await expect(
      createTemplateFromProject("proj-dg-01-dua-tona", { slug: "dg-01-dua-tona" })
    ).rejects.toThrow(TemplateSourceNotFoundError)
  })
})

describe("updateTemplateMeta (memory fallback)", () => {
  it("updates name/slug/description/sortOrder/active in place", async () => {
    seedTemplateForFallback(fakeTemplate())
    const updated = await updateTemplateMeta("tpl-a", {
      name: "Renamed",
      slug: "renamed-slug",
      description: "Baru",
      sortOrder: 9,
      active: false,
    })
    expect(updated).toMatchObject({
      id: "tpl-a",
      name: "Renamed",
      slug: "renamed-slug",
      description: "Baru",
      sortOrder: 9,
      active: false,
    })

    const reread = await getTemplateBySlug("renamed-slug")
    expect(reread?.name).toBe("Renamed")
  })

  it("returns null for an unknown id", async () => {
    expect(await updateTemplateMeta("tpl-nope", { active: false })).toBeNull()
  })
})

describe("resyncTemplateFromSource (memory fallback)", () => {
  it("returns null for an unknown id", async () => {
    expect(await resyncTemplateFromSource("tpl-nope")).toBeNull()
  })

  it("returns null when the template has no sourceProjectId", async () => {
    seedTemplateForFallback(fakeTemplate({ sourceProjectId: null }))
    expect(await resyncTemplateFromSource("tpl-a")).toBeNull()
  })

  it("is a no-op (returns the row unchanged) when a sourceProjectId is set", async () => {
    seedTemplateForFallback(fakeTemplate())
    const resynced = await resyncTemplateFromSource("tpl-a")
    expect(resynced?.id).toBe("tpl-a")
    expect(resynced?.layout).toEqual(FAKE_LAYOUT)
  })
})

describe("deleteTemplate (memory fallback)", () => {
  it("deletes an existing template and returns true", async () => {
    seedTemplateForFallback(fakeTemplate())
    expect(await deleteTemplate("tpl-a")).toBe(true)
    expect(await getTemplateBySlug("template-a")).toBeNull()
  })

  it("returns false for an unknown id", async () => {
    expect(await deleteTemplate("tpl-nope")).toBe(false)
  })
})
