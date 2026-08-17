import { test, expect, type Page } from "@playwright/test"

const DEMO = "proj-demo-8x8"

async function openPreview(page: Page): Promise<void> {
  await page.goto(`/app/projects/${DEMO}/preview-3d`)
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole("heading", { name: "Preview 3D" })).toBeVisible({ timeout: 30_000 })
  await page.waitForTimeout(1000)
}

test.describe("Presentation mode + scene stats", () => {
  test("render presets are selectable and dev scene stats expose budget counters", async ({ page }) => {
    const errors: string[] = []
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()) })
    page.on("pageerror", (e) => errors.push(String(e)))

    await openPreview(page)

    await page.getByRole("button", { name: "Opsi tampilan" }).click()
    const edit = page.getByTestId("render-mode-edit")
    const presentation = page.getByTestId("render-mode-presentation")

    await expect(presentation).toHaveAttribute("aria-pressed", "true")
    await edit.click()
    await expect(edit).toHaveAttribute("aria-pressed", "true")
    await expect(presentation).toHaveAttribute("aria-pressed", "false")

    await presentation.click()
    await expect(presentation).toHaveAttribute("aria-pressed", "true")
    await expect(edit).toHaveAttribute("aria-pressed", "false")

    // Close options popover, then open dev-only scene stats.
    await page.keyboard.press("Escape")
    const statsButton = page.getByTestId("scene-stats-button")
    await expect(statsButton).toBeVisible()
    await statsButton.click()

    await expect(page.getByText("Scene stats · dev only")).toBeVisible()
    await expect(page.getByText("Semantic objects")).toBeVisible()
    await expect(page.getByText("Draw calls")).toBeVisible()
    await expect(page.getByText("Triangles")).toBeVisible()
    await expect(page.getByText("Textures")).toBeVisible()

    // Aset GLB furnitur (public/models/*.glb) tidak ada di checkout lokal
    // (hanya di storage produksi) — layout demo mereferensikan puluhan model.
    // GlbErrorBoundary + Suspense fallback (furniture-model.tsx) menangkap
    // kegagalan load-nya dan jatuh ke ProceduralFurniture, jadi bukan crash
    // produk — hanya noise 404 aset yang memang tidak tersedia di lokal.
    const real = errors.filter(
      (e) => !/favicon|ResizeObserver|mock:\/\/|Could not load \/models\/.+\.glb|Failed to load resource.*404/i.test(e)
    )
    expect(real, real.join("\n")).toEqual([])
  })
})
