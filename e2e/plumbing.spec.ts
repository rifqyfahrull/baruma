import { test, expect } from "@playwright/test"

const DEMO = "proj-demo-8x8"

test.describe("Editor titik air & sanitasi", () => {
  test("Auto-generate menempatkan titik air dan objek sanitasi di denah", async ({ page }) => {
    await page.goto(`/app/projects/${DEMO}/editor`)

    // Plan canvas is the SVG with `touch-none` (same handle the electrical /
    // critical-flows editor tests wait on).
    await expect(page.locator("svg.touch-none")).toBeVisible({ timeout: 30_000 })

    // The no-selection inspector ("Ringkasan") is shown by default — no Edit
    // mode needed — and hosts the "Air & Sanitasi" section with its two
    // deterministic auto buttons (see SummaryInspector -> WaterSanitationSection
    // in src/components/editor/editor-inspector.tsx). Auto-generate is stabler
    // than click-to-place, mirroring the electrical editor test.
    await page.getByRole("button", { name: "Auto-generate titik air" }).click()

    // At least one water-fixture marker for the current floor now renders on the
    // canvas (data-testid set in WaterMarker, plan-canvas.tsx).
    await expect(
      page.locator('[data-testid="water-marker"]').first()
    ).toBeVisible({ timeout: 15_000 })

    // Auto-size sanitasi drops the septic tank / soakwell / control boxes onto
    // the lot as draggable land-objects (data-testid set in SanitationMarker).
    // The demo project seeds a Site, so the button is enabled.
    await page.getByRole("button", { name: "Auto-size sanitasi" }).click()
    await expect(
      page.locator('[data-testid="sanitation-marker"]').first()
    ).toBeVisible({ timeout: 15_000 })
  })
})
