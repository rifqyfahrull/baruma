/**
 * Typed queries for the payment_events table — a pure AUDIT LOG of raw
 * provider webhook events for the future admin backoffice (Task 8). Columns
 * match db/migrations/0001_init.sql:151-159 verbatim (untouched by 0007):
 *   id text primary key             -- dedup key, see below
 *   provider text not null
 *   event_type text not null
 *   signature_ok boolean not null default false
 *   processed boolean not null default false
 *   payload jsonb not null
 *   created_at timestamptz not null default now()
 *
 * CRITICAL (post Task 5 review): this table must NEVER be the idempotency
 * gate for POST /api/webhooks/payment. It used to be keyed by
 * `providerOrderId` alone, on the theory that "a single order only ever
 * transitions paid/failed/expired/cancelled once" — false: Mayar's own
 * "testing" ping (outcome "ignored") can arrive for an order BEFORE the real
 * "paid" event does. Keying by order id alone meant an early "ignored"
 * delivery inserted the row first, so the later genuine "paid" delivery for
 * the SAME order looked like a duplicate and was skipped — activation, plan
 * upgrade and credit grant never ran, silently and permanently (Mayar got its
 * 200 so it never retried).
 *
 * Fix: the caller (the webhook route) now passes `${providerOrderId}:${outcome}`
 * as `id` — a true duplicate DELIVERY of the exact same outcome for the same
 * order still dedupes (returns "duplicate"), but different outcomes for the
 * same order are independent rows that never collide. The real idempotency
 * guard lives in subscriptions.ts (`activateSubscription` / `expireSubscription`,
 * atomic `UPDATE ... WHERE status = ...` guards) — this table is consulted
 * for nothing but audit/history, so a "duplicate" result here must never
 * short-circuit the route.
 *
 * Falls back to a module-level in-memory store when `DATABASE_URL` is absent
 * (dev/test-only — see memory-fallback.ts), mirroring subscriptions.ts.
 */
import { query } from "@/lib/server/db"

import { clone, hasDb } from "./memory-fallback"
import { computePaymentMismatch } from "@/lib/server/billing-reconciliation"
import type { AdminPaymentRow } from "@/types"

export type PaymentEventRow = {
  id: string
  provider: string
  eventType: string
  signatureOk: boolean
  processed: boolean
  payload: unknown
  createdAt: string
}

/** True iff the error is a Postgres unique-violation (duplicate id insert). */
function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code?: unknown }).code === "23505"
  )
}

/* ── in-memory fallback store (dev/test-only) ─────────────────────────────── */

const memEvents = new Map<string, PaymentEventRow>()

/* ── public API ───────────────────────────────────────────────────────────── */

/**
 * Insert a raw webhook event. Returns "duplicate" instead of throwing when
 * `id` already exists (unique-violation in DB mode; already-present key in
 * memory mode) — callers treat a replayed webhook delivery as a silent no-op.
 * Any other DB error is rethrown.
 */
export async function recordPaymentEvent(opts: {
  id: string
  provider: string
  eventType: string
  signatureOk: boolean
  payload: unknown
}): Promise<"inserted" | "duplicate"> {
  if (!hasDb()) {
    if (memEvents.has(opts.id)) return "duplicate"
    memEvents.set(opts.id, {
      id: opts.id,
      provider: opts.provider,
      eventType: opts.eventType,
      signatureOk: opts.signatureOk,
      processed: false,
      payload: clone(opts.payload),
      createdAt: new Date().toISOString(),
    })
    return "inserted"
  }
  try {
    await query(
      `INSERT INTO payment_events (id, provider, event_type, signature_ok, payload)
       VALUES ($1, $2, $3, $4, $5)`,
      [opts.id, opts.provider, opts.eventType, opts.signatureOk, JSON.stringify(opts.payload)]
    )
    return "inserted"
  } catch (e) {
    if (isUniqueViolation(e)) return "duplicate"
    throw e
  }
}

/** Mark a recorded event as processed (its business-logic side effect ran). */
export async function markPaymentEventProcessed(id: string): Promise<void> {
  if (!hasDb()) {
    const row = memEvents.get(id)
    if (row) row.processed = true
    return
  }
  await query(`UPDATE payment_events SET processed = true WHERE id = $1`, [id])
}

/** Row count fetched per source query (events / stale-pending) before merge+limit. */
const RECONCILIATION_FETCH_LIMIT = 200
/** How stale a still-'pending' subscription must be to count as "stuck". */
const STALE_PENDING_HOURS = 1

type RawEventRow = {
  id: string
  provider: string
  event_type: string
  processed: boolean
  created_at: string | Date
  sub_status: string | null
  email: string | null
  plan_name: string | null
  provider_ref: string | null
}

type RawStaleRow = {
  id: string
  provider: string | null
  status: string
  created_at: string | Date
  email: string
  plan_name: string
  provider_ref: string | null
}

function toIsoDate(v: string | Date): string {
  return typeof v === "string" ? v : v.toISOString()
}

/**
 * Admin "Rekonsiliasi pembayaran" listing (Task WS-B): recent payment_events
 * joined with the subscription (matched by extracting the providerOrderId
 * baked into the event id, `${providerOrderId}:${outcome}` — see
 * recordPaymentEvent's caller in webhooks/payment/route.ts) + owner profile
 * + plan, UNIONed with subscriptions stuck 'pending' for over an hour that
 * have no matching 'paid' event at all (those would otherwise never appear
 * — there's no payment_events row for a webhook that never arrived). Each
 * row gets a derived `mismatch` via the pure `computePaymentMismatch`
 * (billing-reconciliation.ts). DB-only (no memory-fallback): reaching this
 * function already required requireAdmin() to resolve a DB-backed admin
 * profile, mirroring profiles.ts's `listProfiles` — an honest empty result
 * in dev/mock mode rather than inventing a parallel in-memory join.
 */
export async function listPaymentReconciliation(): Promise<AdminPaymentRow[]> {
  if (!hasDb()) return []

  const events = await query<RawEventRow>(
    `SELECT pe.id, pe.provider, pe.event_type, pe.processed, pe.created_at,
            s.status AS sub_status, s.provider_ref,
            p.email, pl.name AS plan_name
     FROM payment_events pe
     LEFT JOIN subscriptions s ON s.provider_ref = split_part(pe.id, ':', 1)
     LEFT JOIN profiles p ON p.id = s.profile_id
     LEFT JOIN plans pl ON pl.id = s.plan_id
     ORDER BY pe.created_at DESC
     LIMIT ${RECONCILIATION_FETCH_LIMIT}`
  )

  const stale = await query<RawStaleRow>(
    `SELECT s.id, s.provider AS provider, s.status, s.created_at, s.provider_ref,
            p.email, pl.name AS plan_name
     FROM subscriptions s
     JOIN profiles p ON p.id = s.profile_id
     JOIN plans pl ON pl.id = s.plan_id
     WHERE s.status = 'pending'
       AND s.created_at < now() - interval '${STALE_PENDING_HOURS} hour'
       AND NOT EXISTS (
         SELECT 1 FROM payment_events pe
         WHERE pe.event_type = 'paid' AND split_part(pe.id, ':', 1) = s.provider_ref
       )
     ORDER BY s.created_at DESC
     LIMIT ${RECONCILIATION_FETCH_LIMIT}`
  )

  const eventRows: AdminPaymentRow[] = events.rows.map((r) => {
    const candidate = {
      kind: "event" as const,
      eventType: r.event_type,
      processed: r.processed,
      subscriptionStatus: r.sub_status,
    }
    return {
      id: r.id,
      provider: r.provider,
      eventType: r.event_type,
      processed: r.processed,
      createdAt: toIsoDate(r.created_at),
      email: r.email,
      planName: r.plan_name,
      subscriptionStatus: r.sub_status,
      providerOrderId: r.provider_ref,
      mismatch: computePaymentMismatch(candidate),
    }
  })

  const staleRows: AdminPaymentRow[] = stale.rows.map((r) => {
    const candidate = {
      kind: "pending_stale" as const,
      eventType: null,
      processed: false,
      subscriptionStatus: r.status,
    }
    return {
      id: `sub:${r.id}`,
      provider: r.provider,
      eventType: null,
      processed: false,
      createdAt: toIsoDate(r.created_at),
      email: r.email,
      planName: r.plan_name,
      subscriptionStatus: r.status,
      providerOrderId: r.provider_ref,
      mismatch: computePaymentMismatch(candidate),
    }
  })

  return [...eventRows, ...staleRows].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  )
}
