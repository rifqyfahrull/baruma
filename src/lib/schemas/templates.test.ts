import { describe, it, expect } from "vitest"

import { createTemplateSchema, updateTemplateSchema } from "./templates"

describe("createTemplateSchema", () => {
  it("accepts a minimal valid payload", () => {
    const parsed = createTemplateSchema.safeParse({
      projectId: "proj-dg-01-dua-tona",
      slug: "dg-01-dua-tona",
    })
    expect(parsed.success).toBe(true)
  })

  it("accepts a full payload with optional fields", () => {
    const parsed = createTemplateSchema.safeParse({
      projectId: "proj-dg-01-dua-tona",
      slug: "dg-01-dua-tona",
      name: "Rumah Modern Dua-Tona",
      description: "Deskripsi singkat.",
      sortOrder: 1,
    })
    expect(parsed.success).toBe(true)
  })

  it("rejects a missing projectId", () => {
    const parsed = createTemplateSchema.safeParse({ slug: "abc-123" })
    expect(parsed.success).toBe(false)
  })

  it("rejects an empty projectId", () => {
    const parsed = createTemplateSchema.safeParse({ projectId: "", slug: "abc-123" })
    expect(parsed.success).toBe(false)
  })

  it.each([
    "Abc-123", // uppercase
    "abc_123", // underscore
    "abc 123", // space
    "abc.123", // dot
    "",
  ])("rejects an invalid slug %j", (slug) => {
    const parsed = createTemplateSchema.safeParse({
      projectId: "proj-dg-01-dua-tona",
      slug,
    })
    expect(parsed.success).toBe(false)
  })

  it.each(["abc", "abc-123", "villa-modern-santika", "dg-01-dua-tona", "a1"])(
    "accepts a valid slug %j",
    (slug) => {
      const parsed = createTemplateSchema.safeParse({
        projectId: "proj-x",
        slug,
      })
      expect(parsed.success).toBe(true)
    }
  )
})

describe("updateTemplateSchema", () => {
  it("rejects an empty object (no fields)", () => {
    const parsed = updateTemplateSchema.safeParse({})
    expect(parsed.success).toBe(false)
  })

  it("accepts a partial meta patch", () => {
    const parsed = updateTemplateSchema.safeParse({ active: false })
    expect(parsed.success).toBe(true)
  })

  it("accepts resync:true alone", () => {
    const parsed = updateTemplateSchema.safeParse({ resync: true })
    expect(parsed.success).toBe(true)
  })

  it("accepts a full meta patch", () => {
    const parsed = updateTemplateSchema.safeParse({
      name: "New name",
      slug: "new-slug",
      description: null,
      sortOrder: 5,
      active: true,
    })
    expect(parsed.success).toBe(true)
  })

  it("rejects an invalid slug", () => {
    const parsed = updateTemplateSchema.safeParse({ slug: "Not Valid!" })
    expect(parsed.success).toBe(false)
  })
})
