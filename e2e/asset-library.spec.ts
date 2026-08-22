import { expect, test } from "@playwright/test"

test("asset library page renders the storage-backed model catalog surface", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text())
  })

  await page.goto("/app/asset-library")
  await expect(page.getByRole("heading", { name: "Asset Library" })).toBeVisible()
  await expect(page.getByRole("link", { name: /Asset Library/ })).toBeVisible()
  await expect(page.getByText("Total asset")).toBeVisible()
  await expect(page.getByText("Sedang ditampilkan")).toBeVisible()
  await expect(page.getByRole("button", { name: "Bangunan" })).toBeVisible()

  expect(errors).toEqual([])
})

test("aset katalog GLOBAL (bank aset) tampil untuk semua user di library & picker 3D", async ({ page }) => {
  // Library page: katalog global (paritas `user_assets.is_public`) ikut listing.
  await page.goto("/app/asset-library")
  await expect(page.getByRole("heading", { name: "Asset Library" })).toBeVisible()
  await expect(page.getByText("Sofa Itali 1")).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText("People 1")).toBeVisible()

  // Picker "Tambah dari My Library" di preview 3D juga melihatnya — jalur
  // pemakaian nyata: user mana pun memasang aset katalog ke ruangannya.
  await page.goto("/app/projects/proj-demo-8x8/preview-3d")
  // Fase 6: Kolam/Tangga/Model 3D Kustom melebur jadi satu menu "+ Tambah".
  await page.getByTestId("preview-add-menu").click()
  await page.getByTestId("room-custom-model").click()
  await page.getByRole("button", { name: /Tambah dari My Library/ }).click()
  await expect(page.getByText("Sofa Itali 1")).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText("Jam Dinding 1")).toBeVisible()
})
