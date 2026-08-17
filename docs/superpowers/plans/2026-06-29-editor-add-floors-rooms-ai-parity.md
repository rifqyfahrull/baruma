# Editor: Add Floors + Rooms + Full AI Parity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add room + floor creation to the 2D editor (pick-type-then-click for rooms, +/remove for floors), make room type editable, and give the AI "Asisten Denah" parity over the **entire** editor mutation surface.

**Architecture:** Pure builders (`makeRoom`/`makeFloor`) feed new undo-aware `editor-store` actions (`addRoom`/`addFloor`/`removeFloor` + `pendingRoomType`). UI: a toolbar room-type picker arms placement; the canvas places on click; the FloorSwitcher gains +/remove; the inspector type becomes a Select. The AI floorplan action set gains `addRoom`/`addFloor`/`removeFloor`/`updateOpening`/`deleteOpening` (schema + sanitizer + simulate + prompt + describe + apply).

**Tech Stack:** Next.js 16 · zustand · zod · SVG 2D canvas · React Three Fiber (no change) · vitest.

## Global Constraints

- Spec: [docs/superpowers/specs/2026-06-29-editor-add-floors-rooms-ai-parity-design.md](../specs/2026-06-29-editor-add-floors-rooms-ai-parity-design.md).
- No DB migration (`DesignLayout` is JSONB). No new npm deps (`nanoid` already present).
- All store mutations go through the existing `commit()` (one undo entry, auto-revalidate). Room min size `MIN_ROOM = 1.2` m; sizes/positions clamped to the lot.
- **AI must reach every editor mutation** — after Task 6 the floorplan action set covers add/edit/delete room, add/edit/delete opening, add/remove floor, lock, zone, level, move-floor.
- UI copy Bahasa Indonesia. Verify `rtk tsc` · `npx vitest run` · `npx next build`.

---

## File Structure

- Create `src/lib/editor/create.ts` — `makeRoom`, `makeFloor` (pure) + test.
- Modify `src/stores/editor-store.ts` — `pendingRoomType`/`setPendingRoomType`, `addRoom`, `addFloor`, `removeFloor` + test.
- Modify `src/components/editor/editor-toolbar.tsx` — "Tambah Ruang" room-type dropdown.
- Modify `src/components/editor/plan-canvas.tsx` — place room on click in `"room"` tool.
- Modify `src/components/editor/floor-switcher.tsx` — always visible + add/remove floor.
- Modify `src/components/editor/editor-inspector.tsx` — editable Tipe (Select).
- Modify `src/lib/assistant/actions.ts`, `src/lib/server/editor-assistant.ts`, `src/lib/assistant/apply.ts` (+ tests) — AI parity.

---

## Task 1: Pure builders `makeRoom` / `makeFloor`

**Files:**
- Create: `src/lib/editor/create.ts`
- Test: `src/lib/editor/create.test.ts`

**Interfaces:**
- Consumes: `ROOM_TYPES` ([constants](../../../src/lib/constants/index.ts)); `roomArea`, `round2`, `clamp` ([geometry](../../../src/lib/geometry/index.ts)).
- Produces: `makeRoom(type: RoomType, x: number, y: number, floorId: string, site: {widthM:number;depthM:number}, snap?: (v:number)=>number): Room`; `makeFloor(existing: Floor[]): Floor`.

- [ ] **Step 1: Write the failing test** — create `src/lib/editor/create.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { makeRoom, makeFloor } from "./create"

const site = { widthM: 10, depthM: 12 }

describe("makeRoom", () => {
  it("derives a square-ish default size from the type and clamps into the lot", () => {
    const r = makeRoom("kamar_tidur", 2, 2, "f1", site) // defaultAreaM2 = 12
    expect(r.floorId).toBe("f1")
    expect(r.type).toBe("kamar_tidur")
    expect(r.name).toBe("Kamar tidur")
    expect(r.width).toBeCloseTo(3.5, 5) // round(sqrt(12)*2)/2
    expect(r.depth).toBeCloseTo(3.5, 5)
    expect(r.areaM2).toBeCloseTo(12.25, 5)
    expect(r.id).toMatch(/^room-/)
  })
  it("clamps position so the room stays inside the lot", () => {
    const r = makeRoom("ruang_tamu", 100, 100, "f1", site)
    expect(r.x + r.width).toBeLessThanOrEqual(site.widthM + 1e-6)
    expect(r.y + r.depth).toBeLessThanOrEqual(site.depthM + 1e-6)
  })
  it("applies the snap fn to position", () => {
    const r = makeRoom("dapur", 1.2, 1.2, "f1", site, (v) => Math.round(v))
    expect(r.x).toBe(1)
    expect(r.y).toBe(1)
  })
})

describe("makeFloor", () => {
  it("assigns the next level and a derived name", () => {
    const f = makeFloor([
      { id: "a", level: 1, name: "Lantai 1", heightM: 3 },
      { id: "b", level: 2, name: "Lantai 2", heightM: 3.2 },
    ])
    expect(f.level).toBe(3)
    expect(f.name).toBe("Lantai 3")
    expect(f.heightM).toBe(3.2) // copied from the last floor
    expect(f.id).toMatch(/^floor-/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/editor/create.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — create `src/lib/editor/create.ts`:

```ts
/** Pure constructors for new rooms/floors created in the editor. */
import { nanoid } from "nanoid"

import type { Floor, Room, RoomType } from "@/types"
import { ROOM_TYPES } from "@/lib/constants"
import { clamp, roomArea, round2 } from "@/lib/geometry"

const MIN_ROOM = 1.2

export function makeRoom(
  type: RoomType,
  x: number,
  y: number,
  floorId: string,
  site: { widthM: number; depthM: number },
  snap?: (v: number) => number
): Room {
  const side = Math.max(MIN_ROOM, Math.round(Math.sqrt(ROOM_TYPES[type].defaultAreaM2) * 2) / 2)
  const width = round2(clamp(side, MIN_ROOM, site.widthM))
  const depth = round2(clamp(side, MIN_ROOM, site.depthM))
  const sx = snap ? snap(x) : x
  const sy = snap ? snap(y) : y
  return {
    id: `room-${nanoid(8)}`,
    floorId,
    name: ROOM_TYPES[type].label,
    type,
    x: round2(clamp(sx, 0, Math.max(0, site.widthM - width))),
    y: round2(clamp(sy, 0, Math.max(0, site.depthM - depth))),
    width,
    depth,
    areaM2: roomArea(width, depth),
  }
}

export function makeFloor(existing: Floor[]): Floor {
  const level = Math.max(0, ...existing.map((f) => f.level)) + 1
  return {
    id: `floor-${nanoid(6)}`,
    level,
    name: `Lantai ${level}`,
    heightM: existing[existing.length - 1]?.heightM ?? 3,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/editor/create.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/editor/create.ts src/lib/editor/create.test.ts
git commit -m "feat(editor): pure makeRoom/makeFloor builders

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Store actions — addRoom / addFloor / removeFloor

**Files:**
- Modify: `src/stores/editor-store.ts`
- Test: `src/stores/editor-store.test.ts`

**Interfaces:**
- Consumes: `makeRoom`/`makeFloor` (Task 1); existing `commit`, `snap`, `selectedFloorId`, `site`.
- Produces (on `useEditorStore`): `pendingRoomType: RoomType | null`, `setPendingRoomType(t)`, `addRoom(type, x, y)`, `addFloor()`, `removeFloor(floorId)`.

- [ ] **Step 1: Write the failing test** — create `src/stores/editor-store.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest"
import { useEditorStore } from "./editor-store"
import type { DesignLayout } from "@/types"

const layout = (): DesignLayout => ({
  id: "l", projectId: "p", versionId: "v",
  floors: [{ id: "f1", level: 1, name: "Lantai 1", heightM: 3 }],
  rooms: [{ id: "r1", floorId: "f1", name: "R", type: "ruang_tamu", x: 0, y: 0, width: 3, depth: 3, areaM2: 9 }],
  walls: [], openings: [], stairs: [], pools: [],
  validation: { passed: true, issues: [] },
})
const site = { widthM: 10, depthM: 12 }

beforeEach(() => useEditorStore.getState().loadLayout(layout(), site, []))

describe("editor-store create actions", () => {
  it("addRoom appends a room on the active floor and selects it; undo restores", () => {
    const s = useEditorStore.getState()
    s.addRoom("kamar_tidur", 4, 4)
    const st = useEditorStore.getState()
    expect(st.layout!.rooms).toHaveLength(2)
    const added = st.layout!.rooms.find((r) => r.type === "kamar_tidur")!
    expect(added.floorId).toBe("f1")
    expect(st.selectedObjectId).toBe(added.id)
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().layout!.rooms).toHaveLength(1)
  })

  it("addFloor adds a floor and selects it", () => {
    useEditorStore.getState().addFloor()
    const st = useEditorStore.getState()
    expect(st.layout!.floors).toHaveLength(2)
    expect(st.selectedFloorId).toBe(st.layout!.floors[1].id)
  })

  it("removeFloor removes the floor + its rooms; refuses the last floor", () => {
    useEditorStore.getState().addFloor()
    const f2 = useEditorStore.getState().layout!.floors[1].id
    useEditorStore.getState().addRoom("dapur", 1, 1) // on f2 (now active)
    useEditorStore.getState().removeFloor(f2)
    let st = useEditorStore.getState()
    expect(st.layout!.floors).toHaveLength(1)
    expect(st.layout!.rooms.some((r) => r.floorId === f2)).toBe(false)
    // last-floor guard
    useEditorStore.getState().removeFloor("f1")
    expect(useEditorStore.getState().layout!.floors).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/stores/editor-store.test.ts`
Expected: FAIL — `addRoom is not a function`.

- [ ] **Step 3: Implement** — in `src/stores/editor-store.ts`:

(a) imports (top):
```ts
import type { RoomType } from "@/types"
import { makeRoom, makeFloor } from "@/lib/editor/create"
```
(`RoomType` may be folded into the existing `@/types` import.)

(b) add to the `EditorState` type (near `updateRoom`):
```ts
  pendingRoomType: RoomType | null
  setPendingRoomType: (t: RoomType | null) => void
  addRoom: (type: RoomType, x: number, y: number) => void
  addFloor: () => void
  removeFloor: (floorId: string) => void
```

(c) initial state (near `snapEnabled: true`): add `pendingRoomType: null,`

(d) actions (near `updateRoom`):
```ts
    setPendingRoomType: (t) => set({ pendingRoomType: t }),

    addRoom: (type, x, y) => {
      const { selectedFloorId, site, snapEnabled, gridSize } = get()
      if (!selectedFloorId || !site) return
      let newId = ""
      commit((l) => {
        const room = makeRoom(type, x, y, selectedFloorId, site, snapEnabled ? (v) => snap(v, gridSize) : undefined)
        newId = room.id
        l.rooms.push(room)
      })
      set({ selectedObjectId: newId, pendingRoomType: null })
    },

    addFloor: () => {
      const { layout } = get()
      if (!layout) return
      const floor = makeFloor(layout.floors)
      commit((l) => {
        const rooftopIdx = l.floors.findIndex((f) => f.id === "floor-rooftop")
        if (rooftopIdx >= 0) l.floors.splice(rooftopIdx, 0, floor)
        else l.floors.push(floor)
      })
      set({ selectedFloorId: floor.id, selectedObjectId: null })
    },

    removeFloor: (floorId) => {
      const { layout } = get()
      if (!layout || layout.floors.length <= 1) return
      commit((l) => {
        l.floors = l.floors.filter((f) => f.id !== floorId)
        l.rooms = l.rooms.filter((r) => r.floorId !== floorId)
        l.openings = l.openings.filter((o) => o.floorId !== floorId)
      })
      set((s) => ({
        selectedFloorId:
          s.selectedFloorId === floorId ? get().layout?.floors[0]?.id ?? null : s.selectedFloorId,
        selectedObjectId: null,
      }))
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/stores/editor-store.test.ts` then `rtk tsc`
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/stores/editor-store.ts src/stores/editor-store.test.ts
git commit -m "feat(editor): addRoom/addFloor/removeFloor store actions

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Add-room UX (toolbar type picker + canvas placement)

**Files:**
- Modify: `src/components/editor/editor-toolbar.tsx`
- Modify: `src/components/editor/plan-canvas.tsx`

**Interfaces:**
- Consumes: `setTool`, `setPendingRoomType`, `pendingRoomType`, `addRoom`, `activeTool` (store); `ROOM_TYPES`.

- [ ] **Step 1: Toolbar picker** — in `src/components/editor/editor-toolbar.tsx`:

(a) imports: add `SquarePlus` to the `lucide-react` import; `import { ROOM_TYPES } from "@/lib/constants"`; `import type { RoomType } from "@/types"`; and DropdownMenu pieces:
```ts
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
```
(b) selectors inside `EditorToolbar`:
```ts
  const setPendingRoomType = useEditorStore((s) => s.setPendingRoomType)
  const setToolFn = useEditorStore((s) => s.setTool)
  const adding = useEditorStore((s) => s.activeTool === "room")
```
(c) render — add after the `TOOLS.map(...)` block (before the first `<Separator/>`):
```tsx
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant={adding ? "default" : "ghost"} size="icon" aria-label="Tambah ruang" title="Tambah ruang">
            <SquarePlus className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" className="max-h-72 overflow-y-auto">
          {(Object.keys(ROOM_TYPES) as RoomType[]).map((t) => (
            <DropdownMenuItem key={t} onClick={() => { setToolFn("room"); setPendingRoomType(t) }}>
              {ROOM_TYPES[t].label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
```

- [ ] **Step 2: Canvas placement** — in `src/components/editor/plan-canvas.tsx`:

(a) add selectors near the others:
```ts
  const pendingRoomType = useEditorStore((s) => s.pendingRoomType)
  const addRoom = useEditorStore((s) => s.addRoom)
```
(b) in `onBackgroundDown`, handle the room tool first (before the pan/select logic):
```ts
  const onBackgroundDown = (e: React.PointerEvent) => {
    if (tool === "room" && pendingRoomType) {
      const { wx, wy } = pointer(e)
      addRoom(pendingRoomType, wx, wy)
      setTool("select")
      return
    }
    if (panning || e.button === 1) {
      drag.current = { kind: "pan", lastPx: e.clientX, lastPy: e.clientY }
      capture(e.pointerId)
      return
    }
    if (tool === "select") selectObject(null)
  }
```
(c) cursor: extend the svg `className` cursor ternary so `tool === "room"` shows `cursor-copy` (same as door/window):
```tsx
        panning ? "cursor-grab" : tool === "door" || tool === "window" || tool === "room" ? "cursor-copy" : "cursor-default"
```
(`setTool` is already a selector in this component.)

- [ ] **Step 3: Verify**

Run: `rtk tsc` then `npx next build`
Expected: 0 errors; build succeeds. Manually: pick "Tambah ruang" → a type → click canvas → a room of that type appears, selected, and the tool returns to select.

- [ ] **Step 4: Commit**

```bash
git add src/components/editor/editor-toolbar.tsx src/components/editor/plan-canvas.tsx
git commit -m "feat(editor): add-room via type picker + click-to-place

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: FloorSwitcher — add / remove floor

**Files:**
- Modify: `src/components/editor/floor-switcher.tsx`

**Interfaces:**
- Consumes: `addFloor`, `removeFloor`, `setSelectedFloor`, `selectedFloorId`, `layout.floors`.

- [ ] **Step 1: Implement** — replace `src/components/editor/floor-switcher.tsx` with:

```tsx
"use client"

import { Layers, Plus, Trash2 } from "lucide-react"

import { useEditorStore } from "@/stores/editor-store"
import { cn } from "@/lib/utils"

export function FloorSwitcher() {
  const floors = useEditorStore((s) => s.layout?.floors ?? [])
  const selectedFloorId = useEditorStore((s) => s.selectedFloorId)
  const setSelectedFloor = useEditorStore((s) => s.setSelectedFloor)
  const addFloor = useEditorStore((s) => s.addFloor)
  const removeFloor = useEditorStore((s) => s.removeFloor)

  if (floors.length === 0) return null

  return (
    <div className="flex items-center gap-1 rounded-lg border bg-card/95 p-1 shadow-sm backdrop-blur">
      <Layers className="ml-1 size-3.5 text-muted-foreground" />
      {floors.map((f) => (
        <button
          key={f.id}
          type="button"
          onClick={() => setSelectedFloor(f.id)}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            f.id === selectedFloorId ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
          )}
        >
          {f.name}
        </button>
      ))}
      <button
        type="button"
        onClick={() => addFloor()}
        aria-label="Tambah lantai"
        title="Tambah lantai"
        className="rounded-md px-1.5 py-1 text-muted-foreground hover:bg-muted"
      >
        <Plus className="size-4" />
      </button>
      {floors.length > 1 && (
        <button
          type="button"
          onClick={() => {
            const f = floors.find((x) => x.id === selectedFloorId)
            if (f && window.confirm(`Hapus ${f.name} beserta ruang di dalamnya?`)) removeFloor(f.id)
          }}
          aria-label="Hapus lantai aktif"
          title="Hapus lantai aktif"
          className="rounded-md px-1.5 py-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="size-4" />
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify**

Run: `rtk tsc`
Expected: 0 errors. Manually: "+" adds a floor (becomes active, empty); trash removes the active floor after confirm; switcher now shows even for one floor.

- [ ] **Step 3: Commit**

```bash
git add src/components/editor/floor-switcher.tsx
git commit -m "feat(editor): add/remove floor in FloorSwitcher

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Editable room type (inspector Select)

**Files:**
- Modify: `src/components/editor/editor-inspector.tsx`

**Interfaces:**
- Consumes: `updateRoom`; `ROOM_TYPES`; existing `Select` ([ui/select.tsx](../../../src/components/ui/select.tsx)).

- [ ] **Step 1: Implement** — in `src/components/editor/editor-inspector.tsx`:

(a) imports: `import type { RoomType } from "@/types"` (if not present) and the Select primitives:
```ts
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
```
(b) In `RoomInspector`, replace the read-only Tipe row:
```tsx
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">Tipe</span>
        <Badge variant="secondary">{ROOM_TYPES[room.type].label}</Badge>
      </div>
```
with an editable Select:
```tsx
      <Field label="Tipe">
        <Select
          value={room.type}
          disabled={room.locked}
          onValueChange={(v) => updateRoom(room.id, { type: v as RoomType })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent className="max-h-72">
            {(Object.keys(ROOM_TYPES) as RoomType[]).map((t) => (
              <SelectItem key={t} value={t}>{ROOM_TYPES[t].label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
```

(If `Badge` is now unused in the file, leave it — `OpeningInspector` still uses it. Verify before removing any import.)

- [ ] **Step 2: Verify**

Run: `rtk tsc` then `npx next build`
Expected: 0 errors; build succeeds. Manually: select a room → change Tipe in the dropdown → label/fill update.

- [ ] **Step 3: Commit**

```bash
git add src/components/editor/editor-inspector.tsx
git commit -m "feat(editor): editable room type in inspector

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: AI full parity (addRoom/addFloor/removeFloor/updateOpening/deleteOpening)

**Files:**
- Modify: `src/lib/assistant/actions.ts`
- Modify: `src/lib/server/editor-assistant.ts`
- Modify: `src/lib/assistant/apply.ts`
- Test: `src/lib/server/editor-assistant.test.ts`

**Interfaces:**
- Consumes: `roomTypeSchema` (existing in actions.ts); `ROOM_TYPES`; store `addRoom`/`addFloor`/`removeFloor`/`updateOpening`/`deleteObject`.
- Produces: 5 new `FloorplanAction` variants.

- [ ] **Step 1: Extend the schema** — in `src/lib/assistant/actions.ts`, before `roomPatchSchema`, add an opening-patch schema, then add 5 variants to `floorplanActionSchema`:

```ts
const openingPatchSchema = z.object({
  positionM: z.number().finite().nonnegative().optional(),
  widthM: z.number().finite().positive().optional(),
  heightM: z.number().finite().positive().optional(),
  openingType: z.enum(["door", "window"]).optional(),
})
```
Add inside the `floorplanActionSchema` discriminated union:
```ts
  z.object({ type: z.literal("addRoom"), roomType: roomTypeSchema, x: z.number().finite().optional(), y: z.number().finite().optional() }),
  z.object({ type: z.literal("addFloor") }),
  z.object({ type: z.literal("removeFloor"), floorId: z.string().min(1) }),
  z.object({ type: z.literal("updateOpening"), openingId: z.string().min(1), patch: openingPatchSchema }),
  z.object({ type: z.literal("deleteOpening"), openingId: z.string().min(1) }),
```

- [ ] **Step 2: describeAction** — in `actions.ts` `describeAction`, add cases (before the closing of the switch):
```ts
    case "addRoom":
      return `Tambah ruang ${ROOM_TYPES[action.roomType]?.label ?? action.roomType}`
    case "addFloor":
      return "Tambah lantai baru"
    case "removeFloor": {
      const f = (scene as FloorplanScene).floors.find((x) => x.id === action.floorId)
      return `Hapus lantai ${f?.name ?? action.floorId}`
    }
    case "updateOpening":
      return "Ubah bukaan (pintu/jendela)"
    case "deleteOpening":
      return "Hapus bukaan"
```

- [ ] **Step 3: Write the failing test** — append to `src/lib/server/editor-assistant.test.ts` inside the `sanitizeActions (floorplan)` describe:
```ts
  it("accepts the new editor-parity actions and validates ids", () => {
    const sceneWithOpening: FloorplanScene = {
      ...fpScene,
      openings: [{ id: "op1", roomId: "r1", side: "n", type: "window", positionM: 1 }],
    }
    const out = sanitizeActions(
      "floorplan",
      [
        { type: "addRoom", roomType: "kamar_mandi" },                 // x/y default-filled
        { type: "addFloor" },
        { type: "removeFloor", floorId: "f2" },                       // valid floor
        { type: "removeFloor", floorId: "ghost" },                    // dropped
        { type: "updateOpening", openingId: "op1", patch: { positionM: 2 } },
        { type: "updateOpening", openingId: "nope", patch: { positionM: 2 } }, // dropped
        { type: "deleteOpening", openingId: "op1" },
      ],
      sceneWithOpening
    ) as FloorplanAction[]
    const kinds = out.map((a) => a.type)
    expect(kinds).toEqual(["addRoom", "addFloor", "removeFloor", "updateOpening", "deleteOpening"])
    const add = out[0]
    if (add.type === "addRoom") { expect(add.x).toBeTypeOf("number"); expect(add.y).toBeTypeOf("number") }
  })
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run src/lib/server/editor-assistant.test.ts`
Expected: FAIL — new actions dropped (not handled in sanitizer).

- [ ] **Step 5: Sanitizer + simulate + prompt** — in `src/lib/server/editor-assistant.ts`:

(a) `sanitizeFloorplan`: build id sets once at the top:
```ts
  const floorIds = new Set(scene.floors.map((f) => f.id))   // already present
  const openingIds = new Set(scene.openings.map((o) => o.id))
```
After the existing `if (a.type === "updateRoom") {...} else if (a.type === "addOpening") {...} else if (a.type === "deleteRoom") {...}` chain, add branches:
```ts
    } else if (a.type === "addRoom") {
      out.push({
        type: "addRoom",
        roomType: a.roomType,
        x: round2(clampNum(a.x ?? scene.site.widthM / 2, 0, scene.site.widthM)),
        y: round2(clampNum(a.y ?? scene.site.depthM / 2, 0, scene.site.depthM)),
      })
    } else if (a.type === "addFloor") {
      out.push({ type: "addFloor" })
    } else if (a.type === "removeFloor") {
      if (floorIds.has(a.floorId)) out.push(a)
    } else if (a.type === "updateOpening") {
      if (openingIds.has(a.openingId)) out.push(a)
    } else if (a.type === "deleteOpening") {
      if (openingIds.has(a.openingId)) out.push(a)
    }
```
(The existing `roomById.get(a.roomId)` early-continue guards only the room-targeting actions; restructure so the `!room` check applies only to `updateRoom`/`addOpening`/`deleteRoom`. Concretely: move `const room = roomById.get(a.roomId)` and its `if (!room) continue` inside those three branches, or guard with `"roomId" in a`.)

(b) `simulateFloorplanActions`: include `addRoom` so the overlap loop sees new rooms. After the `updateRoom`/`deleteRoom` handling, add:
```ts
    } else if (a.type === "addRoom") {
      const side = Math.max(1.2, Math.round(Math.sqrt(ROOM_TYPES[a.roomType].defaultAreaM2) * 2) / 2)
      rooms.push({
        id: `new-${rooms.length}`, name: ROOM_TYPES[a.roomType].label, type: a.roomType,
        floorId: scene.selectedFloorId ?? rooms[0]?.floorId ?? "",
        x: a.x ?? 0, y: a.y ?? 0, width: side, depth: side, areaM2: side * side,
      })
```
(`simulateFloorplanActions` takes `(actions, scene)`; it already maps `scene.rooms`. Add `ROOM_TYPES` import if missing — it's already imported in this file. Pass `scene` so `selectedFloorId`/`site` are reachable; if the signature only had `scene.rooms`, widen it to use `scene`.)

(c) `buildFloorplanMessages` prompt: extend the `AKSI` list with the new actions and flip the "tidak bisa membuat ruang baru" rule:
```
'- {"type":"addRoom","roomType":"<RoomType>","x":<meter?>,"y":<meter?>} — buat ruang baru di lantai aktif.\n' +
'- {"type":"addFloor"} — tambah lantai baru (kosong).\n' +
'- {"type":"removeFloor","floorId":"<id lantai>"} — hapus lantai + isinya.\n' +
'- {"type":"updateOpening","openingId":"<id>","patch":{positionM?,widthM?,heightM?,openingType?}}.\n' +
'- {"type":"deleteOpening","openingId":"<id>"}.\n' +
```
And replace the rule line `"- Kamu TIDAK bisa membuat ruang baru…"` with: `"- Kamu BISA membuat ruang baru (addRoom) dan menambah/menghapus lantai (addFloor/removeFloor)."`

- [ ] **Step 6: apply** — in `src/lib/assistant/apply.ts` `applyFloorplanActions`, the existing room-existence guard (`if (!store.layout?.rooms.some(...)) continue`) must NOT block the non-room-targeting actions. Restructure: only guard `updateRoom`/`addOpening`/`deleteRoom` by roomId; handle the new ones unconditionally:
```ts
export function applyFloorplanActions(actions: FloorplanAction[]): number {
  let applied = 0
  for (const a of actions) {
    const store = useEditorStore.getState()
    try {
      if (a.type === "updateRoom" || a.type === "addOpening" || a.type === "deleteRoom") {
        if (!store.layout?.rooms.some((r) => r.id === a.roomId)) continue
        if (a.type === "updateRoom") store.updateRoom(a.roomId, a.patch)
        else if (a.type === "addOpening") store.addOpening(a.roomId, a.side, a.positionM, a.openingType)
        else store.deleteObject(a.roomId)
      } else if (a.type === "addRoom") {
        store.addRoom(a.roomType, a.x ?? 0, a.y ?? 0)
      } else if (a.type === "addFloor") {
        store.addFloor()
      } else if (a.type === "removeFloor") {
        store.removeFloor(a.floorId)
      } else if (a.type === "updateOpening") {
        store.updateOpening(a.openingId, {
          positionM: a.patch.positionM, widthM: a.patch.widthM, heightM: a.patch.heightM, type: a.patch.openingType,
        })
      } else if (a.type === "deleteOpening") {
        store.deleteObject(a.openingId)
      }
      applied++
    } catch {
      // skip a failing action; keep applying the rest
    }
  }
  return applied
}
```
(`updateOpening`'s patch is `Partial<Opening>`; passing `undefined` fields is fine — `Object.assign` skips them only if present, so build the object without undefined keys if the store copies verbatim. Use: spread only defined keys — see note.) Build the patch object excluding undefined:
```ts
        const patch: Record<string, unknown> = {}
        if (a.patch.positionM != null) patch.positionM = a.patch.positionM
        if (a.patch.widthM != null) patch.widthM = a.patch.widthM
        if (a.patch.heightM != null) patch.heightM = a.patch.heightM
        if (a.patch.openingType != null) patch.type = a.patch.openingType
        store.updateOpening(a.openingId, patch as Partial<import("@/types").Opening>)
```

- [ ] **Step 7: Run tests + types**

Run: `npx vitest run src/lib/server/editor-assistant.test.ts` then `rtk tsc`
Expected: PASS; tsc 0 errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/assistant/actions.ts src/lib/server/editor-assistant.ts src/lib/assistant/apply.ts src/lib/server/editor-assistant.test.ts
git commit -m "feat(assistant): full editor parity (addRoom/addFloor/removeFloor/updateOpening/deleteOpening)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Full verification

- [ ] **Step 1: tsc + tests + build**

Run: `rtk tsc` · `npx vitest run` · `npx next build`
Expected: tsc clean; all tests pass; build succeeds.

- [ ] **Step 2: Manual (mock mode)**

`npx next dev`, 2D editor: FloorSwitcher "+" adds a floor (active, empty); "Tambah Ruang" → pick "Kamar Tidur" → click → room appears selected; inspector → change Tipe; trash removes the active floor (confirm). In "Asisten Denah": "tambah lantai", "tambah kamar mandi", "geser jendela ruang tamu ke tengah" (updateOpening), "hapus lantai 2" — each previews + applies.

- [ ] **Step 3: Final commit (if fixes)**

```bash
git add -A && git commit -m "test(editor): verify add floors/rooms + AI parity

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** Stage 1 store create (T1 builders + T2 actions) · Stage 2 add-room UX (T3) · Stage 3 floors UI (T4) · Stage 4 editable type (T5) · Stage 5 AI full parity incl. the 5 new actions + sanitizer + simulate + prompt + describe + apply (T6) · verification (T7). The parity table's every row maps to an existing or T6 action. ✓

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `addRoom(type,x,y)`/`addFloor()`/`removeFloor(floorId)`/`pendingRoomType`/`setPendingRoomType` identical across T2 (store), T3 (canvas/toolbar), T4 (switcher), T6 (apply). `makeRoom`/`makeFloor` signatures match T1↔T2. New AI action shapes identical across T6 schema (actions.ts), sanitizer/simulate (editor-assistant.ts), describe (actions.ts), and apply (apply.ts): `addRoom{roomType,x?,y?}`, `addFloor{}`, `removeFloor{floorId}`, `updateOpening{openingId,patch}`, `deleteOpening{openingId}`. `openingType`→`type` mapping handled only in apply.

**Note for implementer (T6):** the current `sanitizeFloorplan`/`applyFloorplanActions`/`simulateFloorplanActions` assume room-targeting actions; you MUST restructure their room-existence guards so they apply only to `updateRoom`/`addOpening`/`deleteRoom`, not the new non-room actions (called out in the steps).
