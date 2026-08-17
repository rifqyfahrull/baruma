import { test, expect } from "@playwright/test"

const DEMO = "proj-demo-8x8"

test.describe("Design-audit card (proactive standards in editor)", () => {
  test("shows a standards score and hands fixes to the unified AI Agent", async ({ page }) => {
    const errors: string[] = []
    page.on("pageerror", (e) => errors.push(String(e)))
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()) })

    await page.goto(`/app/projects/${DEMO}/editor`)

    // Open the standards/AI tab. The chat itself is hosted once at project layout level.
    await page.getByRole("button", { name: /Cek & AI/ }).click()

    // The proactive "Cek Standar" card renders with a /100 score.
    const card = page.getByText("Cek Standar")
    await expect(card).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(/\/100/).first()).toBeVisible()

    // Expand it to reveal findings (or a "sesuai" state).
    await page.getByRole("button", { name: /Buka detail cek standar/ }).click()

    await page.screenshot({ path: "e2e/artifacts/design-audit-card.png", fullPage: false })

    // If the demo design has an auto-fixable issue, the "Perbaiki semua" button
    // hands the instruction to the assistant input (prefill, user confirms).
    const fixAll = page.getByRole("button", { name: "Perbaiki semua" })
    if (await fixAll.count()) {
      await fixAll.first().click()
      await expect(page.getByTestId("project-agent-panel").getByLabel("Pesan untuk AI Agent"))
        .toHaveValue(/perbaiki semua/i)
    }

    const real = errors.filter((e) => !/favicon|ResizeObserver/i.test(e))
    expect(real, real.join("\n")).toEqual([])
  })
})
