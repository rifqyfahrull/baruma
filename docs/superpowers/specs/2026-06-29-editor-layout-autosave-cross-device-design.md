# Editor: Layout Autosave + Cross-Device Freshness

**Date:** 2026-06-29
**Status:** Design (awaiting review)
**Covers:** making denah edits consistent across devices/tabs/refresh — the deferred part of the "2D & 3D selaras" work, now scoped to the server as the shared channel.

## Context / Problem

The denah editor persists to the server **only on a manual "Simpan"**:
- `/editor` edits mutate `useEditorStore` (live draft); the server record is written just by `useSaveLayout` when the user clicks Simpan ([editor/page.tsx](../../../src/app/app/projects/[projectId]/editor/page.tsx) `onSave`).
- `/preview-3d` reads the layout query; on a cold load it fetches the server's latest, and (from the prior fix) prefers the in-memory `useEditorStore` draft for the same project ([effective-layout.ts](../../../src/components/preview-3d/effective-layout.ts)).

So **across devices** (or a different browser/tab after a full reload), an edit made on device A is invisible on device B until the user manually saves on A — the in-memory draft never leaves device A. To be consistent cross-device, edits must reach the **server** automatically.

The interior side already solves the same problem with a debounced autosave hook ([use-interior-autosave.ts](../../../src/hooks/use-interior-autosave.ts)) + `useSaveInterior`. We mirror that for the layout.

**Confirmed decisions:** cross-device consistency via the **server** (layout is JSONB — reuse `saveLayout`, no new table/endpoint) · freshness **on open / refresh / focus** (no polling, no websockets) · last-write-wins (single-user assumption).

## Non-goals (v1)

- Real-time push (WebSocket/SSE) or polling while both views stay open.
- Multi-user conflict resolution / merge (last-write-wins).
- A separate "draft vs published" record — autosave writes the single layout record (same as manual Simpan).
- No DB migration, no data-layer/API change.

## Stage 1 — Layout autosave hook

New `src/hooks/use-layout-autosave.ts`, a direct mirror of `use-interior-autosave`:
- Watches `useEditorStore` `dirty` + `layout`; **800 ms** after the last change, calls `useSaveLayout(projectId).mutate(layout)`; on success `markSaved()`; returns `SaveStatus` (`idle | saving | saved | error`).
- Drag frames set `dirty` repeatedly, but the debounce timer resets each change (deps `[dirty, layout]`), so it fires only ~800 ms after a gesture ends — same proven pattern as interior.

Wire into `/editor`:
- Call `useLayoutAutosave(projectId)` in the editor page; surface its status where the current "Belum tersimpan / Tersimpan" indicator sits.
- Keep the **Simpan** button as an explicit flush (harmless if autosave already saved — idempotent). Its disabled/`dirty` wiring stays.

`useSaveLayout.onSuccess` already does `setQueryData(queryKeys.layout, saved)`, so the same client's cache stays current after every autosave.

## Stage 2 — Preview freshness on open / refresh / focus

For device B, every cold page load already cold-fetches the server's latest (autosaved) layout — that covers new device / new tab / full refresh. To also update an **already-open** `/preview-3d` tab when the user returns to it, make its layout query refetch on mount + focus **without** disturbing the editor:

- `useLayout(projectId)` gains an optional `{ fresh?: boolean }`:
  - default (editor): unchanged — `staleTime: Infinity`, no auto-refetch (the editor renders from the store; `loadLayout` guards on `layout.id`, so a refetch wouldn't clobber, but we keep its behavior stable).
  - `fresh: true` (preview): `refetchOnMount: "always"` + `refetchOnWindowFocus: true` + finite `staleTime` (e.g. 0) so opening/re-focusing the preview pulls the server's latest.
- `/preview-3d/page.tsx` calls `useLayout(projectId, { fresh: true })`.
- Keep `pickEffectiveLayout(editorLayout, fetchedLayout, projectId)` — the in-memory draft still gives instant same-tab/same-session responsiveness (0–800 ms before autosave flushes); the fetched value is now reliably current for cross-device.

## Data flow (cross-device, "on open/refresh")

1. Device A edits → `dirty` → ~800 ms later autosave `POST` to server (record updated) → indicator "Tersimpan".
2. Device B opens/refreshes `/preview-3d` (or the editor) → cold fetch → gets the autosaved latest. An already-open preview on B refetches when re-focused.
3. Same-tab on A: `/editor` → `/preview-3d` shows the draft instantly via `pickEffectiveLayout`, and the server copy is current within ~800 ms.

## Testing

- `useLayoutAutosave`: mirrors the interior-autosave contract — on `dirty`+layout, after the debounce it calls save then `markSaved`; error path sets `error`. (Test the debounce/flush logic the way `use-interior-autosave` is exercised; or extract the pure "should save" decision if hook testing is awkward.)
- `useLayout` `fresh` option: passing `fresh: true` sets `refetchOnMount: "always"` + `refetchOnWindowFocus: true`; default keeps `staleTime: Infinity` (a light unit/inspection check).
- Existing editor/preview tests stay green.
- Manual (two browsers / two tabs): edit on A → wait ~1 s → open/refresh preview on B → shows the change; re-focus an already-open preview on B → updates.

## Rollout

No DB migration, no API change (reuses `saveLayout`, layout is JSONB). Verify `rtk tsc` · `npx vitest run` · `npx next build`.

## Sequencing (one spec, 2 shippable stages, in order 1→2)

1. **Autosave hook** — `use-layout-autosave` + wire into `/editor` (edits reach the server automatically; this alone fixes cross-device on cold load).
2. **Preview freshness** — `useLayout({ fresh })` + `/preview-3d` uses it (already-open/refocused preview pulls latest).
