# Furniture Free Rotation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Replace the confusing 90°-step-with-dim-swap furniture rotation (which double-rotated in 3D and made objects poke through walls) with a single, correct model: `widthM/depthM` are the object's intrinsic size, `rotationDeg` is any angle, and the visual rotates consistently in 2D and 3D. Add a drag-to-rotate handle. Remove the snap-to-wall band-aid.

**Architecture:** Unify on "intrinsic dims + visual rotation." Stop swapping dims on rotate; rotate the rendered geometry by `rotationDeg` in both 2D (SVG transform) and 3D (group rotation, no pre-swap). Migrate existing saved interiors (which stored swapped dims for 90/270) once, via the existing `schemaVersion`. Add a rotation handle + degree input driving a new `setFurnitureRotation` action.

**Tech Stack:** Next.js 16 · zustand · zod · SVG · R3F · vitest.

## Design rationale (why the old model broke)

Old: `rotatePlacedFurniture` **swapped** `widthM/depthM` and set `rotationDeg` (0/90/180/270). 2D drew the swapped rect (axis-aligned, no rotation); 3D fit the model to the swapped dims **and** rotated by `rotationDeg` → for 90/270 the world footprint swapped again → perpendicular/poking through walls. The two views used incompatible conventions, and arbitrary angles were impossible. The fix is one convention: dims never swap; rotation is purely visual.

## Global Constraints

- `rotationDeg` becomes a free `number` (degrees). No dim-swapping anywhere. No DB migration (interior is JSONB; `schemaVersion` already exists — bump 1→2, migrate on load). Undo via `updateRoomPlan`. Bahasa UI. Verify `rtk tsc` · `npx vitest run` · `npx next build`.
- **Migration is mandatory and must be exactly-once:** existing saved interiors are `schemaVersion:1` with swapped dims for `rotationDeg∈{90,270}`. On load, un-swap those, treat as v2. `toSavedInterior` writes `schemaVersion:2`. Never re-run on v2.

---

## Task 1: Remove the snap-to-wall feature

**Files:** delete `src/lib/interior/wall-snap.ts` + `wall-snap.test.ts`; modify `src/lib/interior/plan.ts`, `src/stores/interior-store.ts`, `src/components/interior/interior-workspace.tsx`, `src/components/preview-3d/preview-controls.tsx`, `src/lib/assistant/actions.ts`, `src/lib/server/editor-assistant.ts`, `src/lib/assistant/apply.ts`, `src/lib/server/editor-assistant.test.ts`.

- [ ] **Step 1: Remove every snap-to-wall reference.** Delete `wall-snap.ts` + its test. In `plan.ts` remove `snapFurnitureToWall` (and its `./wall-snap` import). In `interior-store.ts` remove the `snapFurnitureToWall` action + `Wall` import + the type-member. In `interior-workspace.tsx` remove the "Tempel ke dinding" button group + the `snapFurnitureToWall` selector. In `preview-controls.tsx` remove the "Tempel ke dinding" buttons + the `snapFurnitureToWall` selector. In `actions.ts` remove the `snapFurnitureToWall` schema variant + its `describeAction` case. In `editor-assistant.ts` remove it from the interior prompt (and the sanitize comment mention). In `apply.ts` remove the `snapFurnitureToWall` dispatch branch. In `editor-assistant.test.ts` remove the snap-to-wall sanitizer test.
- [ ] **Step 2: Keep `FurnitureModel`'s `md` pre-swap for now** (old data still renders correctly until Task 2's migration + Task 3's render change land). Do not touch `furniture-model.tsx` in this task.
- [ ] **Step 3: Verify** — `rtk tsc` (0), `npx vitest run` (green; snap tests are gone), `npx next build` (success). Grep to confirm zero remaining `snapFurnitureToWall`/`snapToWall`/`wall-snap` references.
- [ ] **Step 4: Commit** — `git add -A && git commit -m "revert(interior): remove snap-to-wall feature"` (+ Co-Authored-By trailer).

---

## Task 2: Convention flip — intrinsic dims + migration (data layer)

**Files:** `src/types/index.ts`, `src/lib/schemas/interior.ts`, `src/lib/interior/plan.ts`; Test `src/lib/interior/plan.test.ts`.

**Interfaces:** Produces `normalizeLegacyRotation(furniture: PlacedFurniture[]): PlacedFurniture[]` (un-swap dims for rotationDeg∈{90,270}); changed `rotatePlacedFurniture` (no swap).

- [ ] **Step 1: Write failing tests** — append to `plan.test.ts`:

```ts
import { rotatePlacedFurniture, normalizeLegacyRotation } from "./plan"

describe("free rotation model", () => {
  const room = { id: "r1", floorId: "f1", name: "R", type: "kamar_tidur", x: 0, y: 0, width: 4, depth: 4, areaM2: 16 } as const
  const base = generateRoomInterior(room as never, { rooms: [room], openings: [] } as never, "scandinavian")

  it("rotatePlacedFurniture increments the angle by 90 and does NOT swap dims", () => {
    const item = base.furniture[0]
    const before = { w: item.widthM, d: item.depthM }
    const next = rotatePlacedFurniture(room as never, base, item.id)
    const after = next.furniture.find((f) => f.id === item.id)!
    expect(after.rotationDeg).toBe((item.rotationDeg + 90) % 360)
    expect(after.widthM).toBe(before.w) // NOT swapped
    expect(after.depthM).toBe(before.d)
  })

  it("normalizeLegacyRotation un-swaps dims for 90/270 (legacy) and leaves 0/180", () => {
    const legacy = [
      { id: "a", rotationDeg: 270, widthM: 0.6, depthM: 2 },
      { id: "b", rotationDeg: 0, widthM: 2, depthM: 0.6 },
      { id: "c", rotationDeg: 90, widthM: 0.6, depthM: 2 },
    ] as unknown as import("@/types").PlacedFurniture[]
    const out = normalizeLegacyRotation(legacy)
    expect([out[0].widthM, out[0].depthM]).toEqual([2, 0.6]) // un-swapped → intrinsic
    expect([out[1].widthM, out[1].depthM]).toEqual([2, 0.6]) // unchanged
    expect([out[2].widthM, out[2].depthM]).toEqual([2, 0.6]) // un-swapped
    expect(out.map((f) => f.rotationDeg)).toEqual([270, 0, 90]) // angle unchanged
  })
})
```

- [ ] **Step 2: Run → FAIL** — `npx vitest run src/lib/interior/plan.test.ts`.

- [ ] **Step 3: Implement**
  - `types/index.ts`: `rotationDeg: number` (was `0 | 90 | 180 | 270`).
  - `schemas/interior.ts`: `rotationDeg: z.number()` (was the 4-literal union); `schemaVersion: z.union([z.literal(1), z.literal(2)])` (was `z.literal(1)`).
  - `plan.ts` — rewrite `rotatePlacedFurniture` to NOT swap and keep center (position unchanged; the visual rotates now):

```ts
export function rotatePlacedFurniture(room: Room, plan: RoomInteriorPlan, furnitureId: string): RoomInteriorPlan {
  const furniture = plan.furniture.map((item) =>
    item.id === furnitureId ? { ...item, rotationDeg: (item.rotationDeg + 90) % 360 } : item
  )
  const warnings = validateFurnitureInRoom(room, furniture)
  const budgetEstimate = buildRoomBudget(room, furniture, plan.materials, plan.lighting)
  return { ...plan, furniture, warnings, budgetEstimate }
}
```
  - `plan.ts` — add the migration helper:

```ts
/** Legacy (schemaVersion 1) stored swapped dims for 90/270 rotations. Restore intrinsic dims. */
export function normalizeLegacyRotation(furniture: PlacedFurniture[]): PlacedFurniture[] {
  return furniture.map((f) =>
    f.rotationDeg === 90 || f.rotationDeg === 270
      ? { ...f, widthM: f.depthM, depthM: f.widthM }
      : f
  )
}
```
  - `plan.ts` — in `applySavedInterior`, when `saved.schemaVersion === 1`, run `normalizeLegacyRotation` over each room's saved furniture BEFORE building the plan (so migrated dims are intrinsic). In `toSavedInterior`, write `schemaVersion: 2` (change the `schemaVersion: 1` literal at line ~104).

- [ ] **Step 4: Run → PASS** + `rtk tsc`. Fix any `as PlacedFurniture["rotationDeg"]` casts made obsolete by the number type.

- [ ] **Step 5: Commit** — `feat(interior): intrinsic-dims rotation model + legacy migration` (+ trailer).

---

## Task 3: Render intrinsic dims + rotation (2D + 3D)

**Files:** `src/components/preview-3d/furniture-model.tsx`; `src/components/interior/interior-workspace.tsx`.

- [ ] **Step 1: 3D — drop the pre-swap.** In `furniture-model.tsx`, remove the `md` swap block (added in commit 90ac231) and use `dims` directly everywhere it replaced (`GlbModel`/`ProceduralFurniture`/box/cage/hitbox back to `dims`). The `<group rotation={[0, -(rotationDeg)*π/180, 0]}>` stays — with intrinsic dims + migrated data, rotating by `rotationDeg` now yields the correct world footprint for any angle.
- [ ] **Step 2: 2D — rotate the furniture in `InteriorCanvas`.** Wrap the furniture `<g>` (the rect + label) with a rotation transform about the item's center:
```tsx
const cx = originX + (item.x + item.widthM / 2) * scale
const cy = originY + (item.y + item.depthM / 2) * scale
// on the <g>:
transform={`rotate(${item.rotationDeg} ${cx} ${cy})`}
```
(The rect stays drawn at `widthM×depthM`; the transform rotates it visually. Keep the `Grip`/selection affordance readable — it may rotate with the group, which is acceptable.)
- [ ] **Step 3: Verify** — `rtk tsc` + `npx next build`. Manual: a rotated wardrobe now shows the SAME orientation in 2D and 3D, flush and inside the room (no poke-through); an existing (migrated) rotated wardrobe renders correctly.
- [ ] **Step 4: Commit** — `feat(interior): render furniture with intrinsic dims + visual rotation` (+ trailer).

---

## Task 4: Free-rotation interaction (handle + degree input)

**Files:** `src/lib/interior/plan.ts` (helper); `src/stores/interior-store.ts` (action); `src/components/interior/interior-workspace.tsx` (2D handle + inspector input); Test `src/lib/interior/plan.test.ts` + a small angle-util test.

**Interfaces:** `setFurnitureRotationInRoom(room, plan, furnitureId, deg)`; store `setFurnitureRotation(roomId, furnitureId, deg)`; `normalizeAngle(deg, snapStep?)`.

- [ ] **Step 1: Write failing tests** — in `plan.test.ts` (helper) and a new `src/lib/geometry/angle.test.ts`:
```ts
// angle.test.ts
import { normalizeAngle } from "@/lib/geometry/angle"
describe("normalizeAngle", () => {
  it("wraps into [0,360)", () => { expect(normalizeAngle(-90)).toBe(270); expect(normalizeAngle(450)).toBe(90) })
  it("snaps to the given step", () => { expect(normalizeAngle(47, 15)).toBe(45); expect(normalizeAngle(8, 15)).toBe(15) })
})
```
```ts
// plan.test.ts
it("setFurnitureRotationInRoom sets an arbitrary angle (normalized)", () => {
  const item = base.furniture[0]
  const next = setFurnitureRotationInRoom(room as never, base, item.id, 405)
  expect(next.furniture.find((f) => f.id === item.id)!.rotationDeg).toBe(45)
})
```
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement**
  - `src/lib/geometry/angle.ts`: `export function normalizeAngle(deg: number, snapStep?: number): number { let d = ((deg % 360) + 360) % 360; if (snapStep && snapStep > 0) d = (Math.round(d / snapStep) * snapStep) % 360; return d }`.
  - `plan.ts`: `setFurnitureRotationInRoom(room, plan, furnitureId, deg)` (mirror `rotatePlacedFurniture`, sets `rotationDeg: normalizeAngle(deg)`, recompute warnings+budget).
  - `interior-store.ts`: `setFurnitureRotation(roomId, furnitureId, deg)` via `updateRoomPlan` (keep selection).
- [ ] **Step 4: 2D rotation handle** — in `InteriorCanvas`, when a furniture is selected, render a small draggable circle offset above the item's top-center (in unrotated coords; it lives inside the rotated `<g>` so it orbits the item). On pointer-down, start a rotate-drag (like the existing furniture drag): each move computes `deg = normalizeAngle(atan2(pointerY−cy, pointerX−cx)·180/π + 90, e.shiftKey ? 15 : undefined)` and calls `setFurnitureRotation(room.id, item.id, deg)` (use the same pointer→canvas coords the furniture drag uses; `cx/cy` = item center in px). Also add a small **degree number input** in the furniture inspector (0–359) → `setFurnitureRotation`. Keep the existing "Rotate" +90° button.
- [ ] **Step 5: Verify** — tests pass; `rtk tsc` + build. Manual: drag the handle → the item rotates to any angle in 2D and 3D; Shift snaps to 15°; the degree input works; +90° button still works.
- [ ] **Step 6: Commit** — `feat(interior): drag-to-rotate handle + degree input (free rotation)` (+ trailer).

---

## Task 5: Rotated-bounds check

**Files:** `src/lib/interior/plan.ts` (or `validation` module); Test `src/lib/interior/plan.test.ts`.

- [ ] **Step 1: Write failing test** — `plan.test.ts`: an item rotated 45° near a wall is reported out-of-room when its **rotated** bounding box exceeds the room, but not when the axis-aligned one would falsely pass/fail. Assert via a helper `rotatedAABB(item)` → `{minX,minY,maxX,maxY}` (center + rotated half-extents): e.g. a 2×0.6 item at 45° has AABB ≈ 1.84 on each side.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** `rotatedAABB(item)` (compute the axis-aligned bbox of the rotated rectangle: `hw=widthM/2, hd=depthM/2, c=|cos θ|, s=|sin θ|; ex = hw*c + hd*s; ey = hw*s + hd*c; center=(x+hw, y+hd)`), and use it in `validateFurnitureInRoom`'s room-containment check (replace the axis-aligned `x+widthM>room.width` style test with the rotated AABB). Keep overlap detection as-is (approximate) unless trivial.
- [ ] **Step 4: Run → PASS** + `rtk tsc`.
- [ ] **Step 5: Commit** — `feat(interior): out-of-room check uses rotated bounding box` (+ trailer).

---

## Task 6: Full verification

- [ ] **Step 1:** `rtk tsc` · `npx vitest run` · `npx next build` → all green.
- [ ] **Step 2: Manual** — rotate a wardrobe (button, handle-drag, degree input) → consistent in 2D & 3D, no poke-through; an existing rotated design (Rumah Qyfa) loads and renders correctly (migration); via "Asisten Interior" `rotateFurniture` still works.
- [ ] **Step 3: Final commit (if fixes).**

---

## Self-Review

**Coverage:** remove snap (T1) · intrinsic-dims + migration (T2) · render 2D/3D (T3) · free-rotation handle/input + store (T4) · rotated bounds (T5) · verify (T6). ✓
**Placeholders:** none.
**Types:** `rotationDeg: number` (T2) consumed by render (T3), `setFurnitureRotation`/`setFurnitureRotationInRoom`/`normalizeAngle` consistent T4. Migration `normalizeLegacyRotation` + `schemaVersion:2` (T2) is exactly-once via the version gate.
**Risk note (implementers):** T2+T3 are a coupled convention flip — after T2 alone the 3D still pre-swaps (transiently wrong for 90/270); T3 removes the pre-swap to restore consistency. The final verification (T6) confirms the whole. The migration only touches `schemaVersion:1` payloads; verify a v1 fixture round-trips to correct intrinsic dims.
