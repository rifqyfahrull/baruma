/**
 * Typed queries for the briefs table (jsonb payload, 1:1 with project).
 */
import { query } from "@/lib/server/db"
import type { Brief } from "@/types"

export async function getBriefPayload(projectId: string): Promise<Brief | null> {
  const res = await query<{ payload: Brief }>(
    `SELECT payload FROM briefs WHERE project_id = $1`,
    [projectId]
  )
  return res.rows[0]?.payload ?? null
}

export async function upsertBrief(
  projectId: string,
  payload: Brief
): Promise<Brief> {
  const res = await query<{ payload: Brief }>(
    `INSERT INTO briefs (project_id, payload)
     VALUES ($1, $2)
     ON CONFLICT (project_id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()
     RETURNING payload`,
    [projectId, JSON.stringify(payload)]
  )
  return res.rows[0].payload
}

export async function patchBrief(
  projectId: string,
  patch: Partial<Brief>
): Promise<Brief | null> {
  const current = await getBriefPayload(projectId)
  if (!current) return null
  const merged: Brief = { ...current, ...patch }
  return upsertBrief(projectId, merged)
}
