import { test, expect, type Locator, type Page } from "@playwright/test"

const DEMO = "proj-demo-8x8"

/**
 * Range inputs are React-controlled, so a plain `.value = x` assignment gets
 * swallowed by React's tracked-value shim. Go through the native setter (the
 * same trick React Testing Library uses) and fire input+change so the
 * component's onChange actually runs.
 */
async function setRangeValue(locator: Locator, value: number) {
  await locator.evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    )!.set!
    setter.call(el, String(v))
    el.dispatchEvent(new Event("input", { bubbles: true }))
    el.dispatchEvent(new Event("change", { bubbles: true }))
  }, value)
}

/** Concatenated coordinates of every rendered `<line>` inside the sheet SVG —
 *  a cheap fingerprint of the drawing's actual geometry. */
async function sheetLineFingerprint(page: Page): Promise<string> {
  return page.locator('[data-testid="sheet-svg"] line').evaluateAll((lines) =>
    lines
      .map((l) => `${l.getAttribute("x1")},${l.getAttribute("y1")},${l.getAttribute("x2")},${l.getAttribute("y2")}`)
      .join("|")
  )
}

test.describe("Gambar Kerja", () => {
  test("Gambar Kerja: 6 sheet tampil dan bisa dinavigasi", async ({ page }) => {
    // Reach the project workspace (pola critical-flows), then use the real
    // nav link so this test also covers nav wiring, not just the route.
    await page.goto(`/app/projects/${DEMO}/editor`)
    await expect(page.locator("svg.touch-none")).toBeVisible()
    // Gambar Kerja kini sub-halaman Hasil (caret), bukan tab langsung — Fase 5
    // (ProjectTabs diganti ProjectBar).
    await page
      .getByRole("navigation", { name: "Tahap project" })
      .getByTestId("stage-hasil-caret")
      .click()
    await page.getByRole("menuitem", { name: "Gambar Kerja" }).click()
    await page.waitForURL(`**/app/projects/${DEMO}/drawings`)

    // Sheet list is dynamic (tampak/potongan + per-floor kusen plans + daftar
    // + detail sheets), so assert at-least-6 rather than a hardcoded count.
    const tabs = page.locator('[data-testid^="sheet-tab-"]')
    await expect(tabs.first()).toBeVisible()
    expect(await tabs.count()).toBeGreaterThanOrEqual(6)
    for (const id of ["n", "s", "e", "w", "secA", "secB"]) {
      await expect(page.getByTestId(`sheet-tab-${id}`)).toBeVisible()
    }

    // Default sheet renders a real elevation: title block text + enough
    // geometry to be an actual drawing, not an empty placeholder.
    const sheetSvg = page.getByTestId("sheet-svg")
    await expect(sheetSvg).toBeVisible({ timeout: 30_000 })
    await expect(sheetSvg.getByText(/Tampak/)).toBeVisible()
    await expect(sheetSvg.getByText(/Skala 1:/)).toBeVisible()
    const lineCount = await page.locator('[data-testid="sheet-svg"] line').count()
    expect(lineCount).toBeGreaterThan(10)

    // Default active sheet is Tampak Selatan.
    await expect(sheetSvg.getByText("Tampak Selatan")).toBeVisible()

    const zoomFrame = page.getByTestId("drawings-sheet-zoom-frame")
    const zoomValue = page.getByTestId("drawings-zoom-value")
    await expect(zoomValue).toHaveText("100%")
    const widthBeforeZoom = (await zoomFrame.boundingBox())?.width ?? 0
    await page.getByRole("button", { name: "Perbesar gambar kerja" }).click()
    await expect(zoomValue).toHaveText("125%")
    await expect
      .poll(async () => (await zoomFrame.boundingBox())?.width ?? 0)
      .toBeGreaterThan(widthBeforeZoom)
    await page.getByRole("button", { name: "Reset zoom gambar kerja" }).click()
    await expect(zoomValue).toHaveText("100%")

    // Switching tampak changes the rendered title.
    await page.getByTestId("sheet-tab-n").click()
    await expect(sheetSvg.getByText("Tampak Utara")).toBeVisible()
    await expect(sheetSvg.getByText("Tampak Selatan")).toHaveCount(0)
  })

  test("Denah (D-01) menampilkan denah arsitektur per lantai", async ({ page }) => {
    await page.goto(`/app/projects/${DEMO}/drawings`)

    // Sheet Denah baru (2026-07-11) — tab id `sheet-tab-denah-<floorId>`
    // floor-dependent, jadi cari via nama tombolnya.
    await page.getByRole("button", { name: /^Denah — / }).first().click()

    const sheetSvg = page.getByTestId("sheet-svg")
    await expect(sheetSvg).toBeVisible({ timeout: 30_000 })
    await expect(sheetSvg.getByText(/Denah — /)).toBeVisible()

    // Gambar nyata: outline ruang + dim chains (bukan placeholder kosong).
    const lineCount = await page.locator('[data-testid="sheet-svg"] line').count()
    expect(lineCount).toBeGreaterThan(10)
  })

  test("Potongan: slider menggeser garis potong dan mengubah gambar", async ({ page }) => {
    await page.goto(`/app/projects/${DEMO}/drawings`)
    await page.getByTestId("sheet-tab-secA").click()

    const sheetSvg = page.getByTestId("sheet-svg")
    await expect(sheetSvg).toBeVisible({ timeout: 30_000 })
    const miniPlan = page.getByTestId("mini-plan")
    await expect(miniPlan).toBeVisible()
    const cutLine = page.getByTestId("mini-plan-cut-line")

    const slider = page.getByTestId("cut-slider")
    const max = Number(await slider.getAttribute("max"))
    expect(max).toBeGreaterThan(0)

    const initialValue = Number(await slider.inputValue())
    const initialCutX1 = await cutLine.getAttribute("x1")
    const initialFingerprint = await sheetLineFingerprint(page)

    // Move well away from the initial (default = mid-building) position.
    const target = Math.round(max * 0.85 * 10) / 10
    expect(target).not.toBe(initialValue)
    await setRangeValue(slider, target)

    await expect.poll(() => cutLine.getAttribute("x1")).not.toBe(initialCutX1)
    const newCutX1 = await cutLine.getAttribute("x1")
    expect(Number(newCutX1)).toBeCloseTo(target, 1)

    // The section drawing itself (which rooms/openings get cut) also changed.
    const newFingerprint = await sheetLineFingerprint(page)
    expect(newFingerprint).not.toBe(initialFingerprint)
  })

  test("Export drawings_pack menghasilkan unduhan PDF", async ({ page }) => {
    await page.goto(`/app/projects/${DEMO}/exports`)
    const card = page.locator('[data-slot="card"]').filter({ hasText: "Gambar Kerja (PDF)" })
    await expect(card).toBeVisible()

    const dlPromise = page.waitForEvent("download")
    await card.getByRole("button", { name: "Generate" }).click()
    await expect(page.getByText("Sebelum membuat file")).toBeVisible()
    await page.getByRole("button", { name: /Saya mengerti/ }).click()

    const dl = await dlPromise
    expect(dl.suggestedFilename()).toMatch(/\.pdf$/)
  })

  test("Daftar Kusen menampilkan kode tipe", async ({ page }) => {
    // Reach the project workspace via the real nav link, same pattern as the
    // first test above.
    await page.goto(`/app/projects/${DEMO}/editor`)
    await expect(page.locator("svg.touch-none")).toBeVisible()
    // Gambar Kerja kini sub-halaman Hasil (caret), bukan tab langsung — Fase 5
    // (ProjectTabs diganti ProjectBar).
    await page
      .getByRole("navigation", { name: "Tahap project" })
      .getByTestId("stage-hasil-caret")
      .click()
    await page.getByRole("menuitem", { name: "Gambar Kerja" }).click()
    await page.waitForURL(`**/app/projects/${DEMO}/drawings`)

    // Sheet list is dynamic: 4 tampak + 2 potongan + 1 Rencana Kusen per
    // regular floor + Daftar Kusen + Detail Kusen sheet(s) — well over 8 for
    // the demo project (3 regular floors -> 11 tabs total).
    const tabs = page.locator('[data-testid^="sheet-tab-"]')
    await expect(tabs.first()).toBeVisible()
    expect(await tabs.count()).toBeGreaterThan(8)

    await page.getByTestId("sheet-tab-kusen-daftar").click()
    const sheetSvg = page.getByTestId("sheet-svg")
    await expect(sheetSvg).toBeVisible({ timeout: 30_000 })
    await expect(sheetSvg.getByText(/Daftar Kusen/)).toBeVisible()

    // The demo layout's mock generator (`generateLayout`) only auto-adds
    // window openings for rooms needing light/ventilation — it never adds
    // doors — so only the J-code family actually exists for this project
    // (verified directly: kusenSchedule on the seeded demo layout yields
    // J1 x6 + J2 x2, zero P codes). Assert the codes that are actually
    // present rather than assuming both P1 and J1 exist.
    await expect(sheetSvg.getByText("J1", { exact: true })).toBeVisible()
    await expect(sheetSvg.getByText("J2", { exact: true })).toBeVisible()
  })

  test("Rencana Kusen menampilkan label kode di denah", async ({ page }) => {
    await page.goto(`/app/projects/${DEMO}/drawings`)

    // Tab ids are floor-dependent (`sheet-tab-kusen-<floorId>`), so locate
    // the first Rencana Kusen sheet by its accessible name instead.
    await page.getByRole("button", { name: /Rencana Kusen/ }).first().click()

    const sheetSvg = page.getByTestId("sheet-svg")
    await expect(sheetSvg).toBeVisible({ timeout: 30_000 })
    const lineCount = await page.locator('[data-testid="sheet-svg"] line').count()
    expect(lineCount).toBeGreaterThan(4)

    // At least one opening is labeled with its kusen code (P<n> for doors,
    // J<n> for windows — see src/lib/drawings/kusen.ts).
    await expect(sheetSvg.getByText(/^(P|J)\d+$/).first()).toBeVisible()
  })

  test("Pola Lantai dan Rencana Plafon menampilkan label material", async ({ page }) => {
    await page.goto(`/app/projects/${DEMO}/drawings`)

    // Tab ids are floor-dependent (`sheet-tab-floor-pattern-<floorId>`), so
    // locate the first Pola Lantai sheet by its accessible name, same pattern
    // as the Rencana Kusen test above.
    await page.getByRole("button", { name: /Pola Lantai/ }).first().click()

    const sheetSvg = page.getByTestId("sheet-svg")
    await expect(sheetSvg).toBeVisible({ timeout: 30_000 })

    // Every room gets a material label: either "<name> · <w>×<h> · <n> pcs"
    // for tiled finishes or "<name> · tanpa nat" for seamless ones (see
    // src/lib/drawings/floor-pattern.ts) — both the saved-interior and the
    // generated-fallback demo plans produce at least one of these.
    await expect(sheetSvg.getByText(/pcs|tanpa nat/).first()).toBeVisible()

    // Real drawing, not an empty placeholder: outlines + dims + tile grid.
    const lineCount = await page.locator('[data-testid="sheet-svg"] line').count()
    expect(lineCount).toBeGreaterThan(10)

    // Switch to the first ceiling plan: rooms are labeled with the ceiling
    // height ("+2,6 m" style via formatElevation — see
    // src/lib/drawings/ceiling-plan.ts).
    await page.getByRole("button", { name: /Rencana Plafon/ }).first().click()
    await expect(sheetSvg.getByText(/\+2,\d/).first()).toBeVisible()
  })

  test("Detail Atap menampilkan sheet detail", async ({ page }) => {
    await page.goto(`/app/projects/${DEMO}/drawings`)
    await page.getByTestId("sheet-tab-roof-detail").click()

    const sheetSvg = page.getByTestId("sheet-svg")
    await expect(sheetSvg).toBeVisible({ timeout: 30_000 })
    await expect(sheetSvg.getByText(/Detail Atap/).first()).toBeVisible()
  })

  test("Rencana Listrik menampilkan legenda dan panel schedule", async ({ page }) => {
    await page.goto(`/app/projects/${DEMO}/drawings`)

    // Tab ids are floor-dependent (`sheet-tab-electrical-<floorId>`), so locate
    // the first Rencana Listrik sheet by its accessible name, same pattern as
    // the Rencana Kusen / Pola Lantai tests above.
    await page.getByRole("button", { name: /Rencana Listrik/ }).first().click()

    const sheetSvg = page.getByTestId("sheet-svg")
    await expect(sheetSvg).toBeVisible({ timeout: 30_000 })

    // The legend always lists "Stopkontak" and the panel-schedule table always
    // carries an "MCB" column header — both render whether the demo project has
    // saved interiors or falls back to generated points (see
    // src/lib/drawings/electrical-plan.ts).
    await expect(sheetSvg.getByText(/Stopkontak|MCB/).first()).toBeVisible()

    // Real drawing, not an empty placeholder: room outlines + dims + point
    // symbols + panel-schedule grid.
    const lineCount = await page.locator('[data-testid="sheet-svg"] line').count()
    expect(lineCount).toBeGreaterThan(10)
  })

  test("Rencana Air, Diagram Riser, dan Detail Septic menampilkan sheet air/sanitasi", async ({ page }) => {
    await page.goto(`/app/projects/${DEMO}/drawings`)

    // Tab ids are floor-dependent (`sheet-tab-plumbing-<floorId>`), so locate the
    // first Rencana Air sheet by its accessible name, same pattern as the Rencana
    // Kusen / Pola Lantai / Rencana Listrik tests above.
    await page.getByRole("button", { name: /Rencana Air/ }).first().click()

    const sheetSvg = page.getByTestId("sheet-svg")
    await expect(sheetSvg).toBeVisible({ timeout: 30_000 })

    // The fixture schedule always carries the "Ø" (pipe-diameter) column header;
    // a "Kloset" fixture, when present, is also named — assert either (see
    // src/lib/drawings/plumbing-plan.ts).
    await expect(sheetSvg.getByText(/Ø|Kloset/).first()).toBeVisible()

    // Real drawing, not an empty placeholder: room outlines + dims + pipe routing
    // + fixture-schedule grid.
    const lineCount = await page.locator('[data-testid="sheet-svg"] line').count()
    expect(lineCount).toBeGreaterThan(10)

    // Diagram Riser (fixed id `riser`) — schematic stacks + vent riser.
    await page.getByTestId("sheet-tab-riser").click()
    await expect(sheetSvg.getByText(/Riser|vent/i).first()).toBeVisible()

    // Detail Septic Tank (fixed id `sanitation-septic`) — parametric section with
    // the mandatory SNI note.
    await page.getByTestId("sheet-tab-sanitation-septic").click()
    await expect(sheetSvg.getByText(/Septic|SNI/).first()).toBeVisible()
  })

  test("Rencana Pondasi dan Perhitungan Struktur menampilkan sheet struktur", async ({ page }) => {
    await page.goto(`/app/projects/${DEMO}/drawings`)

    // Rencana Pondasi (fixed id `structural-foundation`, F-01) — the foundation
    // labels always carry σ / kN / footing size (see src/lib/drawings/structural-plan.ts),
    // and the grid axes + one footing square + pier stub per column give plenty
    // of geometry (9 columns on the demo grid → well over 10 lines).
    await page.getByTestId("sheet-tab-structural-foundation").click()
    const sheetSvg = page.getByTestId("sheet-svg")
    await expect(sheetSvg).toBeVisible({ timeout: 30_000 })
    await expect(sheetSvg.getByText(/telapak|σ|kN/i).first()).toBeVisible()
    const lineCount = await page.locator('[data-testid="sheet-svg"] line').count()
    expect(lineCount).toBeGreaterThan(10)

    // Perhitungan Struktur (fixed id `structural-calc`, ST-01) — the stacked-label
    // calc table (Pu step) plus the verbatim PBG disclaimer ("…wajib diverifikasi…
    // (persyaratan PBG)"); see src/lib/drawings/structural-calc.ts.
    await page.getByTestId("sheet-tab-structural-calc").click()
    await expect(sheetSvg.getByText(/PBG|Pu|diverifikasi/).first()).toBeVisible()
  })
})
