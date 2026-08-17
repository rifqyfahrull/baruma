/**
 * Typed queries for the alternatives table.
 */
import { query, getClient } from "@/lib/server/db"
import type { Alternative } from "@/types"

export async function getAlternatives(projectId: string): Promise<Alternative[]> {
  const res = await query<{ alternative_id: string; payload: Alternative }>(
    `SELECT alternative_id, payload FROM alternatives
     WHERE project_id = $1 ORDER BY created_at, alternative_id`,
    [projectId]
  )
  return res.rows.map((r) => r.payload)
}

export async function upsertAlternatives(
  projectId: string,
  alternatives: Alternative[]
): Promise<Alternative[]> {
  const client = await getClient()
  try {
    await client.query("BEGIN")
    await client.query(`DELETE FROM alternatives WHERE project_id = $1`, [projectId])
    for (const alt of alternatives) {
      await client.query(
        `INSERT INTO alternatives (project_id, alternative_id, payload)
         VALUES ($1, $2, $3)`,
        [projectId, alt.id, JSON.stringify(alt)]
      )
    }
    await client.query("COMMIT")
    return alternatives
  } catch (err) {
    await client.query("ROLLBACK")
    throw err
  } finally {
    client.release()
  }
}
