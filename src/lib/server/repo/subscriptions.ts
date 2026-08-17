/**
 * Typed queries for the subscriptions table (Mayar manual-renew billing).
 * Falls back to a module-level in-memory store when `DATABASE_URL` is absent
 * (dev/test-only — see memory-fallback.ts).
 */
import { query } from "@/lib/server/db"

import { clone, hasDb } from "./memory-fallback"
import { getPlan } from "./plans"

export type SubscriptionStatus =
  | "pending"
  | "active"
  | "past_due"
  | "canceled"
  | "incomplete"
  | "expired"

export type SubRow = {
  id: string
  profileId: string
  planId: string
  status: SubscriptionStatus
  provider: string | null
  providerRef: string | null
  currentPeriodEnd: string | null
  createdAt: string
  updatedAt: string
}

type DbSubRow = {
  id: string
  profile_id: string
  plan_id: string
  status: string
  provider: string | null
  provider_ref: string | null
  current_period_end: string | Date | null
  created_at: string | Date
  updated_at: string | Date
}

const COLS =
  "id, profile_id, plan_id, status, provider, provider_ref, current_period_end, created_at, updated_at"

function toIso(v: string | Date | null): string | null {
  if (v === null) return null
  return typeof v === "string" ? v : v.toISOString()
}

function mapRow(r: DbSubRow): SubRow {
  return {
    id: r.id,
    profileId: r.profile_id,
    planId: r.plan_id,
    status: r.status as SubscriptionStatus,
    provider: r.provider,
    providerRef: r.provider_ref,
    currentPeriodEnd: toIso(r.current_period_end),
    createdAt: toIso(r.created_at) as string,
    updatedAt: toIso(r.updated_at) as string,
  }
}

/* ── in-memory fallback store (dev/test-only) ─────────────────────────────── */

/** Insertion-ordered; "latest" in memory mode = last inserted. */
const memSubs: SubRow[] = []

/* ── public API ───────────────────────────────────────────────────────────── */

export async function createPendingSubscription(opts: {
  profileId: string
  planId: string
  provider: string
  providerRef: string
}): Promise<{ id: string }> {
  if (!hasDb()) {
    const now = new Date().toISOString()
    const row: SubRow = {
      id: `sub-${crypto.randomUUID()}`,
      profileId: opts.profileId,
      planId: opts.planId,
      status: "pending",
      provider: opts.provider,
      providerRef: opts.providerRef,
      currentPeriodEnd: null,
      createdAt: now,
      updatedAt: now,
    }
    memSubs.push(row)
    return { id: row.id }
  }
  const res = await query<{ id: string }>(
    `INSERT INTO subscriptions (profile_id, plan_id, status, provider, provider_ref)
     VALUES ($1, $2, 'pending', $3, $4)
     RETURNING id`,
    [opts.profileId, opts.planId, opts.provider, opts.providerRef]
  )
  return { id: res.rows[0].id }
}

export async function getSubscriptionByProviderRef(
  ref: string
): Promise<SubRow | null> {
  if (!hasDb()) {
    const row = memSubs.find((s) => s.providerRef === ref)
    return row ? clone(row) : null
  }
  const res = await query<DbSubRow>(
    `SELECT ${COLS} FROM subscriptions WHERE provider_ref = $1`,
    [ref]
  )
  return res.rows[0] ? mapRow(res.rows[0]) : null
}

/**
 * Mark the subscription paid: status 'active' + period end. This IS the
 * atomic idempotency guard for the whole billing flow (see
 * src/app/api/webhooks/payment/route.ts) — it only flips a row that is
 * currently 'pending', mirroring the parent tampil.dev app's
 * `UPDATE ... WHERE status = 'pending'` pattern. Returns null when the ref is
 * unknown OR the row is no longer 'pending' (already active/expired/etc), so
 * callers can tell "this call just activated it" (a row comes back) apart
 * from "already processed elsewhere, no-op" (null) without a separate,
 * racy read-then-write status check.
 */
export async function activateSubscription(opts: {
  providerRef: string
  currentPeriodEnd: string
}): Promise<SubRow | null> {
  if (!hasDb()) {
    const row = memSubs.find((s) => s.providerRef === opts.providerRef)
    if (!row || row.status !== "pending") return null
    row.status = "active"
    row.currentPeriodEnd = opts.currentPeriodEnd
    row.updatedAt = new Date().toISOString()
    return clone(row)
  }
  const res = await query<DbSubRow>(
    `UPDATE subscriptions SET status = 'active', current_period_end = $2
     WHERE provider_ref = $1 AND status = 'pending'
     RETURNING ${COLS}`,
    [opts.providerRef, opts.currentPeriodEnd]
  )
  return res.rows[0] ? mapRow(res.rows[0]) : null
}

/**
 * Supersede any OTHER 'active' subscription the profile still has, keeping
 * only `exceptId` active. Baruma's billing has no proration (accepted spec
 * non-goal): an early renewal creates a brand-new pending→active row rather
 * than mutating the old one, so without this a profile could end up with two
 * 'active' rows after renewing early — this keeps `getActiveSubscription`
 * and the admin listing (Task 8) honest. Safe to call unconditionally; a
 * no-op when there is nothing else active.
 */
export async function expireOtherActiveSubscriptions(
  profileId: string,
  exceptId: string
): Promise<void> {
  if (!hasDb()) {
    const now = new Date().toISOString()
    for (const s of memSubs) {
      if (s.profileId === profileId && s.status === "active" && s.id !== exceptId) {
        s.status = "expired"
        s.updatedAt = now
      }
    }
    return
  }
  await query(
    `UPDATE subscriptions SET status = 'expired'
     WHERE profile_id = $1 AND status = 'active' AND id != $2`,
    [profileId, exceptId]
  )
}

/** Latest active subscription for a profile, or null. */
export async function getActiveSubscription(
  profileId: string
): Promise<SubRow | null> {
  if (!hasDb()) {
    for (let i = memSubs.length - 1; i >= 0; i--) {
      const s = memSubs[i]
      if (s.profileId === profileId && s.status === "active") return clone(s)
    }
    return null
  }
  const res = await query<DbSubRow>(
    `SELECT ${COLS} FROM subscriptions
     WHERE profile_id = $1 AND status = 'active'
     ORDER BY created_at DESC
     LIMIT 1`,
    [profileId]
  )
  return res.rows[0] ? mapRow(res.rows[0]) : null
}

/**
 * Retire a subscription. Atomic idempotency guard — only flips a row that is
 * currently 'active', so repeat/concurrent callers (e.g. a duplicate webhook
 * delivery, or two racing lazy-expiry reads in GET /api/v1/me) are safe: at
 * most one caller ever sees `true`. Returns whether THIS call actually
 * changed a row, so callers can gate their own once-only side effects on it.
 */
export async function expireSubscription(id: string): Promise<boolean> {
  if (!hasDb()) {
    const row = memSubs.find((s) => s.id === id)
    if (!row || row.status !== "active") return false
    row.status = "expired"
    row.updatedAt = new Date().toISOString()
    return true
  }
  const res = await query(
    `UPDATE subscriptions SET status = 'expired' WHERE id = $1 AND status = 'active'`,
    [id]
  )
  return (res.rowCount ?? 0) > 0
}

/** Admin listing: every subscription joined with profile email + plan name. */
export async function listSubscriptionsAdmin(): Promise<
  Array<SubRow & { email: string; planName: string }>
> {
  if (!hasDb()) {
    // Memory mode has no profiles store — surface profileId as the email
    // placeholder (dev/test-only listing).
    const out: Array<SubRow & { email: string; planName: string }> = []
    for (let i = memSubs.length - 1; i >= 0; i--) {
      const s = memSubs[i]
      const plan = await getPlan(s.planId)
      out.push({ ...clone(s), email: s.profileId, planName: plan?.name ?? s.planId })
    }
    return out
  }
  const res = await query<DbSubRow & { email: string; plan_name: string }>(
    `SELECT s.id, s.profile_id, s.plan_id, s.status, s.provider, s.provider_ref,
            s.current_period_end, s.created_at, s.updated_at,
            p.email, pl.name AS plan_name
     FROM subscriptions s
     JOIN profiles p ON p.id = s.profile_id
     JOIN plans pl ON pl.id = s.plan_id
     ORDER BY s.created_at DESC`
  )
  return res.rows.map((r) => ({
    ...mapRow(r),
    email: r.email,
    planName: r.plan_name,
  }))
}
