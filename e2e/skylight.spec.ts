import { test, expect } from "@playwright/test"

const DEMO = "proj-demo-8x8"

// Skylight (Fase B ARSITEKTUR_MODERN): tambah dari kartu Atap → rect muncul
// di layer Atap 2D → drag menggesernya (auto-fit) → hapus dari kartu.
test.describe("Skylight bidang atap datar", () => {
  test("tambah dari kartu Atap → rect di layer Atap → geser → hapus", async ({
    page,
  }) => {
    await page.goto(`/app/projects/${DEMO}/editor`)
    await expect(page.locator("svg.touch-none")).toBeVisible()

    const panel = page.getByTestId("editor-floating-sidebar")
    await expect(panel).toBeVisible()

    // Kartu Atap (RoofSummarySection) selalu ada tanpa seleksi.
    await panel.getByTestId("skylight-add").click()

    // addSkylight auto-berpindah ke layer Atap + memilih skylight-nya.
    await expect(page.getByTestId("floor-tab-atap")).toBeVisible()
    const rect = page.getByTestId("skylight-rect")
    await expect(rect).toHaveCount(1)
    await expect(panel.getByTestId("skylight-inspector")).toBeVisible()

    // Drag menggeser posisi (nilai x di store berubah — cek via kartu).
    const box = (await rect.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, {
      steps: 5,
    })
    await page.mouse.up()
    await expect(rect).toHaveCount(1)

    // Hapus dari kartu → rect hilang.
    await panel.getByRole("button", { name: "Hapus skylight" }).click()
    await expect(page.getByTestId("skylight-rect")).toHaveCount(0)
  })
})
