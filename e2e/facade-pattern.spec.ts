import { test, expect, type Page, type Locator } from "@playwright/test"

const DEMO = "proj-demo-8x8"

/**
 * `wall-hit-{roomId}-{side}` testid dari plan-canvas.tsx (2D Editor) — hit
 * target transparan per dinding ruang nyata. roomId acak per load (nanoid),
 * jadi kita TIDAK boleh hardcode id; ambil dari DOM lalu bedakan by roomId.
 */
function roomIdOfWallHit(testid: string): string {
  return testid.replace(/^wall-hit-/, "").replace(/-[nsew]$/, "")
}

async function openEditor(page: Page): Promise<void> {
  await page.goto(`/app/projects/${DEMO}/editor`)
  await expect(page.locator("svg.touch-none")).toBeVisible({ timeout: 30_000 })
}

/**
 * Dua dinding BERBEDA (roomId beda) dari daftar hit-target dinding di 2D
 * Editor. Di viewport 720p panel Properti kanan menutup ~sepertiga kanan
 * kanvas; klik force tetap kalah hit-test dgn panel, jadi hanya dinding yang
 * pusatnya di KIRI panel yang dipakai.
 */
async function twoDistinctWalls(page: Page): Promise<{ wallA: Locator; wallB: Locator }> {
  // elementFromPoint nyata di pusat tiap dinding: hanya dinding yang benar-
  // benar menerima klik (tidak tertutup panel/floor bar/cluster zoom/rail)
  // yang dipakai — tahan terhadap perubahan tata letak overlay.
  const testids = await page.evaluate(() => {
    const out: string[] = []
    document.querySelectorAll('[data-testid^="wall-hit-"]').forEach((el) => {
      const r = el.getBoundingClientRect()
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      if (hit && (hit === el || el.contains(hit))) {
        out.push(el.getAttribute("data-testid") ?? "")
      }
    })
    return out
  })
  const idA = testids[0]
  const roomA = roomIdOfWallHit(idA)
  const idB = testids.find((t) => roomIdOfWallHit(t) !== roomA)
  expect(idB, "butuh dua dinding dari ruang berbeda di layout demo").toBeTruthy()
  return {
    wallA: page.locator(`[data-testid="${idA}"]`),
    wallB: page.locator(`[data-testid="${idB}"]`),
  }
}

function facadeQuickEditor(page: Page): Locator {
  return page.locator('[data-testid="facade-quick-editor"]')
}

test.describe("Elemen fasad (kisi/roster) — panel dinding 2D Editor", () => {
  test("preset 'Panel sirip (fluted)' mengisi seluruh bidang dinding", async ({ page }) => {
    await openEditor(page)
    const { wallA } = await twoDistinctWalls(page)
    await wallA.click({ force: true })

    const card = facadeQuickEditor(page)
    await expect(card).toBeVisible()
    await expect(card.getByTestId("facade-louver-section")).toBeVisible()

    await card.getByTestId("facade-add-fluted-panel").click()

    const label = card.locator('[data-testid^="facade-element-label-"]').first()
    await expect(label).toHaveText("Panel sirip (fluted)")

    // `div[data-testid^="facade-element-"]` (bukan `[data-testid^=...]` polos)
    // supaya tak ikut menjaring `<p data-testid="facade-element-label-...">`
    // (prefix string sama).
    const elCard = card.locator('div[data-testid^="facade-element-"]').first()
    const widthText = await elCard.getByLabel("Lebar (m)").inputValue()
    const heightText = await elCard.getByLabel("Tinggi (m)").inputValue()
    expect(Number(widthText)).toBeGreaterThan(0)
    expect(Number(heightText)).toBeGreaterThan(0)
  })

  test("preset 'Nat beton / reveal line' menyalakan toggle inset", async ({ page }) => {
    await openEditor(page)
    const { wallB } = await twoDistinctWalls(page)
    await wallB.click({ force: true })

    const card = facadeQuickEditor(page)
    await expect(card).toBeVisible()

    await card.getByTestId("facade-add-reveal-line").click()

    const label = card.locator('[data-testid^="facade-element-label-"]').first()
    await expect(label).toHaveText("Nat beton / reveal line")

    const elCard = card.locator('div[data-testid^="facade-element-"]').first()
    // Kolektif "Pola kustom" terbuka bawaan (state awal `!!pattern`) karena
    // preset ini SELALU membawa `pattern.inset = true` — lihat
    // addRevealLineFacadePanel di editor-store.ts.
    const toggle = elCard.getByRole("switch", {
      name: "Tenggelam di muka dinding (nat beton/reveal)",
    })
    await expect(toggle).toHaveAttribute("aria-checked", "true")
  })

  test("hapus satu elemen kisi hanya menghilangkan elemen itu, dinding lain tetap", async ({ page }) => {
    await openEditor(page)
    const { wallA, wallB } = await twoDistinctWalls(page)
    const card = facadeQuickEditor(page)

    // Elemen 1 di dinding A.
    await wallA.click({ force: true })
    await expect(card).toBeVisible()
    await card.getByTestId("facade-add-fluted-panel").click()
    // `div[data-testid^=...]` — hindari menjaring `<p data-testid="facade-
    // element-label-...">` yang berbagi prefix string sama.
    const el1 = card.locator('div[data-testid^="facade-element-"]').first()
    const testId1 = await el1.getAttribute("data-testid")
    expect(testId1).toBeTruthy()
    const feId1 = testId1!.replace("facade-element-", "")

    // Elemen 2 di dinding B (berbeda).
    await wallB.click({ force: true })
    await expect(card).toBeVisible()
    await card.getByTestId("facade-add-reveal-line").click()
    const el2 = card.locator('div[data-testid^="facade-element-"]').first()
    const testId2 = await el2.getAttribute("data-testid")
    expect(testId2).toBeTruthy()
    const feId2 = testId2!.replace("facade-element-", "")

    // Hapus elemen 1 — kembali ke dinding A lalu klik tombol hapusnya.
    await wallA.click({ force: true })
    await expect(card).toBeVisible()
    await card.getByTestId(`facade-remove-${feId1}`).click()
    await expect(card.getByTestId(`facade-element-${feId1}`)).toHaveCount(0)

    // Dinding B masih punya elemennya sendiri, tak tersentuh.
    await wallB.click({ force: true })
    await expect(card).toBeVisible()
    await expect(card.getByTestId(`facade-element-${feId2}`)).toBeVisible()
    await expect(
      card.getByTestId(`facade-element-label-${feId2}`),
    ).toHaveText("Nat beton / reveal line")
  })
})

test.describe("Studio Komponen — pola kisi/roster kustom", () => {
  test("membuka studio, menerapkan preset tersimpan ke elemen", async ({ page }) => {
    await openEditor(page)
    const { wallA } = await twoDistinctWalls(page)
    await wallA.click({ force: true })

    const card = facadeQuickEditor(page)
    await expect(card).toBeVisible()
    await card.getByTestId("facade-add-fluted-panel").click()

    // "Pola kustom" terbuka bawaan (fluted SELALU membawa `pattern`) — tombol
    // Studio langsung terlihat tanpa perlu membuka collapsible.
    await card.getByRole("button", { name: "Buka Studio Komponen" }).first().click()

    const sheet = page.getByTestId("component-studio-sheet")
    await expect(sheet).toBeVisible()
    await expect(sheet.getByRole("heading", { name: "Studio Komponen" })).toBeVisible()
    await expect(
      sheet.locator('svg[aria-label="Pratinjau pola komponen"]'),
    ).toBeVisible()

    const presetItems = sheet.locator("ul li")
    await expect(presetItems.first()).toBeVisible()
    expect(await presetItems.count()).toBeGreaterThan(0)

    await presetItems.first().getByRole("button", { name: "Terapkan" }).click()
    await sheet.getByRole("button", { name: "Terapkan ke elemen" }).click()

    // Sheet tidak menutup otomatis setelah "Terapkan ke elemen" (hanya
    // commit ke store) — kontrak sukses di sini adalah toast, bukan close.
    await expect(page.getByText("Pola diterapkan ke elemen")).toBeVisible()
  })
})

test.describe("Kisi pada dinding tepi lantai atas (w-edge)", () => {
  /**
   * Regresi: dinding sintetis `edge-{floorId}` (penutup fasad lantai
   * ELEVATED yang tak ditempati Room — lihat lib/geometry/edge-wall.ts &
   * komentar wall-inspector.tsx baris ~478) DULU tak menampilkan bagian
   * "Kisi / roster fasad" sama sekali. 2D Editor TIDAK punya jalur seleksi
   * untuk dinding ini (hit-target `wall-hit-*` hanya digambar utk Room asli
   * — plan-canvas.tsx), jadi satu-satunya jalur UI nyata adalah 3D Preview:
   * klik dinding di tampilan Atas dengan Lantai 1/3/Rooftop disembunyikan
   * (mengisolasi Lantai 2), yang menyeleksi dinding barat sintetisnya lewat
   * FacadeWallMesh (build-model.ts baris ~1084, previewStore.selectWall).
   * Titik klik (0.38, 0.55 relatif kanvas) diverifikasi stabil lintas
   * beberapa run — geometri demo project deterministik (bukan diacak).
   */
  test("bagian 'Kisi / roster fasad' tampil & bisa dipakai di dinding tepi sintetis", async ({ page }) => {
    await page.goto(`/app/projects/${DEMO}/preview-3d`)
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 30_000 })
    await page.waitForTimeout(1200)

    const bar = page.getByTestId("floor-toggle-bar")
    await bar.getByRole("button", { name: /Lantai 1/ }).click()
    await bar.getByRole("button", { name: /Lantai 3/ }).click()
    await bar.getByRole("button", { name: /Rooftop/ }).click()
    await page.waitForTimeout(500)

    await page.getByRole("button", { name: /Sudut pandang Atas/ }).click()
    await page.waitForTimeout(800)

    // Panel dibiarkan TERBUKA: semua kandidat klik di sisi kiri kanvas
    // (x <= 0.42 lebar), jauh dari panel kanan — dan kartu inspector harus
    // ada di DOM supaya loop verifikasi di bawah bisa membaca heading-nya.
    const canvas = page.locator("canvas").first()
    const box = await canvas.boundingBox()
    expect(box).toBeTruthy()
    // Titik relatif tunggal rapuh terhadap proporsi kanvas (chrome atas
    // berubah tinggi di Fase 5) — coba beberapa kandidat di sisi barat
    // proyeksi bangunan sampai dinding TEPI sintetis yang terseleksi
    // (headingnya "Fasad lantai — …", bukan "Dinding … · <ruang>").
    const relCandidates: Array<[number, number]> = [
      [0.38, 0.55], [0.36, 0.5], [0.4, 0.5], [0.35, 0.55],
      [0.33, 0.5], [0.38, 0.45], [0.42, 0.55], [0.34, 0.45],
    ]
    let matched = false
    for (const [rx, ry] of relCandidates) {
      await canvas.click({ position: { x: box!.width * rx, y: box!.height * ry } })
      await page.waitForTimeout(300)
      const text = await facadeQuickEditor(page)
        .locator("p")
        .nth(1)
        .textContent()
        .catch(() => null)
      if (text?.startsWith("Fasad lantai — ")) {
        matched = true
        break
      }
    }
    expect(matched, "tidak menemukan dinding tepi sintetis dari kandidat klik").toBe(true)
    await page.waitForTimeout(200)

    const card = facadeQuickEditor(page)
    await expect(card).toBeVisible()
    const heading = card.locator("p").nth(1)
    await expect(heading).toHaveText(/^Fasad lantai — /)

    const louverSection = card.getByTestId("facade-louver-section")
    await expect(louverSection).toBeVisible()

    await louverSection.getByTestId("facade-add-fluted-panel").click()
    await expect(
      louverSection.locator('[data-testid^="facade-element-label-"]').first(),
    ).toHaveText("Panel sirip (fluted)")
  })
})
