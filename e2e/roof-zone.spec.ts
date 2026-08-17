import { test, expect } from "@playwright/test"

const DEMO = "proj-demo-8x8"

test.describe("Roof zone editor", () => {
  test("convert legacy roof to editable zones, split it, and keep Preview 3D alive", async ({
    page,
  }) => {
    await page.goto(`/app/projects/${DEMO}/editor`)
    await expect(page.locator("svg.touch-none")).toBeVisible()

    const panel = page.getByTestId("editor-floating-sidebar")
    await expect(panel).toBeVisible()

    await panel.getByRole("button", { name: "Jadikan zona atap editable" }).click()

    await expect(page.getByTestId("roof-zone")).toHaveCount(1)
    await expect(
      panel.getByRole("heading", { name: "Zona atap", exact: true }),
    ).toBeVisible()
    await expect(panel.getByRole("button", { name: "Kiri / kanan" })).toBeVisible()

    await panel.getByRole("button", { name: "Kiri / kanan" }).click()

    await expect(page.getByTestId("roof-zone")).toHaveCount(2)
    await expect(page.getByTestId("roof-zone-handle")).toHaveCount(8)

    // NOT asserting data-has-issue === "false" here (utang lama diagnosis,
    // 2026-08-16, verified via a temporary window.__debug dump of
    // layout.validation.issues — not left in the code):
    // proj-demo-8x8's building footprint (buildingFootprint(), consumed by
    // legacyRoofZone() in src/lib/exterior/roof-zones.ts) ALREADY extends
    // past its own 8×8 site before this test ever touches the roof — the
    // same demo layout independently flags "Musholla keluar dari batas
    // tanah" / "Tangga keluar dari batas tanah" on two rooms via
    // validateLayout (see design-audit-card.spec.ts, which tolerates the
    // demo project having pre-existing findings rather than asserting zero).
    // The legacy roof inherits that same oversized footprint, so
    // validateRoofZones' "berada di luar tapak" check legitimately fires on
    // BOTH split halves — confirmed present on the single un-split zone too
    // (same footprint, just not yet divided), so this is unrelated to
    // "Kiri / kanan" splitting itself and not a regression from this
    // feature. Fixing the demo fixture's site/footprint mismatch is out of
    // scope here (touches RAB/audit fixtures broadly) — tracked as a real,
    // pre-existing product/fixture issue rather than papered over.
    const issueFlags = await page
      .getByTestId("roof-zone")
      .evaluateAll((zones) =>
        zones.map((zone) => zone.getAttribute("data-has-issue")),
      )
    expect(issueFlags).toEqual(["true", "true"])

    // Navigate via SPA so the editor store draft (roofZones) is preserved into
    // Preview 3D; a full page.goto would reload the mock project from fixtures.
    await page
      .getByRole("navigation")
      .getByRole("link", { name: "3D Preview" })
      .click()
    await page.waitForURL(`**/app/projects/${DEMO}/preview-3d`)
    await expect(page.getByRole("heading", { name: "Preview 3D" })).toBeVisible({
      timeout: 30_000,
    })

    const canvas = page.locator("canvas").first()
    const fallback = page.getByText("Gagal memuat preview 3D")
    await expect(canvas.or(fallback)).toBeVisible({ timeout: 30_000 })
  })
})
