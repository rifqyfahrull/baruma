# Picker 3D Preview (Bagian 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** In the furniture "Tambah furniture" picker, show a small auto-rotating 3D preview of the hovered/focused catalog item, reusing the Bagian-1 model pipeline.

**Architecture:** A new `furniture-preview.tsx` renders one furniture model (GLB→procedural→box) normalized to a consistent display size inside a small `<Canvas>` with auto-rotate. `FurnitureQuickAdd` tracks the hovered/focused item and renders `<FurniturePreview item={...}/>` above the catalog grid. `GlbModel`/`GlbErrorBoundary` are exported from `furniture-model.tsx` for reuse.

**Tech Stack:** React 19, @react-three/fiber 9, @react-three/drei 10, three 0.184, TypeScript, Vitest, Playwright.

## Global Constraints
- `"use client"` R3F; mirror existing `src/components/preview-3d/*`. The preview is a SEPARATE `<Canvas>` (its own R3F root) — fine alongside the main scene canvas.
- Reuse Bagian-1: `resolveFurnitureSource`, `archetypeForCategory` (`@/lib/three/furniture-models`), `ProceduralFurniture` (`furniture-procedural`), `GlbModel`+`GlbErrorBoundary` (export from `furniture-model.tsx`), `interiorFurnitureColor` (`house-model.tsx`, already exported).
- No SSR of `<Canvas>` (the whole subtree is already `dynamic ssr:false`).
- `npx tsc --noEmit` 0; `npx vitest run` green; `npm run build` succeeds (middleware warning OK); `npx playwright test` e2e.
- Commit trailer (exact last line): `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Use `rtk git`.

---

### Task 1: FurniturePreview component (+ export GlbModel)

**Files:**
- Modify: `src/components/preview-3d/furniture-model.tsx` (add `export` to `GlbModel` and `GlbErrorBoundary`)
- Create: `src/components/preview-3d/furniture-preview.tsx`
- Test: `src/components/preview-3d/furniture-preview.test.tsx`

**Interfaces:**
- Produces: `PreviewModel({ furnitureId, category, dims, color })` and `FurniturePreview({ item: FurnitureItem | null })`.

- [ ] **Step 1: Export reusables.** In `furniture-model.tsx`, change `function GlbModel(` → `export function GlbModel(` and `class GlbErrorBoundary` → `export class GlbErrorBoundary`. (No behavior change.) Run `npx tsc --noEmit` → 0.

- [ ] **Step 2: Write the failing smoke test** (`furniture-preview.test.tsx`)
```tsx
import { describe, expect, it } from "vitest"
import { FurniturePreview, PreviewModel } from "./furniture-preview"

describe("furniture-preview module", () => {
  it("exports the components without throwing on import", () => {
    expect(typeof FurniturePreview).toBe("function")
    expect(typeof PreviewModel).toBe("function")
  })
})
```
Run `npx vitest run src/components/preview-3d/furniture-preview.test.tsx` → fails (module missing).

- [ ] **Step 3: Implement `furniture-preview.tsx`**
```tsx
"use client"

import * as React from "react"
import { Canvas } from "@react-three/fiber"
import { OrbitControls } from "@react-three/drei"

import type { FurnitureCategory, FurnitureItem, PlacedFurniture } from "@/types"
import { resolveFurnitureSource, archetypeForCategory } from "@/lib/three/furniture-models"
import { ProceduralFurniture } from "@/components/preview-3d/furniture-procedural"
import { GlbModel, GlbErrorBoundary } from "@/components/preview-3d/furniture-model"
import { interiorFurnitureColor } from "@/components/preview-3d/house-model"

const DISPLAY = 1.2 // target max dimension after normalization (keeps framing constant)

export function PreviewModel({
  furnitureId,
  category,
  dims,
  color,
}: {
  furnitureId: string
  category: FurnitureCategory
  dims: { w: number; d: number; h: number }
  color: string
}) {
  const source = resolveFurnitureSource({ furnitureId, category })
  const fallbackArchetype = archetypeForCategory(category) ?? "generic"
  const maxDim = Math.max(dims.w, dims.d, dims.h, 0.1)
  const scale = DISPLAY / maxDim
  return (
    <group scale={scale}>
      {source.kind === "glb" && (
        <GlbErrorBoundary
          fallback={<ProceduralFurniture archetype={fallbackArchetype} dims={dims} color={color} />}
        >
          <React.Suspense
            fallback={<ProceduralFurniture archetype={fallbackArchetype} dims={dims} color={color} />}
          >
            <GlbModel url={source.url} dims={dims} />
          </React.Suspense>
        </GlbErrorBoundary>
      )}
      {source.kind === "procedural" && (
        <ProceduralFurniture archetype={source.archetype} dims={dims} color={color} />
      )}
      {source.kind === "box" && (
        <mesh position={[0, dims.h / 2, 0]}>
          <boxGeometry args={[dims.w, dims.h, dims.d]} />
          <meshStandardMaterial color={color} />
        </mesh>
      )}
    </group>
  )
}

export function FurniturePreview({ item }: { item: FurnitureItem | null }) {
  if (!item) {
    return (
      <div
        className="flex h-[150px] w-full items-center justify-center rounded-lg border bg-muted/30 text-center text-xs text-muted-foreground"
        data-testid="furniture-preview-empty"
      >
        Arahkan ke furnitur untuk pratinjau
      </div>
    )
  }
  const color = interiorFurnitureColor({ category: item.category, furnitureId: item.id } as PlacedFurniture)
  return (
    <div
      className="h-[150px] w-full overflow-hidden rounded-lg border bg-muted/30"
      data-testid="furniture-preview"
    >
      <Canvas dpr={[1, 2]} gl={{ alpha: true }} camera={{ position: [1.7, 1.3, 1.7], fov: 40 }}>
        <ambientLight intensity={0.85} />
        <hemisphereLight args={["#ffffff", "#b9c2bb", 0.5]} />
        <directionalLight position={[3, 4, 2]} intensity={1.1} />
        <React.Suspense fallback={null}>
          <PreviewModel
            furnitureId={item.id}
            category={item.category}
            dims={{ w: item.widthM, d: item.depthM, h: item.heightM }}
            color={color}
          />
        </React.Suspense>
        <OrbitControls
          autoRotate
          autoRotateSpeed={1.4}
          enableZoom={false}
          enablePan={false}
          target={[0, 0.5, 0]}
          makeDefault
        />
      </Canvas>
    </div>
  )
}
```

- [ ] **Step 4: Run** `npx vitest run src/components/preview-3d/furniture-preview.test.tsx` → passes; `npx tsc --noEmit` → 0.

- [ ] **Step 5: Commit**
```bash
rtk git add src/components/preview-3d/furniture-model.tsx src/components/preview-3d/furniture-preview.tsx src/components/preview-3d/furniture-preview.test.tsx
rtk git commit -m "feat(3d): FurniturePreview — mini auto-rotating 3D model for the picker

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Wire preview into FurnitureQuickAdd

**Files:**
- Modify: `src/components/interior/interior-workspace.tsx` (the `FurnitureQuickAdd` component, ~line 315)

- [ ] **Step 1: Add preview state + import.** At the top of the file add:
```ts
import { FurniturePreview } from "@/components/preview-3d/furniture-preview"
```
Inside `FurnitureQuickAdd`, add state:
```tsx
const [previewItem, setPreviewItem] = React.useState<FurnitureItem | null>(null)
```

- [ ] **Step 2: Render the preview above the grid.** In `FurnitureQuickAdd`'s JSX, immediately BEFORE the catalog grid (`<div className={cn("mt-3 grid gap-2", ...)}>`), insert:
```tsx
<div className="mt-3">
  <FurniturePreview item={previewItem ?? visible[0] ?? null} />
</div>
```
(`visible` is the already-computed sliced list of catalog entries; each element is `{ item, recommended }`, so use `visible[0]?.item ?? null`. Adjust: `item={previewItem ?? visible[0]?.item ?? null}`.)

- [ ] **Step 3: Set preview on hover/focus.** On each catalog `<button>` in the grid (the `visible.map(({ item, recommended }) => ...)` buttons), add:
```tsx
onPointerEnter={() => setPreviewItem(item)}
onFocus={() => setPreviewItem(item)}
```
Keep the existing `onClick={() => add(item, recommended)}`.

- [ ] **Step 4: Verify** `npx tsc --noEmit` → 0; `npx vitest run` → all green; `npm run build` → succeeds.

- [ ] **Step 5: Commit**
```bash
rtk git add src/components/interior/interior-workspace.tsx
rtk git commit -m "feat(3d): show 3D preview of the hovered/focused catalog furniture

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: E2E + gates

**Files:**
- Create: `e2e/interior-picker-preview.spec.ts`

- [ ] **Step 1: Write the e2e test**
```ts
import { test, expect } from "@playwright/test"

const DEMO = "proj-demo-8x8"

test.describe("Interior picker 3D preview", () => {
  test("hovering a catalog item shows a 3D preview without console errors", async ({ page }) => {
    const errors: string[] = []
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()) })
    page.on("pageerror", (e) => errors.push(String(e)))

    await page.goto(`/app/projects/${DEMO}/preview-3d`)
    await expect(page.getByText("Interior 3D editor")).toBeVisible({ timeout: 30_000 })

    const add = page.getByTestId("preview-3d-interior-add")
    await add.getByTestId("preview-3d-interior-add-search").fill("kasur")

    // Hover a catalog item → the shared 3D preview should mount.
    const item = add.getByRole("button", { name: /Tambah Kasur Queen/ })
    await item.hover()

    // Preview pane appears (default item or hovered item).
    await expect(page.getByTestId("furniture-preview")).toBeVisible({ timeout: 15_000 })
    await page.waitForTimeout(1500) // let the model load/spin

    const real = errors.filter((e) => !/favicon|ResizeObserver/i.test(e))
    expect(real, real.join("\n")).toEqual([])
  })
})
```

- [ ] **Step 2: Run new e2e** `npx playwright test e2e/interior-picker-preview.spec.ts` → PASS.
- [ ] **Step 3: Full suite** `npx playwright test` → existing pass (known unrelated `a11y: landing` may remain failed; no NEW failures).
- [ ] **Step 4: Gates** `npx vitest run` (green), `npx tsc --noEmit` (0), `npm run build` (succeeds).
- [ ] **Step 5: Commit**
```bash
rtk git add e2e/interior-picker-preview.spec.ts
rtk git commit -m "test(3d): e2e catalog picker 3D preview mounts without errors

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Manual / Morning Verification
1. `npm run dev` → preview-3d → open "Tambah furniture", hover items: a small 3D model spins in the preview pane and changes per item; default shows the first item; no jank/crash.
2. Items with a GLB (Kasur Queen) show the GLB; others show the clean procedural model.

## Notes / Risks
- Two canvases on the page: fine (≤ context limit). The preview has its own fallback so a weak device won't break the picker.
- `interiorFurnitureColor` is reused via a minimal cast (it only reads `category`).
- Normalizing to a constant `DISPLAY` size keeps camera framing fixed across items (no per-item reframe).
- Bagian 3 reuses Bagian 1; if `GlbModel`/`GlbErrorBoundary` exports ever change, update this preview.
