import { test, expect } from "@playwright/test"

const DEMO = "proj-demo-8x8"

test.describe("Marketing", () => {
  test("landing & pricing tampil", async ({ page }) => {
    await page.goto("/")
    await expect(
      page.getByRole("heading", { name: /Bikin konsep rumah terukur/i })
    ).toBeVisible()

    await page.goto("/pricing")
    await expect(
      page.getByRole("heading", { name: /Pilih paket yang sesuai/i })
    ).toBeVisible()
  })
})

test.describe("Auth", () => {
  test("login demo masuk ke dashboard", async ({ page }) => {
    await page.goto("/login")
    await page.getByRole("button", { name: "Lanjut sebagai demo" }).click()
    await page.waitForURL("**/app/dashboard")
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible()
    await expect(page.getByText(/Rumah 8/).first()).toBeVisible()
  })
})

test.describe("Create project", () => {
  test("wizard membuat project lalu membuka brief", async ({ page }) => {
    await page.goto("/app/projects/new")
    await page.getByLabel("Nama project").fill("Rumah E2E Test")
    await page.getByLabel(/Lokasi/).fill("Surabaya")

    await page.getByRole("button", { name: "Lanjut" }).click() // -> Data tanah
    await page.getByRole("button", { name: "Lanjut" }).click() // -> Bangunan
    await page.getByRole("button", { name: "Terasa lega" }).click()
    await page.getByRole("button", { name: "Lanjut" }).click() // -> Kebutuhan ruang
    await page.getByRole("button", { name: "Lanjut" }).click() // -> Ringkasan
    await page.getByRole("button", { name: "Buat project" }).click()

    await page.waitForURL(/\/app\/projects\/proj-.+\/brief/, { timeout: 30_000 })
    // Fase 5: nama project kini tombol dropdown di ProjectBar, bukan heading.
    await expect(
      page.getByTestId("project-name-menu-trigger").filter({ hasText: "Rumah E2E Test" })
    ).toBeVisible()
  })
})

test.describe("Alternatives", () => {
  test("pilih alternatif membuka 2D editor", async ({ page }) => {
    await page.goto(`/app/projects/${DEMO}/alternatives`)
    await expect(page.getByText("Compact Courtyard Pool")).toBeVisible()
    await page.getByRole("button", { name: /Pilih layout/ }).first().click()
    await page.waitForURL(`**/app/projects/${DEMO}/editor`, { timeout: 30_000 })
    await expect(page.locator("svg.touch-none")).toBeVisible()
  })
})

test.describe("2D editor", () => {
  test("editor render denah & ganti lantai", async ({ page }) => {
    await page.goto(`/app/projects/${DEMO}/editor`)
    await expect(page.locator("svg.touch-none")).toBeVisible()
    await page.getByRole("button", { name: "Lantai 2" }).click()
    await expect(page.getByText("Ringkasan").first()).toBeVisible()
  })

  // Regression guard: the desktop Simpan control lives in the FloatingPanel
  // header. When the panel is expanded (default) it must stay visible and
  // clickable — not occluded behind the panel overlay (the T3 occlusion bug).
  test("tombol Simpan di header panel terlihat & bisa diklik saat panel terbuka", async ({
    page,
  }) => {
    await page.goto(`/app/projects/${DEMO}/editor`)
    await expect(page.locator("svg.touch-none")).toBeVisible()

    const panel = page.getByTestId("editor-floating-sidebar")
    await expect(panel).toBeVisible()
    const simpan = panel.getByRole("button", { name: "Simpan" })
    await expect(simpan).toBeVisible()

    // Enable Simpan by marking the layout dirty: change soil bearing σ in the
    // Properti/Ringkasan inspector (same panel body).
    const soil = panel.getByLabel("Daya dukung tanah (kPa)")
    const current = await soil.inputValue()
    await soil.fill(current === "200" ? "180" : "200")
    await soil.blur()
    await expect(simpan).toBeEnabled()

    // A real click must reach the button (Playwright throws if another element
    // intercepts the pointer) and trigger a manual save.
    await simpan.click()
    await expect(page.getByText(/Layout tersimpan/)).toBeVisible()
  })

  test("peringatan pindah ke lonceng: note, detail, dan add to AI context", async ({
    page,
  }) => {
    await page.goto(`/app/projects/${DEMO}/editor`)
    await expect(page.locator("svg.touch-none")).toBeVisible()

    const panel = page.getByTestId("editor-floating-sidebar")
    await expect(panel).toBeVisible()
    await expect(panel.getByText("Peringatan")).toHaveCount(0)

    await panel.getByRole("button", { name: /Peringatan denah/ }).click()
    await expect(page.getByText(/total$/).first()).toBeVisible()

    const firstMenu = page.getByRole("button", { name: "Aksi peringatan" }).first()
    await firstMenu.click()
    await page.getByRole("menuitem", { name: "Take note" }).click()
    await page.getByLabel("Catatan peringatan").fill("Cek bersama engineer.")
    await page.getByRole("button", { name: "Simpan catatan" }).click()
    await expect(page.getByText("Cek bersama engineer.")).toBeVisible()

    await firstMenu.click()
    await page.getByRole("menuitem", { name: "Show detail" }).click()
    await expect(page.getByRole("dialog", { name: "Detail Peringatan" })).toBeVisible()
    await page.getByRole("button", { name: "Close" }).click()

    await panel.getByRole("button", { name: /Peringatan denah/ }).click()
    await expect(page.getByText("Cek bersama engineer.")).toBeVisible()
    await page.getByRole("button", { name: "Aksi peringatan" }).first().click()
    await page.getByRole("menuitem", { name: "Add to AI context" }).click()
    const agent = page.getByTestId("project-agent-panel")
    await expect(agent).toBeVisible()
    await expect(agent.getByLabel("Pesan untuk AI Agent")).toHaveValue(
      /Aksi yang saya inginkan:/
    )
    await expect(agent.getByLabel("Pesan untuk AI Agent")).toHaveValue(
      /Peringatan:/
    )
  })

  test("ikon warning di kanvas membuka detail saat hover dan click", async ({ page }) => {
    await page.goto(`/app/projects/${DEMO}/editor`)
    await expect(page.locator("svg.touch-none")).toBeVisible()

    const panel = page.getByTestId("editor-floating-sidebar")

    await page.getByText("Carport", { exact: true }).click({ force: true })

    const ventilationSwitch = panel.getByRole("switch", { name: "Perlu ventilasi" })
    await expect(ventilationSwitch).toBeVisible()
    await ventilationSwitch.click()

    const marker = page.getByRole("button", { name: "Detail peringatan untuk Carport" })
    await expect(marker).toBeVisible()

    const markerTestId = await marker.getAttribute("data-testid")
    if (!markerTestId) throw new Error("Warning marker test id missing")
    const warningId = markerTestId.replace("warning-marker-", "")
    const detail = page.getByTestId(`warning-detail-${warningId}`)

    await marker.hover()
    await expect(detail).toBeVisible()
    await page.waitForTimeout(500)
    await expect(detail).toBeVisible()

    await marker.click()
    await expect(detail).toBeVisible()
    await page.waitForTimeout(500)
    await expect(detail).toBeVisible()
  })
})

test.describe("Partial rooftop", () => {
  // Deck sebagian end-to-end: pilih mode di bagian "Atap" inspector → input
  // rect + ringkasan luas muncul, overlay deck dirender di kanvas lantai
  // Rooftop, lalu pindah ke Preview 3D via tab nav SPA (BUKAN page.goto —
  // full reload membuang draft rooftopArea karena mock layer in-memory;
  // shared editor store yang membawa draft ke preview) dan toggle
  // "Tampilkan atap" muncul (disembunyikan untuk rooftop deck PENUH).
  test("atur deck rooftop sebagian → overlay kanvas + toggle atap muncul di Preview 3D", async ({
    page,
  }) => {
    await page.goto(`/app/projects/${DEMO}/editor`)
    await expect(page.locator("svg.touch-none")).toBeVisible()

    const panel = page.getByTestId("editor-floating-sidebar")
    await expect(panel).toBeVisible()

    // Bagian "Atap" hidup di inspector Ringkasan (selalu ter-render, tanpa
    // accordion) — langsung pilih mode "Deck sebagian" pada radiogroup.
    await expect(
      panel.getByRole("radiogroup", { name: "Mode deck rooftop" })
    ).toBeVisible()
    await panel.getByRole("radio", { name: "Deck sebagian" }).click()

    // 4 input rect deck + ringkasan luas Deck/Atap (m²).
    await expect(panel.getByLabel("Posisi X deck rooftop (meter)")).toBeVisible()
    await expect(panel.getByLabel("Posisi Y deck rooftop (meter)")).toBeVisible()
    await expect(panel.getByLabel("Lebar deck rooftop (meter)")).toBeVisible()
    await expect(panel.getByLabel("Dalam deck rooftop (meter)")).toBeVisible()
    await expect(panel.getByText(/^Deck [\d.]+ m²$/)).toBeVisible()
    await expect(panel.getByText(/^Atap [\d.]+ m²$/)).toBeVisible()

    // Overlay deck hanya dirender di lantai Rooftop (floor-rooftop aktif).
    await page.getByRole("button", { name: "Rooftop", exact: true }).click()
    await expect(page.getByTestId("rooftop-deck-overlay")).toBeVisible()
    await expect(page.getByTestId("rooftop-deck-handle")).toHaveCount(4)

    // Pindah ke Preview 3D via stage nav Desain (caret → sub-halaman, Fase 5
    // — ProjectTabs diganti ProjectBar) supaya draft deck ikut terbawa (SPA).
    await page
      .getByRole("navigation", { name: "Tahap project" })
      .getByTestId("stage-desain-caret")
      .click()
    await page.getByRole("menuitem", { name: "3D Preview" }).click()
    await page.waitForURL(`**/app/projects/${DEMO}/preview-3d`)
    await expect(page.getByRole("heading", { name: "Preview 3D" })).toBeVisible({
      timeout: 30_000,
    })

    // "Opsi tampilan" adalah accordion yang default collapsed — buka dulu.
    await page.getByRole("button", { name: "Opsi tampilan" }).click()
    await expect(
      page.getByRole("switch", { name: "Tampilkan atap" })
    ).toBeVisible()
  })
})

test.describe("3D preview", () => {
  test("3D render canvas atau fallback", async ({ page }) => {
    await page.goto(`/app/projects/${DEMO}/preview-3d`)
    const canvas = page.locator("canvas").first()
    const fallback = page.getByText("Gagal memuat preview 3D")
    await expect(canvas.or(fallback)).toBeVisible({ timeout: 30_000 })
    // Sudut pandang pindah ke ViewToolbar kiri (icon-only, 2026-07-11).
    await expect(page.getByTestId("view-toolbar")).toBeVisible()
    await expect(page.getByRole("button", { name: /Sudut pandang Isometrik/ })).toBeVisible()
  })

  test("material ruang bisa diganti dari sidebar 3D dan muncul di jadwal material", async ({ page }) => {
    await page.goto(`/app/projects/${DEMO}/preview-3d`)
    await expect(page.getByRole("heading", { name: "Preview 3D" })).toBeVisible({
      timeout: 30_000,
    })

    await page.getByRole("button", { name: /Interior Editor/ }).click()
    await page.getByRole("button", { name: "Ruang tamu" }).click()
    await page.getByRole("button", { name: /^Material$/ }).click()

    const floorPicker = page.getByRole("combobox", { name: /Material Lantai Ruang tamu/ })
    await floorPicker.click()
    await page.getByRole("option", { name: "Polished Concrete" }).click()
    await expect(floorPicker).toContainText("Polished Concrete")

    await page.getByRole("link", { name: "Jadwal material" }).click()
    await page.waitForURL(`**/app/projects/${DEMO}/materials`)
    await expect(page.getByText("Polished Concrete").first()).toBeVisible()
  })

  // FloatingPanel bersama: minimize → pill → buka lagi. Siklus dijalankan 2×
  // untuk membuktikan toggle idempoten, dan test berakhir dengan panel
  // TERBUKA (localStorage "panel:preview3d" = "0") supaya test lain di
  // storage state yang sama tidak terpengaruh.
  test("panel Preview 3D bisa di-minimize jadi pill dan dibuka lagi", async ({
    page,
  }) => {
    await page.goto(`/app/projects/${DEMO}/preview-3d`)
    const panel = page.getByTestId("preview-floating-sidebar")
    await expect(panel).toBeVisible({ timeout: 30_000 })

    const minimize = page.getByRole("button", {
      name: "Minimize Preview 3D",
      exact: true,
    })
    const pill = page.getByRole("button", {
      name: "Buka Preview 3D",
      exact: true,
    })

    for (let cycle = 0; cycle < 2; cycle++) {
      await minimize.click()
      await expect(panel).toBeHidden()
      await expect(pill).toBeVisible()

      await pill.click()
      await expect(panel).toBeVisible()
      await expect(pill).toBeHidden()
      await expect(panel.getByTestId("preview-controls-scroll")).toBeVisible()
      await expect(
        panel.getByRole("heading", { name: "Preview 3D" })
      ).toBeVisible()
    }
  })
})

test.describe("Interior in 3D preview", () => {
  test("route interior lama redirect ke 3D Preview tunggal", async ({ page }) => {
    await page.goto(`/app/projects/${DEMO}/interior?room=legacy-room`)
    await page.waitForURL(`**/app/projects/${DEMO}/preview-3d?room=legacy-room`)
    await expect(page.locator("body")).not.toContainText("RumahCAD AI")
  })

  test("edit interior furniture dari 3D Preview tunggal", async ({ page }) => {
    await page.goto(`/app/projects/${DEMO}/preview-3d`)
    await expect(page.getByRole("heading", { name: "Preview 3D" })).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByTestId("preview-floating-sidebar")).toHaveCSS("position", "absolute")
    const controlsScroll = page.getByTestId("preview-controls-scroll").first()
    await expect(controlsScroll).toHaveCSS("overflow-y", "auto")

    // Mode edit kini default (toggle Edit/View sudah dihapus dari UI) —
    // kontrol furnitur langsung tersedia tanpa langkah ekstra.

    // "Interior Editor" is a collapsed accordion by default — expand it.
    await page.getByRole("button", { name: /Interior Editor/ }).click()

    await expect(page.getByTestId("preview-style-selector")).toBeVisible()
    await expect.poll(async () =>
      controlsScroll.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)
    ).toBe(true)

    // Selector style compact (2026-07-11): tombol hanya berisi nama style.
    await page.getByRole("button", { name: "Japandi", exact: true }).click()
    // Furniture addition now goes through the single project AI Agent instead
    // of the removed preview-only quick-add assistant.
    await page.getByRole("button", { name: "AI Agent", exact: true }).first().click()
    const agent = page.getByTestId("project-agent-panel")
    await agent.getByRole("button", { name: "Interior", exact: true }).click()
    await agent.getByLabel("Pesan untuk AI Agent").fill("Tambahkan coffee table ke ruang ini")
    await agent.getByRole("button", { name: "Kirim pesan" }).click()
    await expect(agent.getByText("Usulan perubahan (1)")).toBeVisible()
    await agent.getByRole("button", { name: "Terapkan" }).click()
    await expect(agent.getByText("✓ Diterapkan")).toBeVisible()
    await page.getByTestId("project-agent-sheet").getByRole("button", { name: "Close" }).click()

    const canvas = page.locator("canvas")
    if (await canvas.isVisible().catch(() => false)) {
      await expect(
        page
          .getByTestId("interior-scene-furniture-label")
          .filter({ hasText: /Coffee Table/ })
          .first()
      ).toBeVisible()
      await expect.poll(async () =>
        page
          .getByTestId("interior-scene-furniture-label")
          .filter({ hasText: /Coffee Table/ })
          .first()
          .evaluate((el) => {
            let node: HTMLElement | null = el as HTMLElement
            let maxZ = 0
            while (node && node !== document.body) {
              const z = Number(window.getComputedStyle(node).zIndex)
              if (Number.isFinite(z)) maxZ = Math.max(maxZ, z)
              node = node.parentElement
            }
            return maxZ
          })
      ).toBeLessThan(50)
    }

    // Fase 5: tombol "Cari project" (AppTopbar) tak ada di route project —
    // command palette dibuka via shortcut global.
    await page.keyboard.press("ControlOrMeta+k")
    const commandDialog = page.getByRole("dialog", { name: "Command palette" })
    await expect(commandDialog).toBeVisible()
    const dialogContent = page.locator('[data-slot="dialog-content"]').last()
    await expect.poll(async () =>
      dialogContent.evaluate((el) => Number(window.getComputedStyle(el).zIndex))
    ).toBeGreaterThanOrEqual(50)
    await expect.poll(async () =>
      dialogContent.evaluate((el) => {
        const rect = el.getBoundingClientRect()
        const topElement = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + Math.min(32, rect.height / 2)
        )
        return !!topElement && el.contains(topElement)
      })
    ).toBe(true)
    await page.keyboard.press("Escape")

    // "Opsi tampilan" is a collapsed accordion too — expand it for the label toggle.
    await page.getByRole("button", { name: "Opsi tampilan" }).click()
    await page.getByRole("switch", { name: "Label interior" }).click()
    await expect(
      page.getByTestId("interior-scene-furniture-label").filter({ hasText: /Coffee Table/ })
    ).toHaveCount(0)
    await page.getByRole("switch", { name: "Label interior" }).click()
    if (await canvas.isVisible().catch(() => false)) {
      await expect(
        page
          .getByTestId("interior-scene-furniture-label")
          .filter({ hasText: /Coffee Table/ })
          .first()
      ).toBeVisible()
    }

    // Furniture kini sub-halaman Desain (caret), bukan tab langsung — Fase 5.
    await page
      .getByRole("navigation", { name: "Tahap project" })
      .getByTestId("stage-desain-caret")
      .click()
    await page.getByRole("menuitem", { name: "Furniture" }).click()
    await expect(page.getByRole("heading", { name: "Furniture" })).toBeVisible()
    await expect(page.getByText("Furniture schedule")).toBeVisible()
    await expect.poll(async () =>
      page.getByRole("cell", { name: "Coffee Table" }).count()
    ).toBeGreaterThan(0)

    await page.getByRole("link", { name: "Buka 3D Preview" }).click()
    await expect(page.getByRole("heading", { name: "Preview 3D" })).toBeVisible()
    // The page remounted — the "Interior Editor" accordion collapsed again.
    await page.getByRole("button", { name: /Interior Editor/ }).click()
    await expect(page.getByTestId("preview-style-selector")).toBeVisible()
    await expect(page.getByText("Coffee Table").first()).toBeVisible()

    await page.goto(`/app/projects/${DEMO}/materials`)
    await expect(page.getByRole("heading", { name: "Materials" })).toBeVisible()
    await expect(page.getByText("Material schedule")).toBeVisible()

    await page.goto(`/app/projects/${DEMO}/furniture`)
    await expect(page.getByRole("heading", { name: "Furniture" })).toBeVisible()
    await expect(page.getByText("Furniture schedule")).toBeVisible()
    await expect(page.locator("body")).not.toContainText("RumahCAD AI")
  })
})

test.describe("RAB / BOQ", () => {
  test("BOQ tampil & recompute saat ganti finishing", async ({ page }) => {
    await page.goto(`/app/projects/${DEMO}/rab`)
    await expect(page.getByRole("heading", { name: "RAB / BOQ" })).toBeVisible()
    const rows = page.locator("table tbody tr")
    await expect(rows.first()).toBeVisible()
    await page.getByRole("button", { name: /Premium/ }).click()
    await expect(page.getByText("Rincian BOQ")).toBeVisible()
    await expect(rows.first()).toBeVisible()
  })
})

test.describe("Exports", () => {
  // Demo/mock user is permanently plan "studio" (Task 7 — "supaya fitur
  // showcase & e2e existing tetap hijau"), whose entitlements
  // (creditsPerPeriod/maxProjects/exportPdf/glbUpload) are all unlocked —
  // see DEFAULT_PLANS in src/lib/server/repo/plan-defaults.ts. export-card.tsx
  // gates every proOnly format on `entitlements.exportPdf` alone, so with
  // that permanently true for this account, NO format can ever render
  // "Upgrade untuk akses" — the locked/unlocked render states themselves are
  // already covered directly (both props) by export-card.test.tsx's RTL
  // suite. This test now asserts the current, intentional behaviour instead:
  // the demo account's export catalog is fully unlocked, end to end.
  test("generate flow + semua format terbuka (demo plan studio)", async ({ page }) => {
    await page.goto(`/app/projects/${DEMO}/exports`)
    await expect(page.getByText("Contractor Pack PDF")).toBeVisible()
    await expect(page.getByText("Interior Pack PDF")).toBeVisible()
    await expect(
      page.getByRole("link", { name: /Upgrade untuk akses/ })
    ).toHaveCount(0)

    await page.getByRole("button", { name: "Generate" }).first().click()
    await expect(page.getByText("Sebelum membuat file")).toBeVisible()
    await page.getByRole("button", { name: /Saya mengerti/ }).click()
    await expect(page.getByText(/Membuat|Dibuat/).first()).toBeVisible({
      timeout: 15_000,
    })
  })
})

test.describe("Billing", () => {
  test("menampilkan paket & upgrade scaffold", async ({ page }) => {
    await page.goto("/app/billing")
    await expect(
      page.getByRole("heading", { name: "Billing & paket" })
    ).toBeVisible()
    await page.getByRole("button", { name: /Pilih Pro/ }).click()
    await expect(page.getByText(/Pembayaran belum/)).toBeVisible({
      timeout: 10_000,
    })
  })
})

test.describe("Review", () => {
  test("tambah komentar & resolve peringatan", async ({ page }) => {
    await page.goto(`/app/projects/${DEMO}/review`)
    await expect(
      page.getByRole("heading", { name: "Review & catatan" })
    ).toBeVisible()

    await page.getByPlaceholder(/Tulis catatan/).fill("Komentar dari E2E.")
    await page.getByRole("button", { name: "Kirim" }).click()
    await expect(page.getByText("Komentar dari E2E.")).toBeVisible()

    await page.getByRole("button", { name: "Teratasi" }).first().click()
    await expect(
      page.getByRole("button", { name: "Buka lagi" }).first()
    ).toBeVisible()
  })
})
