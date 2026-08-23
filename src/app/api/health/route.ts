import { query } from "@/lib/server/db"
import { storageEnabled } from "@/lib/server/storage"
import { isParentBillingConfigured } from "@/lib/billing/providers/parent"

/**
 * Health endpoint — dipakai smoke test deploy (.github/workflows/deploy.yml)
 * dan siap dipasang ke pemantau uptime eksternal (mis. UptimeRobot, lihat
 * docs/runbook-rotasi-kredensial.md untuk cara pasangnya).
 *
 * TANPA AUTH dengan sengaja: tidak membocorkan data apa pun, hanya status
 * boolean tiga dependensi + versi build + uptime proses. Aman diakses publik.
 *
 * `ok` keseluruhan HANYA bergantung pada DB — storage & billing dilaporkan
 * tapi non-fatal (Baruma tetap bisa melayani baca/tulis project tanpa
 * storage/billing terkonfigurasi, mis. di dev/staging).
 */

// DB check dibatasi waktu pendek agar endpoint ini sendiri tidak pernah
// menggantung lama saat DB bermasalah (mis. tailnet putus) — smoke test
// deploy & uptime monitor butuh jawaban cepat, bukan menunggu statement_timeout
// pool (15s).
const DB_CHECK_TIMEOUT_MS = 3_000

async function checkDb(): Promise<boolean> {
  try {
    await Promise.race([
      query("select 1"),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("db check timeout")), DB_CHECK_TIMEOUT_MS)
      ),
    ])
    return true
  } catch (e) {
    console.error("[health] db check failed:", e instanceof Error ? e.message : e)
    return false
  }
}

export async function GET(): Promise<Response> {
  const [db, storage, billing] = await Promise.all([
    checkDb(),
    Promise.resolve(storageEnabled()),
    Promise.resolve(isParentBillingConfigured()),
  ])

  const ok = db
  const body = {
    ok,
    checks: { db, storage, billing },
    version: process.env.GIT_SHA ?? "dev",
    uptime: process.uptime(),
  }

  return Response.json(body, { status: ok ? 200 : 503 })
}
