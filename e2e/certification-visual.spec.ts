import { test, expect, type Page } from "@playwright/test"

const SCENES = [
  "scene-a-modern-concrete",
  "scene-b-brick-gable",
] as const

async function openPresentationPreview(page: Page, sceneId: string): Promise<void> {
  await page.goto(`/app/projects/${sceneId}/preview-3d`)
  await expect(page.getByRole("heading", { name: "Preview 3D" })).toBeVisible({ timeout: 30_000 })
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 30_000 })
  await page.getByRole("button", { name: "Opsi tampilan" }).click()
  await expect(page.getByTestId("render-mode-presentation")).toHaveAttribute("aria-pressed", "true")
  await page.keyboard.press("Escape")
  await page.waitForTimeout(1500)
}

test.describe("Certification visual regression", () => {
  for (const sceneId of SCENES) {
    test(`${sceneId} canvas matches presentation baseline`, async ({ page }) => {
      await openPresentationPreview(page, sceneId)

      await expect(page.locator("canvas").first()).toHaveScreenshot(
        `${sceneId}-presentation.png`,
        {
          animations: "disabled",
          maxDiffPixelRatio: 0.04,
          timeout: 15_000,
        },
      )
    })
  }
})
