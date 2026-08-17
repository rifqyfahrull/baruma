/** Typed persistence for the single AI Agent thread owned by a project. */
import { nanoid } from "nanoid"

import { getClient, query } from "@/lib/server/db"
import type {
  AssistantAction,
  AssistantMessage,
  AssistantMessageStatus,
  AssistantMode,
  AssistantRequestState,
  AssistantSurface,
} from "@/lib/assistant/actions"

type Row = {
  id: string
  project_id: string
  mode: string
  surface: string | null
  turn_id: string | null
  client_request_id: string | null
  request_state: string | null
  processing_started_at: string | Date | null
  role: string
  content: string
  planner_note: string | null
  actions: AssistantAction[] | null
  action_labels: string[] | null
  status: string | null
  created_at: string | Date
}

const COLS =
  "id, project_id, mode, surface, turn_id, client_request_id, request_state, processing_started_at, role, content, planner_note, actions, action_labels, status, created_at"

function iso(value: string | Date | null): string | null {
  if (!value) return null
  return typeof value === "string" ? value : value.toISOString()
}

function parseOptionsFromContent(content: string): string[] | undefined {
  if (!content) return undefined
  const trimmed = content.trim()
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmed)
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.options) && parsed.options.length > 0) {
        return parsed.options.filter((opt: unknown) => typeof opt === "string" && opt.trim().length > 0)
      }
    } catch {
      /* ignore */
    }
  }
  return undefined
}

function parseNeedsClarifyFromContent(content: string): Array<{ question: string; suggestions: string[] }> | undefined {
  if (!content) return undefined
  const trimmed = content.trim()
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmed)
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.needs_clarify) && parsed.needs_clarify.length > 0) {
        return parsed.needs_clarify.map((item: any) => ({
          question: typeof item.question === "string" ? item.question : String(item.question ?? ""),
          suggestions: Array.isArray(item.suggestions)
            ? item.suggestions.filter((s: unknown) => typeof s === "string" && s.trim().length > 0)
            : [],
        }))
      }
    } catch {
      /* ignore */
    }
  }
  return undefined
}

function mapRow(r: Row): AssistantMessage {
  return {
    id: r.id,
    projectId: r.project_id,
    mode: r.mode as AssistantMode,
    surface: (r.surface ?? r.mode) as AssistantSurface,
    turnId: r.turn_id ?? r.id,
    clientRequestId: r.client_request_id ?? undefined,
    requestState: (r.request_state as AssistantRequestState | null) ?? null,
    processingStartedAt: iso(r.processing_started_at),
    role: r.role === "assistant" ? "assistant" : "user",
    content: r.content,
    plannerNote: r.planner_note ?? undefined,
    actions: r.actions ?? undefined,
    actionLabels: r.action_labels ?? undefined,
    options: parseOptionsFromContent(r.content),
    needsClarify: parseNeedsClarifyFromContent(r.content),
    status: (r.status as AssistantMessageStatus | null) ?? null,
    createdAt: iso(r.created_at)!,
  }
}

/** Most recent `limit` messages, returned chronologically for rendering/context. */
export async function listMessages(projectId: string, limit = 100): Promise<AssistantMessage[]> {
  const res = await query<Row>(
    `SELECT ${COLS} FROM (
       SELECT ${COLS} FROM assistant_messages WHERE project_id = $1
       ORDER BY created_at DESC, id DESC LIMIT $2
     ) recent ORDER BY created_at ASC, id ASC`,
    [projectId, limit]
  )
  return res.rows.map(mapRow)
}

/** Compatibility insert used by the old routes while rollout is in progress. */
export async function appendMessage(
  projectId: string,
  msg: {
    mode: AssistantMode
    surface?: AssistantSurface
    turnId?: string
    clientRequestId?: string
    requestState?: AssistantRequestState | null
    role: "user" | "assistant"
    content: string
    plannerNote?: string | null
    actions?: AssistantAction[] | null
    actionLabels?: string[] | null
    status?: AssistantMessageStatus | null
  }
): Promise<AssistantMessage> {
  const id = `msg-${nanoid(12)}`
  const res = await query<Row>(
    `INSERT INTO assistant_messages
       (id, project_id, mode, surface, turn_id, client_request_id, request_state,
        processing_started_at, role, content, planner_note, actions, action_labels, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,CASE WHEN $7 = 'pending' THEN now() ELSE NULL END,$8,$9,$10,$11,$12,$13)
     RETURNING ${COLS}`,
    [
      id,
      projectId,
      msg.mode,
      msg.surface ?? msg.mode,
      msg.turnId ?? id,
      msg.clientRequestId ?? null,
      msg.requestState ?? (msg.role === "user" ? "completed" : null),
      msg.role,
      msg.content,
      msg.plannerNote ?? null,
      msg.actions ? JSON.stringify(msg.actions) : null,
      msg.actionLabels ? JSON.stringify(msg.actionLabels) : null,
      msg.status ?? null,
    ]
  )
  return mapRow(res.rows[0])
}

export type ClaimTurnResult =
  | { kind: "claimed"; message: AssistantMessage }
  | { kind: "processing"; message: AssistantMessage }
  | { kind: "completed" | "failed"; message: AssistantMessage; reply?: AssistantMessage }

/**
 * Atomically claim a client request. Concurrent duplicates never run a second
 * LLM call; an abandoned request may be reclaimed after `leaseMs`.
 */
export async function claimTurn(input: {
  projectId: string
  clientRequestId: string
  mode: AssistantMode
  surface: AssistantSurface
  content: string
  leaseMs?: number
}): Promise<ClaimTurnResult> {
  const id = `msg-${nanoid(12)}`
  const turnId = `turn-${nanoid(12)}`
  const inserted = await query<Row>(
    `INSERT INTO assistant_messages
       (id, project_id, mode, surface, turn_id, client_request_id, request_state,
        processing_started_at, role, content)
     VALUES ($1,$2,$3,$4,$5,$6,'pending',now(),'user',$7)
     ON CONFLICT DO NOTHING
     RETURNING ${COLS}`,
    [id, input.projectId, input.mode, input.surface, turnId, input.clientRequestId, input.content]
  )
  if (inserted.rows[0]) return { kind: "claimed", message: mapRow(inserted.rows[0]) }

  const existing = await findTurnByRequestId(input.projectId, input.clientRequestId)
  if (!existing.user) {
    // A conflict unrelated to the request-id index is not recoverable here.
    throw new Error("Failed to claim assistant turn")
  }
  if (existing.user.requestState === "completed") {
    return { kind: "completed", message: existing.user, reply: existing.reply }
  }
  if (existing.user.requestState === "failed") {
    return { kind: "failed", message: existing.user, reply: existing.reply }
  }

  const cutoff = new Date(Date.now() - (input.leaseMs ?? 120_000)).toISOString()
  const reclaimed = await query<Row>(
    `UPDATE assistant_messages
        SET processing_started_at = now(), mode = $3, surface = $4, content = $5
      WHERE project_id = $1 AND client_request_id = $2 AND role = 'user'
        AND request_state = 'pending'
        AND (processing_started_at IS NULL OR processing_started_at < $6)
      RETURNING ${COLS}`,
    [input.projectId, input.clientRequestId, input.mode, input.surface, input.content, cutoff]
  )
  if (reclaimed.rows[0]) return { kind: "claimed", message: mapRow(reclaimed.rows[0]) }
  return { kind: "processing", message: existing.user }
}

export async function findTurnByRequestId(
  projectId: string,
  clientRequestId: string
): Promise<{ user?: AssistantMessage; reply?: AssistantMessage }> {
  const res = await query<Row>(
    `SELECT ${COLS} FROM assistant_messages
      WHERE project_id = $1 AND (
        client_request_id = $2 OR turn_id = (
          SELECT turn_id FROM assistant_messages
           WHERE project_id = $1 AND client_request_id = $2 AND role = 'user'
           LIMIT 1
        )
      )
      ORDER BY created_at ASC, id ASC`,
    [projectId, clientRequestId]
  )
  const messages = res.rows.map(mapRow)
  return {
    user: messages.find((m) => m.role === "user"),
    reply: messages.find((m) => m.role === "assistant"),
  }
}

/** Insert the reply and mark its paired user request completed atomically. */
export async function completeTurn(
  userMessage: AssistantMessage,
  reply: {
    mode: AssistantMode
    surface: AssistantSurface
    content: string
    plannerNote?: string | null
    actions?: AssistantAction[] | null
    actionLabels?: string[] | null
    status?: AssistantMessageStatus | null
  }
): Promise<AssistantMessage> {
  const client = await getClient()
  try {
    await client.query("BEGIN")
    const id = `msg-${nanoid(12)}`
    const inserted = await client.query<Row>(
      `INSERT INTO assistant_messages
         (id, project_id, mode, surface, turn_id, client_request_id, role, content,
          planner_note, actions, action_labels, status)
       VALUES ($1,$2,$3,$4,$5,$6,'assistant',$7,$8,$9,$10,$11)
       ON CONFLICT (project_id, turn_id, role) DO UPDATE SET id = assistant_messages.id
       RETURNING ${COLS}`,
      [
        id,
        userMessage.projectId,
        reply.mode,
        reply.surface,
        userMessage.turnId ?? userMessage.id,
        userMessage.clientRequestId ?? null,
        reply.content,
        reply.plannerNote ?? null,
        reply.actions ? JSON.stringify(reply.actions) : null,
        reply.actionLabels ? JSON.stringify(reply.actionLabels) : null,
        reply.status ?? null,
      ]
    )
    await client.query(
      `UPDATE assistant_messages SET request_state = 'completed'
        WHERE id = $1 AND project_id = $2 AND role = 'user'`,
      [userMessage.id, userMessage.projectId]
    )
    await client.query("COMMIT")
    return mapRow(inserted.rows[0])
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
}

export async function failTurn(projectId: string, messageId: string): Promise<void> {
  await query(
    `UPDATE assistant_messages SET request_state = 'failed'
      WHERE id = $1 AND project_id = $2 AND role = 'user'`,
    [messageId, projectId]
  )
}

export async function setMessageStatus(
  projectId: string,
  messageId: string,
  status: AssistantMessageStatus
): Promise<void> {
  await query(
    `UPDATE assistant_messages SET status = $3
      WHERE id = $1 AND project_id = $2 AND role = 'assistant'`,
    [messageId, projectId, status]
  )
}

export async function clearThread(projectId: string): Promise<void> {
  await query(`DELETE FROM assistant_messages WHERE project_id = $1`, [projectId])
}
