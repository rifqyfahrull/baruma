# Editor Layout Autosave + Cross-Device Freshness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Denah edits reach the server automatically (debounced autosave) so other devices/tabs see them on open/refresh/focus.

**Architecture:** Mirror the proven interior autosave: a `useLayoutAutosave` hook watches the editor store's `dirty` flag and debounce-saves via the existing `useSaveLayout`. The `/preview-3d` layout query opts into refetch-on-mount/focus so an already-open preview pulls the latest. No new endpoint/table (layout is JSONB; reuse `saveLayout`).

**Tech Stack:** Next.js 16 · zustand · TanStack Query · vitest.

## Global Constraints

- Spec: [docs/superpowers/specs/2026-06-29-editor-layout-autosave-cross-device-design.md](../specs/2026-06-29-editor-layout-autosave-cross-device-design.md).
- Reuse `saveLayout` (no new API/DB migration). Debounce **800 ms** (match `use-interior-autosave`). Last-write-wins.
- Freshness = on open / refresh / focus only (no polling, no websockets).
- The editor's own `useLayout` call stays unchanged (`staleTime: Infinity`); only `/preview-3d` opts into freshness.
- Keep the manual **Simpan** button and `pickEffectiveLayout`. Verify `rtk tsc` · `npx vitest run` · `npx next build`.

---

## File Structure

- Create `src/hooks/use-layout-autosave.ts` — debounced layout autosave (mirror of `use-interior-autosave.ts`).
- Modify `src/app/app/projects/[projectId]/editor/page.tsx` — call the hook; show its status.
- Modify `src/lib/api/hooks.ts` — `useLayout(projectId, opts?)` gains an optional `{ fresh }`.
- Modify `src/app/app/projects/[projectId]/preview-3d/page.tsx` — call `useLayout(projectId, { fresh: true })`.

---

## Task 1: Layout autosave hook + wire into editor

**Files:**
- Create: `src/hooks/use-layout-autosave.ts`
- Modify: `src/app/app/projects/[projectId]/editor/page.tsx`

**Interfaces:**
- Consumes: `useEditorStore` (`layout`, `dirty`, `markSaved`); `useSaveLayout` ([hooks.ts](../../../src/lib/api/hooks.ts)); `SaveStatus` type shape (`"idle" | "saving" | "saved" | "error"`).
- Produces: `useLayoutAutosave(projectId: string): SaveStatus`.

- [ ] **Step 1: Create the hook** — `src/hooks/use-layout-autosave.ts` (direct mirror of [use-interior-autosave.ts](../../../src/hooks/use-interior-autosave.ts)):

```ts
"use client"

import * as React from "react"

import { useEditorStore } from "@/stores/editor-store"
import { useSaveLayout } from "@/lib/api/hooks"

export type SaveStatus = "idle" | "saving" | "saved" | "error"

/**
 * Debounced autosave for denah edits. Watches the editor store's `dirty` flag
 * and, 800ms after the last change, persists the current layout via
 * useSaveLayout so other devices/tabs see it on open/refresh.
 */
export function useLayoutAutosave(projectId: string): SaveStatus {
  const layout = useEditorStore((s) => s.layout)
  const dirty = useEditorStore((s) => s.dirty)
  const markSaved = useEditorStore((s) => s.markSaved)
  const save = useSaveLayout(projectId)
  const [status, setStatus] = React.useState<SaveStatus>("idle")

  const saveRef = React.useRef(save)
  saveRef.current = save

  React.useEffect(() => {
    if (!dirty || !layout) return
    const handle = setTimeout(() => {
      setStatus("saving")
      saveRef.current.mutate(layout, {
        onSuccess: () => {
          markSaved()
          setStatus("saved")
        },
        onError: () => setStatus("error"),
      })
    }, 800)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, layout])

  return status
}
```

- [ ] **Step 2: Wire into the editor** — in `editor/page.tsx`, inside the client component that already reads `dirty`/`markSaved`/`save` (the one rendering the Simpan button):

(a) import: `import { useLayoutAutosave } from "@/hooks/use-layout-autosave"`.
(b) call it near the other hooks:
```ts
  const autosaveStatus = useLayoutAutosave(projectId)
```
(c) Reflect it in the existing status indicator (the `<span>` currently showing "Belum tersimpan / Tersimpan"). Replace that span's inner logic with:
```tsx
            {autosaveStatus === "saving" ? (
              <>Menyimpan…</>
            ) : autosaveStatus === "error" ? (
              <span className="text-destructive">Gagal menyimpan otomatis</span>
            ) : dirty ? (
              <>Belum tersimpan</>
            ) : (
              <>
                <Check className="size-3 text-success" /> Tersimpan
              </>
            )}
```
(Leave the manual Simpan button as-is — it remains a valid explicit flush.)

- [ ] **Step 3: Verify**

Run: `rtk tsc` then `npx next build`
Expected: 0 errors; build succeeds. Manual: make an edit, stop → ~0.8 s later the indicator shows "Menyimpan…" then "Tersimpan" without clicking Simpan.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/use-layout-autosave.ts src/app/app/projects/[projectId]/editor/page.tsx
git commit -m "feat(editor): debounced layout autosave (cross-device via server)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `useLayout({ fresh })` + preview opts in

**Files:**
- Modify: `src/lib/api/hooks.ts`
- Modify: `src/app/app/projects/[projectId]/preview-3d/page.tsx`

**Interfaces:**
- Produces: `useLayout(projectId: string, opts?: { fresh?: boolean })`.

- [ ] **Step 1: Add the option** — in `hooks.ts`, replace the current `useLayout`:

```ts
export function useLayout(projectId: string, opts?: { fresh?: boolean }) {
  return useQuery({
    queryKey: queryKeys.layout(projectId),
    queryFn: () => data.getLayout(projectId),
    enabled: !!projectId,
    // editor: editing is local; refetch would clobber the draft → never auto-refetch.
    // preview (fresh): pull the server's latest on open/refresh/focus (cross-device).
    staleTime: opts?.fresh ? 0 : Infinity,
    refetchOnMount: opts?.fresh ? "always" : true,
    refetchOnWindowFocus: opts?.fresh ? true : false,
  })
}
```
(The editor default preserves prior behavior: `staleTime: Infinity` + `refetchOnWindowFocus: false`; `refetchOnMount: true` with infinite staleTime does not refetch a fresh cache, matching today.)

- [ ] **Step 2: Preview opts in** — in `preview-3d/page.tsx`, change the layout query call:
```ts
  const { data: fetchedLayout, isLoading } = useLayout(projectId, { fresh: true })
```
(Everything else — `pickEffectiveLayout`, the loading/empty gates — stays as-is.)

- [ ] **Step 3: Verify**

Run: `rtk tsc` then `npx next build`
Expected: 0 errors; build succeeds. Manual (two tabs): edit + autosave in `/editor` tab; switch to an already-open `/preview-3d` tab → on focus it refetches and shows the change.

- [ ] **Step 4: Commit**

```bash
git add src/lib/api/hooks.ts src/app/app/projects/[projectId]/preview-3d/page.tsx
git commit -m "feat(preview-3d): refetch layout on mount/focus for cross-device freshness

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Full verification

- [ ] **Step 1: tsc + tests + build**

Run: `rtk tsc` · `npx vitest run` · `npx next build`
Expected: tsc clean; all tests pass; build succeeds.

- [ ] **Step 2: Manual smoke**

`npx next dev`: edit a room in `/editor`, don't click Simpan → indicator auto-goes "Menyimpan…"→"Tersimpan". Open `/preview-3d` in a second tab / after a full refresh → shows the edit. Re-focus an already-open preview after another edit → updates. The manual Simpan button still works.

- [ ] **Step 3: Final commit (if fixes)**

```bash
git add -A && git commit -m "test(editor): verify layout autosave + cross-device freshness

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** Stage 1 autosave → T1 (`useLayoutAutosave` + wire + status). Stage 2 freshness → T2 (`useLayout({fresh})` + preview opts in). `pickEffectiveLayout` kept (untouched). Manual Simpan kept (T1 leaves it). Verification → T3. ✓

**Placeholder scan:** none — full code/commands throughout.

**Type consistency:** `useLayoutAutosave(projectId): SaveStatus` matches T1 def ↔ editor call. `useLayout(projectId, opts?: { fresh?: boolean })` matches T2 def ↔ preview call (and the editor's existing no-arg call still type-checks since `opts` is optional). `SaveStatus` union identical to the interior hook's.

**Notes for implementers:** (T1) mirror `use-interior-autosave.ts` exactly — same debounce, `saveRef` pattern, and the `eslint-disable` for the deps line; only the store/mutation swap (`useEditorStore`/`useSaveLayout`/`layout`). Confirm the editor client component (not the outer `EditorPage` gate) is where `dirty`/`Check` are in scope before adding the status JSX. (T2) confirm the editor's existing `useLayout(projectId)` call site compiles unchanged (optional 2nd arg).
