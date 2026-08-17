# Editor: Add Floors + Add Rooms + Full AI Parity

**Date:** 2026-06-29
**Status:** Design (awaiting review)
**Covers:** capability-audit item #1 (add floors in the editor) — expanded with a real "add room" capability and **full AI-assistant parity** over the editor's entire mutation surface.

## Context / Problem

The 2D editor can edit, move, resize, and delete existing rooms + openings, but **cannot create rooms or floors**:
- `useEditorStore` ([editor-store.ts](../../../src/stores/editor-store.ts)) has `updateRoom`, `toggleLock`, `deleteObject`/`deleteSelected`, `addOpening`, `updateOpening` — but **no `addRoom`, `addFloor`, `removeFloor`**.
- `FloorSwitcher` ([floor-switcher.tsx](../../../src/components/editor/floor-switcher.tsx)) only switches floors and hides entirely for single-floor projects (no "+").
- The room inspector's **Tipe is read-only** (a Badge).
- Floor count is fixed at project creation (`building.floors` → layout generator).

Separately, the **AI "Asisten Denah"** ([editor-assistant.ts](../../../src/lib/server/editor-assistant.ts) / [actions.ts](../../../src/lib/assistant/actions.ts)) only exposes `updateRoom`, `addOpening`, `deleteRoom` — so it cannot do everything the editor can.

**Goal:** add floor + room creation to the editor, make room type editable, and give the AI assistant **complete parity with the editor's mutation surface — every feature, no exceptions** (a hard requirement from the user).

**Confirmed decisions:** new floors start **empty** + add a real **"Tambah Ruang"** capability · add-room UX = **pick type first, then click to place** · AI must master **all** editor features.

## Non-goals (v1)

- Auto-populating a new floor (it starts empty; the user/AI adds rooms).
- Floor reorder / per-floor height editing UI (height defaults; reorder out of scope).
- Stairs auto-linking between floors.

## Editor mutation surface → AI parity map

| Editor capability | Store action | AI action (after this feature) |
|---|---|---|
| Edit room (name/type/size/pos/floor/zone/level/flags) | `updateRoom` | `updateRoom` ✅ exists |
| Lock/unlock room | `toggleLock` | `updateRoom.patch.locked` ✅ exists |
| Delete room | `deleteObject` | `deleteRoom` ✅ exists |
| Add door/window | `addOpening` | `addOpening` ✅ exists |
| **Create room** | `addRoom` (new) | `addRoom` (new) |
| **Add floor** | `addFloor` (new) | `addFloor` (new) |
| **Remove floor** | `removeFloor` (new) | `removeFloor` (new) |
| **Edit opening** | `updateOpening` | `updateOpening` (new) |
| **Delete opening** | `deleteObject` | `deleteOpening` (new) |

After this feature the AI covers the **entire** list — no editor mutation lacks an AI action.

No DB migration (`DesignLayout` is JSONB).

## Stage 1 — Store: create rooms & floors ([editor-store.ts](../../../src/stores/editor-store.ts))

All undo-aware via the existing `commit()` (one history entry each); `revalidate()` runs automatically.

- State: `pendingRoomType: RoomType | null` (the type armed for placement) + `setPendingRoomType(type | null)`.
- `addRoom(type: RoomType, x: number, y: number): void` — appends a `Room`: `id = \`room-${nanoid(8)}\``, `floorId = selectedFloorId`, `name = ROOM_TYPES[type].label`, `type`, width/depth derived from `ROOM_TYPES[type].defaultAreaM2` (`√area`, rounded to 0.5, clamped to `[MIN_ROOM, site dims]`), `x`/`y` snapped (when `snapEnabled`) and clamped so the room fits in the lot, `areaM2 = roomArea(w,d)`. Selects the new room. No-op if no `selectedFloorId`.
- `addFloor(): void` — appends a `Floor`: `id = \`floor-${nanoid(6)}\``, `level = max(levels)+1`, `name = \`Lantai ${level}\``, `heightM` copied from the last regular floor (else 3); inserted **before** the rooftop floor (`floor-rooftop`) if present, else appended. Selects the new floor. (Empty — no rooms.)
- `removeFloor(floorId): void` — guard: never remove the last floor. Removes the floor + its rooms + their openings; if it was selected, select the first remaining floor; clears selection.

`nanoid` is already a dependency (used in mock + repos).

## Stage 2 — Add-room UX (pick type → click)

- **Toolbar** ([editor-toolbar.tsx](../../../src/components/editor/editor-toolbar.tsx)): a **"Tambah Ruang"** control (icon `Plus`/`SquarePlus`) opens a `DropdownMenu` listing room types (labels from `ROOM_TYPES`). Selecting a type → `setTool("room")` + `setPendingRoomType(type)`. The `"room"` `EditorTool` already exists.
- **Canvas** ([plan-canvas.tsx](../../../src/components/editor/plan-canvas.tsx)): cursor `copy` when `tool==="room"`. On background pointer-down with `tool==="room"` and `pendingRoomType` set → convert pointer to world coords, `addRoom(pendingRoomType, wx, wy)`, then `setTool("select")` + `setPendingRoomType(null)` (single placement per pick; re-pick to add another).

## Stage 3 — Floors UI ([floor-switcher.tsx](../../../src/components/editor/floor-switcher.tsx))

- Render **always** (drop the `floors.length <= 1` early return) so "+" is reachable.
- A **"+"** button → `addFloor()` (then it becomes the active floor).
- A **remove** button (trash icon) for the active floor, shown only when `floors.length > 1`, with a confirm (`AlertDialog` or `window.confirm`) → `removeFloor(activeId)`.
- 3D needs **no change** — `build-model` iterates `layout.floors`; an empty new floor renders as a slab only.

## Stage 4 — Editable room type ([editor-inspector.tsx](../../../src/components/editor/editor-inspector.tsx))

- Replace the read-only **Tipe** `Badge` with a `Select` over `RoomType` (options labeled via `ROOM_TYPES`), writing `updateRoom(room.id, { type })`. Disabled when `room.locked`.

## Stage 5 — AI full parity ([actions.ts](../../../src/lib/assistant/actions.ts), [editor-assistant.ts](../../../src/lib/server/editor-assistant.ts), [apply.ts](../../../src/lib/assistant/apply.ts))

Add these to the **floorplan** action discriminated union (`floorplanActionSchema`):
- `{ type: "addRoom", roomType: RoomType, x?: number, y?: number }` — server clamps x/y to the lot (defaults to lot center when absent); apply → `addRoom`.
- `{ type: "addFloor" }` — apply → `addFloor`.
- `{ type: "removeFloor", floorId: string }` — sanitizer validates `floorId` exists in `scene.floors`; apply → `removeFloor`.
- `{ type: "updateOpening", openingId: string, patch: { positionM?, widthM?, heightM?, openingType?("door"|"window") } }` — sanitizer validates `openingId` exists in `scene.openings`; apply → `updateOpening`.
- `{ type: "deleteOpening", openingId: string }` — validates existence; apply → `deleteObject(openingId)`.

Updates:
- **`sanitizeFloorplan`**: validate/clamp the new actions (roomType enum, floorId/openingId membership against the scene, numeric clamps); the floorplan **validation loop** (simulate → check overlaps) extends so `addRoom` is included in `simulateFloorplanActions` (a new room participates in overlap checks).
- **Prompt** (`buildFloorplanMessages`): document the new actions so the model knows it can create rooms/floors, edit/delete openings, and remove floors. Update the standing line "Kamu TIDAK bisa membuat ruang baru" → it now CAN.
- **`describeAction`**: human labels for each new action (e.g. "Tambah ruang Kamar Tidur", "Tambah lantai", "Hapus lantai", "Ubah bukaan", "Hapus bukaan").
- **`applyFloorplanActions`** ([apply.ts](../../../src/lib/assistant/apply.ts)): dispatch the 5 new actions to the store; scene builders already include floors/openings ids.

The interior assistant is unchanged (its parity with the interior store is already complete).

## Testing

- Store (`editor-store`): `addRoom` (default size from type, clamp to lot, selects, undo restores), `addFloor` (level/name, inserted before rooftop, selected, undo), `removeFloor` (removes rooms+openings, last-floor guard, reselect).
- `sanitizeFloorplan`: addRoom roomType enum + x/y clamp; removeFloor/updateOpening/deleteOpening membership validation against scene; addRoom included in the overlap simulation.
- `describeAction`: labels for the 5 new actions.
- Existing editor/assistant/build tests stay green.

## Rollout

No DB migration. Verify `rtk tsc` · `npx vitest run` · `npx next build`. Manual: add a floor (FloorSwitcher "+"), place a "Kamar Tidur" via the type picker → click, edit its type in the inspector, remove the floor; then via "Asisten Denah": "tambah lantai", "tambah kamar mandi di lantai 2", "geser jendela ruang tamu", "hapus lantai 2" — each previews and applies.

## Sequencing (one spec, 5 shippable stages, in order 1→5)

Store → add-room UX → floors UI → editable type → AI parity. Each stage is independently testable; the AI parity stage depends on the store actions from Stage 1.
