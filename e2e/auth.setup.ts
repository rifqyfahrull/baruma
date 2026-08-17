import { test as setup } from "@playwright/test"

const authFile = "e2e/.auth/user.json"

// Logs in once (demo credentials) and saves the session so the other specs run
// authenticated against the middleware-protected /app routes.
setup("authenticate", async ({ page }) => {
  await page.goto("/login")
  await page.getByRole("button", { name: "Lanjut sebagai demo" }).click()
  await page.waitForURL("**/app/dashboard")
  await page.context().storageState({ path: authFile })
})
