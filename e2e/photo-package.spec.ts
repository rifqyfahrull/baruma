import { test, expect, type Page } from "@playwright/test"

const DEMO = "proj-demo-8x8"

async function openPreview(page: Page): Promise<void> {
  await page.goto(`/app/projects/${DEMO}/preview-3d`)
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole("heading", { name: "Preview 3D" })).toBeVisible({ timeout: 30_000 })
  await page.waitForTimeout(1500)
}

test.describe("Paket foto presentasi", () => {
  test("buat paket → galeri berisi beberapa foto, tiap foto bisa diunduh", async ({ page }) => {
    const errors: string[] = []
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()) })
    page.on("pageerror", (e) => errors.push(String(e)))

    await openPreview(page)

    // Paket foto pindah ke dalam flyout "Kamera" (Fase 4 rail) — buka dulu,
    // lalu klik baris "Paket Foto Presentasi" (testid dipertahankan).
    await page.getByRole("button", { name: "Kamera" }).click()
    await page.getByTestId("photo-package-open").click()
    await expect(page.getByRole("heading", { name: "Paket Foto Presentasi" })).toBeVisible()

    // Buat paket — scene diputar melalui tiap sudut lalu galeri muncul.
    await page.getByTestId("photo-package-generate").click()
    const gallery = page.getByTestId("photo-package-gallery")
    await expect(gallery).toBeVisible({ timeout: 30_000 })

    // Minimal 3 foto tergenerate (PHOTO_SHOTS), tiap <img> punya data URL PNG.
    const imgs = gallery.locator("img")
    await expect
      .poll(async () => imgs.count(), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(3)
    const firstSrc = await imgs.first().getAttribute("src")
    expect(firstSrc).toMatch(/^data:image\/png;base64,/)
    // Foto rumah nyata → base64 panjang (bukan kanvas kosong).
    expect((firstSrc ?? "").length).toBeGreaterThan(5000)

    // Unduh satu foto individual → memicu download.
    const downloadPromise = page.waitForEvent("download", { timeout: 10_000 })
    await gallery.getByRole("button", { name: /Unduh/ }).first().click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/\.png$/)

    // Tidak ada error konsol/shader dari pergantian sudut+suasana.
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
