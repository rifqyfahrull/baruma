import { describe, expect, it } from "vitest"

import { getCurrentUser, getLayout, getProject } from "@/lib/mock"
import type { CreateProjectInput } from "@/lib/schemas/project"

describe("mock getCurrentUser", () => {
  it("returns the demo user on the studio plan", async () => {
    const user = await getCurrentUser()
    expect(user.plan).toBe("studio")
  })

  it("attaches entitlements matching the studio plan's shape", async () => {
    const user = await getCurrentUser()
    expect(user.entitlements).toEqual({
      creditsPerPeriod: 500,
      maxProjects: 50,
      exportPdf: true,
      glbUpload: true,
      aiRenderHd: true,
    })
  })

  it("defaults role to 'user' (mock user is never an admin by default)", async () => {
    const user = await getCurrentUser()
    expect(user.role).toBe("user")
  })
})

describe("mock listMyAssets — read-only katalog global", () => {
  it("aset katalog global (Baruma Asset Bank) editable=false; aset user editable=true", async () => {
    const { listMyAssets } = await import("@/lib/mock")
    const { items } = await listMyAssets()
    const global = items.filter((a) => a.sourceName === "Baruma Asset Bank")
    expect(global.length).toBeGreaterThan(0)
    expect(global.every((a) => a.editable === false)).toBe(true)
    expect(global.some((a) => a.performance)).toBe(true)
    const own = items.filter((a) => a.sourceName !== "Baruma Asset Bank")
    expect(own.every((a) => a.editable === true)).toBe(true)
  })
})

describe("mock asset price (integrasi furnitur ↔ RAB)", () => {
  it("aset katalog global membawa priceIDR sehingga penempatan langsung berharga", async () => {
    const { listMyAssets } = await import("@/lib/mock")
    const { items } = await listMyAssets()
    const sofa = items.find((a) => a.name === "Sofa Itali 1")!
    expect(sofa.priceIDR).toBeGreaterThan(0)
  })

  it("updateAssetMetadata mem-persist price_idr ke aset upload user", async () => {
    const { createIngestionJob, updateAssetMetadata, listMyAssets } = await import("@/lib/mock")
    const job = await createIngestionJob({
      projectId: "p-price-test",
      expectedCategory: "generic",
      fileUrl: "mock://assets/x/kursi.glb",
      originalFilename: "kursi.glb",
    })
    await updateAssetMetadata(job.assetId, { price_idr: 1_250_000 })
    const { items } = await listMyAssets()
    const asset = items.find((a) => a.id === job.assetId)!
    expect(asset.priceIDR).toBe(1_250_000)
  })
})

describe("mock updateBrief — Project.site sync (audit reads Project.site, not Brief.site)", () => {
  const baseInput: CreateProjectInput = {
    name: "Rumah Regulasi",
    city: "Bandung",
    projectType: "new",
    style: "modern_tropis",
    widthM: 8,
    depthM: 10,
    frontOrientation: "unknown",
    sidesAttached: 0,
    frontRoadWidthM: 5,
    carport: true,
    siteNotes: "",
    floors: 2,
    rooftop: false,
    budgetMinIDR: 500_000_000,
    budgetMaxIDR: 900_000_000,
    finishingLevel: "menengah",
    priorities: [],
    rooms: [
      {
        roomType: "ruang_tamu",
        name: "Ruang tamu",
        required: true,
        quantity: 1,
        sizePreference: "standard",
      },
    ],
  }

  it("editing brief.site.regulation via updateBrief propagates to project.site.regulation", async () => {
    const { createProject, updateBrief } = await import("@/lib/mock")
    const { project } = await createProject(baseInput)
    expect(project.site.regulation).toBeUndefined()

    const nextSite = {
      ...project.site,
      regulation: { maxKdb: 0.6, maxKlb: 1.8, gsbM: 3, minKdh: 0.15 },
    }
    await updateBrief(project.id, { site: nextSite })

    const updated = await getProject(project.id)
    expect(updated?.site.regulation).toEqual({
      maxKdb: 0.6,
      maxKlb: 1.8,
      gsbM: 3,
      minKdh: 0.15,
    })
  })

  it("editing an unrelated brief field (summary) leaves project.site untouched", async () => {
    const { createProject, updateBrief } = await import("@/lib/mock")
    const { project } = await createProject(baseInput)
    await updateBrief(project.id, { summary: "Ringkasan baru" })

    const updated = await getProject(project.id)
    expect(updated?.site).toEqual(project.site)
  })
})

describe("mock certification scene routes", () => {
  it("serves certification projects directly without adding them to dashboard seed state", async () => {
    const project = await getProject("scene-a-modern-concrete")
    const layout = await getLayout("scene-a-modern-concrete")

    expect(project?.name).toBe("Certification Scene A")
    expect(layout?.projectId).toBe("scene-a-modern-concrete")
    expect(layout?.exteriorElements?.some((element) => element.kind === "facade_panel")).toBe(true)
  })
})

describe("mock templates", () => {
  it("seeds two active templates with valid layouts", async () => {
    const { getTemplates, getAdminTemplates } = await import("@/lib/mock")
    const active = await getTemplates()
    const all = await getAdminTemplates()
    expect(all.length).toBe(2)
    expect(active.length).toBe(2)
    expect(active.map((t) => t.slug)).toEqual(
      expect.arrayContaining(["rumah-8x8-modern-tropis", "rumah-minimalis-6x15"])
    )
  })

  it("getTemplate returns the full design payload for an active slug", async () => {
    const { getTemplate } = await import("@/lib/mock")
    const detail = await getTemplate("rumah-8x8-modern-tropis")
    expect(detail.layout.rooms.length).toBeGreaterThan(0)
    expect(detail.brief).not.toBeNull()
  })

  it("getTemplate throws (does not return null) for a missing slug", async () => {
    const { getTemplate } = await import("@/lib/mock")
    await expect(getTemplate("tidak-ada")).rejects.toThrow()
  })

  it("updateTemplate({active:false}) hides a template from getTemplates but not getAdminTemplates", async () => {
    const { getTemplates, getAdminTemplates, updateTemplate } = await import("@/lib/mock")
    await updateTemplate("tmpl-minimalis-6x15", { active: false })
    const active = await getTemplates()
    const all = await getAdminTemplates()
    expect(active.some((t) => t.id === "tmpl-minimalis-6x15")).toBe(false)
    expect(all.some((t) => t.id === "tmpl-minimalis-6x15")).toBe(true)
    // Restore for other tests in this shared in-memory module.
    await updateTemplate("tmpl-minimalis-6x15", { active: true })
  })

  it("createTemplate snapshots a project and createTemplate again upserts by slug-derived id", async () => {
    // Only DEMO_PROJECT_ID has a seeded brief (`ensureLayout` needs one to
    // generate a layout for projects that aren't a prebuilt showcase scene).
    const { createTemplate, getAdminTemplates, DEMO_PROJECT_ID } = await import("@/lib/mock")
    const created = await createTemplate({
      projectId: DEMO_PROJECT_ID,
      slug: "demo-8x8-test",
    })
    expect(created.sourceProjectId).toBe(DEMO_PROJECT_ID)
    expect(created.layout.rooms.length).toBeGreaterThan(0)

    const recreated = await createTemplate({
      projectId: DEMO_PROJECT_ID,
      slug: "demo-8x8-test",
      name: "Demo 8x8 (v2)",
    })
    expect(recreated.id).toBe(created.id)
    expect(recreated.name).toBe("Demo 8x8 (v2)")

    const all = await getAdminTemplates()
    expect(all.filter((t) => t.slug === "demo-8x8-test").length).toBe(1)
  })

  it("createTemplate throws for an unknown projectId", async () => {
    const { createTemplate } = await import("@/lib/mock")
    await expect(
      createTemplate({ projectId: "proj-does-not-exist", slug: "nope" })
    ).rejects.toThrow("Proyek tidak ditemukan")
  })

  it("deleteTemplate removes the row", async () => {
    const { createTemplate, deleteTemplate, getAdminTemplates, DEMO_PROJECT_ID } =
      await import("@/lib/mock")
    const created = await createTemplate({
      projectId: DEMO_PROJECT_ID,
      slug: "delete-me-test",
    })
    await deleteTemplate(created.id)
    const all = await getAdminTemplates()
    expect(all.some((t) => t.id === created.id)).toBe(false)
  })
})

describe("mock createProjectFromTemplate (WS-D §1)", () => {
  it("clones brief + full layout into a NEW project owned separately from the template", async () => {
    const { createProjectFromTemplate, getProject, getBrief, getLayout, getTemplate } =
      await import("@/lib/mock")
    const template = await getTemplate("rumah-8x8-modern-tropis")

    const { projectId } = await createProjectFromTemplate("rumah-8x8-modern-tropis")
    expect(projectId).not.toBe(template.sourceProjectId)

    const project = await getProject(projectId)
    expect(project?.name).toBe(`${template.name} (salinan)`)
    expect(project?.floors).toBe(template.floors)

    const layout = await getLayout(projectId)
    expect(layout?.rooms.length).toBe(template.layout.rooms.length)

    const brief = await getBrief(projectId)
    expect(brief?.projectId).toBe(projectId)
  })

  it("throws for an unknown/inactive template slug", async () => {
    const { createProjectFromTemplate } = await import("@/lib/mock")
    await expect(createProjectFromTemplate("tidak-ada")).rejects.toThrow()
  })
})

describe("mock share links (WS-D §2)", () => {
  it("getShareLink returns {url: null} before any link is created", async () => {
    const { getShareLink } = await import("@/lib/mock")
    const result = await getShareLink("proj-share-test-1")
    expect(result.url).toBeNull()
  })

  it("createShareLink is idempotent and getShareLink reflects it afterwards", async () => {
    const { createShareLink, getShareLink } = await import("@/lib/mock")
    const first = await createShareLink("proj-share-test-2")
    const second = await createShareLink("proj-share-test-2")
    expect(second.url).toBe(first.url)
    expect((await getShareLink("proj-share-test-2")).url).toBe(first.url)
  })

  it("revokeShareLink clears the active link", async () => {
    const { createShareLink, revokeShareLink, getShareLink } = await import("@/lib/mock")
    await createShareLink("proj-share-test-3")
    await revokeShareLink("proj-share-test-3")
    expect((await getShareLink("proj-share-test-3")).url).toBeNull()
  })
})

describe("mock component presets (Studio Komponen)", () => {
  it("listComponentPresets returns the seeded starter presets, newest first", async () => {
    const { listComponentPresets } = await import("@/lib/mock")
    const presets = await listComponentPresets()
    expect(presets.length).toBeGreaterThanOrEqual(4)
    expect(presets.map((p) => p.name)).toEqual(
      expect.arrayContaining([
        "Kisi Kubisme 18 bilah",
        "Jeruji Rapat Tropis",
        "Pergola Anyam 40cm",
        "Roster Grid Klasik",
      ])
    )
  })

  it("saveComponentPreset tanpa id membuat preset baru dengan id & createdAt terisi", async () => {
    const { saveComponentPreset, listComponentPresets } = await import("@/lib/mock")
    const before = await listComponentPresets()
    const saved = await saveComponentPreset({
      name: "Kisi Uji Coba",
      family: "kisi",
      pattern: { orientation: "v", pitchM: 0.2, barWidthM: 0.06 },
    })
    expect(saved.id).toBeTruthy()
    expect(saved.createdAt).toBeTruthy()
    const after = await listComponentPresets()
    expect(after.length).toBe(before.length + 1)
    expect(after.some((p) => p.id === saved.id && p.name === "Kisi Uji Coba")).toBe(true)
  })

  it("saveComponentPreset dengan id yang ada meng-upsert (bukan duplikat)", async () => {
    const { saveComponentPreset, listComponentPresets } = await import("@/lib/mock")
    const created = await saveComponentPreset({
      name: "Roster Uji",
      family: "roster",
      pattern: { orientation: "grid", pitchM: 0.3 },
    })
    const before = await listComponentPresets()
    const updated = await saveComponentPreset({
      id: created.id,
      name: "Roster Uji (revisi)",
      family: "roster",
      pattern: { orientation: "grid", pitchM: 0.35 },
    })
    expect(updated.id).toBe(created.id)
    const after = await listComponentPresets()
    expect(after.length).toBe(before.length)
    expect(after.find((p) => p.id === created.id)?.name).toBe("Roster Uji (revisi)")
  })

  it("deleteComponentPreset menghapus preset; id tak dikenal melempar error", async () => {
    const { saveComponentPreset, deleteComponentPreset, listComponentPresets } =
      await import("@/lib/mock")
    const created = await saveComponentPreset({
      name: "Pagar Uji Hapus",
      family: "pagar",
      pattern: { orientation: "v", pitchM: 0.15 },
    })
    await deleteComponentPreset(created.id)
    const after = await listComponentPresets()
    expect(after.some((p) => p.id === created.id)).toBe(false)
    await expect(deleteComponentPreset(created.id)).rejects.toThrow()
  })
})
