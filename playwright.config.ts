import { defineConfig, devices } from "@playwright/test"

const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 3100)
const baseURL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 12_000 },
  reporter: [["list"]],
  use: {
    baseURL,
    headless: true,
    actionTimeout: 15_000,
    navigationTimeout: 60_000,
    trace: "on-first-retry",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/user.json",
      },
      dependencies: ["setup"],
      testIgnore: /auth\.setup\.ts/,
    },
  ],
  webServer: {
    command: `pnpm exec next dev --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
    // Test-only bootstrap admin: the mock/demo user (demo@baruma.id) needs
    // to pass isAdminEmail's ADMIN_EMAILS allowlist check so e2e can
    // exercise /app/admin (the demo profile's `role` column stays "user" —
    // this only satisfies the layout's allowlist fallback, mirroring how a
    // real production bootstrap admin would be configured).
    //
    // Supabase is deliberately forced OFF here (empty keys): the shared project
    // enforces captcha on password login, which a headless browser can't solve.
    // With Supabase unconfigured, the middleware leaves /app open and the login
    // page's demo button just navigates (see supabaseBrowserConfigured()), so
    // e2e stays hermetic/mock — exactly as it did under the old demo auth.
    env: {
      ADMIN_EMAILS: "demo@baruma.id",
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: "",
    },
  },
})
