/**
 * Typed queries for the review-related tables:
 * review_comments, review_checklist, resolved_warnings.
 * Also assembles the full Review shape from DB rows + generated warnings.
 */
import { query } from "@/lib/server/db"
import { nanoid } from "nanoid"
import type {
  Comment,
  Review,
  ReviewChecklistItem,
  ReviewRole,
  RiskWarning,
} from "@/types"

/* ---- comments ---- */

interface CommentRow {
  id: string
  author: string
  role: ReviewRole | null
  body: string
  resolved: boolean
  created_at: string
}

export async function getComments(projectId: string): Promise<Comment[]> {
  const res = await query<CommentRow>(
    `SELECT id, author, role, body, resolved, created_at
     FROM review_comments WHERE project_id = $1 ORDER BY created_at ASC`,
    [projectId]
  )
  return res.rows.map((r) => ({
    id: r.id,
    author: r.author,
    role: r.role ?? undefined,
    body: r.body,
    createdAt: r.created_at,
    resolved: r.resolved,
  }))
}

export async function insertComment(
  projectId: string,
  body: string,
  author = "Kamu"
): Promise<Comment> {
  const id = `c-${nanoid(6)}`
  const res = await query<CommentRow>(
    `INSERT INTO review_comments (id, project_id, author, body)
     VALUES ($1, $2, $3, $4)
     RETURNING id, author, role, body, resolved, created_at`,
    [id, projectId, author, body]
  )
  const r = res.rows[0]
  return {
    id: r.id,
    author: r.author,
    role: r.role ?? undefined,
    body: r.body,
    createdAt: r.created_at,
    resolved: r.resolved,
  }
}

export async function toggleComment(
  commentId: string,
  projectId: string
): Promise<void> {
  await query(
    `UPDATE review_comments SET resolved = NOT resolved
     WHERE id = $1 AND project_id = $2`,
    [commentId, projectId]
  )
}

/* ---- checklist ---- */

interface ChecklistRow {
  role: ReviewRole
  label: string
  status: ReviewChecklistItem["status"]
}

export async function getChecklist(
  projectId: string
): Promise<ReviewChecklistItem[]> {
  const res = await query<ChecklistRow>(
    `SELECT role, label, status FROM review_checklist WHERE project_id = $1`,
    [projectId]
  )
  return res.rows.map((r) => ({ role: r.role, label: r.label, status: r.status }))
}

export async function upsertChecklistItem(
  projectId: string,
  role: ReviewRole,
  label: string,
  status: ReviewChecklistItem["status"]
): Promise<void> {
  await query(
    `INSERT INTO review_checklist (project_id, role, label, status)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (project_id, role) DO UPDATE SET status = EXCLUDED.status, label = EXCLUDED.label`,
    [projectId, role, label, status]
  )
}

/* ---- resolved warnings ---- */

export async function getResolvedWarningIds(
  projectId: string
): Promise<string[]> {
  const res = await query<{ warning_id: string }>(
    `SELECT warning_id FROM resolved_warnings WHERE project_id = $1`,
    [projectId]
  )
  return res.rows.map((r) => r.warning_id)
}

export async function toggleResolvedWarning(
  projectId: string,
  warningId: string
): Promise<void> {
  const res = await query<{ warning_id: string }>(
    `SELECT warning_id FROM resolved_warnings WHERE project_id = $1 AND warning_id = $2`,
    [projectId, warningId]
  )
  if (res.rows.length > 0) {
    await query(
      `DELETE FROM resolved_warnings WHERE project_id = $1 AND warning_id = $2`,
      [projectId, warningId]
    )
  } else {
    await query(
      `INSERT INTO resolved_warnings (project_id, warning_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [projectId, warningId]
    )
  }
}

/* ---- assemble full Review ---- */

const DEFAULT_CHECKLIST_LABELS: Record<ReviewRole, string> = {
  arsitek: "Tinjau denah, sirkulasi & estetika",
  engineer_struktur: "Tinjau struktur & beban",
  mep: "Tinjau MEP / plumbing",
  kontraktor: "Tinjau biaya & metode pelaksanaan",
  pbg_legal: "Cek perizinan & sempadan",
}

export async function assembleReview(opts: {
  projectId: string
  versionId: string
  generatedWarnings: RiskWarning[]
  generatedChecklist: ReviewChecklistItem[]
  aiSummary: string
}): Promise<Review> {
  const [comments, storedChecklist, resolvedWarningIds] = await Promise.all([
    getComments(opts.projectId),
    getChecklist(opts.projectId),
    getResolvedWarningIds(opts.projectId),
  ])

  // Merge stored checklist with generated defaults (stored takes priority).
  const storedMap = new Map(storedChecklist.map((c) => [c.role, c]))
  const checklist: ReviewChecklistItem[] = opts.generatedChecklist.map((gen) => {
    return storedMap.get(gen.role) ?? gen
  })

  return {
    projectId: opts.projectId,
    versionId: opts.versionId,
    aiSummary: opts.aiSummary,
    checklist,
    comments,
    warnings: opts.generatedWarnings,
    resolvedWarningIds,
  }
}

export { DEFAULT_CHECKLIST_LABELS }
