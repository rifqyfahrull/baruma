import { test, expect } from "@playwright/test"

// Slugs seeded in mock mode (src/lib/mock/index.ts buildSeedTemplates) — the
// e2e webServer always runs without DATABASE_URL, so the data source is the
// in-memory mock, not the real db/migrations/0037_seed_templates.sql rows.
const TEMPLATE_SLUG = "rumah-8x8-modern-tropis"

test.describe("Template → project (WS-D §1)", () => {
  test("galeri publik: 'Gunakan template ini' membuat project dan membuka editor dengan denah terisi", async ({
    page,
  }) => {
    await page.goto("/templates")
    const card = page.getByTestId(`template-card-${TEMPLATE_SLUG}`)
    // Galeri /templates adalah server component yang membaca DB langsung —
    // di e2e hermetis (tanpa DATABASE_URL) galerinya kosong. Skip dgn alasan
    // jelas; jalur mock client-side tetap teruji lewat test kartu dashboard.
    test.skip(
      (await page.locator('[data-testid^="template-card-"]').count()) === 0,
      "Galeri /templates butuh DATABASE_URL (server-rendered dari DB)",
    )
    await expect(card).toBeVisible()

    await card.getByTestId("use-template-button").click()

    await page.waitForURL(/\/app\/projects\/proj-.+\/editor/, { timeout: 30_000 })
    // Editor render denah 2D — bukti clone berhasil (bukan halaman kosong).
    await expect(page.locator("svg.touch-none")).toBeVisible()
  })

  test("halaman detail template: CTA yang sama membuat project dari template itu", async ({
    page,
  }) => {
    await page.goto(`/templates/${TEMPLATE_SLUG}`)
    // Paritas skip dgn test galeri di atas — halaman detail juga DB-rendered.
    test.skip(
      (await page.getByTestId("use-template-button").count()) === 0,
      "Detail /templates/[slug] butuh DATABASE_URL (server-rendered dari DB)",
    )
    await expect(page.getByRole("heading", { name: "Rumah 8×8 Modern Tropis" })).toBeVisible()

    await page.getByTestId("use-template-button").click()

    await page.waitForURL(/\/app\/projects\/proj-.+\/editor/, { timeout: 30_000 })
    await expect(page.locator("svg.touch-none")).toBeVisible()

    // Nama project = "<template> (salinan)" — muncul di dropdown nama ProjectBar.
    await expect(
      page.getByTestId("project-name-menu-trigger").filter({ hasText: "salinan" })
    ).toBeVisible()
  })
})

test.describe("Dashboard — kartu template nyata (WS-D §1)", () => {
  test("kartu 'Template saran' memuat data nyata dari galeri (bukan 3 kartu palsu) dengan CTA yang berfungsi", async ({
    page,
  }) => {
    await page.goto("/app/dashboard")
    await expect(page.getByRole("heading", { name: "Template saran" })).toBeVisible()

    const card = page.getByTestId(`template-card-${TEMPLATE_SLUG}`)
    await expect(card).toBeVisible()
    await expect(card.getByText("Rumah 8×8 Modern Tropis")).toBeVisible()

    await card.getByTestId("use-template-button").click()
    await page.waitForURL(/\/app\/projects\/proj-.+\/editor/, { timeout: 30_000 })
    await expect(page.locator("svg.touch-none")).toBeVisible()
  })
})
