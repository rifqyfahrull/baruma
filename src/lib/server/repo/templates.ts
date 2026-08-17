/**
 * Typed queries for the templates table (curated, publicly browsable list of
 * ready-made designs snapshotted from showcase projects — see
 * db/migrations/0036_templates.sql + 0037_seed_templates.sql).
 * Falls back to a module-level in-memory store (empty by default) when
 * `DATABASE_URL` is absent (dev/test-only — see memory-fallback.ts).
 */
import { query } from "@/lib/server/db"
import type { Brief, DesignLayout, HouseStyle, Site, ThumbnailVariant } from "@/types"
import type { SavedInterior } from "@/lib/schemas/interior"
import type { TemplateDetail, TemplateSummary } from "@/types/templates"

import { clone, hasDb } from "./memory-fallback"

/** Thrown by createTemplateFromProject/resyncTemplateFromSource when the
 * source project (or its design layout) can't be found — routes translate
 * this to a 404. */
export class TemplateSourceNotFoundError extends Error {
  constructor(message = "Source project not found") {
    super(message)
    this.name = "TemplateSourceNotFoundError"
  }
}

type DbTemplateSummaryRow = {
  id: string
  slug: string
  name: string
  description: string | null
  style: string | null
  city: string | null
  province: string | null
  floors: number
  rooftop: boolean
  thumbnail: string
  site: Site
  source_project_id: string | null
  sort_order: number
  active: boolean
  created_at: string | Date
  updated_at: string | Date
}

type DbTemplateDetailRow = DbTemplateSummaryRow & {
  layout: DesignLayout
  brief: Brief | null
  interior: SavedInterior | null
}

/** Row shape of the join query against projects/design_layouts/briefs/project_interiors. */
type SourceRow = {
  name: string
  style: string | null
  city: string | null
  province: string | null
  floors: number
  rooftop: boolean
  thumbnail: string
  site: Site
  layout: DesignLayout
  brief: Brief | null
  interior: SavedInterior | null
}

const SUMMARY_COLS =
  "id, slug, name, description, style, city, province, floors, rooftop, thumbnail, site, source_project_id, sort_order, active, created_at, updated_at"
const DETAIL_COLS = `${SUMMARY_COLS}, layout, brief, interior`

function toIso(v: string | Date): string {
  return typeof v === "string" ? v : v.toISOString()
}

function mapSummaryRow(r: DbTemplateSummaryRow): TemplateSummary {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    style: (r.style ?? undefined) as HouseStyle | undefined,
    city: r.city ?? undefined,
    province: r.province ?? undefined,
    floors: r.floors,
    rooftop: r.rooftop,
    thumbnail: r.thumbnail as ThumbnailVariant,
    site: r.site,
    sortOrder: r.sort_order,
    active: r.active,
    sourceProjectId: r.source_project_id,
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
  }
}

function mapDetailRow(r: DbTemplateDetailRow): TemplateDetail {
  return {
    ...mapSummaryRow(r),
    layout: r.layout,
    brief: r.brief ?? null,
    interior: r.interior ?? null,
  }
}

/** Query used by both createTemplateFromProject and resyncTemplateFromSource. */
async function fetchSourceProject(projectId: string): Promise<SourceRow | null> {
  const res = await query<SourceRow>(
    `SELECT p.name, p.style, p.city, p.province, p.floors, p.rooftop, p.thumbnail, p.site,
            dl.payload AS layout, b.payload AS brief, pi.payload AS interior
     FROM projects p
     JOIN design_layouts dl ON dl.project_id = p.id
     LEFT JOIN briefs b ON b.project_id = p.id
     LEFT JOIN project_interiors pi ON pi.project_id = p.id
     WHERE p.id = $1`,
    [projectId]
  )
  return res.rows[0] ?? null
}

function briefSummary(brief: Brief | null): string | null {
  if (!brief || typeof brief !== "object") return null
  const summary = (brief as { summary?: unknown }).summary
  return typeof summary === "string" ? summary : null
}

/* ── in-memory fallback store (dev/test-only) ─────────────────────────────── */

/** Empty by default — templates only exist via seed migration / admin create. */
let memTemplates: Map<string, TemplateDetail> | null = null

function memStore(): Map<string, TemplateDetail> {
  if (!memTemplates) memTemplates = new Map()
  return memTemplates
}

function toSummary(row: TemplateDetail): TemplateSummary {
  const { layout: _layout, brief: _brief, interior: _interior, ...summary } = row
  return summary
}

function sortTemplates<T extends TemplateSummary>(rows: T[]): T[] {
  return rows.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
}

/**
 * Test/dev-only: directly seed (or overwrite) a row in the in-memory fallback
 * store. There is no in-memory equivalent of `projects`/`design_layouts`, so
 * `createTemplateFromProject` cannot run in memory mode — tests that need a
 * pre-existing template use this instead.
 */
export function seedTemplateForFallback(row: TemplateDetail): void {
  memStore().set(row.id, clone(row))
}

/** Test/dev-only: clear the in-memory fallback store. */
export function clearTemplatesFallback(): void {
  memStore().clear()
}

/* ── public API ───────────────────────────────────────────────────────────── */

export async function listTemplates(activeOnly: boolean): Promise<TemplateSummary[]> {
  if (!hasDb()) {
    const rows = [...memStore().values()]
      .filter((r) => !activeOnly || r.active)
      .map((r) => clone(toSummary(r)))
    return sortTemplates(rows)
  }
  const res = await query<DbTemplateSummaryRow>(
    `SELECT ${SUMMARY_COLS} FROM templates ${activeOnly ? "WHERE active = true" : ""}
     ORDER BY sort_order ASC, name ASC`
  )
  return sortTemplates(res.rows.map(mapSummaryRow))
}

export async function getTemplateBySlug(
  slug: string,
  opts?: { activeOnly?: boolean }
): Promise<TemplateDetail | null> {
  const activeOnly = opts?.activeOnly ?? false
  if (!hasDb()) {
    const row = [...memStore().values()].find((r) => r.slug === slug)
    if (!row || (activeOnly && !row.active)) return null
    return clone(row)
  }
  const res = await query<DbTemplateDetailRow>(
    `SELECT ${DETAIL_COLS} FROM templates WHERE slug = $1 ${activeOnly ? "AND active = true" : ""}`,
    [slug]
  )
  return res.rows[0] ? mapDetailRow(res.rows[0]) : null
}

export async function createTemplateFromProject(
  projectId: string,
  meta: {
    id?: string
    slug: string
    name?: string
    description?: string
    sortOrder?: number
  }
): Promise<TemplateDetail> {
  if (!hasDb()) {
    // No in-memory projects/design_layouts store to snapshot from.
    throw new TemplateSourceNotFoundError(`Project not found: ${projectId}`)
  }
  const src = await fetchSourceProject(projectId)
  if (!src) {
    throw new TemplateSourceNotFoundError(
      `Project or its design layout not found: ${projectId}`
    )
  }

  const id = meta.id ?? `tpl-${meta.slug}`
  const name = meta.name ?? src.name
  const description = meta.description ?? briefSummary(src.brief)
  const sortOrder = meta.sortOrder ?? 0

  const res = await query<DbTemplateDetailRow>(
    `INSERT INTO templates
       (id, slug, name, description, style, city, province, floors, rooftop,
        thumbnail, site, layout, brief, interior, source_project_id, sort_order, active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,true)
     ON CONFLICT (id) DO UPDATE SET
       slug = EXCLUDED.slug,
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       style = EXCLUDED.style,
       city = EXCLUDED.city,
       province = EXCLUDED.province,
       floors = EXCLUDED.floors,
       rooftop = EXCLUDED.rooftop,
       thumbnail = EXCLUDED.thumbnail,
       site = EXCLUDED.site,
       layout = EXCLUDED.layout,
       brief = EXCLUDED.brief,
       interior = EXCLUDED.interior,
       source_project_id = EXCLUDED.source_project_id,
       sort_order = EXCLUDED.sort_order,
       active = true,
       updated_at = now()
     RETURNING ${DETAIL_COLS}`,
    [
      id,
      meta.slug,
      name,
      description,
      src.style,
      src.city,
      src.province,
      src.floors,
      src.rooftop,
      src.thumbnail,
      JSON.stringify(src.site),
      JSON.stringify(src.layout),
      src.brief ? JSON.stringify(src.brief) : null,
      src.interior ? JSON.stringify(src.interior) : null,
      projectId,
      sortOrder,
    ]
  )
  return mapDetailRow(res.rows[0])
}

export async function updateTemplateMeta(
  id: string,
  patch: {
    name?: string
    slug?: string
    description?: string | null
    sortOrder?: number
    active?: boolean
  }
): Promise<TemplateSummary | null> {
  if (!hasDb()) {
    const row = memStore().get(id)
    if (!row) return null
    if (patch.name !== undefined) row.name = patch.name
    if (patch.slug !== undefined) row.slug = patch.slug
    if (patch.description !== undefined) row.description = patch.description
    if (patch.sortOrder !== undefined) row.sortOrder = patch.sortOrder
    if (patch.active !== undefined) row.active = patch.active
    row.updatedAt = new Date().toISOString()
    return clone(toSummary(row))
  }

  const setClauses: string[] = []
  const values: unknown[] = []
  let idx = 1
  if (patch.name !== undefined) {
    setClauses.push(`name = $${idx++}`)
    values.push(patch.name)
  }
  if (patch.slug !== undefined) {
    setClauses.push(`slug = $${idx++}`)
    values.push(patch.slug)
  }
  if (patch.description !== undefined) {
    setClauses.push(`description = $${idx++}`)
    values.push(patch.description)
  }
  if (patch.sortOrder !== undefined) {
    setClauses.push(`sort_order = $${idx++}`)
    values.push(patch.sortOrder)
  }
  if (patch.active !== undefined) {
    setClauses.push(`active = $${idx++}`)
    values.push(patch.active)
  }
  if (setClauses.length === 0) {
    // Nothing to change — just return the current row (or null if missing).
    const res = await query<DbTemplateSummaryRow>(
      `SELECT ${SUMMARY_COLS} FROM templates WHERE id = $1`,
      [id]
    )
    return res.rows[0] ? mapSummaryRow(res.rows[0]) : null
  }
  setClauses.push(`updated_at = now()`)
  values.push(id)

  const res = await query<DbTemplateSummaryRow>(
    `UPDATE templates SET ${setClauses.join(", ")} WHERE id = $${idx}
     RETURNING ${SUMMARY_COLS}`,
    values
  )
  return res.rows[0] ? mapSummaryRow(res.rows[0]) : null
}

export async function resyncTemplateFromSource(
  id: string
): Promise<TemplateDetail | null> {
  if (!hasDb()) {
    // No in-memory projects/design_layouts store to resync from — memory
    // mode is a no-op (returns the row unchanged) so callers don't crash.
    const row = memStore().get(id)
    if (!row || !row.sourceProjectId) return null
    return clone(row)
  }

  const existing = await query<{ source_project_id: string | null }>(
    `SELECT source_project_id FROM templates WHERE id = $1`,
    [id]
  )
  const sourceProjectId = existing.rows[0]?.source_project_id
  if (!sourceProjectId) return null

  const src = await fetchSourceProject(sourceProjectId)
  if (!src) return null

  const res = await query<DbTemplateDetailRow>(
    `UPDATE templates SET
       style = $2, city = $3, province = $4, floors = $5, rooftop = $6,
       thumbnail = $7, site = $8, layout = $9, brief = $10, interior = $11,
       updated_at = now()
     WHERE id = $1
     RETURNING ${DETAIL_COLS}`,
    [
      id,
      src.style,
      src.city,
      src.province,
      src.floors,
      src.rooftop,
      src.thumbnail,
      JSON.stringify(src.site),
      JSON.stringify(src.layout),
      src.brief ? JSON.stringify(src.brief) : null,
      src.interior ? JSON.stringify(src.interior) : null,
    ]
  )
  return res.rows[0] ? mapDetailRow(res.rows[0]) : null
}

export async function deleteTemplate(id: string): Promise<boolean> {
  if (!hasDb()) {
    return memStore().delete(id)
  }
  const res = await query(`DELETE FROM templates WHERE id = $1`, [id])
  return (res.rowCount ?? 0) > 0
}

/** Lightweight lookup used by DELETE to revalidate the right ISR path
 * before the row disappears (deleteTemplate itself only returns a bool). */
export async function getTemplateSlugById(id: string): Promise<string | null> {
  if (!hasDb()) {
    return memStore().get(id)?.slug ?? null
  }
  const res = await query<{ slug: string }>(`SELECT slug FROM templates WHERE id = $1`, [id])
  return res.rows[0]?.slug ?? null
}
