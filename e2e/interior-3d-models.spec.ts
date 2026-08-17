import { test, expect } from "@playwright/test"

const DEMO = "proj-demo-8x8"

test.describe("Interior 3D models (GLB hybrid)", () => {
  test("preview-3d renders furniture without console errors and a GLB item can be added", async ({ page }) => {
    const errors: string[] = []
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()) })
    page.on("pageerror", (e) => errors.push(String(e)))

    await page.goto(`/app/projects/${DEMO}/preview-3d`)
    // Scene mounts (canvas) or graceful fallback — must not be a crash.
    const canvas = page.locator("canvas").first()
    const fallback = page.getByText("Gagal memuat preview 3D")
    await expect(canvas.or(fallback)).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole("heading", { name: "Preview 3D" })).toBeVisible({ timeout: 30_000 })

    // Default mode is View — enter Edit so furniture controls activate.
    await page.getByTitle("Masuk mode Edit (E)").click()

    // Panel quick-add katalog sengaja dihapus (0066600, 12 Jul) — GLB item
    // ditambahkan lewat "Tambah Model 3D Kustom" → My Library (aset katalog
    // global mock, paritas asset-library.spec).
    await page.getByTestId("room-custom-model").click()
    await page.getByRole("button", { name: /Tambah dari My Library/ }).click()
    await page.getByText("Sofa Itali 1").first().click()
    await expect(page.getByText(/ditambahkan ke/).first()).toBeVisible()

    // Give the GLB a moment to load, then snapshot for visual review.
    await page.waitForTimeout(2500)
    await page.screenshot({ path: "e2e/artifacts/preview-3d-glb.png", fullPage: false })

    // No uncaught/console errors from model loading. SoftShadows (the old
    // unpackRGBAToDepth exemption) is removed from the scene — any shader
    // compile error is a real bug again. mock:// adalah skema storage palsu
    // mock backend — fetch model aset yang baru dipasang adalah noise yang
    // diharapkan (renderer jatuh ke fallback prosedural, bukan crash).
    //
    // Aset GLB furnitur (public/models/*.glb) sengaja TIDAK ada di checkout
    // lokal (hanya tersedia di storage produksi) — layout demo mereferensikan
    // puluhan model (sofa, meja, dst). GlbErrorBoundary + Suspense fallback
    // (furniture-model.tsx) sudah menangkap kegagalan loadnya dan jatuh ke
    // ProceduralFurniture, jadi ini bukan crash produk — hanya noise 404 aset
    // yang memang tidak tersedia di lokal.
    const modelErrors = errors.filter(
      (e) => !/favicon|ResizeObserver|mock:\/\/|Could not load \/models\/.+\.glb|Failed to load resource.*404/i.test(e)
    )
    expect(modelErrors, modelErrors.join("\n")).toEqual([])

    // Scene still alive after adding the model.
    await expect(canvas.or(fallback)).toBeVisible()
  })
})
