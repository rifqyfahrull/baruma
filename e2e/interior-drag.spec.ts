import { test, expect } from "@playwright/test"

const DEMO = "proj-demo-8x8"

test.describe("Interior drag in 3D", () => {
  test("3D canvas mouse interaction (drag) does not produce console errors and keeps the scene alive", async ({ page }) => {
    const errors: string[] = []
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()) })
    page.on("pageerror", (e) => errors.push(String(e)))

    await page.goto(`/app/projects/${DEMO}/preview-3d`)
    const canvas = page.locator("canvas").first()
    const fallback = page.getByText("Gagal memuat preview 3D")
    await expect(canvas.or(fallback)).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole("heading", { name: "Preview 3D" })).toBeVisible({ timeout: 30_000 })

    // Toggle Edit/View DIHAPUS (Fase 4 rail cleanup) — interactionMode kini
    // selalu "edit" secara default (murni gate readOnly untuk viewer publik),
    // jadi canvas drag langsung aktif tanpa langkah masuk mode Edit lagi.

    // Panel quick-add katalog sengaja dihapus (0066600, 12 Jul) — furniture
    // baru ditambahkan lewat "Tambah Model 3D Kustom" → My Library. Item baru
    // auto-terseleksi (addAssetFurniture), siap untuk drag.
    await page.getByTestId("room-custom-model").click()
    await page.getByRole("button", { name: /Tambah dari My Library/ }).click()
    await page.getByText("Sofa Itali 1").first().click()
    await expect(page.getByText(/ditambahkan ke/).first()).toBeVisible()

    if (await canvas.isVisible().catch(() => false)) {
      const box = await canvas.boundingBox()
      if (box) {
        const midX = box.x + box.width / 2
        const midY = box.y + box.height / 2
        await page.mouse.move(midX, midY)
        await page.mouse.down()
        await page.mouse.move(midX + 40, midY + 30, { steps: 8 })
        await page.mouse.move(midX - 30, midY + 10, { steps: 8 })
        await page.mouse.up()
      }
    }

    await page.waitForTimeout(500)
    // SoftShadows (the old unpackRGBAToDepth exemption) is removed from the
    // scene — any shader compile error is a real bug again. mock:// adalah
    // skema storage palsu mock backend — fetch model dari aset library yang
    // baru dipasang adalah noise yang diharapkan di e2e.
    //
    // Aset GLB furnitur (public/models/*.glb) tidak ada di checkout lokal
    // (hanya di storage produksi) — layout demo mereferensikan puluhan model.
    // GlbErrorBoundary + Suspense fallback (furniture-model.tsx) menangkap
    // kegagalan load-nya dan jatuh ke ProceduralFurniture, jadi bukan crash
    // produk — hanya noise 404 aset yang memang tidak tersedia di lokal.
    const real = errors.filter(
      (e) => !/favicon|ResizeObserver|mock:\/\/|Could not load \/models\/.+\.glb|Failed to load resource.*404/i.test(e)
    )
    expect(real, real.join("\n")).toEqual([])
    await expect(canvas.or(fallback)).toBeVisible()
    // sidebar still functional after drag
    await expect(page.getByRole("heading", { name: "Preview 3D" })).toBeVisible()
  })
})
