import { expect, test } from "@playwright/test"

const DEMO = "proj-demo-8x8"

test.describe("Unified project AI Agent", () => {
  test("shares one persistent thread across Brief and Editor and applies a Denah proposal", async ({ page }) => {
    await page.goto(`/app/projects/${DEMO}/brief`)
    await page.getByRole("button", { name: "AI Agent", exact: true }).first().click()
    const panel = page.getByTestId("project-agent-panel")
    await expect(panel).toBeVisible()

    await panel.getByRole("button", { name: "Brief", exact: true }).click()
    await panel.getByLabel("Pesan untuk AI Agent").fill("Apakah brief ini realistis untuk keluarga saya?")
    await panel.getByRole("button", { name: "Kirim pesan" }).click()
    await expect(panel.getByText("Apakah brief ini realistis untuk keluarga saya?", { exact: true })).toBeVisible()
    await expect(panel.getByText(/thread unified/)).toBeVisible()

    await page.getByTestId("project-agent-sheet").getByRole("button", { name: "Close" }).click()
    // 2D Editor kini sub-halaman Desain (caret), bukan tab langsung — Fase 5.
    await page
      .getByRole("navigation", { name: "Tahap project" })
      .getByTestId("stage-desain-caret")
      .click()
    await page.getByRole("menuitem", { name: "2D Editor" }).click()
    await expect(page).toHaveURL(new RegExp(`/app/projects/${DEMO}/editor$`))
    await expect(page.locator("svg.touch-none")).toBeVisible()
    await page.getByRole("button", { name: "AI Agent", exact: true }).first().click()
    await expect(panel.getByText("Apakah brief ini realistis untuk keluarga saya?", { exact: true })).toBeVisible()

    await panel.getByRole("button", { name: "Denah", exact: true }).click()
    await panel.getByLabel("Pesan untuk AI Agent").fill("Tambahkan jendela di ruang tamu")
    await panel.getByRole("button", { name: "Kirim pesan" }).click()
    await expect(panel.getByText("Usulan perubahan (1)")).toBeVisible()
    await panel.getByRole("button", { name: "Terapkan" }).click()
    await expect(panel.getByText("✓ Diterapkan")).toBeVisible()
  })
})
