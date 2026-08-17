import { test, expect } from "@playwright/test"

const DEMO = "proj-demo-8x8"

test.describe("Editor titik listrik", () => {
  test("Auto-generate menempatkan titik listrik di denah", async ({ page }) => {
    await page.goto(`/app/projects/${DEMO}/editor`)

    // Plan canvas is the SVG with `touch-none` (same handle other editor
    // e2e/critical-flows tests wait on).
    await expect(page.locator("svg.touch-none")).toBeVisible({ timeout: 30_000 })

    // The no-selection inspector ("Ringkasan") is shown by default — no Edit
    // mode needed — and hosts the "Listrik" section with its Auto-generate
    // button (see SummaryInspector -> ElectricalSection in
    // src/components/editor/editor-inspector.tsx). Auto-generate is
    // deterministic, so it's a stabler assertion than click-to-place.
    await page.getByRole("button", { name: "Auto-generate titik listrik" }).click()

    // At least one electrical marker for the current floor now renders on the
    // canvas (data-testid set in ElectricalMarker, plan-canvas.tsx).
    await expect(
      page.locator('[data-testid="electrical-marker"]').first()
    ).toBeVisible({ timeout: 15_000 })
  })
})
