# Furniture "Snap to Wall" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** One-click placement of an interior furniture item flush against a chosen wall — long side along the wall, front facing into the room — so users don't have to fiddle with drag + 90° rotate to line a wardrobe up against a wall.

**Architecture:** A pure `snapToWall(item, wall, room)` computes the new `{x,y,widthM,depthM,rotationDeg}` (matching the existing rotate convention: 90/270 ⇒ dims swapped, front faces into room). A room-plan helper + interior-store action apply it (recomputing warnings/budget, undo-aware); the interior inspector shows 4 wall buttons; the interior AI assistant gets a matching `snapFurnitureToWall` action.

**Tech Stack:** Next.js 16 · zustand · zod · vitest.

## Context (why)

The interior editor already has `moveFurniture` (drag) and `rotateFurniture` (+90° in place). Users get stuck because **rotate never repositions** (it keeps the center), so aligning a wardrobe flush to a wall means fiddly dragging + rotating. Verified rendering convention (from live data, project "Rumah Qyfa": a wardrobe at `w=0.6,d=2,rot=270,x≈0` is a valid "vertical, flush-left, facing-right" state): front (door/handles) is local +z; `rotationDeg` maps front → 0:+y, 90:−x, 180:−y, 270:+x. Dims at rot 90/270 are the swapped footprint.

## Global Constraints

- No DB migration (interior is JSONB). No new deps. Undo via `updateRoomPlan`. Locked items unaffected. Bahasa UI copy. Verify `rtk tsc` · `npx vitest run` · `npx next build`.
- Facing INTO the room from a wall → `rotationDeg`: **left→270, right→90, top→0, bottom→180**. Footprint long side ALONG the wall → left/right: `widthM=min(w,d)`, `depthM=max(w,d)`; top/bottom: `widthM=max(w,d)`, `depthM=min(w,d)`. Flush + centered on the wall.

---

## Task 1: Pure `snapToWall` helper

**Files:** Create `src/lib/interior/wall-snap.ts`; Test `src/lib/interior/wall-snap.test.ts`

**Interfaces:** Produces `type Wall = "left"|"right"|"top"|"bottom"`; `snapToWall(item: { widthM: number; depthM: number }, wall: Wall, room: { width: number; depth: number }): { x: number; y: number; widthM: number; depthM: number; rotationDeg: 0|90|180|270 }`.

- [ ] **Step 1: Write the failing test** — `src/lib/interior/wall-snap.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { snapToWall } from "./wall-snap"

const room = { width: 4.23, depth: 3.69 }
const wardrobe = { widthM: 2, depthM: 0.6 } // a 2m-wide wardrobe

describe("snapToWall", () => {
  it("left wall → flush left, vertical (long side along wall), facing right (270), centered in y", () => {
    const r = snapToWall(wardrobe, "left", room)
    expect(r.x).toBe(0)
    expect(r.widthM).toBeCloseTo(0.6, 5) // short side across the room
    expect(r.depthM).toBeCloseTo(2, 5)   // long side along the wall
    expect(r.rotationDeg).toBe(270)
    expect(r.y).toBeCloseTo((room.depth - 2) / 2, 2) // centered
  })
  it("right wall → flush right, facing left (90)", () => {
    const r = snapToWall(wardrobe, "right", room)
    expect(r.rotationDeg).toBe(90)
    expect(r.widthM).toBeCloseTo(0.6, 5)
    expect(r.x).toBeCloseTo(room.width - 0.6, 2)
  })
  it("top wall → flush top, horizontal, facing down into room (0)", () => {
    const r = snapToWall(wardrobe, "top", room)
    expect(r.y).toBe(0)
    expect(r.widthM).toBeCloseTo(2, 5)  // long side along the wall
    expect(r.depthM).toBeCloseTo(0.6, 5)
    expect(r.rotationDeg).toBe(0)
    expect(r.x).toBeCloseTo((room.width - 2) / 2, 2)
  })
  it("bottom wall → flush bottom, facing up into room (180)", () => {
    const r = snapToWall(wardrobe, "bottom", room)
    expect(r.rotationDeg).toBe(180)
    expect(r.y).toBeCloseTo(room.depth - 0.6, 2)
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/lib/interior/wall-snap.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** — `src/lib/interior/wall-snap.ts`:

```ts
import { round2, clamp } from "@/lib/geometry"

export type Wall = "left" | "right" | "top" | "bottom"

/**
 * Place an item flush against a wall: long side along the wall, front facing
 * into the room, centered on the wall. Matches the editor's rotate convention
 * (rot 90/270 ⇒ swapped footprint; front local +z → 270:+x, 90:−x, 0:+y, 180:−y).
 */
export function snapToWall(
  item: { widthM: number; depthM: number },
  wall: Wall,
  room: { width: number; depth: number }
): { x: number; y: number; widthM: number; depthM: number; rotationDeg: 0 | 90 | 180 | 270 } {
  const long = Math.max(item.widthM, item.depthM)
  const short = Math.min(item.widthM, item.depthM)
  const vertical = wall === "left" || wall === "right"
  const widthM = vertical ? short : long
  const depthM = vertical ? long : short
  const rotationDeg: 0 | 90 | 180 | 270 =
    wall === "left" ? 270 : wall === "right" ? 90 : wall === "top" ? 0 : 180

  const centerX = round2(clamp((room.width - widthM) / 2, 0, Math.max(0, room.width - widthM)))
  const centerY = round2(clamp((room.depth - depthM) / 2, 0, Math.max(0, room.depth - depthM)))
  const x =
    wall === "left" ? 0 : wall === "right" ? round2(Math.max(0, room.width - widthM)) : centerX
  const y =
    wall === "top" ? 0 : wall === "bottom" ? round2(Math.max(0, room.depth - depthM)) : centerY

  return { x, y, widthM: round2(widthM), depthM: round2(depthM), rotationDeg }
}
```
(`round2`, `clamp` are exported from `@/lib/geometry`.)

- [ ] **Step 4: Run to verify it passes** — `npx vitest run src/lib/interior/wall-snap.test.ts` → PASS; `rtk tsc` clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/interior/wall-snap.ts src/lib/interior/wall-snap.test.ts
git commit -m "feat(interior): pure snapToWall geometry helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Room-plan helper + store action + inspector buttons

**Files:** Modify `src/lib/interior/plan.ts`; `src/stores/interior-store.ts`; `src/components/interior/interior-workspace.tsx`

**Interfaces:**
- Consumes: `snapToWall`/`Wall` (Task 1).
- Produces: `snapFurnitureToWall(room, plan, furnitureId, wall)` (plan.ts); store action `snapFurnitureToWall(roomId, furnitureId, wall)`.

- [ ] **Step 1: Room-plan helper** — in `plan.ts` (mirror `movePlacedFurniture`; import `snapToWall`, `Wall` from `./wall-snap`):

```ts
export function snapFurnitureToWall(
  room: Room, plan: RoomInteriorPlan, furnitureId: string, wall: Wall
): RoomInteriorPlan {
  const furniture = plan.furniture.map((item) =>
    item.id === furnitureId ? { ...item, ...snapToWall(item, wall, room) } : item
  )
  const warnings = validateFurnitureInRoom(room, furniture)
  const budgetEstimate = buildRoomBudget(room, furniture, plan.materials, plan.lighting)
  return { ...plan, furniture, warnings, budgetEstimate }
}
```
(`snapToWall` returns `rotationDeg` typed `0|90|180|270`, matching `PlacedFurniture["rotationDeg"]`; if tsc complains, cast as `PlacedFurniture["rotationDeg"]`.)

- [ ] **Step 2: Store action** — in `interior-store.ts`: import `snapFurnitureToWall` from `@/lib/interior/plan` and `Wall` from `@/lib/interior/wall-snap`; add to the state type `snapFurnitureToWall: (roomId: string, furnitureId: string, wall: Wall) => void`; implement (mirror `moveFurniture`):

```ts
    snapFurnitureToWall: (roomId, furnitureId, wall) =>
      updateRoomPlan(set, get, roomId, (room, plan) => snapFurnitureToWall(room, plan, furnitureId, wall),
        () => ({ selectedFurnitureId: furnitureId })),
```

- [ ] **Step 3: Inspector buttons** — in `interior-workspace.tsx`, in the furniture inspector block (where a selected furniture's controls live, near the rotate/remove buttons), add a "Tempel ke dinding" group:

```tsx
<div className="space-y-1.5">
  <p className="text-xs font-medium text-muted-foreground">Tempel ke dinding</p>
  <div className="grid grid-cols-4 gap-1">
    {([
      ["left", "Kiri"], ["right", "Kanan"], ["top", "Atas"], ["bottom", "Bawah"],
    ] as const).map(([wall, label]) => (
      <Button key={wall} size="sm" variant="outline"
        onClick={() => snapFurnitureToWall(room.id, selectedFurniture.id, wall)}>
        {label}
      </Button>
    ))}
  </div>
</div>
```
Wire `const snapFurnitureToWall = useInteriorStore((s) => s.snapFurnitureToWall)` and reuse the existing `room`/`selectedFurniture` in scope (match how the rotate/remove buttons obtain them). Use the file's existing `Button` import.

- [ ] **Step 4: Verify** — `rtk tsc` then `npx next build` → 0 errors / success. Manual: select the wardrobe → click "Kiri" → it snaps flush to the left wall, vertical, facing right.

- [ ] **Step 5: Commit**

```bash
git add src/lib/interior/plan.ts src/stores/interior-store.ts src/components/interior/interior-workspace.tsx
git commit -m "feat(interior): snap-to-wall action + inspector buttons

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: AI parity (interior `snapFurnitureToWall`)

**Files:** Modify `src/lib/assistant/actions.ts`; the interior sanitizer in `src/lib/server/editor-assistant.ts`; `src/lib/assistant/apply.ts`; Test the interior sanitizer test file.

**Interfaces:** Produces interior action `{ type: "snapFurnitureToWall", roomId, furnitureId, wall: "left"|"right"|"top"|"bottom" }`.

- [ ] **Step 1: Schema** — in `actions.ts`, add to `interiorActionSchema`:
```ts
  z.object({ type: z.literal("snapFurnitureToWall"), roomId: z.string().min(1), furnitureId: z.string().min(1), wall: z.enum(["left", "right", "top", "bottom"]) }),
```
and a `describeAction` case:
```ts
    case "snapFurnitureToWall":
      return `Tempelkan furnitur ke dinding ${action.wall}`
```

- [ ] **Step 2: Write the failing test** — in the interior sanitizer test file (where furniture-action sanitize tests live), add a test: a `snapFurnitureToWall` with a valid `roomId`+`furnitureId` is kept; a ghost `roomId` or `furnitureId` is dropped; bad `wall` rejected by schema. Model it on the existing furniture sanitize tests (reuse the scene fixture; ensure it has a furniture item with an id to target).

- [ ] **Step 3: Run to verify it fails** — `npx vitest run <interior sanitizer test file>` → FAIL (action dropped).

- [ ] **Step 4: Sanitizer + apply + prompt** — in `sanitizeInterior` (editor-assistant.ts): validate `roomId` exists and `furnitureId` exists in that room's furniture (mirror `moveFurniture`/`rotateFurniture` validation); drop otherwise. In `applyInteriorActions` (apply.ts): `else if (a.type === "snapFurnitureToWall") store.snapFurnitureToWall(a.roomId, a.furnitureId, a.wall)`. In the interior prompt, document the action (Bahasa).

- [ ] **Step 5: Run tests + types** — `npx vitest run <interior sanitizer test file>` → PASS; `rtk tsc` clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/assistant/actions.ts src/lib/server/editor-assistant.ts src/lib/assistant/apply.ts <test file>
git commit -m "feat(assistant): interior snapFurnitureToWall parity

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Full verification

- [ ] **Step 1:** `rtk tsc` · `npx vitest run` · `npx next build` → all green.
- [ ] **Step 2: Manual** — interior workspace: select wardrobe → "Kiri" → flush-left, vertical, facing right; other walls likewise; via "Asisten Interior": "tempelkan lemari ke dinding kiri" applies.
- [ ] **Step 3: Final commit (if fixes)** — `git add -A && git commit -m "test(interior): verify snap-to-wall"` (+ trailer).

---

## Self-Review

**Coverage:** helper (T1) → room-plan+store+inspector (T2) → AI parity (T3) → verify (T4). Facing/footprint rules from Global Constraints are encoded in T1 and asserted in its tests. ✓
**Placeholders:** none. **Types:** `Wall`, `snapToWall(...)→{x,y,widthM,depthM,rotationDeg}`, `snapFurnitureToWall(roomId,furnitureId,wall)` consistent across T1↔T2↔T3.
**Note (implementers):** T2 — match how the existing furniture inspector obtains `room`/`selectedFurniture` before adding buttons. T3 — grep for the interior sanitizer (`sanitizeInterior` in `editor-assistant.ts`) and mirror the `moveFurniture` membership validation; do NOT assume the file.
