import { test, expect } from "@playwright/test"

/**
 * Admin backoffice (Task 8) — plans CRUD reflected live on /app/billing, plus
 * a light smoke test for the Transaksi/Users tabs. Deep per-component
 * coverage already lives in unit tests (plans-table.test.tsx,
 * plan-form.test.tsx, transactions-table.test.tsx, users-table.test.tsx);
 * this file only proves the real browser flow wires together end to end.
 *
 * The e2e demo session (demo@baruma.id, see auth.setup.ts) passes the
 * `/app/admin` layout's `isAdminEmail` allowlist check via `ADMIN_EMAILS`
 * (see playwright.config.ts's webServer.env) — its DB/mock `role` column
 * stays "user". That also means the sidebar's own "Admin" nav link (gated on
 * `useCurrentUser().role === "admin"`, which mock mode hardcodes to "user")
 * stays hidden for this session — expected, not a bug — so every test here
 * reaches /app/admin via page.goto directly instead of a sidebar click.
 */

test.describe("Admin backoffice", () => {
  test("admin bisa mengubah harga plan via /app/admin dan tercermin di billing", async ({
    page,
  }) => {
    await page.goto("/app/admin")
    await expect(page).toHaveURL(/\/app\/admin$/)
    await expect(
      page.getByRole("heading", { name: "Admin", level: 1 })
    ).toBeVisible()
    await expect(page.getByRole("tab", { name: "Plans" })).toHaveAttribute(
      "aria-selected",
      "true"
    )

    // Locate the Pro row via its unique Edit button rather than raw "Pro"
    // text — the "Populer" badge sits in the same cell and a plain text
    // filter would still work, but this stays unambiguous regardless.
    const editPro = page.getByRole("button", { name: "Edit plan Pro" })
    const proRow = page.getByRole("row").filter({ has: editPro })
    await expect(proRow).toContainText("Rp 149rb") // DEFAULT_PLANS seed price

    await editPro.click()
    const dialog = page.getByRole("dialog", { name: "Edit plan Pro" })
    await expect(dialog).toBeVisible()

    await dialog.getByLabel("Harga plan dalam rupiah").fill("199000")
    await dialog.getByRole("button", { name: "Simpan" }).click()

    await expect(dialog).toBeHidden()
    await expect(proRow).toContainText("Rp 199rb")

    // Reach /app/billing via the sidebar's real SPA link ("Upgrade",
    // credits-indicator.tsx) rather than page.goto. The mock plans store
    // (src/lib/mock/index.ts's `db.plans`) lives in browser JS module memory
    // scoped to this page load — a full navigation/reload re-seeds it from
    // DEFAULT_PLANS and would silently discard the edit above.
    await page.getByRole("link", { name: "Upgrade", exact: true }).click()
    await page.waitForURL("**/app/billing")
    await expect(
      page.getByRole("heading", { name: "Billing & paket" })
    ).toBeVisible()

    const proCard = page
      .locator('[data-slot="card"]')
      .filter({ has: page.getByRole("heading", { name: "Pro", level: 3 }) })
    await expect(proCard).toContainText("Rp 199rb")
  })

  test("Transaksi dan Users tab admin bisa dibuka", async ({ page }) => {
    await page.goto("/app/admin")
    await expect(
      page.getByRole("heading", { name: "Admin", level: 1 })
    ).toBeVisible()

    await page.getByRole("tab", { name: "Transaksi" }).click()
    await expect(page.getByText("Belum ada transaksi.")).toBeVisible()

    await page.getByRole("tab", { name: "Users" }).click()
    // Mock mode's only "profile" row is the demo/mock user itself (seedUser,
    // budi@contoh.id) — a separate identity from the e2e login session email
    // (demo@baruma.id); see mock/index.ts's getAdminUsers(). Scope through
    // the role combobox rather than raw email text since that same email
    // also renders in the sidebar's UserMenu.
    const roleSelect = page.getByRole("combobox", {
      name: "Ubah role untuk Budi Santoso",
    })
    await expect(roleSelect).toBeVisible()
    const userRow = page.getByRole("row").filter({ has: roleSelect })
    await expect(userRow).toContainText("budi@contoh.id")
  })
})
