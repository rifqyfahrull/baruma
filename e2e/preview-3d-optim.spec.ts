import { test, expect, type Page } from "@playwright/test"

const DEMO = "proj-demo-8x8"

/**
 * E2E regresi untuk gelombang optimasi 3D:
 * 1. Screenshot PNG tetap berisi gambar walau preserveDrawingBuffer dimatikan
 *    (canvas frameloop "demand" + capture render-then-read).
 * 2. Visibilitas lantai TIDAK di-reset oleh edit dari 3D (dulu efek initFloors
 *    jalan ulang pada setiap mutasi layout).
 * 3. Ekspor GLB masih menghasilkan file utuh setelah pindah ke geometri atap
 *    sungguhan (bukan bounding box).
 */

async function openPreview(page: Page): Promise<void> {
  await page.goto(`/app/projects/${DEMO}/preview-3d`)
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole("heading", { name: "Preview 3D" })).toBeVisible({ timeout: 30_000 })
  // Beri waktu scene selesai frame pertama.
  await page.waitForTimeout(1500)
}

/** Klik kanvas di beberapa titik kandidat sampai editor target muncul. */
async function clickCanvasUntil(page: Page, testId: string, points: Array<[number, number]>): Promise<boolean> {
  const canvas = page.locator("canvas").first()
  const box = await canvas.boundingBox()
  if (!box) return false
  for (const [fx, fy] of points) {
    await canvas.click({ position: { x: box.width * fx, y: box.height * fy } })
    const visible = await page
      .getByTestId(testId)
      .isVisible()
      .catch(() => false)
    if (visible) return true
    await page.waitForTimeout(250)
  }
  return false
}

test.describe("Optimasi 3D — regresi", () => {
  test("tombol Screenshot mengunduh PNG berisi gambar (bukan kanvas kosong)", async ({ page }) => {
    await openPreview(page)
    const downloadPromise = page.waitForEvent("download", { timeout: 15_000 })
    await page.getByRole("button", { name: "Screenshot", exact: true }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/\.png$/)
    const stream = await download.createReadStream()
    const chunks: Buffer[] = []
    for await (const c of stream) chunks.push(c as Buffer)
    const bytes = Buffer.concat(chunks).length
    // PNG kanvas KOSONG (semua piksel sama) terkompresi jauh di bawah 20 KB;
    // scene rumah nyata menghasilkan ratusan KB.
    expect(bytes).toBeGreaterThan(20_000)
  })

  test("visibilitas lantai bertahan setelah edit dari 3D (regresi initFloors reset)", async ({ page }) => {
    await openPreview(page)
    const bar = page.getByTestId("floor-toggle-bar")
    const lantai2 = bar.getByRole("button", { name: /Lantai 2/ })
    // Demo 8x8 punya 2 lantai — sembunyikan Lantai 2.
    await expect(lantai2).toBeVisible()
    await lantai2.click()
    await expect(lantai2).toHaveAttribute("aria-pressed", "false")

    // Edit dari 3D yang MEMUTASI layout: klik dinding lantai 1 → pilih cladding.
    const opened = await clickCanvasUntil(page, "facade-quick-editor", [
      [0.5, 0.62], [0.42, 0.66], [0.58, 0.6], [0.5, 0.7], [0.35, 0.62],
    ])
    expect(opened, "dinding lantai 1 bisa diklik dari view awal").toBe(true)
    // Pilih swatch cladding pertama pada kartu fasad (mutasi layout undo-able).
    await page
      .getByTestId("facade-quick-editor")
      .locator("button[title]")
      .first()
      .click()
    // Tunggu siklus autosave/mutasi menyelesaikan re-render.
    await page.waitForTimeout(1200)

    // Dulu: initFloors jalan ulang → Lantai 2 muncul lagi. Kini harus tetap
    // tersembunyi.
    await expect(lantai2).toHaveAttribute("aria-pressed", "false")
  })

  test("ekspor GLB menghasilkan file model utuh (geometri atap sungguhan)", async ({ page }) => {
    await page.goto(`/app/projects/${DEMO}/exports`)
    const heading = page.getByRole("heading", { name: "GLB 3D" })
    await expect(heading).toBeVisible({ timeout: 20_000 })
    // Kartu = ancestor terdekat yang memuat tombol Generate/Buat ulang.
    const card = heading.locator(
      "xpath=ancestor::div[.//button][1]/ancestor-or-self::div[@data-slot='card'][1]"
    )
    await card.getByRole("button", { name: /Generate|Buat ulang|Coba lagi/ }).click()
    // Dialog disclaimer draft → lanjut.
    await page.getByRole("button", { name: "Saya mengerti, lanjut" }).click()
    // Generate mock berjalan singkat → tombol Download aktif.
    const downloadBtn = card.getByRole("button", { name: "Download" })
    await expect(downloadBtn).toBeEnabled({ timeout: 30_000 })
    const downloadPromise = page.waitForEvent("download", { timeout: 15_000 })
    await downloadBtn.click()
    const download = await downloadPromise
    const stream = await download.createReadStream()
    const chunks: Buffer[] = []
    for await (const c of stream) chunks.push(c as Buffer)
    const buf = Buffer.concat(chunks)
    // Header GLB: magic "glTF"; model rumah nyata > 20 KB.
    expect(buf.subarray(0, 4).toString("ascii")).toBe("glTF")
    expect(buf.length).toBeGreaterThan(20_000)
  })
})
