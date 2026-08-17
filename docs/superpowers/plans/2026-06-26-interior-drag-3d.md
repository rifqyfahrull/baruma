# Drag Furniture in 3D (Bagian 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let users drag furniture directly in the 3D preview — press, drag along the room floor, release — with the position clamped inside the room and saved by autosave.

**Architecture:** A pure `worldToRoomLocal` converts a raycast floor-point to room-local corner coords (center-follows-pointer). `FurnitureModel`'s invisible hitbox gains pointer-down/move/up handlers using pointer capture + a ray↔floor-plane intersection, exposing `onDragStart/onDrag/onDragEnd`. `house-model` wires those to `setDragging` + the existing `moveFurniture` (which clamps). `house-scene` disables OrbitControls while a drag is active via a `draggingFurnitureId` flag in `preview-store`.

**Tech Stack:** React 19, @react-three/fiber 9, @react-three/drei 10, three 0.184, Zustand, TypeScript, Vitest, Playwright.

## Global Constraints
- `"use client"` R3F components; mirror existing `src/components/preview-3d/*`. Do not invent APIs.
- Test runner: `npx vitest run <path>`; `npx tsc --noEmit` 0 errors; `npm run build` succeeds (pre-existing `middleware` warning OK); `npx playwright test` for e2e (port 3100, demo `proj-demo-8x8`, headless, auth "Lanjut sebagai demo").
- `moveFurniture(roomId, furnitureId, x, y)` already exists in `interior-store` and clamps via `movePlacedFurniture`.
- Drag = translate only (rotation stays on the button). Same-room only.
- Commit trailer (exact last line): `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Use `rtk git`.

---

### Task 1: preview-store dragging flag + worldToRoomLocal helper

**Files:**
- Modify: `src/stores/preview-store.ts`
- Create: `src/lib/three/drag-plane.ts`
- Test: `src/lib/three/drag-plane.test.ts`

**Interfaces:**
- Produces: `usePreviewStore` gains `draggingFurnitureId: string | null` and `setDragging: (id: string | null) => void`.
- Produces: `worldToRoomLocal(opts: { worldX:number; worldZ:number; roomX:number; roomY:number; cx:number; cz:number; widthM:number; depthM:number }): { x:number; y:number }`.

- [ ] **Step 1: Write the failing test** (`drag-plane.test.ts`)
```ts
import { describe, expect, it } from "vitest"
import { worldToRoomLocal } from "./drag-plane"

describe("worldToRoomLocal", () => {
  it("inverts the house-model placement formula (center follows pointer)", () => {
    // house-model: worldX = roomX + x + widthM/2 - cx ; worldZ = roomY + y + depthM/2 - cz
    const roomX = 2, roomY = 3, cx = 4, cz = 5, widthM = 1.6, depthM = 2.0
    const x = 0.7, y = 1.1
    const worldX = roomX + x + widthM / 2 - cx
    const worldZ = roomY + y + depthM / 2 - cz
    const got = worldToRoomLocal({ worldX, worldZ, roomX, roomY, cx, cz, widthM, depthM })
    expect(got.x).toBeCloseTo(x, 6)
    expect(got.y).toBeCloseTo(y, 6)
  })

  it("places the furniture CENTER at the pointer (corner = center - half-size)", () => {
    // pointer at world origin, room origin 0, no centering offset → corner = -half size
    const got = worldToRoomLocal({ worldX: 0, worldZ: 0, roomX: 0, roomY: 0, cx: 0, cz: 0, widthM: 2, depthM: 1 })
    expect(got.x).toBeCloseTo(-1, 6)
    expect(got.y).toBeCloseTo(-0.5, 6)
  })
})
```

- [ ] **Step 2: Run → fails** (`npx vitest run src/lib/three/drag-plane.test.ts`)

- [ ] **Step 3a: Implement `drag-plane.ts`**
```ts
/**
 * Convert a world-space floor point (from a raycast onto the room floor plane)
 * into room-local corner coordinates, with the furniture CENTER following the
 * pointer. Inverse of house-model's placement: worldX = roomX + x + widthM/2 - cx.
 * Pure — clamping is done downstream by movePlacedFurniture.
 */
export function worldToRoomLocal(opts: {
  worldX: number
  worldZ: number
  roomX: number
  roomY: number
  cx: number
  cz: number
  widthM: number
  depthM: number
}): { x: number; y: number } {
  return {
    x: opts.worldX + opts.cx - opts.roomX - opts.widthM / 2,
    y: opts.worldZ + opts.cz - opts.roomY - opts.depthM / 2,
  }
}
```

- [ ] **Step 3b: Extend `preview-store.ts`** — add to the `PreviewState` type:
```ts
  draggingFurnitureId: string | null
  setDragging: (id: string | null) => void
```
add to the initial state object: `draggingFurnitureId: null,` and the action:
```ts
  setDragging: (id) => set({ draggingFurnitureId: id }),
```

- [ ] **Step 4: Run → passes**; `npx tsc --noEmit` → 0.

- [ ] **Step 5: Commit**
```bash
rtk git add src/lib/three/drag-plane.ts src/lib/three/drag-plane.test.ts src/stores/preview-store.ts
rtk git commit -m "feat(3d): worldToRoomLocal helper + preview-store dragging flag

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Disable OrbitControls while dragging

**Files:**
- Modify: `src/components/preview-3d/house-scene.tsx`

- [ ] **Step 1: Implement.** Import the store and read the flag, then gate OrbitControls:
```tsx
import { usePreviewStore } from "@/stores/preview-store"
// inside HouseScene component body:
const dragging = usePreviewStore((s) => s.draggingFurnitureId)
// in the <OrbitControls .../> add:
enabled={!dragging}
```
Keep all existing OrbitControls props (`makeDefault`, `enableDamping`, etc.).

- [ ] **Step 2: Verify** `npx tsc --noEmit` → 0; `npx vitest run` → all green; `npm run build` → succeeds.

- [ ] **Step 3: Commit**
```bash
rtk git add src/components/preview-3d/house-scene.tsx
rtk git commit -m "feat(3d): disable OrbitControls while dragging furniture

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Drag handlers in FurnitureModel + house-model wiring

**Files:**
- Modify: `src/components/preview-3d/furniture-model.tsx`
- Modify: `src/components/preview-3d/house-model.tsx`

**Interfaces:**
- `FurnitureModel` gains optional props: `floorY: number`, `onDragStart?: () => void`, `onDrag?: (worldX: number, worldZ: number) => void`, `onDragEnd?: () => void`.

- [ ] **Step 1: Add drag to FurnitureModel's hitbox.**
Replace the `ThreeEvent` local type with the richer R3F event from fiber to access ray + pointer + target:
```ts
import type { ThreeEvent } from "@react-three/fiber"
```
Add the new props to the component signature (all optional). Inside the component, add a drag ref and a reusable plane/vector:
```tsx
const dragging = React.useRef(false)
const floorPlane = React.useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), -floorY), [floorY])
const hitPoint = React.useMemo(() => new THREE.Vector3(), [])
```
Replace the hitbox `<mesh>` handlers with:
```tsx
<mesh
  position={[0, dims.h / 2, 0]}
  visible={false}
  onPointerDown={(e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    onSelect()
    if (!onDrag) return
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    dragging.current = true
    onDragStart?.()
  }}
  onPointerMove={(e: ThreeEvent<PointerEvent>) => {
    if (!dragging.current) return
    e.stopPropagation()
    const hit = e.ray.intersectPlane(floorPlane, hitPoint)
    if (hit) onDrag?.(hit.x, hit.z)
  }}
  onPointerUp={(e: ThreeEvent<PointerEvent>) => {
    if (!dragging.current) return
    ;(e.target as Element).releasePointerCapture?.(e.pointerId)
    dragging.current = false
    onDragEnd?.()
  }}
  onPointerOver={(e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); onHoverChange(true) }}
  onPointerOut={() => onHoverChange(false)}
>
  <boxGeometry args={[dims.w, dims.h, dims.d]} />
</mesh>
```
Keep `onClick` selection behavior available too (pointerDown already calls onSelect; you may remove the now-redundant `onClick` to avoid double-select, OR keep `onClick` and drop the `onSelect()` from pointerDown — pick ONE select trigger; prefer keeping select on pointerDown and removing onClick). Add `floorY` to the destructured props with a default if needed; it is required for the plane.

- [ ] **Step 2: Wire house-model.** In `house-model.tsx`, import the helper + stores:
```ts
import { worldToRoomLocal } from "@/lib/three/drag-plane"
```
get the store actions near the existing selectors:
```ts
const setDragging = usePreviewStore((s) => s.setDragging)
const moveFurniture = useInteriorStore((s) => s.moveFurniture)
```
(`useInteriorStore` is already imported; `usePreviewStore` is already imported.) On the `<FurnitureModel>` usage, add:
```tsx
floorY={posBase[1]}
onDragStart={() => setDragging(item.id)}
onDrag={(wx, wz) => {
  const local = worldToRoomLocal({
    worldX: wx, worldZ: wz,
    roomX: room.x, roomY: room.y, cx, cz,
    widthM: item.widthM, depthM: item.depthM,
  })
  moveFurniture(room.id, item.id, local.x, local.y)
}}
onDragEnd={() => setDragging(null)}
```
(`posBase`, `room`, `cx`, `cz`, `item` already exist in scope.)

- [ ] **Step 3: Verify** `npx tsc --noEmit` → 0; `npx vitest run` → all green (incl furniture-model import smoke); `npm run build` → succeeds.

- [ ] **Step 4: Commit**
```bash
rtk git add src/components/preview-3d/furniture-model.tsx src/components/preview-3d/house-model.tsx
rtk git commit -m "feat(3d): drag furniture along the room floor (pointer capture + ray-plane)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: E2E drag test + gates

**Files:**
- Create: `e2e/interior-drag.spec.ts`

- [ ] **Step 1: Write the e2e test**
```ts
import { test, expect } from "@playwright/test"

const DEMO = "proj-demo-8x8"

test.describe("Interior drag in 3D", () => {
  test("dragging on the 3D canvas does not error and keeps the scene alive", async ({ page }) => {
    const errors: string[] = []
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()) })
    page.on("pageerror", (e) => errors.push(String(e)))

    await page.goto(`/app/projects/${DEMO}/preview-3d`)
    const canvas = page.locator("canvas")
    const fallback = page.getByText("Gagal memuat preview 3D")
    await expect(canvas.or(fallback)).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText("Interior 3D editor")).toBeVisible({ timeout: 30_000 })

    // Add a piece, then drag across the canvas (down → move → up).
    const add = page.getByTestId("preview-3d-interior-add")
    await add.getByTestId("preview-3d-interior-add-search").fill("kasur")
    await add.getByRole("button", { name: /Tambah Kasur Queen/ }).click()
    await expect(page.getByTestId("preview-active-furniture").getByText("Kasur Queen")).toBeVisible()

    if (await canvas.isVisible().catch(() => false)) {
      const box = await canvas.boundingBox()
      if (box) {
        const midX = box.x + box.width / 2
        const midY = box.y + box.height / 2
        await page.mouse.move(midX, midY)
        await page.mouse.down()
        await page.mouse.move(midX + 40, midY + 30, { steps: 8 })
        await page.mouse.move(midX - 30, midY + 10, { steps: 8 })
        await page.mouse.up()
      }
    }

    await page.waitForTimeout(500)
    const real = errors.filter((e) => !/favicon|ResizeObserver/i.test(e))
    expect(real, real.join("\n")).toEqual([])
    await expect(canvas.or(fallback)).toBeVisible()
    // sidebar still functional after drag
    await expect(page.getByText("Interior 3D editor")).toBeVisible()
  })
})
```

- [ ] **Step 2: Run new e2e** `npx playwright test e2e/interior-drag.spec.ts` → PASS.
- [ ] **Step 3: Full suite (no regression)** `npx playwright test` → existing tests still pass (the pre-existing `a11y: landing` failure is unrelated and may remain).
- [ ] **Step 4: Gates** `npx vitest run` (green), `npx tsc --noEmit` (0), `npm run build` (succeeds).
- [ ] **Step 5: Commit**
```bash
rtk git add e2e/interior-drag.spec.ts
rtk git commit -m "test(3d): e2e drag furniture in 3D preview without errors

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Manual / Morning Verification
1. `npm run dev` → preview-3d → press a furniture in 3D and drag: it follows the pointer on the floor, stays inside the room, camera does NOT rotate while dragging, autosave shows "Menyimpan…→Tersimpan".
2. Release outside the room → clamped to the edge, no jump/crash.

## Notes / Risks
- Pointer capture via `e.target.setPointerCapture` keeps move/up flowing when the cursor leaves the small hitbox.
- OrbitControls is disabled only during an active drag (flag flips on down, clears on up).
- Precise drag position is unit-tested (`worldToRoomLocal`); e2e verifies no-crash/no-error + scene liveness.
