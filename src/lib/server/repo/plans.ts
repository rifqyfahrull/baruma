/**
 * Typed queries for the plans table (DB-driven pricing).
 * Falls back to a module-level in-memory store seeded from DEFAULT_PLANS when
 * `DATABASE_URL` is absent (dev/test-only — see memory-fallback.ts).
 */
import { query } from "@/lib/server/db"
import type { Entitlements, PlanRow } from "@/types"

import { clone, hasDb } from "./memory-fallback"
import { DEFAULT_PLANS } from "./plan-defaults"

type DbPlanRow = {
  id: string
  name: string
  price_idr: number
  period: string
  tagline: string | null
  featured: boolean
  sort_order: number
  active: boolean
  features: unknown
  limits: unknown
  entitlements: unknown
}

const COLS =
  "id, name, price_idr, period, tagline, featured, sort_order, active, features, limits, entitlements"

/** Unknown/empty entitlements normalize to the most restrictive shape. */
const EMPTY_ENTITLEMENTS: Entitlements = {
  creditsPerPeriod: 0,
  maxProjects: 0,
  exportPdf: false,
  glbUpload: false,
  aiRenderHd: false,
}

function mapStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : []
}

function mapEntitlements(v: unknown): Entitlements {
  const partial = v && typeof v === "object" ? (v as Partial<Entitlements>) : {}
  return { ...EMPTY_ENTITLEMENTS, ...partial }
}

function mapRow(r: DbPlanRow): PlanRow {
  return {
    id: r.id,
    name: r.name,
    priceIdr: r.price_idr,
    period: r.period === "year" ? "year" : "month",
    tagline: r.tagline,
    featured: r.featured,
    sortOrder: r.sort_order,
    active: r.active,
    features: mapStringArray(r.features),
    limits: mapStringArray(r.limits),
    entitlements: mapEntitlements(r.entitlements),
  }
}

/* ── in-memory fallback store (dev/test-only) ─────────────────────────────── */

let memPlans: Map<string, PlanRow> | null = null

function memStore(): Map<string, PlanRow> {
  if (!memPlans) {
    memPlans = new Map(DEFAULT_PLANS.map((p) => [p.id, clone(p)]))
  }
  return memPlans
}

function sortPlans(rows: PlanRow[]): PlanRow[] {
  return rows.sort((a, b) => a.sortOrder - b.sortOrder || a.priceIdr - b.priceIdr)
}

/* ── public API ───────────────────────────────────────────────────────────── */

export async function getPlans(activeOnly = false): Promise<PlanRow[]> {
  if (!hasDb()) {
    const rows = [...memStore().values()].filter((p) => !activeOnly || p.active)
    return sortPlans(rows.map((p) => clone(p)))
  }
  const res = await query<DbPlanRow>(
    `SELECT ${COLS} FROM plans ${activeOnly ? "WHERE active = true" : ""}
     ORDER BY sort_order ASC, price_idr ASC`
  )
  return res.rows.map(mapRow)
}

export async function getPlan(id: string): Promise<PlanRow | null> {
  if (!hasDb()) {
    const row = memStore().get(id)
    return row ? clone(row) : null
  }
  const res = await query<DbPlanRow>(
    `SELECT ${COLS} FROM plans WHERE id = $1`,
    [id]
  )
  return res.rows[0] ? mapRow(res.rows[0]) : null
}

export async function upsertPlan(row: PlanRow): Promise<void> {
  if (!hasDb()) {
    memStore().set(row.id, clone(row))
    return
  }
  await query(
    `INSERT INTO plans (${COLS})
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       price_idr = EXCLUDED.price_idr,
       period = EXCLUDED.period,
       tagline = EXCLUDED.tagline,
       featured = EXCLUDED.featured,
       sort_order = EXCLUDED.sort_order,
       active = EXCLUDED.active,
       features = EXCLUDED.features,
       limits = EXCLUDED.limits,
       entitlements = EXCLUDED.entitlements`,
    [
      row.id,
      row.name,
      row.priceIdr,
      row.period,
      row.tagline,
      row.featured,
      row.sortOrder,
      row.active,
      JSON.stringify(row.features),
      JSON.stringify(row.limits),
      JSON.stringify(row.entitlements),
    ]
  )
}

export async function setPlanActive(id: string, active: boolean): Promise<void> {
  if (!hasDb()) {
    const row = memStore().get(id)
    if (row) row.active = active
    return
  }
  await query(`UPDATE plans SET active = $2 WHERE id = $1`, [id, active])
}
