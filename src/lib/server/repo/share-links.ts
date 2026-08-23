/**
 * Typed queries for the share_links table (db/migrations/0040_share_links.sql)
 * — public, no-auth links a project owner generates so a recipient can view
 * a read-only snapshot at `/s/[token]` without logging in.
 *
 * Follows the same hasDb()/memory-fallback split as templates.ts, BUT the
 * memory-fallback path can only manage the link ROW itself (id/token/
 * project_id/revoked_at) — `getSharedProjectByToken`'s join against
 * `projects`/`design_layouts`/`briefs` needs those tables, which (unlike
 * `templates`) have NO in-memory fallback (see projects.ts/layouts.ts/
 * briefs.ts — always real Postgres). So in memory mode (no DATABASE_URL,
 * i.e. local dev/unit tests/e2e) the public join always resolves to `null`
 * — intentional, mirrors how every other authenticated project route is
 * already DB-only in this codebase; the `/s/[token]` page just renders its
 * friendly "not found" state in that environment instead of crashing.
 */
import { nanoid } from "nanoid"
import { query } from "@/lib/server/db"
import type { Brief, DesignLayout, HouseStyle, Project, Site, ThumbnailVariant } from "@/types"
import { clone, hasDb } from "./memory-fallback"

export interface ShareLink {
  id: string
  projectId: string
  token: string
  createdAt: string
  revokedAt: string | null
}

/** Read-only snapshot a public visitor sees at `/s/[token]`. */
export interface SharedProjectView {
  token: string
  project: Project
  brief: Brief | null
  layout: DesignLayout | null
}

interface ShareLinkRow {
  id: string
  project_id: string
  token: string
  created_at: string | Date
  revoked_at: string | Date | null
}

interface SharedProjectRow {
  token: string
  project_id: string
  name: string
  status: Project["status"]
  readiness: Project["readiness"]
  project_type: Project["projectType"]
  location: string | null
  city: string | null
  province: string | null
  style: HouseStyle | null
  thumbnail: ThumbnailVariant
  floors: number
  rooftop: boolean
  site: Site
  current_version_id: string | null
  created_at: string | Date
  updated_at: string | Date
  layout: DesignLayout | null
  brief: Brief | null
}

function toIso(v: string | Date): string {
  return typeof v === "string" ? v : v.toISOString()
}

function mapRow(r: ShareLinkRow): ShareLink {
  return {
    id: r.id,
    projectId: r.project_id,
    token: r.token,
    createdAt: toIso(r.created_at),
    revokedAt: r.revoked_at ? toIso(r.revoked_at) : null,
  }
}

function mapSharedProjectRow(r: SharedProjectRow): SharedProjectView {
  return {
    token: r.token,
    project: {
      id: r.project_id,
      name: r.name,
      status: r.status,
      readiness: r.readiness,
      projectType: r.project_type,
      location: r.location ?? undefined,
      city: r.city ?? undefined,
      province: r.province ?? undefined,
      style: r.style ?? undefined,
      thumbnail: r.thumbnail,
      floors: r.floors,
      rooftop: r.rooftop,
      site: r.site,
      currentVersionId: r.current_version_id ?? undefined,
      createdAt: toIso(r.created_at),
      updatedAt: toIso(r.updated_at),
    },
    brief: r.brief ?? null,
    layout: r.layout ?? null,
  }
}

/* ── in-memory fallback (dev/test-only — link rows only, see file header) ── */

let memLinks: Map<string, ShareLink> | null = null
function memStore(): Map<string, ShareLink> {
  if (!memLinks) memLinks = new Map()
  return memLinks
}

/** Test-only: clear the in-memory fallback store. */
export function clearShareLinksFallback(): void {
  memLinks = null
}

/* ── public API ───────────────────────────────────────────────────────────── */

/** Active (non-revoked) link for a project, if any. */
export async function getActiveShareLink(projectId: string): Promise<ShareLink | null> {
  if (!hasDb()) {
    for (const link of memStore().values()) {
      if (link.projectId === projectId && !link.revokedAt) return clone(link)
    }
    return null
  }
  const res = await query<ShareLinkRow>(
    `SELECT id, project_id, token, created_at, revoked_at FROM share_links
     WHERE project_id = $1 AND revoked_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [projectId]
  )
  return res.rows[0] ? mapRow(res.rows[0]) : null
}

/**
 * Idempotent create: reuses the project's active link if one exists,
 * otherwise mints a fresh unguessable token.
 */
export async function createOrReuseShareLink(projectId: string): Promise<ShareLink> {
  const existing = await getActiveShareLink(projectId)
  if (existing) return existing

  const id = `shr-${nanoid(8)}`
  const token = nanoid(21)

  if (!hasDb()) {
    const link: ShareLink = { id, projectId, token, createdAt: new Date().toISOString(), revokedAt: null }
    memStore().set(id, link)
    return clone(link)
  }
  const res = await query<ShareLinkRow>(
    `INSERT INTO share_links (id, project_id, token) VALUES ($1, $2, $3)
     RETURNING id, project_id, token, created_at, revoked_at`,
    [id, projectId, token]
  )
  return mapRow(res.rows[0])
}

/** Revoke the project's active link (no-op if none). */
export async function revokeShareLinks(projectId: string): Promise<void> {
  if (!hasDb()) {
    for (const link of memStore().values()) {
      if (link.projectId === projectId && !link.revokedAt) {
        link.revokedAt = new Date().toISOString()
      }
    }
    return
  }
  await query(
    `UPDATE share_links SET revoked_at = now() WHERE project_id = $1 AND revoked_at IS NULL`,
    [projectId]
  )
}

/**
 * Lightweight token check (no project/brief/layout join) — used by the
 * public comments route, which only needs the `project_id` to insert
 * against, not the full share view.
 */
export async function getShareLinkByToken(token: string): Promise<ShareLink | null> {
  if (!hasDb()) {
    for (const link of memStore().values()) {
      if (link.token === token && !link.revokedAt) return clone(link)
    }
    return null
  }
  const res = await query<ShareLinkRow>(
    `SELECT id, project_id, token, created_at, revoked_at FROM share_links
     WHERE token = $1 AND revoked_at IS NULL`,
    [token]
  )
  return res.rows[0] ? mapRow(res.rows[0]) : null
}

/**
 * Public read: resolves a token to the project's current name/site/style +
 * brief + layout, joined in one query. Returns `null` for an unknown OR
 * revoked token (the route/page can't tell those apart, by design — no
 * "this link was revoked, but here's the project name" leak) and — in
 * memory-fallback mode only — for otherwise-valid tokens too (see file
 * header).
 */
export async function getSharedProjectByToken(token: string): Promise<SharedProjectView | null> {
  if (!hasDb()) return null
  const res = await query<SharedProjectRow>(
    `SELECT sl.token, p.id AS project_id, p.name, p.status, p.readiness, p.project_type,
            p.location, p.city, p.province, p.style, p.thumbnail, p.floors, p.rooftop,
            p.site, p.current_version_id, p.created_at, p.updated_at,
            dl.payload AS layout, b.payload AS brief
     FROM share_links sl
     JOIN projects p ON p.id = sl.project_id
     LEFT JOIN design_layouts dl ON dl.project_id = p.id
     LEFT JOIN briefs b ON b.project_id = p.id
     WHERE sl.token = $1 AND sl.revoked_at IS NULL`,
    [token]
  )
  return res.rows[0] ? mapSharedProjectRow(res.rows[0]) : null
}
