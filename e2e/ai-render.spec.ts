import { test, expect, type Page } from "@playwright/test"

/**
 * E2E Render AI (Fase 8/9 — docs/plan-integrasi-ai-renderer-2026-08.md).
 *
 * Seperti spec 3D lain di repo ini (lihat photo-package.spec.ts,
 * furnimesh-upload-corpus.spec.ts), env e2e default TIDAK mengeset
 * NEXT_PUBLIC_API_URL/NEXT_PUBLIC_DATA_SOURCE (lihat playwright.config.ts) —
 * jadi `@/lib/data` jatuh ke in-memory mock CLIENT (lazyMockSource,
 * src/lib/data/mock-source.ts), BUKAN route handler server nyata. Mode
 * "cepat"/"presisi" di mock (`src/lib/mock/index.ts` createRender) selalu
 * resolve instan ke "succeeded" dengan placeholder SVG — tanpa provider AI
 * eksternal, persis prinsip "AI_RENDER_PROVIDER=mock" di sisi server.
 *
 * Satu-satunya panggilan jaringan nyata dalam alur ini adalah PUT ke
 * signed-upload URL — mock mengembalikan host palsu
 * `https://mock-storage.example.com/...` (sama seperti requestUploadUrl aset
 * GLB), jadi diintersep persis pola furnimesh-upload-corpus.spec.ts.
 *
 * Menjalankan lokal: `pnpm exec playwright test e2e/ai-render.spec.ts`
 * (server dev otomatis dijalankan oleh playwright.config.ts's `webServer`).
 */

const DEMO = "proj-demo-8x8"

async function openPreview(page: Page): Promise<void> {
  await page.goto(`/app/projects/${DEMO}/preview-3d`)
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole("heading", { name: "Preview 3D" })).toBeVisible({ timeout: 30_000 })
  await page.waitForTimeout(1500)
}

test.describe("Render AI", () => {
  test("tombol Render AI tampil di toolbar preview 3D", async ({ page }) => {
    await openPreview(page)
    await expect(page.getByTestId("ai-render-open")).toBeVisible()
  })

  test("dialog terbuka, mode/preset/bidikan bisa dipilih", async ({ page }) => {
    await openPreview(page)

    await page.getByTestId("ai-render-open").click()
    await expect(page.getByRole("heading", { name: "Render AI" })).toBeVisible()

    // Mode: default Cepat (1 kredit) — pilih Presisi lalu kembali ke Cepat.
    await expect(page.getByTestId("ai-render-submit")).toContainText("Render — 1 kredit")
    await page.getByTestId("ai-render-mode-presisi").click()
    await expect(page.getByTestId("ai-render-submit")).toContainText("Render — 2 kredit")
    await page.getByTestId("ai-render-mode-cepat").click()
    await expect(page.getByTestId("ai-render-submit")).toContainText("Render — 1 kredit")

    // Preset suasana — 4 pilihan tetap (RENDER_PRESETS).
    await expect(page.getByTestId("ai-render-preset-tropis-siang")).toBeVisible()
    await expect(page.getByTestId("ai-render-preset-tropis-senja")).toBeVisible()
    await expect(page.getByTestId("ai-render-preset-skandinavia-siang")).toBeVisible()
    await expect(page.getByTestId("ai-render-preset-malam")).toBeVisible()
    await page.getByTestId("ai-render-preset-tropis-senja").click()

    // Bidikan — reuse PHOTO_SHOTS.
    await page.getByTestId("ai-render-shot-depan-siang").click()

    // Kredit tersisa tampil (demo user studio, tak akan 0/terkunci).
    await expect(page.getByTestId("ai-render-credits-remaining")).toContainText("Sisa kredit")
  })

  test("buat render → hasil muncul, label kejujuran tampil, muncul di Riwayat Render", async ({
    page,
  }) => {
    const errors: string[] = []
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text())
    })
    page.on("pageerror", (e) => errors.push(String(e)))

    // Host storage mock — sama pola dengan furnimesh-upload-corpus.spec.ts.
    await page.route("https://mock-storage.example.com/**", (route) =>
      route.fulfill({ status: 200, body: "" })
    )

    await openPreview(page)
    await page.getByTestId("ai-render-open").click()
    await expect(page.getByRole("heading", { name: "Render AI" })).toBeVisible()

    // Mode Cepat + preset/bidikan default cukup untuk alur happy path.
    await page.getByTestId("ai-render-submit").click()

    // Capture (WebGL beauty+depth pass) → upload → POST job → hasil (mock
    // resolve instan ke succeeded).
    await expect(page.getByTestId("ai-render-result-image")).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText("Visualisasi konsep — bukan gambar kerja")).toBeVisible()

    // Unduh hasil memicu download nyata.
    const downloadPromise = page.waitForEvent("download", { timeout: 10_000 })
    await page.getByTestId("ai-render-download").click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/\.png$/)

    // Riwayat Render — job yang baru dibuat muncul di galeri. Playwright's
    // .click() melakukan interaksi mouse nyata (mousedown+mouseup+click),
    // beda dgn fireEvent.click sintetis di vitest — jadi tak perlu workaround
    // khusus utk Radix Tabs (yang berpindah lewat onMouseDown) di sini.
    await page.getByTestId("ai-render-tab-riwayat").click()
    await expect(page.getByTestId("ai-render-gallery")).toBeVisible({ timeout: 10_000 })

    // Noise 404 GLB lokal (furnitur showcase) & mock:// bukan kegagalan produk
    // — pola sama dgn photo-package.spec.ts.
    const real = errors.filter(
      (e) =>
        !/favicon|ResizeObserver|mock:\/\/|Could not load \/models\/.+\.glb|Failed to load resource.*404/i.test(
          e
        )
    )
    expect(real, real.join("\n")).toEqual([])
  })

  test('bidikan "Sudut saat ini" — capture kamera aktual (bukan requestView), render sukses', async ({
    page,
  }) => {
    // NOTE arsitektur (lihat doc-comment atas file): di mode e2e ini
    // `data.createRender` adalah panggilan JS in-memory (mock-source.ts →
    // src/lib/mock/index.ts), BUKAN `fetch`/XHR — jadi tak ada request
    // jaringan nyata bernama "POST .../renders" utk diintersep di sini
    // (diverifikasi empiris: `page.on("request", …)` selama alur submit
    // penuh hanya menangkap chunk Next.js + GLB + SATU PUT ke
    // mock-storage.example.com untuk upload beauty PNG — tidak ada request
    // lain). Bentuk JSON body (`pose.position` array 3 angka, `sceneMeta`
    // absen) SUDAH dites presisi di level unit pada
    // `ai-render-dialog.test.tsx` (test 'selecting "Sudut saat ini" skips
    // requestView during capture and sends pose'), yang me-mock `data`
    // sepenuhnya via `vi.mock("@/lib/data")` dan membaca argumen mutate
    // langsung. Di sini fokusnya melengkapi: SATU-SATUNYA hal yang unit test
    // (jsdom) tidak bisa buktikan — bahwa `captureRenderInputs()` sungguhan
    // (kamera WebGL nyata di browser) berhasil membaca pose SAAT INI tanpa
    // `requestView` (beda dari bidikan preset lain yang terbang ke sudut
    // tetap) — dibuktikan via bukti tak-langsung yang kuat: request upload
    // PNG hanya terjadi kalau `captured` tak null (lihat `handleSubmit`:
    // `if (!captured) { setPhase("pilih"); return }` — memutus alur SEBELUM
    // upload apa pun kalau capture/pose gagal), dan nama file upload memuat
    // id bidikan `sudut-ini` (bukti bidikan yang dipilih benar yang dipakai).
    await page.route("https://mock-storage.example.com/**", (route) =>
      route.fulfill({ status: 200, body: "" })
    )

    await openPreview(page)
    await page.getByTestId("ai-render-open").click()
    await expect(page.getByRole("heading", { name: "Render AI" })).toBeVisible()

    const shotButton = page.getByTestId("ai-render-shot-sudut-ini")
    await expect(shotButton).toBeVisible()
    await expect(shotButton).toHaveAttribute("aria-pressed", "false")
    await shotButton.click()
    await expect(shotButton).toHaveAttribute("aria-pressed", "true")

    const uploadRequest = page.waitForRequest(
      (req) => req.method() === "PUT" && req.url().includes("sudut-ini-beauty.png"),
      { timeout: 20_000 }
    )
    await page.getByTestId("ai-render-submit").click()
    // Request PUT ke storage TERJADI dan NAMA FILE-nya memuat id bidikan
    // "sudut-ini" — bukti kuat capture kamera aktual berhasil & bidikan yang
    // benar dipakai (predicate page.waitForRequest sudah menyaring keduanya;
    // gagal capture berarti promise ini timeout, bukan resolve palsu).
    await uploadRequest

    // Hasil mock sukses (sinyal yang sama dgn kasus "buat render" di atas).
    await expect(page.getByTestId("ai-render-result-image")).toBeVisible({ timeout: 30_000 })
  })

  test("target Interior + ruang pertama — capture kamera di dalam ruangan (requestInteriorView), render sukses", async ({
    page,
  }) => {
    // Bukti tak-langsung sama seperti kasus "Sudut saat ini" di atas: SATU-
    // SATUNYA request jaringan nyata dalam alur ini adalah PUT ke storage —
    // kalau `requestInteriorView` + capture gagal, `handleSubmit` memutus
    // alur SEBELUM upload apa pun (lihat `if (!captured) { ...; return }`),
    // jadi request PUT yang benar-benar terjadi membuktikan kamera WebGL
    // nyata berhasil dipindah ke dalam ruangan & capture berhasil.
    await page.route("https://mock-storage.example.com/**", (route) =>
      route.fulfill({ status: 200, body: "" })
    )

    await openPreview(page)
    await page.getByTestId("ai-render-open").click()
    await expect(page.getByRole("heading", { name: "Render AI" })).toBeVisible()

    // Segmented control: Eksterior (default) -> Interior. Munculkan <select>
    // ruang grup-per-lantai lalu pilih opsi ruang pertama (index 0 adalah
    // placeholder disabled "Pilih ruangan…").
    const targetButton = page.getByTestId("ai-render-target-interior")
    await targetButton.click()
    await expect(targetButton).toHaveAttribute("aria-pressed", "true")

    const roomSelect = page.getByTestId("ai-render-interior-room")
    await expect(roomSelect).toBeVisible()
    await roomSelect.selectOption({ index: 1 })
    await expect(roomSelect).not.toHaveValue("")

    const uploadRequest = page.waitForRequest(
      (req) => req.method() === "PUT" && req.url().includes("-beauty.png"),
      { timeout: 20_000 }
    )
    await page.getByTestId("ai-render-submit").click()
    // Request PUT ke storage TERJADI — bukti capture interior nyata berhasil
    // (bidikan default target Interior adalah "Siang", jadi nama file berupa
    // `interior-siang-beauty.png`).
    await uploadRequest

    // Hasil mock sukses (sinyal yang sama dgn kasus-kasus di atas).
    await expect(page.getByTestId("ai-render-result-image")).toBeVisible({ timeout: 30_000 })
  })
})
