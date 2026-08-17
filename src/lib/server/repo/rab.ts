/**
 * Typed queries for the rab table (jsonb payload, 1:1 with project).
 */
import { query } from "@/lib/server/db"
import type { RAB } from "@/types"

export async function getRABPayload(projectId: string): Promise<RAB | null> {
  const res = await query<{ payload: RAB }>(
    `SELECT payload FROM rab WHERE project_id = $1`,
    [projectId]
  )
  return res.rows[0]?.payload ?? null
}

export async function upsertRAB(
  projectId: string,
  rab: RAB
): Promise<RAB> {
  const res = await query<{ payload: RAB }>(
    `INSERT INTO rab (project_id, payload)
     VALUES ($1, $2)
     ON CONFLICT (project_id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()
     RETURNING payload`,
    [projectId, JSON.stringify(rab)]
  )
  return res.rows[0].payload
}

export async function deleteRAB(projectId: string): Promise<void> {
  await query(`DELETE FROM rab WHERE project_id = $1`, [projectId])
}
