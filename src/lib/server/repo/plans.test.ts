// @vitest-environment node
/**
 * Plans repo — memory-fallback paths (no DATABASE_URL) + the DEFAULT_PLANS
 * content-parity contract that keeps the landing pixel-equal now that it's
 * DB-driven (T2).
 */
import { describe, it, expect, beforeAll } from "vitest"

import type { PlanRow } from "@/types"

import { getPlan, getPlans, setPlanActive, upsertPlan } from "./plans"
import { DEFAULT_PLANS } from "./plan-defaults"

beforeAll(() => {
  // Force the in-memory fallback even if a previous test file in this worker
  // set DATABASE_URL (repos check the env at call time).
  delete process.env.DATABASE_URL
})

describe("DEFAULT_PLANS content is locked verbatim (pixel-parity contract for T2)", () => {
  // Snapshot of the exact landing copy that used to live in the (now-removed)
  // `PRICING_PLANS` constant in src/lib/pricing.ts. Locked here inline — since
  // plans are DB-driven from T2 onward there's no hardcoded TS list left to
  // diff against, so this literal IS the parity contract.
  const EXPECTED = [
    {
      id: "free",
      name: "Free",
      tagline: "Untuk mencoba dan eksplorasi konsep awal.",
      featured: false,
      features: [
        "1 project aktif",
        "Brief + 3 alternatif layout",
        "Editor denah 2D dasar",
        "3D preview sederhana",
        "RAB awal (estimasi)",
      ],
      limits: ["Watermark pada export", "Tanpa DXF/IFC"],
    },
    {
      id: "pro",
      name: "Pro",
      tagline: "Untuk yang serius menyiapkan diskusi dengan kontraktor.",
      featured: true,
      features: [
        "Project tanpa batas",
        "Semua fitur Free",
        "Export Contractor Pack PDF",
        "Export DXF & IFC",
        "RAB Excel",
        "AI assistant penuh",
      ],
      limits: ["Tanpa watermark"],
    },
    {
      id: "studio",
      name: "Studio",
      tagline: "Untuk studio & kontraktor dengan banyak proyek.",
      featured: false,
      features: [
        "Semua fitur Pro",
        "Kolaborasi tim",
        "Professional review priority",
        "Brand kustom pada export",
        "Dukungan prioritas",
      ],
      limits: [] as string[],
    },
  ] as const

  it("covers exactly the same plan ids in the same display order", () => {
    const sorted = [...DEFAULT_PLANS].sort((a, b) => a.sortOrder - b.sortOrder)
    expect(sorted.map((p) => p.id)).toEqual(EXPECTED.map((p) => p.id))
  })

  it.each(EXPECTED.map((p) => [p.id, p] as const))(
    "plan %s mirrors the pre-T2 pricing.ts content verbatim",
    (id, expected) => {
      const plan = DEFAULT_PLANS.find((p) => p.id === id)
      expect(plan).toBeDefined()
      expect(plan?.name).toBe(expected.name)
      expect(plan?.tagline).toBe(expected.tagline)
      expect(plan?.featured).toBe(expected.featured)
      expect(plan?.features).toEqual(expected.features)
      expect(plan?.limits).toEqual(expected.limits)
    }
  )

  it("locks prices and the fixed entitlements shape per plan", () => {
    const byId = new Map(DEFAULT_PLANS.map((p) => [p.id, p]))
    expect(byId.get("free")?.priceIdr).toBe(0)
    expect(byId.get("pro")?.priceIdr).toBe(149000)
    expect(byId.get("studio")?.priceIdr).toBe(499000)
    expect(byId.get("free")?.entitlements).toEqual({
      creditsPerPeriod: 10,
      maxProjects: 1,
      exportPdf: false,
      glbUpload: false,
      aiRenderHd: false,
    })
    expect(byId.get("pro")?.entitlements).toEqual({
      creditsPerPeriod: 100,
      maxProjects: null,
      exportPdf: true,
      glbUpload: true,
      aiRenderHd: true,
    })
    expect(byId.get("studio")?.entitlements).toEqual({
      creditsPerPeriod: 500,
      maxProjects: 50,
      exportPdf: true,
      glbUpload: true,
      aiRenderHd: true,
    })
  })
})

describe("getPlans (memory fallback)", () => {
  it("returns the 3 seeded plans sorted by sort_order then price", async () => {
    const plans = await getPlans()
    expect(plans.map((p) => p.id)).toEqual(["free", "pro", "studio"])
  })

  it("returns clones — mutating a result never touches the store", async () => {
    const [first] = await getPlans()
    first.name = "HACKED"
    first.features.push("HACKED")
    const [fresh] = await getPlans()
    expect(fresh.name).toBe("Free")
    expect(fresh.features).not.toContain("HACKED")
  })

  it("activeOnly filters out deactivated plans", async () => {
    await setPlanActive("studio", false)
    const active = await getPlans(true)
    expect(active.map((p) => p.id)).toEqual(["free", "pro"])
    const all = await getPlans()
    expect(all).toHaveLength(3)
    await setPlanActive("studio", true)
    expect((await getPlans(true)).map((p) => p.id)).toEqual([
      "free",
      "pro",
      "studio",
    ])
  })
})

describe("getPlan (memory fallback)", () => {
  it("returns a plan by id with its entitlements", async () => {
    const pro = await getPlan("pro")
    expect(pro?.name).toBe("Pro")
    expect(pro?.entitlements.creditsPerPeriod).toBe(100)
  })

  it("returns null for an unknown id", async () => {
    expect(await getPlan("nope")).toBeNull()
  })
})

describe("upsertPlan (memory fallback)", () => {
  it("updates an existing plan in place", async () => {
    const pro = (await getPlan("pro")) as PlanRow
    await upsertPlan({ ...pro, priceIdr: 199000, tagline: "Harga baru." })
    const updated = await getPlan("pro")
    expect(updated?.priceIdr).toBe(199000)
    expect(updated?.tagline).toBe("Harga baru.")
  })

  it("inserts a new plan and keeps the sorted order", async () => {
    await upsertPlan({
      id: "enterprise",
      name: "Enterprise",
      priceIdr: 999000,
      period: "month",
      tagline: null,
      featured: false,
      sortOrder: 3,
      active: true,
      features: ["Semua fitur Studio"],
      limits: [],
      entitlements: {
        creditsPerPeriod: 1000,
        maxProjects: 100,
        exportPdf: true,
        glbUpload: true,
        aiRenderHd: true,
      },
    })
    const plans = await getPlans()
    expect(plans.map((p) => p.id)).toEqual(["free", "pro", "studio", "enterprise"])
  })
})
