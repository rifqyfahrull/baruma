# AI Assistant — Persistent Conversation History + Tool-Call UI + Context

**Date:** 2026-06-29
**Status:** Design (awaiting review)
**Sub-project:** A of {A: assistant history, B: 2D↔3D editor integration}

## Context / Problem

The editor AI Assistant (2D "Asisten Denah" + 3D "Asisten Interior") keeps its conversation in component-local `useState`. Consequences:

- History is **lost on reload / navigation**, and **each panel instance** (desktop aside, mobile drawer, 3D accordion) has its **own** independent state.
- **Tool calls** (proposed/applied actions) are shown as an ephemeral card, **not part of the conversation**, and not persisted.
- The LLM only receives the in-memory text turns as context; applied edits aren't reflected.

**Goal:** persist the conversation (incl. tool calls) in the **database**, render tool calls inline in the thread with status, share one thread across all panels + reloads, and use the stored thread (incl. applied actions) as **LLM context**.

**Decisions confirmed with user:** DB-backed persistence · **one unified thread per project** (shared by both floorplan & interior assistants).

## Non-goals (this sub-project)

- Merging the two stores / live 2D→3D sync (that is sub-project B).
- Editing/regenerating past messages, streaming responses, multi-conversation per project.

## Thread model

- **Thread = `projectId`** (one per project). Both panels render the same thread.
- Each **message carries `mode`** (`floorplan` | `interior`) — needed to type its actions, gate apply, and tag it in the UI.
- LLM **context = the whole project thread** (both modes interleaved chronologically), but a turn's **proposed actions are constrained to the active mode/scene** (system prompt + sanitizer stay mode-specific).

## 1. Schema — `db/migrations/0006_assistant.sql`

```sql
create table assistant_messages (
  id            text primary key,
  project_id    text not null references projects(id) on delete cascade,
  mode          text not null,            -- 'floorplan' | 'interior'
  role          text not null,            -- 'user' | 'assistant'
  content       text not null,
  actions       jsonb,                    -- AssistantAction[] (raw, for apply), nullable
  action_labels jsonb,                    -- string[] (describeAction at creation, for display)
  status        text,                     -- null | 'proposed' | 'applied' | 'dismissed'
  created_at    timestamptz not null default now()
);
create index assistant_messages_thread on assistant_messages (project_id, created_at);
```

Thread keyed by `project_id` only; `mode` is a per-message attribute (YAGNI: no separate conversations table). **Migration 0006 must be applied to the central DB** (same mechanism as 0001–0005; `db/migrations/0001_init.sql` is canonical).

## 2. Repo — `src/lib/server/repo/assistant.ts`

Mirrors [interiors.ts](../../../src/lib/server/repo/interiors.ts):
- `listMessages(projectId, limit = 100): AssistantMessage[]` — whole project thread, asc.
- `appendMessage(projectId, { mode, role, content, actions?, actionLabels?, status? }): AssistantMessage` — insert (`id` via `nanoid`).
- `setMessageStatus(messageId, projectId, status): void` — guard by projectId.
- `clearThread(projectId): void` — for "Hapus riwayat".

`AssistantMessage` row type lives in `src/lib/assistant/actions.ts` (isomorphic) so client + server share it.

## 3. API routes

- `GET /api/v1/projects/[id]/editor/assistant` → `{ messages: AssistantMessage[] }` (whole project thread).
- `POST /api/v1/projects/[id]/editor/assistant` — body `{ mode, instruction, scene }` (**no client `history`**):
  1. `requireUser` + `getOwnedProject`.
  2. `appendMessage` the **user** turn (mode, content=instruction).
  3. Load recent thread via `listMessages` → build LLM context (text turns + a summary of previously **applied** actions).
  4. Run existing flow: floorplan self-correcting loop / interior single-shot.
  5. Compute `action_labels = actions.map(a => describeAction(a, scene))`; `appendMessage` the **assistant** turn (reply, actions, action_labels, status = `proposed` if actions else null).
  6. Return `{ message: <assistant message> }`.
- `PATCH /api/v1/projects/[id]/editor/assistant/[msgId]` — body `{ status }` → `setMessageStatus`.

## 4. Data layer + hooks

- [source.ts](../../../src/lib/data/source.ts): replace `askEditorAssistant` with `listAssistantMessages(projectId)`, `sendAssistantMessage(projectId, { mode, instruction, scene })`, `setAssistantMessageStatus(projectId, msgId, status)`.
- [http.ts](../../../src/lib/data/http.ts) + [mock/index.ts](../../../src/lib/mock/index.ts) (in-memory `Map<projectId, AssistantMessage[]>`) + [index.ts](../../../src/lib/data/index.ts) wiring.
- [hooks.ts](../../../src/lib/api/hooks.ts): `useAssistantMessages(projectId)` (query, key `[assistant, projectId]`), `useSendAssistantMessage(projectId)`, `useSetAssistantStatus(projectId)`. The shared React Query cache key gives **cross-panel sharing + reload persistence** for free.

## 5. Panel UI — rework [editor-assistant-panel.tsx](../../../src/components/assistant/editor-assistant-panel.tsx)

- Thread from `useAssistantMessages(projectId)` (drop local `messages` state; keep `input`).
- Render each turn: user/assistant bubble + small **mode tag** (Denah/Interior). Assistant turns with actions show a **tool-call card**: `action_labels` list + **status badge** (Diusulkan/Diterapkan/Diabaikan).
- **Terapkan/Abaikan** shown only on the **latest `proposed` message whose `mode === panel mode`**; others are read-only.
  - Terapkan → `applyFloorplanActions`/`applyInteriorActions` (existing) + `useSetAssistantStatus(msgId, "applied")`.
  - Abaikan → status `dismissed`.
- `useSendAssistantMessage` on submit (optimistic user bubble; on success the assistant message arrives via cache update/invalidate). Header: **"Hapus riwayat"** (clear thread, confirm).

## 6. History as context (server-side)

New pure helper `buildContextFromMessages(messages, maxTurns)` in `src/lib/server/editor-assistant.ts`: maps recent turns → `ChatMsg[]` (role/content) and appends a compact **applied-actions summary** (from `action_labels` of `status==='applied'` messages, e.g. "Sebelumnya diterapkan: tambah Sofa ke Ruang Tamu"). Fed into `buildMessages` as `history`. Client no longer sends history.

## 7. Testing

- `buildContextFromMessages` unit test (text mapping, applied-summary, trimming to maxTurns).
- Repo: in-memory mock behavior test (append/list/setStatus/clear).
- Keep existing floorplan-loop + sanitizer + dimensions/format tests green.

## 8. Rollout

1. Apply `0006_assistant.sql` to the central DB.
2. Deploy app (push → `git reset --hard origin/main` + build + pm2). Mock mode (local default) uses the in-memory Map, so local dev works without DB.

## Open items intentionally deferred

- Streaming, message edit/regenerate, per-project multiple threads → future.
- Unifying the two editor **stores** / live sync → sub-project B.
