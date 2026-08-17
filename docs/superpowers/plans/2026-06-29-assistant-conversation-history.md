# AI Assistant Conversation History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the editor AI Assistant conversation (incl. tool calls) in the DB as one unified thread per project, render tool calls inline with status, and feed stored history back as LLM context.

**Architecture:** New `assistant_messages` table (thread = `project_id`, `mode` per message). A `repo/assistant.ts` layer + GET/POST/PATCH routes. Data layer exposes `listAssistantMessages` / `sendAssistantMessage` / `setAssistantMessageStatus`; React Query cache key `[assistant, projectId]` makes the thread shared across panels and reload-persistent. The panel renders the thread from the query; the POST route loads prior messages → context, runs the existing floorplan-loop / interior single-shot, and persists the assistant turn with its action labels.

**Tech Stack:** Next.js 16 (App Router) · pg (raw SQL) · zod · TanStack Query · zustand · vitest.

## Global Constraints

- Spec: [docs/superpowers/specs/2026-06-29-assistant-conversation-history-design.md](../specs/2026-06-29-assistant-conversation-history-design.md).
- Thread = `projectId` (unified per project); every message carries `mode` (`floorplan` | `interior`).
- Reuse existing patterns: repo like [interiors.ts](../../../src/lib/server/repo/interiors.ts); route auth via `requireUser` + `getOwnedProject`; data-layer split mock/http; repo tests mock `@/lib/server/db`.
- All UI copy in Bahasa Indonesia. Run `rtk tsc`, `npx vitest run`, `npx next build` to verify. `nanoid` for ids. No new npm dependencies.
- Migration `0006_assistant.sql` must be applied to the central DB before the HTTP path works (mock path needs no DB).

---

## File Structure

- Create `db/migrations/0006_assistant.sql` — table + index.
- Modify `src/lib/assistant/actions.ts` — `AssistantMessageStatus`, `AssistantMessage`, `SendAssistantMessageInput`; drop `history` from `editorAssistantRequestSchema`.
- Modify `src/lib/server/editor-assistant.ts` — `buildContextFromMessages()`; `runFloorplanLoop` no longer needed here (route owns it) — keep helpers exported.
- Create `src/lib/server/repo/assistant.ts` (+ `assistant.test.ts`).
- Modify `src/lib/api/keys.ts` — `assistant(projectId)` key.
- Modify `src/lib/data/source.ts`, `src/lib/data/http.ts`, `src/lib/mock/index.ts`, `src/lib/data/index.ts` — 3 new methods, remove `askEditorAssistant`.
- Modify `src/lib/api/hooks.ts` — `useAssistantMessages` / `useSendAssistantMessage` / `useSetAssistantStatus`, remove `useEditorAssistant`.
- Modify `src/app/api/v1/projects/[id]/editor/assistant/route.ts` — add `GET`, rewrite `POST` (persist + DB context).
- Create `src/app/api/v1/projects/[id]/editor/assistant/[msgId]/route.ts` — `PATCH`.
- Modify `src/components/assistant/editor-assistant-panel.tsx` — thread UI from query.

---

## Task 1: Shared types + migration

**Files:**
- Create: `db/migrations/0006_assistant.sql`
- Modify: `src/lib/assistant/actions.ts`

**Interfaces:**
- Produces: `AssistantMessage`, `AssistantMessageStatus`, `SendAssistantMessageInput`; `editorAssistantRequestSchema` (now `{ mode, instruction, scene }`).

- [ ] **Step 1: Write the migration**

Create `db/migrations/0006_assistant.sql`:

```sql
-- AI assistant conversation history (one unified thread per project).
create table assistant_messages (
  id            text primary key,
  project_id    text not null references projects(id) on delete cascade,
  mode          text not null,            -- 'floorplan' | 'interior'
  role          text not null,            -- 'user' | 'assistant'
  content       text not null,
  actions       jsonb,                    -- AssistantAction[] (raw, for apply)
  action_labels jsonb,                    -- string[] (describeAction at creation)
  status        text,                     -- null | 'proposed' | 'applied' | 'dismissed'
  created_at    timestamptz not null default now()
);
create index assistant_messages_thread on assistant_messages (project_id, created_at);
```

- [ ] **Step 2: Add shared types** — append to `src/lib/assistant/actions.ts` (after `EditorAssistantResponse`):

```ts
export type AssistantMessageStatus = "proposed" | "applied" | "dismissed"

export interface AssistantMessage {
  id: string
  projectId: string
  mode: AssistantMode
  role: "user" | "assistant"
  content: string
  actions?: AssistantAction[]
  actionLabels?: string[]
  status?: AssistantMessageStatus | null
  createdAt: string
}

export interface SendAssistantMessageInput {
  mode: AssistantMode
  instruction: string
  scene: AssistantScene
}
```

- [ ] **Step 3: Drop `history` from the request schema** — in `src/lib/assistant/actions.ts`, replace `editorAssistantRequestSchema` body (remove the `history` field; history now comes from the DB):

```ts
export const editorAssistantRequestSchema = z.object({
  mode: z.enum(["floorplan", "interior"]),
  instruction: z.string().trim().min(1, "Perintah tidak boleh kosong").max(1000),
  scene: z.unknown(),
})
export type EditorAssistantRequest = z.infer<typeof editorAssistantRequestSchema> & {
  scene: AssistantScene
}
```

Keep `assistantTurnSchema` / `AssistantTurn` (still used by `buildMessages`).

- [ ] **Step 4: Verify types compile**

Run: `rtk tsc`
Expected: errors only in files that still reference the removed `history`/`askEditorAssistant` (fixed in later tasks). The new types compile.

- [ ] **Step 5: Commit**

```bash
git add db/migrations/0006_assistant.sql src/lib/assistant/actions.ts
git commit -m "feat(assistant): add conversation message types + migration"
```

---

## Task 2: `buildContextFromMessages` (TDD)

**Files:**
- Modify: `src/lib/server/editor-assistant.ts`
- Test: `src/lib/server/editor-assistant.test.ts`

**Interfaces:**
- Consumes: `AssistantMessage`, `AssistantTurn` (Task 1).
- Produces: `buildContextFromMessages(messages: AssistantMessage[], maxTurns?: number): AssistantTurn[]`.

- [ ] **Step 1: Write the failing test** — append to `src/lib/server/editor-assistant.test.ts`:

```ts
import { buildContextFromMessages } from "./editor-assistant"
import type { AssistantMessage } from "@/lib/assistant/actions"

const msg = (over: Partial<AssistantMessage>): AssistantMessage => ({
  id: "m", projectId: "p", mode: "floorplan", role: "user",
  content: "hai", createdAt: "2026-06-29T00:00:00Z", ...over,
})

describe("buildContextFromMessages", () => {
  it("maps role+content and annotates applied tool calls", () => {
    const turns = buildContextFromMessages([
      msg({ role: "user", content: "tambah jendela" }),
      msg({ role: "assistant", content: "Oke", status: "applied", actionLabels: ["Tambah jendela di Ruang Tamu"] }),
      msg({ role: "assistant", content: "Usulan", status: "proposed", actionLabels: ["X"] }),
    ])
    expect(turns[0]).toEqual({ role: "user", content: "tambah jendela" })
    expect(turns[1].content).toContain("[diterapkan: Tambah jendela di Ruang Tamu]")
    expect(turns[2].content).toBe("Usulan") // not applied → no annotation
  })

  it("trims to the last maxTurns", () => {
    const many = Array.from({ length: 30 }, (_, i) => msg({ content: `t${i}` }))
    expect(buildContextFromMessages(many, 16)).toHaveLength(16)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/server/editor-assistant.test.ts`
Expected: FAIL — `buildContextFromMessages is not a function`.

- [ ] **Step 3: Implement** — in `src/lib/server/editor-assistant.ts`, add `AssistantMessage` to the import from `@/lib/assistant/actions`, then add:

```ts
const MAX_CONTEXT_TURNS = 16

/** Map stored thread messages → LLM context turns, annotating applied tool
 *  calls so the model knows what edits already happened. Trims to maxTurns. */
export function buildContextFromMessages(
  messages: AssistantMessage[],
  maxTurns = MAX_CONTEXT_TURNS
): AssistantTurn[] {
  return messages.slice(-maxTurns).map((m) => {
    const applied =
      m.role === "assistant" && m.status === "applied" && m.actionLabels?.length
        ? ` [diterapkan: ${m.actionLabels.join("; ")}]`
        : ""
    return { role: m.role, content: m.content + applied }
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/server/editor-assistant.test.ts`
Expected: PASS (all editor-assistant tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/editor-assistant.ts src/lib/server/editor-assistant.test.ts
git commit -m "feat(assistant): build LLM context from stored thread"
```

---

## Task 3: Repo `repo/assistant.ts` (TDD)

**Files:**
- Create: `src/lib/server/repo/assistant.ts`
- Test: `src/lib/server/repo/assistant.test.ts`

**Interfaces:**
- Produces: `listMessages(projectId, limit?)`, `appendMessage(projectId, msg)`, `setMessageStatus(projectId, messageId, status)`, `clearThread(projectId)`.

- [ ] **Step 1: Write the failing test** — create `src/lib/server/repo/assistant.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeAll } from "vitest"

beforeAll(() => { process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test" })

vi.mock("@/lib/server/db", () => ({ query: vi.fn(), getClient: vi.fn() }))

import { listMessages, appendMessage, setMessageStatus } from "./assistant"
import * as db from "@/lib/server/db"

describe("repo/assistant", () => {
  it("listMessages orders by created_at and maps rows", async () => {
    vi.mocked(db.query).mockResolvedValueOnce({
      rows: [{
        id: "m1", project_id: "p1", mode: "floorplan", role: "assistant",
        content: "hi", actions: [{ type: "deleteRoom", roomId: "r1" }],
        action_labels: ["Hapus ruang"], status: "proposed", created_at: "2026-06-29T00:00:00Z",
      }],
      rowCount: 1,
    } as never)

    const out = await listMessages("p1")
    const [sql] = vi.mocked(db.query).mock.calls.at(-1) as [string, unknown[]]
    expect(sql).toContain("ORDER BY created_at")
    expect(out[0]).toMatchObject({ id: "m1", mode: "floorplan", status: "proposed" })
    expect(out[0].actionLabels).toEqual(["Hapus ruang"])
  })

  it("appendMessage inserts and returns the mapped row", async () => {
    vi.mocked(db.query).mockResolvedValueOnce({
      rows: [{
        id: "m2", project_id: "p1", mode: "interior", role: "user",
        content: "tambah sofa", actions: null, action_labels: null,
        status: null, created_at: "2026-06-29T00:00:01Z",
      }],
      rowCount: 1,
    } as never)
    const out = await appendMessage("p1", { mode: "interior", role: "user", content: "tambah sofa" })
    const [sql] = vi.mocked(db.query).mock.calls.at(-1) as [string, unknown[]]
    expect(sql).toContain("INSERT INTO assistant_messages")
    expect(out.id).toBe("m2")
    expect(out.status).toBeNull()
  })

  it("setMessageStatus guards by project_id", async () => {
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 } as never)
    await setMessageStatus("p1", "m1", "applied")
    const [sql, params] = vi.mocked(db.query).mock.calls.at(-1) as [string, unknown[]]
    expect(sql).toContain("UPDATE assistant_messages SET status")
    expect(params).toEqual(["m1", "p1", "applied"])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/server/repo/assistant.test.ts`
Expected: FAIL — cannot find `./assistant`.

- [ ] **Step 3: Implement** — create `src/lib/server/repo/assistant.ts`:

```ts
/** Typed queries for assistant_messages (one unified thread per project). */
import { nanoid } from "nanoid"

import { query } from "@/lib/server/db"
import type {
  AssistantAction,
  AssistantMessage,
  AssistantMessageStatus,
  AssistantMode,
} from "@/lib/assistant/actions"

type Row = {
  id: string
  project_id: string
  mode: string
  role: string
  content: string
  actions: AssistantAction[] | null
  action_labels: string[] | null
  status: string | null
  created_at: string | Date
}

const COLS =
  "id, project_id, mode, role, content, actions, action_labels, status, created_at"

function mapRow(r: Row): AssistantMessage {
  return {
    id: r.id,
    projectId: r.project_id,
    mode: r.mode as AssistantMode,
    role: r.role === "assistant" ? "assistant" : "user",
    content: r.content,
    actions: r.actions ?? undefined,
    actionLabels: r.action_labels ?? undefined,
    status: (r.status as AssistantMessageStatus | null) ?? null,
    createdAt: typeof r.created_at === "string" ? r.created_at : r.created_at.toISOString(),
  }
}

export async function listMessages(projectId: string, limit = 100): Promise<AssistantMessage[]> {
  const res = await query<Row>(
    `SELECT ${COLS} FROM assistant_messages WHERE project_id = $1
     ORDER BY created_at ASC, id ASC LIMIT $2`,
    [projectId, limit]
  )
  return res.rows.map(mapRow)
}

export async function appendMessage(
  projectId: string,
  msg: {
    mode: AssistantMode
    role: "user" | "assistant"
    content: string
    actions?: AssistantAction[] | null
    actionLabels?: string[] | null
    status?: AssistantMessageStatus | null
  }
): Promise<AssistantMessage> {
  const res = await query<Row>(
    `INSERT INTO assistant_messages (id, project_id, mode, role, content, actions, action_labels, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${COLS}`,
    [
      `msg-${nanoid(12)}`,
      projectId,
      msg.mode,
      msg.role,
      msg.content,
      msg.actions ? JSON.stringify(msg.actions) : null,
      msg.actionLabels ? JSON.stringify(msg.actionLabels) : null,
      msg.status ?? null,
    ]
  )
  return mapRow(res.rows[0])
}

export async function setMessageStatus(
  projectId: string,
  messageId: string,
  status: AssistantMessageStatus
): Promise<void> {
  await query(
    `UPDATE assistant_messages SET status = $3 WHERE id = $1 AND project_id = $2`,
    [messageId, projectId, status]
  )
}

export async function clearThread(projectId: string): Promise<void> {
  await query(`DELETE FROM assistant_messages WHERE project_id = $1`, [projectId])
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/server/repo/assistant.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/repo/assistant.ts src/lib/server/repo/assistant.test.ts
git commit -m "feat(assistant): add assistant_messages repo"
```

---

## Task 4: Data layer + query key + hooks

**Files:**
- Modify: `src/lib/data/source.ts`, `src/lib/data/http.ts`, `src/lib/mock/index.ts`, `src/lib/data/index.ts`, `src/lib/api/keys.ts`, `src/lib/api/hooks.ts`

**Interfaces:**
- Consumes: `AssistantMessage`, `SendAssistantMessageInput`, `AssistantMessageStatus`, `describeAction` (Task 1 / actions.ts).
- Produces: `data.listAssistantMessages/sendAssistantMessage/setAssistantMessageStatus`; hooks `useAssistantMessages/useSendAssistantMessage/useSetAssistantStatus`.

- [ ] **Step 1: Update the DataSource interface** — in `src/lib/data/source.ts`, update the assistant import and replace the `askEditorAssistant` method:

```ts
import type {
  AssistantMessage,
  AssistantMessageStatus,
  SendAssistantMessageInput,
} from "@/lib/assistant/actions"
```

Replace the `askEditorAssistant(...)` member with:

```ts
  listAssistantMessages(projectId: string): Promise<AssistantMessage[]>
  sendAssistantMessage(
    projectId: string,
    input: SendAssistantMessageInput
  ): Promise<AssistantMessage>
  setAssistantMessageStatus(
    projectId: string,
    messageId: string,
    status: AssistantMessageStatus
  ): Promise<void>
```

(Remove the now-unused `EditorAssistantRequest`/`EditorAssistantResponse` import if no longer referenced.)

- [ ] **Step 2: Implement the HTTP source** — in `src/lib/data/http.ts`, replace the `askEditorAssistant` impl and import:

```ts
import type { AssistantMessage } from "@/lib/assistant/actions"
```

```ts
  listAssistantMessages: async (id) =>
    (await req<{ messages: AssistantMessage[] }>("GET", `/projects/${id}/editor/assistant`))
      ?.messages ?? [],
  sendAssistantMessage: async (id, input) =>
    (await req<{ message: AssistantMessage }>("POST", `/projects/${id}/editor/assistant`, input))
      .message,
  setAssistantMessageStatus: (id, messageId, status) =>
    req<void>("PATCH", `/projects/${id}/editor/assistant/${messageId}`, { status }),
```

- [ ] **Step 3: Implement the mock source** — in `src/lib/mock/index.ts`, replace `askEditorAssistant` with an in-memory thread. Update the import to add `AssistantMessage`, `AssistantMessageStatus`, `SendAssistantMessageInput`, `describeAction`, and `nanoid`/`nowISO` are already available. Add near the `db` object:

```ts
const assistantThreads: Record<string, AssistantMessage[]> = {}
```

Then:

```ts
export async function listAssistantMessages(projectId: string): Promise<AssistantMessage[]> {
  await delay(150)
  return structuredClone(assistantThreads[projectId] ?? [])
}

export async function sendAssistantMessage(
  projectId: string,
  input: SendAssistantMessageInput
): Promise<AssistantMessage> {
  await delay(500)
  const thread = assistantThreads[projectId] ?? (assistantThreads[projectId] = [])
  thread.push({
    id: `msg-${nanoid(12)}`, projectId, mode: input.mode, role: "user",
    content: input.instruction, createdAt: nowISO(),
  })

  // Demo: one safe sample action from the scene (mirrors the real flow shape).
  const actions: AssistantAction[] = []
  if (input.mode === "floorplan") {
    const s = input.scene as FloorplanScene
    const room = s.rooms.find((r) => r.id === s.selectedRoomId) ?? s.rooms[0]
    if (room) actions.push({ type: "updateRoom", roomId: room.id, patch: { requiresNaturalLight: true } })
  } else {
    const s = input.scene as InteriorScene
    const room = s.rooms.find((r) => r.roomId === s.selectedRoomId) ?? s.rooms[0]
    if (room) actions.push({ type: "addFurniture", roomId: room.roomId, furnitureId: "coffee-table" })
  }
  const assistant: AssistantMessage = {
    id: `msg-${nanoid(12)}`, projectId, mode: input.mode, role: "assistant",
    content: `(Mode demo) Perintahmu: “${input.instruction}”. Aktifkan backend + LLM untuk asisten sungguhan.`,
    actions: actions.length ? actions : undefined,
    actionLabels: actions.length ? actions.map((a) => describeAction(a, input.scene)) : undefined,
    status: actions.length ? "proposed" : null,
    createdAt: nowISO(),
  }
  thread.push(assistant)
  return structuredClone(assistant)
}

export async function setAssistantMessageStatus(
  projectId: string,
  messageId: string,
  status: AssistantMessageStatus
): Promise<void> {
  await delay(100)
  const m = assistantThreads[projectId]?.find((x) => x.id === messageId)
  if (m) m.status = status
}
```

- [ ] **Step 4: Wire the mock in `index.ts`** — in `src/lib/data/index.ts`, remove `askEditorAssistant: mock.askEditorAssistant,` and add:

```ts
  listAssistantMessages: mock.listAssistantMessages,
  sendAssistantMessage: mock.sendAssistantMessage,
  setAssistantMessageStatus: mock.setAssistantMessageStatus,
```

- [ ] **Step 5: Add the query key** — in `src/lib/api/keys.ts`, add to `queryKeys`:

```ts
  assistant: (projectId: string) => ["assistant", projectId] as const,
```

- [ ] **Step 6: Replace the hook** — in `src/lib/api/hooks.ts`, update imports and replace `useEditorAssistant`:

```ts
import type {
  AssistantMessageStatus,
  SendAssistantMessageInput,
} from "@/lib/assistant/actions"
```

```ts
export function useAssistantMessages(projectId: string) {
  return useQuery({
    queryKey: queryKeys.assistant(projectId),
    queryFn: () => data.listAssistantMessages(projectId),
    enabled: !!projectId,
  })
}

export function useSendAssistantMessage(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: SendAssistantMessageInput) => data.sendAssistantMessage(projectId, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.assistant(projectId) }),
  })
}

export function useSetAssistantStatus(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { messageId: string; status: AssistantMessageStatus }) =>
      data.setAssistantMessageStatus(projectId, vars.messageId, vars.status),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.assistant(projectId) }),
  })
}
```

Remove the old `EditorAssistantRequest` import if now unused.

- [ ] **Step 7: Verify**

Run: `rtk tsc`
Expected: errors remain only in `route.ts` and `editor-assistant-panel.tsx` (Tasks 5–6). Data layer + hooks compile.

- [ ] **Step 8: Commit**

```bash
git add src/lib/data src/lib/mock/index.ts src/lib/api/keys.ts src/lib/api/hooks.ts
git commit -m "feat(assistant): data layer + hooks for persisted thread"
```

---

## Task 5: API routes (GET + POST rewrite + PATCH)

**Files:**
- Modify: `src/app/api/v1/projects/[id]/editor/assistant/route.ts`
- Create: `src/app/api/v1/projects/[id]/editor/assistant/[msgId]/route.ts`

**Interfaces:**
- Consumes: repo (`listMessages`, `appendMessage`, `setMessageStatus`), `buildContextFromMessages`, `buildMessages`, `sanitizeActions`, the floorplan loop helpers, `describeAction`, `parseScene`.
- Produces: `GET → { messages }`, `POST → { message }`, `PATCH → { ok: true }`.

- [ ] **Step 1: Rewrite `route.ts`** — replace the whole file with:

```ts
import { z } from "zod"

import { requireUser } from "@/lib/server/auth-server"
import { getOwnedProject } from "@/lib/server/repo/projects"
import { ok, err, handleError } from "@/lib/server/response"
import { chatJSON, type ChatMsg } from "@/lib/server/llm"
import {
  buildContextFromMessages,
  buildMessages,
  buildRevisionMessage,
  findFloorplanViolations,
  sanitizeActions,
  simulateFloorplanActions,
} from "@/lib/server/editor-assistant"
import { appendMessage, listMessages } from "@/lib/server/repo/assistant"
import {
  describeAction,
  editorAssistantRequestSchema,
  parseScene,
  type AssistantAction,
  type AssistantTurn,
  type FloorplanAction,
  type FloorplanScene,
} from "@/lib/assistant/actions"

const FALLBACK = "Maaf, asisten AI sedang sibuk. Coba lagi sebentar ya."
const MAX_ATTEMPTS = 2
const ATTEMPT_TIMEOUT_MS = 45_000

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const { userId } = await requireUser(request)
    const { id } = await ctx.params
    const project = await getOwnedProject(id, userId)
    if (!project) return err(404, "Project not found")
    return ok({ messages: await listMessages(id) })
  } catch (e) {
    return handleError(e)
  }
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const { userId } = await requireUser(request)
    const { id } = await ctx.params
    const project = await getOwnedProject(id, userId)
    if (!project) return err(404, "Project not found")

    let rawBody: unknown
    try {
      rawBody = await request.json()
    } catch {
      return err(400, "Invalid JSON body")
    }
    const parsed = editorAssistantRequestSchema.safeParse(rawBody)
    if (!parsed.success) {
      return err(400, parsed.error.issues[0]?.message ?? "Invalid request body")
    }

    const { mode, instruction } = parsed.data
    const scene = parseScene(mode, parsed.data.scene)
    if (!scene) return err(400, "Invalid scene snapshot")

    // Context from prior thread, BEFORE appending the new user turn.
    const history = buildContextFromMessages(await listMessages(id))
    await appendMessage(id, { mode, role: "user", content: instruction })

    let reply = FALLBACK
    let actions: AssistantAction[] = []
    if (mode === "floorplan") {
      const res = await runFloorplanLoop(scene as FloorplanScene, instruction, history)
      reply = res.reply
      actions = res.actions
    } else {
      const messages = buildMessages(mode, scene, instruction, history)
      const out = await chatJSON<{ reply?: string; actions?: unknown[] }>(messages, {
        temperature: 0.3,
      })
      reply = typeof out?.reply === "string" && out.reply.trim() ? out.reply.trim() : FALLBACK
      actions = sanitizeActions(mode, out && Array.isArray(out.actions) ? out.actions : [], scene)
    }

    const labels = actions.map((a) => describeAction(a, scene))
    const message = await appendMessage(id, {
      mode,
      role: "assistant",
      content: reply,
      actions: actions.length ? actions : null,
      actionLabels: actions.length ? labels : null,
      status: actions.length ? "proposed" : null,
    })
    return ok({ message })
  } catch (e) {
    return handleError(e)
  }
}

/** Floorplan self-correction loop (propose → simulate → revise) — unchanged
 *  logic, now fed history assembled from the DB thread. */
async function runFloorplanLoop(
  scene: FloorplanScene,
  instruction: string,
  history: AssistantTurn[]
): Promise<{ reply: string; actions: FloorplanAction[] }> {
  let messages: ChatMsg[] = buildMessages("floorplan", scene, instruction, history)
  let lastReply = FALLBACK
  let lastActions: FloorplanAction[] = []

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const out = await chatJSON<{ reply?: string; actions?: unknown[] }>(messages, {
      temperature: 0.3,
      timeoutMs: ATTEMPT_TIMEOUT_MS,
    })
    if (!out) return { reply: FALLBACK, actions: [] }

    const reply = typeof out.reply === "string" && out.reply.trim() ? out.reply.trim() : FALLBACK
    const acts = sanitizeActions(
      "floorplan",
      Array.isArray(out.actions) ? out.actions : [],
      scene
    ) as FloorplanAction[]
    if (acts.length === 0) return { reply, actions: [] }

    const violations = findFloorplanViolations(simulateFloorplanActions(acts, scene), scene.site)
    if (violations.length === 0) return { reply, actions: acts }

    lastReply = reply
    lastActions = acts
    if (attempt < MAX_ATTEMPTS - 1) {
      messages = [
        ...messages,
        { role: "assistant", content: JSON.stringify({ reply, actions: acts }) },
        { role: "user", content: buildRevisionMessage(violations) },
      ]
    }
  }

  return {
    reply: `${lastReply} (Catatan: sebagian ruang mungkin masih bertumpuk — mohon tinjau sebelum menerapkan.)`,
    actions: lastActions,
  }
}
```

- [ ] **Step 2: Create the PATCH route** — create `src/app/api/v1/projects/[id]/editor/assistant/[msgId]/route.ts`:

```ts
import { z } from "zod"

import { requireUser } from "@/lib/server/auth-server"
import { getOwnedProject } from "@/lib/server/repo/projects"
import { ok, err, handleError } from "@/lib/server/response"
import { setMessageStatus } from "@/lib/server/repo/assistant"

const bodySchema = z.object({ status: z.enum(["applied", "dismissed"]) })

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string; msgId: string }> }
): Promise<Response> {
  try {
    const { userId } = await requireUser(request)
    const { id, msgId } = await ctx.params
    const project = await getOwnedProject(id, userId)
    if (!project) return err(404, "Project not found")

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return err(400, "Invalid JSON body")
    }
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) return err(400, "Invalid status")

    await setMessageStatus(id, msgId, parsed.data.status)
    return ok({ ok: true })
  } catch (e) {
    return handleError(e)
  }
}
```

- [ ] **Step 3: Verify**

Run: `rtk tsc`
Expected: errors remain only in `editor-assistant-panel.tsx` (Task 6).

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/v1/projects/[id]/editor/assistant"
git commit -m "feat(assistant): persist thread + DB-sourced context in routes"
```

---

## Task 6: Panel UI — render the persisted thread

**Files:**
- Modify: `src/components/assistant/editor-assistant-panel.tsx`

**Interfaces:**
- Consumes: `useAssistantMessages`, `useSendAssistantMessage`, `useSetAssistantStatus`; `buildFloorplanScene`/`buildInteriorScene`, `applyFloorplanActions`/`applyInteriorActions`; `AssistantMessage`.

- [ ] **Step 1: Rewrite the panel** — replace `src/components/assistant/editor-assistant-panel.tsx` with:

```tsx
"use client"

import * as React from "react"
import { Check, Loader2, Send, Sparkles, Trash2, X } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  useAssistantMessages,
  useSendAssistantMessage,
  useSetAssistantStatus,
} from "@/lib/api/hooks"
import type { AssistantMessage, AssistantMode, FloorplanAction, InteriorAction } from "@/lib/assistant/actions"
import {
  applyFloorplanActions,
  applyInteriorActions,
  buildFloorplanScene,
  buildInteriorScene,
} from "@/lib/assistant/apply"
import { cn } from "@/lib/utils"

const PROMPTS: Record<AssistantMode, string[]> = {
  floorplan: ["Perbesar kamar tidur utama jadi 4×4 m", "Tambahkan jendela di ruang tamu", "Kunci semua kamar"],
  interior: ["Tambahkan sofa di ruang tamu", "Tata ulang kamar tidur", "Ganti gaya jadi Japandi"],
}
const MODE_LABEL: Record<AssistantMode, string> = { floorplan: "Denah", interior: "Interior" }

export function EditorAssistantPanel({ projectId, mode }: { projectId: string; mode: AssistantMode }) {
  const { data: messages = [], isLoading } = useAssistantMessages(projectId)
  const send = useSendAssistantMessage(projectId)
  const setStatus = useSetAssistantStatus(projectId)
  const [input, setInput] = React.useState("")
  const scrollRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [messages, send.isPending])

  // The single actionable proposal: latest 'proposed' message of THIS mode.
  const actionableId = React.useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.role === "assistant" && m.status === "proposed" && m.mode === mode) return m.id
    }
    return null
  }, [messages, mode])

  function submit(raw: string) {
    const instruction = raw.trim()
    if (!instruction || send.isPending) return
    const scene = mode === "floorplan" ? buildFloorplanScene() : buildInteriorScene()
    if (!scene) {
      toast.error(mode === "floorplan" ? "Belum ada denah untuk diedit." : "Belum ada interior untuk diedit.")
      return
    }
    setInput("")
    send.mutate({ mode, instruction, scene })
  }

  function applyMsg(m: AssistantMessage) {
    if (!m.actions?.length) return
    const count =
      m.mode === "floorplan"
        ? applyFloorplanActions(m.actions as FloorplanAction[])
        : applyInteriorActions(m.actions as InteriorAction[])
    setStatus.mutate({ messageId: m.id, status: "applied" })
    if (count > 0) toast.success(`${count} perubahan diterapkan. Tekan Ctrl+Z untuk membatalkan.`)
    else toast.error("Tidak ada perubahan yang bisa diterapkan.")
  }

  const empty = messages.length === 0 && !isLoading && !send.isPending

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid={`editor-assistant-${mode}`}>
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {isLoading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Memuat percakapan…
          </div>
        )}

        {empty && (
          <div className="space-y-3">
            <p className="flex items-center gap-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
              <Sparkles className="size-4 shrink-0 text-info" aria-hidden />
              {mode === "floorplan"
                ? "Tulis perintah untuk mengubah denah — ukuran/nama ruang, pintu/jendela, pindah lantai."
                : "Tulis perintah untuk menata interior — tambah/pindah/putar furnitur, ganti gaya."}
            </p>
            <div className="space-y-2">
              {PROMPTS[mode].map((p) => (
                <Button key={p} variant="outline" size="sm" className="w-full justify-start text-left" onClick={() => submit(p)}>
                  {p}
                </Button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className="space-y-1">
            <div
              className={cn(
                "rounded-lg px-3 py-2 text-sm",
                m.role === "user" ? "ml-6 bg-primary/10" : "mr-6 bg-muted"
              )}
            >
              <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
            </div>

            {m.role === "assistant" && m.actionLabels?.length ? (
              <div className="mr-6 space-y-2 rounded-lg border border-info/40 bg-info/5 p-3">
                <p className="flex items-center justify-between text-xs font-semibold uppercase text-muted-foreground">
                  <span>Usulan perubahan ({m.actionLabels.length})</span>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{MODE_LABEL[m.mode]}</span>
                </p>
                <ul className="space-y-1">
                  {m.actionLabels.map((label, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-info" aria-hidden />
                      <span>{label}</span>
                    </li>
                  ))}
                </ul>
                {m.id === actionableId ? (
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" className="flex-1" onClick={() => applyMsg(m)} disabled={setStatus.isPending}>
                      <Check className="size-4" aria-hidden /> Terapkan
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setStatus.mutate({ messageId: m.id, status: "dismissed" })}>
                      <X className="size-4" aria-hidden /> Abaikan
                    </Button>
                  </div>
                ) : (
                  <p className={cn("text-xs font-medium", m.status === "applied" ? "text-success" : "text-muted-foreground")}>
                    {m.status === "applied" ? "✓ Diterapkan" : m.status === "dismissed" ? "Diabaikan" : "Riwayat"}
                  </p>
                )}
              </div>
            ) : null}
          </div>
        ))}

        {send.isPending && (
          <div className="mr-6 flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" aria-hidden /> AI sedang menyusun…
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); submit(input) }}
        className="flex gap-2 border-t p-3"
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={mode === "floorplan" ? "Perintah untuk denah…" : "Perintah untuk interior…"}
          disabled={send.isPending}
          aria-label="Perintah untuk AI assistant editor"
        />
        <Button type="submit" size="icon" disabled={send.isPending || !input.trim()} aria-label="Kirim perintah">
          <Send className="size-4" aria-hidden />
        </Button>
      </form>
    </div>
  )
}
```

> Note: `Trash2` is imported for a future "Hapus riwayat" control; if the linter flags it as unused, remove the import (clear-thread UI can be added later via `clearThread` — not required for this task).

- [ ] **Step 2: Verify build + types**

Run: `rtk tsc` then `npx next build`
Expected: both succeed (0 errors). The panel renders the persisted thread; old `useEditorAssistant` no longer referenced anywhere.

- [ ] **Step 3: Commit**

```bash
git add src/components/assistant/editor-assistant-panel.tsx
git commit -m "feat(assistant): render persisted thread + tool-call cards"
```

---

## Task 7: Full verification

- [ ] **Step 1: Type-check + tests + build**

Run: `rtk tsc` · `npx vitest run` · `npx next build`
Expected: tsc clean; all tests pass (incl. Task 2/3 additions); build succeeds.

- [ ] **Step 2: Manual (mock mode — local default)**

Run `npx next dev`. In the 2D Denah editor: send a command → user + assistant bubbles appear with a tool-call card; **Terapkan** applies + card shows "✓ Diterapkan". Reload the page → the thread is still there (mock persists in module memory for the session). Open the 3D Interior editor → the SAME thread is visible (unified per project), interior turns tagged "Interior"; only the latest interior proposal is actionable there.

- [ ] **Step 3: Manual (real DB/LLM)**

Apply `db/migrations/0006_assistant.sql` to the central DB, set the HTTP/LLM env, and repeat Step 2 against the deployed/HTTP path: confirm history survives a full reload (DB-backed) and that the assistant's context reflects prior applied edits.

- [ ] **Step 4: Final commit (if any fixes)**

```bash
git add -A
git commit -m "test(assistant): verify conversation history end-to-end"
```

---

## Self-Review

**Spec coverage:** schema (Task 1) · repo (Task 3) · GET/POST/PATCH (Task 5) · data layer + hooks + shared cache key (Task 4) · panel thread + tool-call cards + status + mode tag + mode-gated apply (Task 6) · history-as-context incl. applied summary (Task 2, used in Task 5) · testing (Tasks 2,3,7) · rollout/migration (Tasks 1,7). ✓

**Placeholder scan:** none — every step has concrete code/commands. (The `Trash2` note is an explicit optional, not a placeholder.)

**Type consistency:** `AssistantMessage`/`AssistantMessageStatus`/`SendAssistantMessageInput` (Task 1) used consistently in repo/data/hooks/route/panel; `listMessages`/`appendMessage`/`setMessageStatus` signatures match between Task 3 (repo) and Task 5 (route); `buildContextFromMessages` signature matches between Task 2 and Task 5; data-layer method names match between Task 4 (source/http/mock) and the hooks/panel.
