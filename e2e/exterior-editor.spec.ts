import { test, expect, type Locator, type Page } from "@playwright/test"

const DEMO = "proj-demo-8x8"

/**
 * Klik kanvas utk menempatkan elemen eksterior aktif pada spot kosong.
 * Sama seperti e2e/facade-shapes.spec.ts: rumah demo 8×8 hampir mengisi
 * penuh tapak (denah proc-generated), jadi titik tunggal tetap (mis.
 * 220,220 dari spec lama) gampang jatuh di atas ruangan. Efek auto-fit
 * (plan-canvas.tsx menghitung ulang zoom/pan dari ukuran SVG saat mount)
 * juga membuat pemetaan pixel→world berbeda antar ukuran viewport, jadi
 * titik tunggal tidak portable. Coba beberapa titik di strip kosong khas
 * (di atas footprint bangunan) sampai elemen baru benar-benar bertambah.
 */
async function placeExteriorElement(
  page: Page,
  canvas: Locator,
  kind: string,
): Promise<void> {
  const locator = page.locator(`[data-testid="exterior-element"][data-kind="${kind}"]`)
  const before = await locator.count()
  const candidates: Array<[number, number]> = [
    [500, 90],
    [650, 90],
    [420, 90],
    [500, 130],
    [650, 130],
    [780, 90],
  ]
  for (const [x, y] of candidates) {
    await canvas.click({ position: { x, y } })
    await page.waitForTimeout(200)
    if ((await locator.count()) > before) return
  }
  throw new Error(
    `Gagal menempatkan elemen eksterior kind="${kind}" — semua titik kanvas kandidat gagal (cek tata letak toolbar/panel).`,
  )
}

test.describe("Exterior editor tools", () => {
  // Toolbar editor mengukur tinggi asli via ResizeObserver (useToolbarOverflow)
  // dan menciutkan tombol sekunder (termasuk "Tambah elemen eksterior" &
  // "Pilih template tampak depan") ke menu "Kontrol lainnya" saat viewport
  // pendek (default Playwright 1280×720 sudah cukup pendek utk memicunya).
  // Viewport tinggi di sini menjaga tombol tetap tampil inline — sama
  // seperti idiom e2e/facade-shapes.spec.ts (spec ini menguji desktop biasa,
  // bukan perilaku compact — kasus compact dites terpisah di test viewport
  // mobile di bawah).
  test.use({ viewport: { width: 1280, height: 1400 } })

  test("places an additive portal from the toolbar and supports undo", async ({ page }) => {
    await page.goto(`/app/projects/${DEMO}/editor`)
    const canvas = page.locator("svg.touch-none")
    await expect(canvas).toBeVisible({ timeout: 30_000 })

    await page.getByRole("button", { name: "Tambah elemen eksterior" }).click()
    await page.getByRole("menuitem", { name: "Portal" }).click()
    await expect(page.getByText("Portal").first()).toBeVisible()

    await placeExteriorElement(page, canvas, "portal_frame")

    const portal = page.locator('[data-testid="exterior-element"][data-kind="portal_frame"]').first()
    await expect(portal).toBeVisible()

    await page.getByRole("button", { name: "Undo" }).click()
    await expect(portal).toHaveCount(0)
  })

  test("Escape cancels pending exterior placement before it mutates the layout", async ({ page }) => {
    await page.goto(`/app/projects/${DEMO}/editor`)
    const canvas = page.locator("svg.touch-none")
    await expect(canvas).toBeVisible({ timeout: 30_000 })

    await page.getByRole("button", { name: "Tambah elemen eksterior" }).click()
    await page.getByRole("menuitem", { name: "Gerbang geser" }).click()
    await expect(page.getByText("Gerbang geser").first()).toBeVisible()

    await page.keyboard.press("Escape")
    await expect(page.getByText("Gerbang geser").first()).toHaveCount(0)

    await canvas.click({ position: { x: 220, y: 220 } })
    await expect(page.locator('[data-testid="exterior-element"][data-kind="sliding_gate"]')).toHaveCount(0)
  })

  test("shows validation feedback for an invalid exterior placement", async ({ page }) => {
    await page.goto(`/app/projects/${DEMO}/editor`)
    const canvas = page.locator("svg.touch-none")
    await expect(canvas).toBeVisible({ timeout: 30_000 })

    await page.getByRole("button", { name: "Tambah elemen eksterior" }).click()
    await page.getByRole("menuitem", { name: "Gerbang geser" }).click()
    // Segmen gerbang geser meng-clamp X ke lebar tapak (plan-canvas.tsx),
    // jadi hanya Y yang bisa jatuh di luar batas. plan-canvas.tsx selalu
    // memberi gutter vertikal >= 32px di sekitar tapak saat auto-fit
    // (padding fit 64px dibagi dua) — klik dekat tepi atas kanvas (py kecil)
    // karenanya SELALU jatuh di atas tapak (Y negatif), lepas dari ukuran
    // viewport atau denah proc-generated demo house.
    await canvas.click({ position: { x: 400, y: 10 } })

    await expect(page.getByTestId("exterior-validation-feedback")).toContainText("batas tapak")
  })

  test("places an exterior stair tool", async ({ page }) => {
    await page.goto(`/app/projects/${DEMO}/editor`)
    const canvas = page.locator("svg.touch-none")
    await expect(canvas).toBeVisible({ timeout: 30_000 })

    await page.getByRole("button", { name: "Tambah elemen eksterior" }).click()
    await page.getByRole("menuitem", { name: "Tangga luar" }).click()
    await placeExteriorElement(page, canvas, "exterior_stair")
    await expect(page.locator('[data-testid="exterior-element"][data-kind="exterior_stair"]').first()).toBeVisible()
  })

  test("applies a native facade template from the guided toolbar and supports undo", async ({ page }) => {
    await page.goto(`/app/projects/${DEMO}/editor`)
    await expect(page.locator("svg.touch-none")).toBeVisible({ timeout: 30_000 })

    page.once("dialog", (dialog) => dialog.accept())
    await page.getByRole("button", { name: "Pilih template tampak depan" }).click()
    await page.getByRole("menuitem", { name: /Modern Concrete Vertical/ }).click()

    await expect(page.locator('[data-testid="exterior-element"][data-kind="portal_frame"]').first()).toBeVisible()
    await expect(page.locator('[data-testid="exterior-element"][data-kind="facade_panel"]').first()).toBeVisible()

    await page.getByRole("button", { name: "Undo" }).click()
    await expect(page.locator('[data-testid="exterior-element"][data-kind="portal_frame"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="exterior-element"][data-kind="facade_panel"]')).toHaveCount(0)
  })

  test("places a polygon surface tool with vertex handles", async ({ page }) => {
    await page.goto(`/app/projects/${DEMO}/editor`)
    const canvas = page.locator("svg.touch-none")
    await expect(canvas).toBeVisible({ timeout: 30_000 })

    await page.getByRole("button", { name: "Tambah elemen eksterior" }).click()
    await page.getByRole("menuitem", { name: "Driveway" }).click()
    await placeExteriorElement(page, canvas, "driveway")
    await expect(page.locator('[data-testid="exterior-element"][data-kind="driveway"]').first()).toBeVisible()
    await expect(page.locator('[data-testid="exterior-handle"]')).toHaveCount(3)
  })

  test("mobile viewport can place a native exterior element", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/app/projects/${DEMO}/editor`)
    const canvas = page.locator("svg.touch-none")
    await expect(canvas).toBeVisible({ timeout: 30_000 })

    // Berbeda dari test desktop di atas: `useNarrowViewport` menciutkan
    // toolbar berdasar LEBAR (breakpoint lg 1024px), bukan tinggi — di layar
    // mobile 390px ini SELALU aktif, apa pun tinggi viewport-nya. Jadi
    // "Tambah elemen eksterior" tak pernah muncul sbg tombol langsung di
    // mobile; jalur pengguna nyata di sini adalah lewat menu "Kontrol
    // lainnya" → submenu "Tambah elemen eksterior".
    await page.getByRole("button", { name: "Kontrol lainnya" }).click()
    await page.getByRole("menuitem", { name: "Tambah elemen eksterior" }).click()
    await page.getByRole("menuitem", { name: "Kanopi" }).click()
    await expect(page.getByText("Kanopi").first()).toBeVisible()

    await canvas.click({ position: { x: 170, y: 120 } })

    await expect(page.locator('[data-testid="exterior-element"][data-kind="canopy"]').first()).toBeVisible()
  })
})
