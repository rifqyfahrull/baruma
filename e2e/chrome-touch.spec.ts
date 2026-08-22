import { test, expect, devices, type Page } from "@playwright/test"

const DEMO = "proj-demo-8x8"

/**
 * Fase 7 (unifikasi UI editor) — guard regresi untuk dua kontrak chrome yang
 * sekarang di-encode di primitives (`FloatingBar`/`ToolButton`/`Pill`,
 * lihat src/components/chrome/floating-bar.tsx):
 *   1. Target sentuh pointer-coarse (tablet) ≥ 40×40px — `TOUCH_ICON_CLASS`/
 *      `TOUCH_PILL_CLASS` mengaktifkan ini via varian Tailwind
 *      `pointer-coarse:`.
 *   2. Rail 2D & 3D harus MUAT di desktop 720p fine-pointer TANPA fallback
 *      compact (budget tinggi didokumentasikan di editor-toolbar.tsx) — jadi
 *      "Kontrol lainnya" (`editor-toolbar-more`/`view-toolbar-more`) tidak
 *      boleh dirender sama sekali di ukuran ini, dan dokumen tidak boleh
 *      scroll horizontal.
 *
 * Emulasi pointer-coarse: Playwright TIDAK mendukung media feature
 * `pointer`/`hover` lewat `page.emulateMedia()` (hanya color-scheme/
 * reduced-motion/forced-colors) — satu-satunya jalur adalah lewat device
 * descriptor bawaan (`isMobile`+`hasTouch` via CDP device-metrics override),
 * makanya dipakai `devices["iPad (gen 7)"]` (bukan `hasTouch` manual).
 * Kalau lingkungan CI/browser tertentu tetap tak mewujudkan
 * `matchMedia("(pointer: coarse)")`, test grup (a) di-skip dgn pesan jelas
 * alih-alih false-fail.
 */

async function isPointerCoarse(page: Page): Promise<boolean> {
  return page.evaluate(() => window.matchMedia("(pointer: coarse)").matches)
}

/**
 * Semua `FloatingBar` di halaman (rail 2D, zoom cluster, floor-switcher,
 * view-toolbar, floor-toggle-bar — ditandai seragam `data-slot="floating-bar"`
 * oleh primitive-nya) diperiksa: tiap tombol ANAK LANGSUNG yang tampak harus
 * ≥ 40×40px. Popover/DropdownMenu yang dibuka DARI rail (mis. isi "Kontrol
 * lainnya") sengaja di luar cakupan — itu bukan lagi bagian dari bar itu
 * sendiri secara DOM (konten Radix Popover terpisah/portal saat terbuka).
 */
async function assertFloatingBarButtonsMeetTouchTarget(page: Page): Promise<void> {
  const bars = page.locator('[data-slot="floating-bar"]')
  const barCount = await bars.count()
  expect(barCount, "setidaknya satu FloatingBar tampil di halaman").toBeGreaterThan(0)

  for (let i = 0; i < barCount; i++) {
    const bar = bars.nth(i)
    if (!(await bar.isVisible().catch(() => false))) continue

    const buttons = bar.locator("button")
    const btnCount = await buttons.count()
    for (let j = 0; j < btnCount; j++) {
      const btn = buttons.nth(j)
      if (!(await btn.isVisible().catch(() => false))) continue

      const box = await btn.boundingBox()
      const name =
        (await btn.getAttribute("aria-label")) ??
        (await btn.textContent())?.trim() ??
        `tombol #${j}`
      expect(box, `"${name}" (floating-bar #${i}) tak punya bounding box`).toBeTruthy()
      if (!box) continue
      expect(box.width, `lebar "${name}" (floating-bar #${i}) >= 40px`).toBeGreaterThanOrEqual(40)
      expect(box.height, `tinggi "${name}" (floating-bar #${i}) >= 40px`).toBeGreaterThanOrEqual(40)
    }
  }
}

test.describe("Chrome — target sentuh pointer-coarse (tablet)", () => {
  // defaultBrowserType tidak boleh di-use() dalam describe (memaksa worker
  // baru) — buang dari spread device.
  const { defaultBrowserType: _bt, ...ipad } = devices["iPad (gen 7)"]
  void _bt
  test.use({ ...ipad, viewport: { width: 1080, height: 810 } })

  test("editor 2D: semua tombol FloatingBar >= 40x40", async ({ page }) => {
    await page.goto(`/app/projects/${DEMO}/editor`)
    await expect(page.locator("svg.touch-none")).toBeVisible({ timeout: 30_000 })

    test.skip(
      !(await isPointerCoarse(page)),
      "Lingkungan ini tidak mewujudkan matchMedia('(pointer: coarse)') — lewati guard ukuran sentuh.",
    )

    await assertFloatingBarButtonsMeetTouchTarget(page)
  })

  test("preview 3D: semua tombol FloatingBar >= 40x40", async ({ page }) => {
    await page.goto(`/app/projects/${DEMO}/preview-3d`)
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId("view-toolbar")).toBeVisible({ timeout: 30_000 })

    test.skip(
      !(await isPointerCoarse(page)),
      "Lingkungan ini tidak mewujudkan matchMedia('(pointer: coarse)') — lewati guard ukuran sentuh.",
    )

    await assertFloatingBarButtonsMeetTouchTarget(page)
  })
})

test.describe("Chrome — muat di 720p desktop (fine pointer)", () => {
  test.use({ viewport: { width: 1280, height: 720 } })

  test("editor 2D: rail muat penuh, tanpa fallback 'Kontrol lainnya', tanpa scroll horizontal", async ({
    page,
  }) => {
    await page.goto(`/app/projects/${DEMO}/editor`)
    await expect(page.locator("svg.touch-none")).toBeVisible({ timeout: 30_000 })

    // Desktop 720p HARUS muat inline — fallback compact hanya utk tablet/
    // mobile (viewport sempit ATAU tinggi konten nyata > viewport), lihat
    // komentar budget tinggi rail di editor-toolbar.tsx.
    await expect(page.getByTestId("editor-toolbar-more")).toHaveCount(0)

    // Rail vertikal (2D) — satu-satunya FloatingBar orientasi vertikal di
    // halaman ini (zoom cluster & floor-switcher horizontal) — tepi
    // bawahnya harus di dalam viewport, bukan meluber diam-diam.
    const rail = page
      .locator('[data-slot="floating-bar"][data-orientation="vertical"]')
      .first()
    const railBox = await rail.boundingBox()
    expect(railBox, "rail 2D punya bounding box").toBeTruthy()
    if (railBox) {
      expect(
        railBox.y + railBox.height,
        "tepi bawah rail 2D di dalam viewport 720p",
      ).toBeLessThanOrEqual(720)
    }

    const hasHorizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(hasHorizontalScroll, "dokumen tidak scroll horizontal").toBe(false)
  })

  test("preview 3D: view-toolbar muat penuh, tanpa fallback 'Kontrol lainnya', tanpa scroll horizontal", async ({
    page,
  }) => {
    await page.goto(`/app/projects/${DEMO}/preview-3d`)
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 30_000 })
    const viewToolbar = page.getByTestId("view-toolbar")
    await expect(viewToolbar).toBeVisible({ timeout: 30_000 })

    await expect(page.getByTestId("view-toolbar-more")).toHaveCount(0)

    const box = await viewToolbar.boundingBox()
    expect(box, "view-toolbar punya bounding box").toBeTruthy()
    if (box) {
      expect(
        box.y + box.height,
        "tepi bawah view-toolbar di dalam viewport 720p",
      ).toBeLessThanOrEqual(720)
    }

    const hasHorizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(hasHorizontalScroll, "dokumen tidak scroll horizontal").toBe(false)
  })
})
