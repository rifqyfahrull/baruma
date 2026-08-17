import { test, expect, type Locator, type Page } from "@playwright/test"

const DEMO = "proj-demo-8x8"

/**
 * Klik kanvas utk menempatkan elemen eksterior aktif (tool "exterior" +
 * pendingExteriorKind sudah di-set lewat menu). Rumah demo 8×8 hampir
 * mengisi penuh tapak (denah proc-generated) & toolbar kiri + panel
 * Properti kanan mengambang DI ATAS kanvas (elemen svg sendiri tetap
 * selebar sisa viewport) — titik tunggal tetap (mis. 220,220 dari spec
 * lama) gampang jatuh di atas ruangan atau di bawah toolbar/panel
 * tergantung ukuran viewport. Coba beberapa titik di jalur kosong khas
 * (strip di atas footprint bangunan, antara toolbar kiri & panel kanan)
 * sampai elemen baru benar-benar bertambah.
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

/**
 * E2E regresi utk fitur bentuk/elemen fasad baru (2026-08):
 * 1. Cerobong (chimney) — default "Lantai dasar" ke Rooftop/lantai teratas,
 *    bukan Tapak (dulu terkubur di dalam massa bangunan di 3D — cf0a3b0).
 * 2. Reposisi elemen eksterior — drag di kanvas HARUS jalan walau tool masih
 *    "exterior" (mode tap-berulang), tanpa perlu ganti ke tool "select"
 *    (2a415c3). Field "Posisi X (m)" juga harus menggeser elemen.
 * 3. Balkon melengkung — Tipe "Balkon" + NumField "Lengkung tepi (m)".
 * 4. Bukaan trapesium — NumField "Miring tepi atas (m)" pada jendela di
 *    dinding luar (default kind sliding_window, otomatis termasuk
 *    TOP_SLOPE_KINDS).
 * 5. Toggle "Kaca realistis (lebih berat)" di popover "Opsi tampilan" 3D —
 *    default OFF, bisa diaktifkan.
 */

test.describe("Facade shapes & elements — regresi", () => {
  // Toolbar editor mengukur tinggi asli via ResizeObserver (useToolbarOverflow)
  // dan menciutkan tombol sekunder (termasuk "Tambah elemen eksterior") ke
  // menu "Kontrol lainnya" saat viewport pendek. Viewport tinggi di sini
  // menjaga tombol langsung terlihat — sama seperti idiom spec lain
  // (exterior-editor.spec.ts) yang mengasumsikan tombol top-level.
  test.use({ viewport: { width: 1280, height: 1400 } })

  test("cerobong muncul & default Lantai dasar ke Rooftop, bukan Tapak", async ({ page }) => {
    await page.goto(`/app/projects/${DEMO}/editor`)
    const canvas = page.locator("svg.touch-none")
    await expect(canvas).toBeVisible({ timeout: 30_000 })

    // Cerobong hanya dirender di floor yang cocok dgn floorId-nya (rooftop) —
    // pindah ke tab Rooftop dulu supaya penempatan langsung terlihat.
    await page.getByRole("button", { name: "Rooftop", exact: true }).click()

    await page.getByRole("button", { name: "Tambah elemen eksterior" }).click()
    await page.getByRole("menuitem", { name: "Cerobong" }).click()
    await placeExteriorElement(page, canvas, "chimney")

    const chimney = page.locator('[data-testid="exterior-element"][data-kind="chimney"]').first()
    await expect(chimney).toBeVisible()

    // Regresi: field "Lantai dasar" pada panel Properti HARUS menunjukkan
    // lantai dak/teratas (Rooftop), BUKAN "Tapak" (yang bikin cerobong
    // terkubur di dalam massa bangunan di 3D).
    const floorField = page.getByLabel("Lantai dasar elemen")
    await expect(floorField).toBeVisible()
    await expect(floorField).toContainText("Rooftop")
    await expect(floorField).not.toContainText("Tapak")
  })

  test("reposisi elemen eksterior — drag tanpa ganti tool, lalu via field Posisi X", async ({ page }) => {
    await page.goto(`/app/projects/${DEMO}/editor`)
    const canvas = page.locator("svg.touch-none")
    await expect(canvas).toBeVisible({ timeout: 30_000 })

    await page.getByRole("button", { name: "Tambah elemen eksterior" }).click()
    await page.getByRole("menuitem", { name: "Kolom aksen" }).click()
    await placeExteriorElement(page, canvas, "column")

    const column = page.locator('[data-testid="exterior-element"][data-kind="column"]').first()
    await expect(column).toBeVisible()

    // Regresi utama: tool MASIH "exterior" (mode tap-berulang, sama seperti
    // electrical/water) — dulu drag di sini no-op karena guard hanya
    // mengizinkan tool "select" (lihat plan-canvas.tsx onExteriorDown).
    const before = await column.boundingBox()
    expect(before).toBeTruthy()
    const startX = before!.x + before!.width / 2
    const startY = before!.y + before!.height / 2
    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(startX + 70, startY + 45, { steps: 8 })
    await page.mouse.up()

    const afterDrag = await column.boundingBox()
    expect(afterDrag).toBeTruthy()
    expect(Math.abs(afterDrag!.x - before!.x)).toBeGreaterThan(20)
    expect(Math.abs(afterDrag!.y - before!.y)).toBeGreaterThan(20)

    // Field "Posisi X (m)" juga harus menggeser elemen secara nyata.
    const posX = page.getByLabel("Posisi X (m)")
    await expect(posX).toBeVisible()
    const beforeVal = parseFloat(await posX.inputValue())
    const nextVal = Math.round((beforeVal + 2) * 10) / 10
    await posX.click()
    await posX.fill("")
    await posX.type(String(nextVal))
    await posX.press("Tab")

    await expect(posX).toHaveValue(String(nextVal))
    const afterField = await column.boundingBox()
    expect(afterField).toBeTruthy()
    expect(Math.abs(afterField!.x - afterDrag!.x)).toBeGreaterThan(5)
  })

  test("balkon melengkung — Tipe Balkon + Lengkung tepi (m) tersimpan", async ({ page }) => {
    await page.goto(`/app/projects/${DEMO}/editor`)
    const canvas = page.locator("svg.touch-none")
    await expect(canvas).toBeVisible({ timeout: 30_000 })

    const room = page.locator('[data-testid="room-shape"]').first()
    await expect(room).toBeVisible()
    await room.click()

    const roomPanel = page.getByTestId("room-inspector")
    await expect(roomPanel).toBeVisible()

    // "Tipe" adalah combobox PERTAMA di kartu ruang (sebelum "Lantai").
    await roomPanel.getByRole("combobox").first().click()
    await page.getByRole("option", { name: "Balkon" }).click()

    // RailingRoomContextCard (jalur implisit 2D — editor-inspector.tsx)
    // muncul begitu tipe ruang jadi "balkon".
    const bow = page.getByLabel("Lengkung tepi (m)")
    await expect(bow).toBeVisible()
    await bow.click()
    await bow.fill("")
    await bow.type("0.8")
    await bow.press("Tab")

    await expect(bow).toHaveValue("0.8")
  })

  test("bukaan trapesium — Miring tepi atas (m) tersimpan pada jendela dinding luar", async ({ page }) => {
    await page.goto(`/app/projects/${DEMO}/editor`)
    const canvas = page.locator("svg.touch-none")
    await expect(canvas).toBeVisible({ timeout: 30_000 })

    // Jendela auto-generate HANYA dipasang di dinding luar (lihat
    // src/lib/mock/layout.ts — cek `sharedWallSpan` sebelum menempatkan).
    const win = page.locator('[data-testid="opening-shape"][data-opening-type="window"]').first()
    await expect(win).toHaveCount(1)
    // `force: true`: jendela horizontal punya SVG bounding-rect tinggi 0
    // (garis lurus, geometri murni — stroke tak dihitung getBoundingClientRect),
    // jadi actionability check "visible" bawaan Playwright salah negatif
    // walau garis itu benar-benar dirender & bisa diklik pengguna sungguhan.
    await win.click({ force: true })

    const openingEditor = page.getByTestId("opening-quick-editor")
    await expect(openingEditor).toBeVisible()

    // 0.5 m: aman dari klem produk (heightM default jendela 1.2 m → drop
    // maksimum heightM-0.3 = 0.9 m, lihat editor-store.ts commitOpening).
    const slope = page.getByLabel("Miring tepi atas (m)")
    await expect(slope).toBeVisible()
    await slope.click()
    await slope.fill("")
    await slope.type("0.5")
    await slope.press("Tab")

    await expect(slope).toHaveValue("0.5")
  })

  test("toggle Kaca realistis default OFF, bisa diaktifkan", async ({ page }) => {
    await page.goto(`/app/projects/${DEMO}/preview-3d`)
    await expect(page.getByRole("heading", { name: "Preview 3D" })).toBeVisible({ timeout: 30_000 })
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 30_000 })

    await page.getByRole("button", { name: "Opsi tampilan" }).click()
    const toggle = page.getByRole("switch", { name: "Kaca realistis (lebih berat)" })
    await expect(toggle).toBeVisible()
    await expect(toggle).toHaveAttribute("aria-checked", "false")

    await toggle.click()
    await expect(toggle).toHaveAttribute("aria-checked", "true")
  })
})
