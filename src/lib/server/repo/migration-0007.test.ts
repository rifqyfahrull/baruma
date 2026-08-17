// @vitest-environment node
/**
 * Cheap sanity check on db/migrations/0007_billing_admin.sql (guards typos —
 * no DB): every new column, the seeded plan ids/entitlement keys, and the
 * widened provider/status CHECKs must be mentioned in the file.
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { describe, it, expect } from "vitest"

const sql = readFileSync(
  fileURLToPath(
    new URL("../../../../db/migrations/0007_billing_admin.sql", import.meta.url)
  ),
  "utf8"
)

describe("0007_billing_admin.sql sanity", () => {
  it.each([
    // profiles
    "ALTER TABLE profiles ADD COLUMN IF NOT EXISTS role",
    "ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone",
    "profiles_role_check",
    // plans columns
    "ADD COLUMN IF NOT EXISTS tagline",
    "ADD COLUMN IF NOT EXISTS featured",
    "ADD COLUMN IF NOT EXISTS sort_order",
    "ADD COLUMN IF NOT EXISTS active",
    "ADD COLUMN IF NOT EXISTS limits",
    "ADD COLUMN IF NOT EXISTS entitlements",
    // seeded plans + fixed entitlement keys
    "WHERE id = 'free' AND tagline IS NULL",
    "WHERE id = 'pro' AND tagline IS NULL",
    "WHERE id = 'studio' AND tagline IS NULL",
    "creditsPerPeriod",
    "maxProjects",
    "exportPdf",
    "glbUpload",
    // subscriptions CHECK swaps
    "subscriptions_provider_check",
    "'mayar'",
    "subscriptions_status_check",
    "'pending'",
    "'expired'",
  ])("mentions %s", (needle) => {
    expect(sql).toContain(needle)
  })

  it("guards every plans UPDATE so admin edits are never clobbered", () => {
    const updates = sql.match(/UPDATE plans SET/g) ?? []
    const guards = sql.match(/AND tagline IS NULL/g) ?? []
    expect(updates).toHaveLength(3)
    expect(guards).toHaveLength(3)
  })
})
