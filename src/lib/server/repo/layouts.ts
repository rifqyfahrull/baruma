/**
 * Typed queries for design_layouts table (jsonb payload, 1:1 with project).
 */
import { query } from "@/lib/server/db"
import type { DesignLayout } from "@/types"
import { normalizeDesignLayout, type LayoutDocument } from "@/lib/schemas/layout"

export async function getLayoutDocument(
  projectId: string
): Promise<LayoutDocument | null> {
  const res = await query<{ payload: DesignLayout; revision: string | number }>(
    `SELECT payload, revision FROM design_layouts WHERE project_id = $1`,
    [projectId]
  )
  const row = res.rows[0]
  if (!row) return null
  return {
    layout: normalizeDesignLayout(row.payload),
    revision: Number(row.revision),
  }
}

export async function getLayoutPayload(
  projectId: string
): Promise<DesignLayout | null> {
  return (await getLayoutDocument(projectId))?.layout ?? null
}

export async function insertLayoutIfAbsent(
  projectId: string,
  versionId: string,
  payload: DesignLayout
): Promise<LayoutDocument> {
  const normalized = normalizeDesignLayout(payload)
  const res = await query<{ payload: DesignLayout; revision: string | number }>(
    `INSERT INTO design_layouts (project_id, version_id, payload)
     VALUES ($1, $2, $3)
     ON CONFLICT (project_id) DO NOTHING
     RETURNING payload, revision`,
    [projectId, versionId, JSON.stringify(normalized)]
  )
  const row = res.rows[0]
  if (row) {
    return { layout: normalizeDesignLayout(row.payload), revision: Number(row.revision) }
  }
  const existing = await getLayoutDocument(projectId)
  if (!existing) {
    throw new Error("Failed to insert or load layout")
  }
  return existing
}

export async function updateLayoutAtRevision(
  projectId: string,
  versionId: string,
  payload: DesignLayout,
  expectedRevision: number
): Promise<LayoutDocument | null> {
  const normalized = normalizeDesignLayout(payload)
  const res = await query<{ payload: DesignLayout; revision: string | number }>(
    `UPDATE design_layouts
       SET version_id = $2,
           payload = $3,
           revision = revision + 1,
           updated_at = now()
     WHERE project_id = $1
       AND revision = $4
     RETURNING payload, revision`,
    [projectId, versionId, JSON.stringify(normalized), expectedRevision]
  )
  const row = res.rows[0]
  if (!row) return null
  return {
    layout: normalizeDesignLayout(row.payload),
    revision: Number(row.revision),
  }
}
