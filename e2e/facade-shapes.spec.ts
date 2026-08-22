import { test, expect, type Locator, type Page } from "@playwright/test"

const DEMO = "proj-demo-8x8"

/**
 * Klik kanvas utk menempatkan elemen eksterior aktif (tool "exterior" +
 * `pendingPlacement.variant` sudah di-set lewat palette "Eksterior"). Rumah
 * demo 8×8 hampir mengisi penuh tapak (denah proc-generated) & toolbar kiri
 * + panel Properti kanan mengambang DI ATAS kanvas (elemen svg sendiri
 * tetap selebar sisa viewport) — titik tunggal tetap (mis. 220,220 dari
 * spec lama) gampang jatuh di atas ruangan atau di bawah toolbar/panel
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
  // Titik kandidat dinamis dari bbox ruangan (paritas exterior-editor.spec.ts):
  // strip kosong di atas footprint, aman dari panel kanan di viewport 720p.
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
 * Fase 3 (unifikasi UI editor): rail 2D HANYA 11 tombol + 2 label grup —
 * muat di 720p desktop tanpa fallback compact, jadi tak perlu lagi
 * workaround viewport 1280×1400. Compact tetap bisa terjadi di viewport
 * SEMPIT; helper ini klik "Kontrol lainnya" HANYA bila memang tampak.
 */
async function openToolbarMore(page: Page): Promise<void> {
  const more = page.getByTestId("editor-toolbar-more")
  if (await more.isVisible().catch(() => false)) {
    await more.click()
  }
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
  test("cerobong muncul & default Lantai dasar ke Rooftop, bukan Tapak", async ({ page }) => {
    await page.goto(`/app/projects/${DEMO}/editor`)
    const canvas = page.locator("svg.touch-none")
    await expect(canvas).toBeVisible({ timeout: 30_000 })

    // Cerobong hanya dirender di floor yang cocok dgn floorId-nya (rooftop) —
    // pindah ke tab Rooftop dulu supaya penempatan langsung terlihat.
    await page.getByRole("button", { name: "Rooftop", exact: true }).click()

    await openToolbarMore(page)
    await page.getByRole("button", { name: "Eksterior" }).click()
    await page.getByRole("option", { name: "Cerobong", exact: true }).click()
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

    await openToolbarMore(page)
    await page.getByRole("button", { name: "Eksterior" }).click()
    await page.getByRole("option", { name: "Kolom aksen", exact: true }).click()
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
    await page.getByRole("option", { name: "Balkon", exact: true }).click()

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
