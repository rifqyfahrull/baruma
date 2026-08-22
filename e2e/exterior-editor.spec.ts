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
  // Titik kandidat DINAMIS: strip kosong tepat di atas ruangan teratas,
  // dihitung dari bbox nyata (bukan koordinat tetap yang rapuh terhadap
  // auto-fit/ukuran viewport). Semua titik dijaga di dalam svg dan di kiri
  // panel properti (yang menutup ~sepertiga kanan kanvas di 720p).
  const svgBox = await canvas.boundingBox()
  if (!svgBox) throw new Error("Canvas svg tidak punya bounding box")
  const rooms = await page
    .locator('[data-testid="room-shape"]')
    .evaluateAll((els) => els.map((e) => e.getBoundingClientRect()))
  const roomTop = rooms.length ? Math.min(...rooms.map((r) => r.top)) : svgBox.y + 200
  const roomLeft = rooms.length ? Math.min(...rooms.map((r) => r.left)) : svgBox.x + 200
  const roomRight = rooms.length ? Math.max(...rooms.map((r) => r.right)) : svgBox.x + 600
  const maxX = svgBox.x + svgBox.width * 0.62 // aman dari panel kanan
  const minX = svgBox.x + 70 // kanan dari rail toolbar kiri
  const minY = svgBox.y + 64 // bawah dari floor bar tengah-atas
  const maxY = svgBox.y + svgBox.height - 16
  const midY = rooms.length
    ? (Math.min(...rooms.map((r) => r.top)) + Math.max(...rooms.map((r) => r.bottom))) / 2
    : svgBox.y + svgBox.height / 2
  const roomBottom = rooms.length ? Math.max(...rooms.map((r) => r.bottom)) : svgBox.y + 400
  const rawCandidates: Array<[number, number]> = [
    // margin kiri bangunan (vertikal tengah) — bebas overlay
    [roomLeft - 40, midY],
    [roomLeft - 75, midY],
    // strip atas footprint, menjauhi floor bar tengah
    [roomLeft + 30, roomTop - 24],
    [roomLeft + 90, roomTop - 24],
    // strip bawah footprint
    [roomLeft + 30, roomBottom + 24],
    [(roomLeft + roomRight) / 2, roomBottom + 24],
  ]
  const candidates: Array<[number, number]> = rawCandidates
    .map(([x, y]): [number, number] => [
      Math.min(Math.max(x, minX), maxX),
      Math.min(Math.max(y, minY), maxY),
    ])
    .map(([x, y]): [number, number] => [x - svgBox.x, y - svgBox.y])
  for (const [x, y] of candidates) {
    await canvas.click({ position: { x, y } })
    await page.waitForTimeout(200)
    if ((await locator.count()) > before) return
  }
  throw new Error(
    `Gagal menempatkan elemen eksterior kind="${kind}" — semua titik kanvas kandidat gagal (cek tata letak toolbar/panel).`,
  )
}

/**
 * Fase 3 (unifikasi UI editor): rail 2D sekarang HANYA 11 tombol + 2 label
 * grup — muat di 720p desktop tanpa fallback compact (lihat komentar
 * budget tinggi di editor-toolbar.tsx), jadi workaround viewport
 * 1280×1400 (dulu dipakai supaya "Tambah elemen eksterior"/"Pilih
 * template tampak depan" tetap inline) sudah tidak diperlukan. Compact
 * (tablet/mobile — viewport SEMPIT, bukan pendek) tetap bisa terjadi;
 * helper ini klik tombol "Kontrol lainnya" HANYA bila memang tampak,
 * jadi test yang sama jalan di desktop maupun compact.
 */
async function openToolbarMore(page: Page): Promise<void> {
  const more = page.getByTestId("editor-toolbar-more")
  if (await more.isVisible().catch(() => false)) {
    await more.click()
  }
}

test.describe("Exterior editor tools", () => {
  test("places an additive portal from the toolbar and supports undo", async ({ page }) => {
    await page.goto(`/app/projects/${DEMO}/editor`)
    const canvas = page.locator("svg.touch-none")
    await expect(canvas).toBeVisible({ timeout: 30_000 })

    await openToolbarMore(page)
    await page.getByRole("button", { name: "Eksterior" }).click()
    await page.getByRole("option", { name: "Portal", exact: true }).click()
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

    await openToolbarMore(page)
    await page.getByRole("button", { name: "Eksterior" }).click()
    await page.getByRole("option", { name: "Gerbang geser", exact: true }).click()
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

    await openToolbarMore(page)
    await page.getByRole("button", { name: "Eksterior" }).click()
    await page.getByRole("option", { name: "Gerbang geser", exact: true }).click()
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

    await openToolbarMore(page)
    await page.getByRole("button", { name: "Eksterior" }).click()
    await page.getByRole("option", { name: "Tangga luar", exact: true }).click()
    await placeExteriorElement(page, canvas, "exterior_stair")
    await expect(page.locator('[data-testid="exterior-element"][data-kind="exterior_stair"]').first()).toBeVisible()
  })

  test("applies a native facade template from the guided toolbar and supports undo", async ({ page }) => {
    await page.goto(`/app/projects/${DEMO}/editor`)
    await expect(page.locator("svg.touch-none")).toBeVisible({ timeout: 30_000 })

    // Fase 3: window.confirm() diganti useConfirm() (AlertDialog terkontrol)
    // — bukan lagi dialog native, jadi tak perlu page.once("dialog", ...).
    await openToolbarMore(page)
    await page.getByRole("button", { name: "Eksterior" }).click()
    await page.getByRole("option", { name: /Modern Concrete Vertical/ }).click()
    await page.getByRole("button", { name: "Lanjutkan" }).click()

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

    await openToolbarMore(page)
    await page.getByRole("button", { name: "Eksterior" }).click()
    await page.getByRole("option", { name: "Driveway", exact: true }).click()
    await placeExteriorElement(page, canvas, "driveway")
    await expect(page.locator('[data-testid="exterior-element"][data-kind="driveway"]').first()).toBeVisible()
    await expect(page.locator('[data-testid="exterior-handle"]')).toHaveCount(3)
  })

  test("mobile viewport can place a native exterior element", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/app/projects/${DEMO}/editor`)
    const canvas = page.locator("svg.touch-none")
    await expect(canvas).toBeVisible({ timeout: 30_000 })

    // `useToolbarCompact` menciutkan rail berdasar LEBAR (breakpoint lg
    // 1024px) di layar mobile 390px ini — SELALU aktif apa pun tinggi
    // viewport-nya. `openToolbarMore` membuka "Kontrol lainnya" dulu supaya
    // tombol "Eksterior" (di dalam fragmen sekunder) reachable.
    await openToolbarMore(page)
    await page.getByRole("button", { name: "Eksterior" }).click()
    await page.getByRole("option", { name: "Kanopi", exact: true }).click()
    await expect(page.getByText("Kanopi").first()).toBeVisible()

    await canvas.click({ position: { x: 170, y: 120 } })

    await expect(page.locator('[data-testid="exterior-element"][data-kind="canopy"]').first()).toBeVisible()
  })
})
