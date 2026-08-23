#!/usr/bin/env node
/**
 * Daily maintenance cron trigger — POSTs to this app's own
 * /api/internal/maintenance (expiry sweep + renewal reminders, see
 * src/app/api/internal/maintenance/route.ts) with the MAINTENANCE_SECRET
 * header. Dipanggil oleh cron di droplet (dipasang oleh deploy.yml) —
 * 00:00 UTC setiap hari.
 *
 * Loads MAINTENANCE_SECRET from .env.local itself (same idiom as
 * scripts/backup-db.mjs / scripts/sync-catalog-models.mjs) so the crontab
 * line stays secret-free — `crontab -l` never leaks it.
 *
 * Usage: node scripts/run-maintenance-cron.mjs
 */
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..")

loadEnvFile(path.join(repoRoot, ".env"))
loadEnvFile(path.join(repoRoot, ".env.local"))

function loadEnvFile(file) {
  if (!existsSync(file)) return
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const idx = trimmed.indexOf("=")
    if (idx <= 0) continue
    const key = trimmed.slice(0, idx).trim()
    let value = trimmed.slice(idx + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}

async function main() {
  const secret = process.env.MAINTENANCE_SECRET
  if (!secret) {
    console.error("[maintenance-cron] MAINTENANCE_SECRET is not set — skipping")
    process.exit(0) // Not configured yet = not an error worth failing the cron job over.
  }

  // Local loopback, mirroring deploy.yml's smoke test — this always runs on
  // the same droplet as the app (pm2, port 3000).
  const res = await fetch("http://127.0.0.1:3000/api/internal/maintenance", {
    method: "POST",
    headers: { "x-maintenance-secret": secret },
    signal: AbortSignal.timeout(60_000),
  })
  const body = await res.text()
  console.log(`[maintenance-cron] ${res.status} ${body}`)
  if (!res.ok) process.exit(1)
}

main().catch((e) => {
  console.error("[maintenance-cron] failed:", e)
  process.exit(1)
})
