/**
 * Credit accounting: atomic spend/refund/grant against profiles.credits_* plus
 * an append-only credits_ledger trail (columns: id, profile_id, delta, reason,
 * ref, created_at — see db/migrations/0001_init.sql).
 *
 * In DB mode, every balance UPDATE + ledger INSERT pair runs inside a single
 * BEGIN/COMMIT transaction (pattern: alternatives.ts) so the two are atomic —
 * a mid-flight crash never leaves a committed balance change with no ledger
 * row to explain it, and a failed ledger insert never leaves the caller
 * believing the whole operation failed after the balance already committed.
 *
 * When `DATABASE_URL` is absent the balances live in a tiny in-memory map
 * seeded lazily at { used: 0, total: 10 } per profile. Memory mode is
 * dev/test-only (per-process, non-durable, no ledger, no transaction concept
 * needed — it's synchronous and race-free by construction) — the profiles
 * source of truth is the DB; local dev uses the mock client data source
 * instead.
 */
import type { PoolClient } from "pg"

import { query, getClient } from "@/lib/server/db"

import { hasDb } from "./memory-fallback"

/* ── in-memory fallback store (dev/test-only) ─────────────────────────────── */

const memCredits = new Map<string, { used: number; total: number }>()
const memCreditOps = new Set<string>()

function memAccount(profileId: string): { used: number; total: number } {
  let acc = memCredits.get(profileId)
  if (!acc) {
    acc = { used: 0, total: 10 }
    memCredits.set(profileId, acc)
  }
  return acc
}

/**
 * Append a credits_ledger row. Always called with the same `client` that ran
 * the paired balance UPDATE, inside that transaction — never standalone in DB
 * mode, so the balance change and its ledger explanation commit as one unit.
 */
async function insertLedger(
  client: PoolClient,
  profileId: string,
  delta: number,
  reason: string,
  refId?: string
): Promise<void> {
  await client.query(
    `INSERT INTO credits_ledger (profile_id, delta, reason, ref)
     VALUES ($1, $2, $3, $4)`,
    [profileId, delta, reason, refId ?? null]
  )
}

/* ── public API ───────────────────────────────────────────────────────────── */

/**
 * Atomically spend `n` credits. Single conditional UPDATE — concurrent spends
 * can never push usage past the total. Ledger entry (delta -n) on success.
 */
export async function spendCredits(
  profileId: string,
  n: number,
  reason: string,
  refId?: string
): Promise<"ok" | "insufficient"> {
  if (!hasDb()) {
    const acc = memAccount(profileId)
    if (acc.used + n > acc.total) return "insufficient"
    acc.used += n
    return "ok"
  }
  const client = await getClient()
  try {
    await client.query("BEGIN")
    const res = await client.query<{ id: string }>(
      `UPDATE profiles SET credits_used = credits_used + $2
       WHERE id = $1 AND credits_used + $2 <= credits_total
       RETURNING id`,
      [profileId, n]
    )
    if ((res.rowCount ?? 0) === 0) {
      // Nothing changed — commit the no-op (not a failure, so not a ROLLBACK)
      // and skip the ledger insert entirely; there's nothing to explain.
      await client.query("COMMIT")
      return "insufficient"
    }
    await insertLedger(client, profileId, -n, reason, refId)
    await client.query("COMMIT")
    return "ok"
  } catch (err) {
    await client.query("ROLLBACK")
    throw err
  } finally {
    client.release()
  }
}

/**
 * Spend once for a retryable request. `refId` is a client-generated request id
 * protected by a partial unique ledger index — migration 0016 for
 * `project_agent`, migration 0038 for `ai_render` (setiap reason baru wajib
 * index parsialnya sendiri, lihat komentar di 0038_ai_renders.sql).
 */
export async function spendCreditsOnce(
  profileId: string,
  n: number,
  reason: "project_agent" | "ai_render",
  refId: string
): Promise<"ok" | "insufficient" | "already_spent"> {
  const opKey = `${profileId}:${reason}:${refId}`
  if (!hasDb()) {
    if (memCreditOps.has(opKey)) return "already_spent"
    const acc = memAccount(profileId)
    if (acc.used + n > acc.total) return "insufficient"
    acc.used += n
    memCreditOps.add(opKey)
    return "ok"
  }

  const client = await getClient()
  try {
    await client.query("BEGIN")
    const ledger = await client.query<{ id: string }>(
      `INSERT INTO credits_ledger (profile_id, delta, reason, ref)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING RETURNING id`,
      [profileId, -n, reason, refId]
    )
    if ((ledger.rowCount ?? 0) === 0) {
      await client.query("COMMIT")
      return "already_spent"
    }
    const balance = await client.query<{ id: string }>(
      `UPDATE profiles SET credits_used = credits_used + $2
       WHERE id = $1 AND credits_used + $2 <= credits_total
       RETURNING id`,
      [profileId, n]
    )
    if ((balance.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK")
      return "insufficient"
    }
    await client.query("COMMIT")
    return "ok"
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
}

/** Give back `n` credits (e.g. LLM call failed after a reserve). Clamps at 0. */
export async function refundCredits(
  profileId: string,
  n: number,
  reason: string,
  refId?: string
): Promise<void> {
  if (!hasDb()) {
    const acc = memAccount(profileId)
    acc.used = Math.max(0, acc.used - n)
    return
  }
  const client = await getClient()
  try {
    await client.query("BEGIN")
    await client.query(
      `UPDATE profiles SET credits_used = GREATEST(0, credits_used - $2)
       WHERE id = $1`,
      [profileId, n]
    )
    await insertLedger(client, profileId, n, reason, refId)
    await client.query("COMMIT")
  } catch (err) {
    await client.query("ROLLBACK")
    throw err
  } finally {
    client.release()
  }
}

/** Idempotent counterpart of spendCreditsOnce. */
export async function refundCreditsOnce(
  profileId: string,
  n: number,
  reason: "project_agent_refund" | "ai_render_refund",
  refId: string
): Promise<"ok" | "already_refunded"> {
  const opKey = `${profileId}:${reason}:${refId}`
  if (!hasDb()) {
    if (memCreditOps.has(opKey)) return "already_refunded"
    const acc = memAccount(profileId)
    acc.used = Math.max(0, acc.used - n)
    memCreditOps.add(opKey)
    return "ok"
  }

  const client = await getClient()
  try {
    await client.query("BEGIN")
    const ledger = await client.query<{ id: string }>(
      `INSERT INTO credits_ledger (profile_id, delta, reason, ref)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING RETURNING id`,
      [profileId, n, reason, refId]
    )
    if ((ledger.rowCount ?? 0) === 0) {
      await client.query("COMMIT")
      return "already_refunded"
    }
    await client.query(
      `UPDATE profiles SET credits_used = GREATEST(0, credits_used - $2)
       WHERE id = $1`,
      [profileId, n]
    )
    await client.query("COMMIT")
    return "ok"
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
}

/** New billing period: reset usage to 0 and set the period's total. */
export async function grantPeriodCredits(
  profileId: string,
  total: number,
  reason: string
): Promise<void> {
  if (!hasDb()) {
    const acc = memAccount(profileId)
    acc.total = total
    acc.used = 0
    return
  }
  const client = await getClient()
  try {
    await client.query("BEGIN")
    await client.query(
      `UPDATE profiles SET credits_total = $2, credits_used = 0 WHERE id = $1`,
      [profileId, total]
    )
    await insertLedger(client, profileId, total, reason)
    await client.query("COMMIT")
  } catch (err) {
    await client.query("ROLLBACK")
    throw err
  } finally {
    client.release()
  }
}

/**
 * Admin adjustment: credits_total += deltaTotal, clamped ≥ credits_used.
 *
 * `reason` is the machine-category ledger tag (expected to always be the
 * fixed string `"admin_adjust"` — see
 * src/app/api/v1/admin/users/credits/route.ts). An admin's free-text note
 * belongs in `refId` instead, mirroring how `spendCredits`/`refundCredits`
 * already accept a `refId` (there, a project id; here, the admin's note) —
 * `credits_ledger.reason` stays filterable by category regardless of what an
 * admin types in the note field.
 */
export async function adjustCredits(
  profileId: string,
  deltaTotal: number,
  reason: string,
  refId?: string
): Promise<void> {
  if (!hasDb()) {
    const acc = memAccount(profileId)
    acc.total = Math.max(acc.used, acc.total + deltaTotal)
    return
  }
  const client = await getClient()
  try {
    await client.query("BEGIN")
    await client.query(
      `UPDATE profiles SET credits_total = GREATEST(credits_used, credits_total + $2)
       WHERE id = $1`,
      [profileId, deltaTotal]
    )
    await insertLedger(client, profileId, deltaTotal, reason, refId)
    await client.query("COMMIT")
  } catch (err) {
    await client.query("ROLLBACK")
    throw err
  } finally {
    client.release()
  }
}

/** Current balance; null when the profile does not exist (DB mode only). */
export async function getCredits(
  profileId: string
): Promise<{ used: number; total: number } | null> {
  if (!hasDb()) {
    return { ...memAccount(profileId) }
  }
  const res = await query<{ credits_used: number; credits_total: number }>(
    `SELECT credits_used, credits_total FROM profiles WHERE id = $1`,
    [profileId]
  )
  const row = res.rows[0]
  return row ? { used: row.credits_used, total: row.credits_total } : null
}
