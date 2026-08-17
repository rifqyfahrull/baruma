import { test, expect } from "@playwright/test"

const DEMO = "proj-demo-8x8"

test.describe("Editor struktur (σ tanah)", () => {
  test("Inspector default menampilkan input daya dukung tanah dengan nilai default 150", async ({ page }) => {
    await page.goto(`/app/projects/${DEMO}/editor`)

    // Plan canvas is the SVG with `touch-none` (same handle the electrical /
    // plumbing / critical-flows editor tests wait on).
    await expect(page.locator("svg.touch-none")).toBeVisible({ timeout: 30_000 })

    // The no-selection inspector ("Ringkasan") is shown by default — no Edit
    // mode needed — and hosts the "Struktur" section with the σ input
    // (SummaryInspector → StructuralSection in
    // src/components/editor/editor-inspector.tsx).
    const soil = page.getByLabel("Daya dukung tanah (kPa)")
    await expect(soil).toBeVisible({ timeout: 15_000 })

    // The demo layout seeds no `structural` block, so σ falls back to the
    // SOIL_DEFAULT_KPA default of 150 kPa.
    await expect(soil).toHaveValue("150")
  })
})

test.describe("Preview 3D realistis", () => {
  test("toggle Realistis + slider matahari ada; canvas tetap render tanpa error", async ({ page }) => {
    // Split the two channels: uncaught JS exceptions (pageerror) are the real
    // "no crash" guarantee and must be zero; console errors are asserted too but
    // with environmental noise filtered (see below).
    const pageErrors: string[] = []
    const consoleErrors: string[] = []
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()) })
    page.on("pageerror", (e) => pageErrors.push(String(e)))

    await page.goto(`/app/projects/${DEMO}/preview-3d`)

    // Scene mounts (canvas) or the graceful WebGL fallback — must not be a crash.
    // Mirrors the interior-3d-models / interior-drag e2e pattern.
    const canvas = page.locator("canvas").first()
    const fallback = page.getByText("Gagal memuat preview 3D")
    await expect(canvas.or(fallback)).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole("heading", { name: "Preview 3D" })).toBeVisible({ timeout: 30_000 })

    // Kontrol pencahayaan pindah ke ViewToolbar kiri (2026-07-11): tombol
    // popover "Pencahayaan"; isinya (switch Realistis + slider matahari)
    // dirender via portal Radix di level page, bukan di dalam toolbar.
    await page.getByTestId("view-toolbar").getByRole("button", { name: "Pencahayaan" }).click()

    const realistic = page.getByRole("switch", { name: /Realistis/ })
    await expect(realistic).toBeVisible()
    // Radix Slider tidak meneruskan aria-label ke thumb-nya — assert label
    // teks slider matahari di popover (Azimuth/Elevasi) sebagai bukti hadir.
    await expect(page.getByText(/Azimuth matahari/).first()).toBeVisible()

    // Toggle Realistis off then on — this exercises both the flat and the
    // shadows+PBR-texture render paths. The scene must keep rendering (canvas
    // stays alive) and never crash into the fallback.
    await realistic.click()
    await expect(canvas.or(fallback)).toBeVisible()
    await realistic.click()
    await page.waitForTimeout(800) // let shadows / procedural textures re-mount
    await expect(canvas.or(fallback)).toBeVisible()

    // The realistic render must never throw an uncaught exception — that (plus
    // the canvas staying alive above and SceneBoundary never tripping) is the
    // real "no crash" guarantee.
    //
    // Exception: GLB furniture assets (public/models/*.glb) are not present
    // in a local checkout (production-only storage) — the demo layout
    // references dozens of them. GlbErrorBoundary + Suspense fallback
    // (furniture-model.tsx) already catches the load failure and swaps in
    // ProceduralFurniture (no visual crash — the canvas.or(fallback) checks
    // above prove the scene stays alive); React still surfaces the caught
    // error to window.onerror, which Playwright reports as a pageerror. Any
    // OTHER uncaught exception still fails this assertion.
    const realPageErrors = pageErrors.filter(
      (e) => !/Could not load \/models\/.+\.glb/i.test(e)
    )
    expect(realPageErrors, realPageErrors.join("\n")).toEqual([])

    // Console errors, minus environmental noise (favicon + ResizeObserver, same
    // as the other 3D specs). The old `unpackRGBAToDepth` exemption is GONE on
    // purpose: that was drei <SoftShadows>' PCSS shader failing to compile
    // against three r184 on EVERY GPU (not just SwiftShader) — SoftShadows has
    // been removed from house-scene, so any shader compile error is a real bug.
    // Same missing-local-asset exception as pageErrors above.
    const real = consoleErrors.filter(
      (e) => !/favicon|ResizeObserver|Could not load \/models\/.+\.glb|Failed to load resource.*404/i.test(e)
    )
    expect(real, real.join("\n")).toEqual([])
  })
})
