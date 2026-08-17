import fs from "node:fs"
import path from "node:path"
import { test, expect, type Page } from "@playwright/test"

const DEMO = "proj-demo-8x8"

// public/models/*.glb is gitignored ("3D model binaries live in object
// storage, not git" — see .gitignore) and only synced from production
// storage in CI/deploy environments. This spec drives the REAL upload
// dialog with real corpus files (setInputFiles needs actual bytes on disk,
// unlike the mock-backend "My Library" flow other specs use), so it can't
// run against a plain local checkout. Skip explicitly instead of faking it
// green; runs for real wherever the corpus has been synced.
const CORPUS_FILES = ["public/models/tv-55.glb", "public/models/toilet-toto.glb"]
const corpusAvailable = CORPUS_FILES.every((f) => fs.existsSync(path.join(process.cwd(), f)))

/**
 * FurniMesh ingestion corpus — drives the REAL ModelUploadDialog with
 * real-world GLBs converted from the SketchUp asset bank (the same files
 * shipped in public/models/), so the production client-side pipeline
 * (analyzeGlbFile → Draco decode → validateBboxForSlot → step machine) is
 * exercised against genuinely messy geometry, not synthetic fixtures.
 *
 * Sejak 0066600 (12 Jul) panel quick-add katalog sengaja dihapus dari Preview
 * 3D — entry point upload kini flow ROOM: "Tambah Model 3D Kustom" →
 * "Upload Model 3D" (profil validasi "generic"). Jalur slot-strict (profil
 * TV/sofa dsb.) butuh furniture katalog terseleksi via klik mesh 3D — tidak
 * deterministik di headless, sehingga kasus needs_scale slot-strict tidak
 * lagi diuji lewat UI di sini.
 *
 * The app runs on the in-memory mock data source in e2e, which fakes every
 * asset API — except the storage PUT, which targets the fake host
 * mock-storage.example.com and must be intercepted here.
 */
test.describe("FurniMesh upload corpus (real converted GLBs)", () => {
  async function openPreview3dEditor(page: Page): Promise<string[]> {
    const errors: string[] = []
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()) })
    page.on("pageerror", (e) => errors.push(String(e)))

    // The mock storage host does not exist — accept the dialog's PUT so the
    // flow can proceed to the client-side analysis stage.
    await page.route("https://mock-storage.example.com/**", (route) =>
      route.fulfill({ status: 200, body: "" })
    )

    await page.goto(`/app/projects/${DEMO}/preview-3d`)
    await expect(page.getByRole("heading", { name: "Preview 3D" })).toBeVisible({ timeout: 30_000 })
    await page.getByTitle("Masuk mode Edit (E)").click()
    return errors
  }

  /** Open the room-level upload dialog ("Tambah Model 3D Kustom" flow). */
  async function openRoomUpload(page: Page) {
    await page.getByTestId("room-custom-model").click()
    await page.getByTestId("room-upload-model").click()
    await expect(page.getByRole("heading", { name: /Upload Model untuk/ })).toBeVisible()
  }

  test("dimensionally-honest and corrupt GLBs each land on the right dialog step", async ({ page }) => {
    test.skip(
      !corpusAvailable,
      "corpus GLBs (public/models/tv-55.glb, toilet-toto.glb) not present in local checkout — production-storage-only, gitignored"
    )
    const errors = await openPreview3dEditor(page)
    const dialog = page.getByRole("dialog")

    // ── Case 1: real converted TV model → every "generic" profile bound
    // passes so the dialog must skip needs_scale and go straight to material
    // mode.
    await openRoomUpload(page)
    await dialog.locator('input[type="file"]').setInputFiles("public/models/tv-55.glb")
    await expect(dialog.getByText("Pilih mode material:")).toBeVisible({ timeout: 20_000 })
    await dialog.getByRole("button", { name: "Tutup", exact: false }).or(
      dialog.locator('button:has(svg.lucide-x)')
    ).last().click()
    await expect(dialog).not.toBeVisible()

    // ── Case 2: full happy path against the mock asset backend — real toilet
    // model through material → confirm → attach → success, lalu furniture
    // baru masuk ke ruang (onUploadComplete → addAssetFurniture).
    await openRoomUpload(page)
    await dialog.locator('input[type="file"]').setInputFiles("public/models/toilet-toto.glb")
    await expect(dialog.getByText("Pilih mode material:")).toBeVisible({ timeout: 20_000 })
    await dialog.getByRole("button", { name: "Lanjut ke Konfirmasi" }).click()
    await expect(dialog.getByText("Ringkasan:")).toBeVisible()
    await dialog.getByRole("button", { name: "Pasang Model" }).click()
    await expect(dialog.getByText("Model berhasil dipasang!")).toBeVisible({ timeout: 20_000 })
    await dialog.getByRole("button", { name: "Selesai" }).click()
    await expect(dialog).not.toBeVisible()

    // ── Case 3: corrupt bytes with a .glb name → the analyzer must fail
    // gracefully into the error step with the FRIENDLY message — the raw
    // three.js parser error ("Unexpected token … is not valid JSON") leaked
    // straight to the user before this spec existed.
    await openRoomUpload(page)
    await dialog.locator('input[type="file"]').setInputFiles({
      name: "corrupt.glb",
      mimeType: "model/gltf-binary",
      buffer: Buffer.from("definitely not a binary gltf payload"),
    })
    await expect(dialog.getByText(/File GLB tidak bisa dibaca/)).toBeVisible({ timeout: 20_000 })
    await expect(dialog.getByText(/is not valid JSON/)).not.toBeVisible()
    await dialog.getByRole("button", { name: "Tutup" }).click()

    // No console/page errors end-to-end. mock:// asset URLs are the mock
    // backend's fake storage scheme — a fetch of one is expected noise if a
    // component tries to load the just-attached asset.
    const real = errors.filter((e) => !/favicon|ResizeObserver|mock:\/\//i.test(e))
    expect(real, real.join("\n")).toEqual([])
  })
})
