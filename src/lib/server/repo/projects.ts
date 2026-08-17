/**
 * Typed queries for the projects table.
 */
import { query } from "@/lib/server/db"
import type { Project, ProjectStatus, ReadinessStatus, HouseStyle, ThumbnailVariant, Site } from "@/types"

interface ProjectRow {
  id: string
  owner_id: string
  name: string
  status: ProjectStatus
  readiness: ReadinessStatus
  project_type: "new" | "renovation"
  location: string | null
  city: string | null
  province: string | null
  style: HouseStyle | null
  thumbnail: ThumbnailVariant
  floors: number
  rooftop: boolean
  site: Site
  current_version_id: string | null
  created_at: string
  updated_at: string
}

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    readiness: row.readiness,
    projectType: row.project_type,
    location: row.location ?? undefined,
    city: row.city ?? undefined,
    province: row.province ?? undefined,
    style: row.style ?? undefined,
    thumbnail: row.thumbnail,
    floors: row.floors,
    rooftop: row.rooftop,
    site: row.site,
    currentVersionId: row.current_version_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function listProjectsByOwner(ownerId: string): Promise<Project[]> {
  const res = await query<ProjectRow>(
    `SELECT id, owner_id, name, status, readiness, project_type, location, city, province,
            style, thumbnail, floors, rooftop, site, current_version_id, created_at, updated_at
     FROM projects WHERE owner_id = $1 ORDER BY updated_at DESC`,
    [ownerId]
  )
  return res.rows.map(rowToProject)
}

export async function getOwnedProject(
  id: string,
  ownerId: string
): Promise<Project | null> {
  const res = await query<ProjectRow>(
    `SELECT id, owner_id, name, status, readiness, project_type, location, city, province,
            style, thumbnail, floors, rooftop, site, current_version_id, created_at, updated_at
     FROM projects WHERE id = $1 AND owner_id = $2`,
    [id, ownerId]
  )
  return res.rows[0] ? rowToProject(res.rows[0]) : null
}

export async function createProject(opts: {
  id: string
  ownerId: string
  name: string
  status: ProjectStatus
  readiness: ReadinessStatus
  projectType: "new" | "renovation"
  location?: string
  city?: string
  province?: string
  style?: string
  thumbnail: ThumbnailVariant
  floors: number
  rooftop: boolean
  site: Site
}): Promise<Project> {
  const res = await query<ProjectRow>(
    `INSERT INTO projects
       (id, owner_id, name, status, readiness, project_type, location, city, province,
        style, thumbnail, floors, rooftop, site)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING id, owner_id, name, status, readiness, project_type, location, city, province,
               style, thumbnail, floors, rooftop, site, current_version_id, created_at, updated_at`,
    [
      opts.id,
      opts.ownerId,
      opts.name,
      opts.status,
      opts.readiness,
      opts.projectType,
      opts.location ?? null,
      opts.city ?? null,
      opts.province ?? null,
      opts.style ?? null,
      opts.thumbnail,
      opts.floors,
      opts.rooftop,
      JSON.stringify(opts.site),
    ]
  )
  return rowToProject(res.rows[0])
}

export async function updateProject(
  id: string,
  ownerId: string,
  patch: {
    name?: string
    status?: ProjectStatus
    readiness?: ReadinessStatus
    currentVersionId?: string
    thumbnail?: ThumbnailVariant
  }
): Promise<Project | null> {
  const setClauses: string[] = []
  const values: unknown[] = []
  let idx = 1

  if (patch.name !== undefined) {
    setClauses.push(`name = $${idx++}`)
    values.push(patch.name)
  }
  if (patch.status !== undefined) {
    setClauses.push(`status = $${idx++}`)
    values.push(patch.status)
  }
  if (patch.readiness !== undefined) {
    setClauses.push(`readiness = $${idx++}`)
    values.push(patch.readiness)
  }
  if (patch.currentVersionId !== undefined) {
    setClauses.push(`current_version_id = $${idx++}`)
    values.push(patch.currentVersionId)
  }
  if (patch.thumbnail !== undefined) {
    setClauses.push(`thumbnail = $${idx++}`)
    values.push(patch.thumbnail)
  }
  if (setClauses.length === 0) {
    return getOwnedProject(id, ownerId)
  }

  values.push(id)
  values.push(ownerId)
  const res = await query<ProjectRow>(
    `UPDATE projects SET ${setClauses.join(", ")}
     WHERE id = $${idx++} AND owner_id = $${idx++}
     RETURNING id, owner_id, name, status, readiness, project_type, location, city, province,
               style, thumbnail, floors, rooftop, site, current_version_id, created_at, updated_at`,
    values
  )
  return res.rows[0] ? rowToProject(res.rows[0]) : null
}

/**
 * Sync `projects.site` (incl. `regulation`) from a brief edit. The design
 * audit engine reads `Project.site`, not `Brief.site` — without this, editing
 * "Aturan tata ruang" (or any site field) post-create via the brief wizard
 * would silently never reach the audit. Merges shallowly onto the existing
 * site so a caller can send either a full or partial `Site` patch.
 */
export async function updateProjectSite(
  id: string,
  ownerId: string,
  site: Site
): Promise<Project | null> {
  const current = await getOwnedProject(id, ownerId)
  if (!current) return null
  const merged: Site = { ...current.site, ...site }
  const res = await query<ProjectRow>(
    `UPDATE projects SET site = $1
     WHERE id = $2 AND owner_id = $3
     RETURNING id, owner_id, name, status, readiness, project_type, location, city, province,
               style, thumbnail, floors, rooftop, site, current_version_id, created_at, updated_at`,
    [JSON.stringify(merged), id, ownerId]
  )
  return res.rows[0] ? rowToProject(res.rows[0]) : null
}

export async function deleteProject(id: string, ownerId: string): Promise<boolean> {
  const res = await query(
    `DELETE FROM projects WHERE id = $1 AND owner_id = $2`,
    [id, ownerId]
  )
  // CASCADE handles briefs, alternatives, layouts, interiors, reviews, assets
  return (res.rowCount ?? 0) > 0
}
