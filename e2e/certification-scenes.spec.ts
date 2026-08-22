import { test, expect, type Page } from "@playwright/test"

const SCENES = [
  { id: "scene-a-modern-concrete", name: "Certification Scene A" },
  { id: "scene-b-brick-gable", name: "Certification Scene B" },
] as const

async function openCertificationPreview(page: Page, sceneId: string): Promise<void> {
  await page.goto(`/app/projects/${sceneId}/preview-3d`)
  await expect(page.getByRole("heading", { name: "Preview 3D" })).toBeVisible({ timeout: 30_000 })
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 30_000 })
  await page.waitForTimeout(1500)
}

async function downloadedBytes(page: Page): Promise<number> {
  const downloadPromise = page.waitForEvent("download", { timeout: 15_000 })
  // Screenshot pindah ke dalam flyout "Kamera" (Fase 4 rail) — buka dulu.
  await page.getByRole("button", { name: "Kamera" }).click()
  await page.getByRole("button", { name: "Screenshot", exact: true }).click()
  const download = await downloadPromise
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const c of stream) chunks.push(c as Buffer)
  return Buffer.concat(chunks).length
}

async function clickCanvasUntilAttached(
  page: Page,
  testId: string,
  points: Array<[number, number]>,
): Promise<boolean> {
  const canvas = page.locator("canvas").first()
  const box = await canvas.boundingBox()
  if (!box) return false

  // Posisi elemen di layar bergeser antar-run (animasi kamera preset +
  // raster SwiftShader) — beri waktu kamera settle, lalu sapu grid titik di
  // sekitar titik acuan supaya raycast tidak bergantung pada satu piksel.
  await page.waitForTimeout(1000)
  const sweep: Array<[number, number]> = points.flatMap(([fx, fy]) => [
    [fx, fy],
    [fx + 0.03, fy],
    [fx - 0.03, fy],
    [fx, fy + 0.04],
    [fx, fy - 0.04],
  ])

  for (const [fx, fy] of sweep) {
    // force: klik ini raycast ke viewport 3D — sidebar kanan (floating panel)
    // bisa memanjang menutupi titik klik setelah seleksi sebelumnya dan
    // mencegat pointer; target sebenarnya selalu canvas.
    await canvas.click({ position: { x: box.width * fx, y: box.height * fy }, force: true })
    const attached = await page
      .getByTestId(testId)
      .count()
      .then((count) => count > 0)
    if (attached) return true
    await page.waitForTimeout(150)
  }
  return false
}

test.describe("Certification exterior scenes", () => {
  for (const scene of SCENES) {
    test(`${scene.name} opens in presentation preview within scene budget`, async ({ page }) => {
      const errors: string[] = []
      page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()) })
      page.on("pageerror", (e) => errors.push(String(e)))

      await openCertificationPreview(page, scene.id)
      await expect(page.getByText(scene.name)).toBeVisible()

      // Tombol popover TETAP "Opsi tampilan" (Fase 4 tidak me-rename trigger-nya).
      await page.getByRole("button", { name: "Opsi tampilan" }).click()
      await expect(page.getByTestId("render-mode-presentation")).toHaveAttribute("aria-pressed", "true")

      // Scene stats kini baris footer DI DALAM popover Tampilan — klik tanpa
      // menutup popover induk dulu (tombolnya hanya reachable selagi terbuka).
      await page.getByTestId("scene-stats-button").click()
      await expect(page.getByText("Scene stats · dev only").last()).toBeVisible()
      await expect(page.getByText("Draw calls")).toBeVisible()
      await expect(page.getByText("Triangles")).toBeVisible()
      await expect(page.getByText("Budget scene terlampaui")).toHaveCount(0)
      await page.keyboard.press("Escape")
      await page.keyboard.press("Escape")

      expect(await downloadedBytes(page)).toBeGreaterThan(20_000)

      // Aset GLB furnitur (public/models/*.glb) sengaja TIDAK ada di checkout
      // lokal (hanya di storage produksi) — GlbErrorBoundary + Suspense
      // fallback (furniture-model.tsx) sudah menangkapnya dan jatuh ke
      // ProceduralFurniture, bukan crash produk. Pola sama dengan
      // interior-3d-models/interior-drag/sun-study/photo-package/
      // presentation-mode.spec.ts.
      const realErrors = errors.filter(
        (e) => !/favicon|ResizeObserver|mock:\/\/|Could not load \/models\/.+\.glb|Failed to load resource.*404/i.test(e)
      )
      expect(realErrors, realErrors.join("\n")).toEqual([])
    })
  }

  test("Scene A supports semantic frontage selection from the 3D canvas", async ({ page }) => {
    await openCertificationPreview(page, "scene-a-modern-concrete")

    const selected = await clickCanvasUntilAttached(page, "exterior-quick-editor", [
      [0.50, 0.62],
      [0.58, 0.60],
      [0.42, 0.62],
      [0.66, 0.56],
      [0.34, 0.56],
      [0.50, 0.70],
      [0.70, 0.68],
      [0.30, 0.68],
    ])

    expect(selected, "frontage native element can be selected from 3D").toBe(true)
    await expect(page.getByTestId("exterior-quick-editor")).toContainText("Elemen eksterior terpilih")
    await expect(page.getByTestId("exterior-quick-editor")).toContainText(/Native|Custom GLB/)

    await page.getByRole("button", { name: "Tutup editor elemen eksterior" }).click()
    await expect(page.getByTestId("exterior-quick-editor")).toHaveCount(0)
  })
})
