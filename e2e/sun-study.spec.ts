import { test, expect, type Page } from "@playwright/test"

const DEMO = "proj-demo-8x8"

async function openLightingPopover(page: Page): Promise<void> {
  await page.goto(`/app/projects/${DEMO}/preview-3d`)
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole("heading", { name: "Preview 3D" })).toBeVisible({ timeout: 30_000 })
  // "Cahaya" (rename dari "Pencahayaan" — Fase 4 rail).
  await page.getByRole("button", { name: "Cahaya" }).click()
  await expect(page.getByTestId("sun-study")).toBeVisible()
}

test.describe("Studi matahari", () => {
  test("aktifkan studi → kontrol jam/bulan + readout arah matahari muncul, kanvas tanpa error", async ({ page }) => {
    const errors: string[] = []
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()) })
    page.on("pageerror", (e) => errors.push(String(e)))

    await openLightingPopover(page)

    // Kontrol manual azimuth ada sebelum studi diaktifkan (Radix Slider tak
    // meneruskan aria-label ke thumb — assert via teks label).
    await expect(page.getByText(/Azimuth matahari/)).toBeVisible()

    // Nyalakan studi matahari.
    await page.getByTestId("sun-study").getByRole("switch").click()

    // Readout + kontrol jam/bulan tampil; kontrol manual azimuth hilang.
    const readout = page.getByTestId("sun-study-readout")
    await expect(readout).toBeVisible()
    await expect(readout).toContainText(/matahari di/)
    await expect(page.getByText(/^Jam —/)).toBeVisible()
    await expect(page.getByText(/^Bulan —/)).toBeVisible()
    await expect(page.getByText(/Azimuth matahari/)).toHaveCount(0)

    // Geser jam ke pagi → readout jam ikut berubah (matahari bergerak).
    // Hanya 2 slider dalam sun-study setelah aktif: jam (pertama), bulan.
    const jamThumb = page.getByTestId("sun-study").getByRole("slider").first()
    await jamThumb.focus()
    for (let i = 0; i < 8; i++) await page.keyboard.press("ArrowLeft") // mundur ke pagi
    await expect(readout).not.toContainText("12:00")

    // "Putar sehari" berjalan lalu bisa dijeda tanpa error.
    const play = page.getByTestId("sun-study-play")
    await expect(play).toContainText(/Putar sehari/)
    await play.click()
    await expect(play).toContainText("Jeda")
    await page.waitForTimeout(600)
    await play.click()
    await expect(play).toContainText(/Putar sehari/)

    // Tidak ada error konsol/shader dari perubahan lintasan matahari.
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
  })
})
