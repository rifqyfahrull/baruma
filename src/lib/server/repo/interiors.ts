/**
 * Typed queries for project_interiors table (jsonb payload, 1:1 with project).
 */
import { query } from "@/lib/server/db"
import type { SavedInterior } from "@/lib/schemas/interior"

export async function getInteriorPayload(
  projectId: string
): Promise<SavedInterior | null> {
  const res = await query<{ payload: SavedInterior }>(
    `SELECT payload FROM project_interiors WHERE project_id = $1`,
    [projectId]
  )
  return res.rows[0]?.payload ?? null
}

export async function upsertInterior(
  projectId: string,
  versionId: string,
  payload: SavedInterior
): Promise<SavedInterior> {
  const res = await query<{ payload: SavedInterior }>(
    `INSERT INTO project_interiors (project_id, version_id, payload)
     VALUES ($1, $2, $3)
     ON CONFLICT (project_id) DO UPDATE
       SET version_id = EXCLUDED.version_id,
           payload = EXCLUDED.payload,
           updated_at = now()
     RETURNING payload`,
    [projectId, versionId, JSON.stringify(payload)]
  )
  return res.rows[0].payload
}
