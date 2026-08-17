# Realistic Furniture Rendering (Hybrid GLB) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Render interior furniture in the 3D preview as real 3D models — GLB file when one is registered, else a stylized procedural model, else the current box — with automatic fit-to-footprint, layered loading/error fallback, and preserved click/selection.

**Architecture:** Three pure/presentational units (`fit-transform`, `furniture-models` resolver, `furniture-procedural` archetypes) feed one render component (`furniture-model`) that house-model.tsx mounts per placed furniture. GLB loads via drei `useGLTF`, is cloned per placement, bounding-box-normalized to the item's `w×d×h`, and wrapped in Suspense (→ procedural fallback) + an ErrorBoundary (→ procedural fallback). Selection shows a wireframe cage.

**Tech Stack:** React 19, @react-three/fiber 9, @react-three/drei 10, three 0.184, TypeScript, Vitest, Playwright.

## Global Constraints

- This repo's Next.js/R3F differs from common knowledge. Mirror existing client components (`"use client"`, the patterns already in `src/components/preview-3d/*`). Do not invent APIs.
- All new R3F components are client components (`"use client"`).
- Test runner: `npx vitest run <path>` (unit). `npx playwright test` (e2e, port 3100, auth via "Lanjut sebagai demo", demo project `proj-demo-8x8`). `npx tsc --noEmit` must stay at 0 errors. `npm run build` must pass (pre-existing `middleware` deprecation warning is acceptable).
- Furniture dims come from `PlacedFurniture` (`widthM`, `depthM`, `heightM`); the model's BASE sits on the floor (y=0 at the group), centered on the footprint, rotated `-rotationDeg` about Y (match existing scene convention).
- Reuse the existing palette: `interiorFurnitureColor(item)` and `SHARED_COLORS` from this module / `@/lib/three/materials`.
- Registered GLB test files live in `public/models/`: `bed.glb`, `cute_little_armchair_-_kc002_3d_model.glb`. `appartement.glb`/`alte163_chodba_v2.glb` are whole scenes — DO NOT register them.
- Commit trailer (exact, last line): `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Use `rtk git ...`.
- Keep files focused; one responsibility each.

---

### Task 1: Fit-to-footprint math (pure)

**Files:**
- Create: `src/lib/three/fit-transform.ts`
- Test: `src/lib/three/fit-transform.test.ts`

**Interfaces:**
- Produces: `computeFitTransform(bbox: { size: [number,number,number]; center: [number,number,number] }, target: { w: number; d: number; h: number }): { scale: number; position: [number,number,number] }`
  - `scale` = uniform = `min(target.w/size.x, target.h/size.y, target.d/size.z)`, guarding any size component `<= 1e-6` (treat as no constraint from that axis; if all degenerate → scale 1).
  - `position` translates the scaled model so its center is at x=0,z=0 and its BASE rests at y=0: `position = [ -center.x*scale, (size.y/2 - center.y)*scale, -center.z*scale ]`.

- [ ] **Step 1: Write the failing test**
```ts
import { describe, expect, it } from "vitest"
import { computeFitTransform } from "./fit-transform"

describe("computeFitTransform", () => {
  it("scales uniformly to fit within the target footprint (smallest ratio wins)", () => {
    // model 2x2x2 centered at origin, target 1(w) x 4(d) x 4(h) → limiting axis is width → scale 0.5
    const t = computeFitTransform({ size: [2, 2, 2], center: [0, 0, 0] }, { w: 1, d: 4, h: 4 })
    expect(t.scale).toBeCloseTo(0.5, 5)
  })

  it("rests the base at y=0 and centers x/z", () => {
    // model 2x2x2 whose center is at (1, 1, 1) (so it spans 0..2 on each axis), target 2x2x2 → scale 1
    const t = computeFitTransform({ size: [2, 2, 2], center: [1, 1, 1] }, { w: 2, d: 2, h: 2 })
    expect(t.scale).toBeCloseTo(1, 5)
    expect(t.position[0]).toBeCloseTo(-1, 5) // -center.x*scale
    expect(t.position[2]).toBeCloseTo(-1, 5) // -center.z*scale
    // base: center.y=1, size.y/2=1 → (1 - 1)*1 = 0
    expect(t.position[1]).toBeCloseTo(0, 5)
  })

  it("guards degenerate (zero) size without throwing or NaN", () => {
    const t = computeFitTransform({ size: [0, 0, 0], center: [0, 0, 0] }, { w: 1, d: 1, h: 1 })
    expect(Number.isFinite(t.scale)).toBe(true)
    expect(t.scale).toBe(1)
    expect(t.position.every(Number.isFinite)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test → fails** (`npx vitest run src/lib/three/fit-transform.test.ts` → module not found)

- [ ] **Step 3: Implement**
```ts
/**
 * Normalize an arbitrary GLB's bounding box to a furniture footprint:
 * uniform scale to fit within w×d×h, centered on x/z, base resting on y=0.
 * Pure math — no three.js import — so it is unit-testable in isolation.
 */
export function computeFitTransform(
  bbox: { size: [number, number, number]; center: [number, number, number] },
  target: { w: number; d: number; h: number }
): { scale: number; position: [number, number, number] } {
  const [sx, sy, sz] = bbox.size
  const eps = 1e-6
  const ratios: number[] = []
  if (sx > eps) ratios.push(target.w / sx)
  if (sy > eps) ratios.push(target.h / sy)
  if (sz > eps) ratios.push(target.d / sz)
  const scale = ratios.length ? Math.min(...ratios) : 1

  const [cx, cy, cz] = bbox.center
  return {
    scale,
    position: [-cx * scale, (sy / 2 - cy) * scale, -cz * scale],
  }
}
```

- [ ] **Step 4: Run test → passes**

- [ ] **Step 5: Commit**
```bash
rtk git add src/lib/three/fit-transform.ts src/lib/three/fit-transform.test.ts
rtk git commit -m "feat(3d): computeFitTransform — normalize GLB bbox to footprint

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Furniture model registry + resolver (pure)

**Files:**
- Create: `src/lib/three/furniture-models.ts`
- Test: `src/lib/three/furniture-models.test.ts`

**Interfaces:**
- Produces:
  - `type Archetype = "seating" | "bed" | "table" | "wardrobe" | "cabinet" | "appliance" | "kitchen" | "bathroom" | "decor_flat" | "generic"`
  - `type FurnitureSource = { kind: "glb"; url: string } | { kind: "procedural"; archetype: Archetype } | { kind: "box" }`
  - `FURNITURE_MODEL_REGISTRY: Record<string, string>` (furnitureId → public URL)
  - `resolveFurnitureSource(item: { furnitureId: string; category: FurnitureCategory }): FurnitureSource`
  - `archetypeForCategory(category: FurnitureCategory): Archetype | null`
  - `registeredModelUrls(): string[]`

- [ ] **Step 1: Write the failing test**
```ts
import { describe, expect, it } from "vitest"
import { resolveFurnitureSource, FURNITURE_MODEL_REGISTRY, registeredModelUrls } from "./furniture-models"

describe("resolveFurnitureSource", () => {
  it("returns a glb source for a registered furnitureId", () => {
    const src = resolveFurnitureSource({ furnitureId: "queen-bed", category: "bed" })
    expect(src).toEqual({ kind: "glb", url: FURNITURE_MODEL_REGISTRY["queen-bed"] })
    expect(FURNITURE_MODEL_REGISTRY["queen-bed"]).toBe("/models/bed.glb")
  })

  it("falls back to a procedural archetype by category when no glb is registered", () => {
    const src = resolveFurnitureSource({ furnitureId: "single-bed", category: "bed" })
    expect(src).toEqual({ kind: "procedural", archetype: "bed" })
  })

  it("maps seating/table/appliance/etc to their archetypes", () => {
    expect(resolveFurnitureSource({ furnitureId: "x", category: "seating" })).toEqual({ kind: "procedural", archetype: "seating" })
    expect(resolveFurnitureSource({ furnitureId: "x", category: "table" })).toEqual({ kind: "procedural", archetype: "table" })
    expect(resolveFurnitureSource({ furnitureId: "x", category: "wardrobe" })).toEqual({ kind: "procedural", archetype: "wardrobe" })
    expect(resolveFurnitureSource({ furnitureId: "x", category: "decor" })).toEqual({ kind: "procedural", archetype: "decor_flat" })
  })

  it("registeredModelUrls returns each registered url once", () => {
    const urls = registeredModelUrls()
    expect(urls).toContain("/models/bed.glb")
    expect(new Set(urls).size).toBe(urls.length)
  })
})
```

- [ ] **Step 2: Run test → fails**

- [ ] **Step 3: Implement**
```ts
import type { FurnitureCategory } from "@/types"

export type Archetype =
  | "seating" | "bed" | "table" | "wardrobe" | "cabinet"
  | "appliance" | "kitchen" | "bathroom" | "decor_flat" | "generic"

export type FurnitureSource =
  | { kind: "glb"; url: string }
  | { kind: "procedural"; archetype: Archetype }
  | { kind: "box" }

/** furnitureId → GLB under /public. Only items with a real, furniture-scale model. */
export const FURNITURE_MODEL_REGISTRY: Record<string, string> = {
  "queen-bed": "/models/bed.glb",
  "single-bed": "/models/bed.glb",
  "sofa-3-seat": "/models/cute_little_armchair_-_kc002_3d_model.glb",
}

const CATEGORY_ARCHETYPE: Record<FurnitureCategory, Archetype> = {
  seating: "seating",
  table: "table",
  bed: "bed",
  wardrobe: "wardrobe",
  cabinet: "cabinet",
  kitchen: "kitchen",
  appliance: "appliance",
  lighting: "generic",
  decor: "decor_flat",
  bathroom_fixture: "bathroom",
  outdoor: "seating",
  storage: "cabinet",
  workspace: "table",
  prayer: "decor_flat",
}

export function archetypeForCategory(category: FurnitureCategory): Archetype | null {
  return CATEGORY_ARCHETYPE[category] ?? null
}

export function resolveFurnitureSource(item: {
  furnitureId: string
  category: FurnitureCategory
}): FurnitureSource {
  const url = FURNITURE_MODEL_REGISTRY[item.furnitureId]
  if (url) return { kind: "glb", url }
  const archetype = archetypeForCategory(item.category)
  if (archetype) return { kind: "procedural", archetype }
  return { kind: "box" }
}

export function registeredModelUrls(): string[] {
  return Array.from(new Set(Object.values(FURNITURE_MODEL_REGISTRY)))
}
```

- [ ] **Step 4: Run test → passes**

- [ ] **Step 5: Commit**
```bash
rtk git add src/lib/three/furniture-models.ts src/lib/three/furniture-models.test.ts
rtk git commit -m "feat(3d): furniture model registry + source resolver

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Procedural furniture archetypes

**Files:**
- Create: `src/components/preview-3d/furniture-procedural.tsx`
- Test: `src/lib/three/furniture-procedural-dims.test.ts`

**Goal:** A presentational component that renders a stylized model composed from primitives, sized to `dims` (centered x/z, base y=0). Plus a PURE helper `proceduralPartBoxes(archetype, dims)` that returns the list of part boxes (`{ size:[w,h,d], pos:[x,y,z] }`) — this is what the component maps over AND what the test asserts on (so geometry is unit-testable without a renderer).

**Interfaces:**
- Consumes: `Archetype` from `@/lib/three/furniture-models`.
- Produces:
  - `proceduralPartBoxes(archetype: Archetype, dims: { w: number; d: number; h: number }): Array<{ size: [number,number,number]; pos: [number,number,number]; rounded?: boolean }>` (pure)
  - `<ProceduralFurniture archetype dims color />` — maps the parts to `<mesh>`es with `meshStandardMaterial` (roughness 0.85). The overall bounding box of all parts MUST stay within `dims` and rest on y=0.

**Archetype recipes** (all coordinates: x=width across, y=up, z=depth; origin centered x/z, base y=0). Implement `proceduralPartBoxes` to produce these. Keep every part inside `[-w/2,w/2] × [0,h] × [-d/2,d/2]`:

- `seating`: seat slab `[w, h*0.45, d]` at y=`h*0.225`; backrest `[w, h*0.55, d*0.18]` at y=`h*0.5+h*0.225`? — keep simple: backrest `[w, h*0.55, d*0.16]` centered at z=`-d/2+d*0.08`, y=`h*0.45 + h*0.275`; two arms `[w*0.12, h*0.5, d]` at x=`±(w/2 - w*0.06)`, y=`h*0.25`; seat cushion `[w*0.9, h*0.12, d*0.85]` on top of seat.
- `bed`: frame `[w, h*0.35, d]` at y=`h*0.175`; mattress `[w*0.96, h*0.3, d*0.96]` at y=`h*0.35 + h*0.15`; two pillows `[w*0.4, h*0.12, d*0.18]` near head (z=`-d/2 + d*0.14`).
- `table`: top `[w, h*0.1, d]` at y=`h - h*0.05`; four legs `[w*0.06, h*0.9, d*0.06]` at the four inset corners (x=`±(w/2 - w*0.06)`, z=`±(d/2 - d*0.06)`), y=`h*0.45`.
- `wardrobe`/`cabinet`: body `[w, h, d]` at y=`h/2`; two door gaps via a thin vertical seam box `[w*0.02, h*0.92, 0.005]` slightly proud at z=`d/2`; two handles `[w*0.03, h*0.12, d*0.04]` near the seam. (cabinet = same recipe, shorter h already from dims.)
- `appliance`: body `[w, h, d]` at y=`h/2`; a thin front panel `[w*0.9, h*0.5, 0.01]` proud at z=`d/2`. (TV via id heuristic handled by caller using `decor_flat`-like thin slab is NOT needed here; appliance recipe is fine for fridge/washer; tv-55 already has tiny depth so the body reads as a screen.)
- `kitchen`: base counter `[w, h*0.4, d]` at y=`h*0.2`; upper cabinets `[w, h*0.3, d*0.5]` at y=`h - h*0.15`, z=`-d/2 + d*0.25`; backsplash thin `[w, h*0.3, 0.02]` at z=`-d/2`, y=`h*0.55`.
- `bathroom`: generic → body `[w, h, d]` at y=`h/2` with a thin front panel like appliance (acceptable stylization; fixtures vary).
- `decor_flat`: single flat slab `[w, max(h, 0.02), d]` at y=`max(h,0.02)/2` (rug/prayer mat).
- `generic`: single rounded box `[w, h, d]` at y=`h/2`.

- [ ] **Step 1: Write the failing test (pure dims)**
```ts
import { describe, expect, it } from "vitest"
import { proceduralPartBoxes } from "@/components/preview-3d/furniture-procedural"
import type { Archetype } from "@/lib/three/furniture-models"

const dims = { w: 2, d: 1, h: 0.8 }
const archetypes: Archetype[] = ["seating","bed","table","wardrobe","cabinet","appliance","kitchen","bathroom","decor_flat","generic"]

function bounds(parts: ReturnType<typeof proceduralPartBoxes>) {
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,minZ=Infinity,maxZ=-Infinity
  for (const p of parts) {
    minX=Math.min(minX,p.pos[0]-p.size[0]/2); maxX=Math.max(maxX,p.pos[0]+p.size[0]/2)
    minY=Math.min(minY,p.pos[1]-p.size[1]/2); maxY=Math.max(maxY,p.pos[1]+p.size[1]/2)
    minZ=Math.min(minZ,p.pos[2]-p.size[2]/2); maxZ=Math.max(maxZ,p.pos[2]+p.size[2]/2)
  }
  return { minX,maxX,minY,maxY,minZ,maxZ }
}

describe("proceduralPartBoxes", () => {
  it("every archetype produces at least one part and stays within the footprint + on the floor", () => {
    for (const a of archetypes) {
      const parts = proceduralPartBoxes(a, dims)
      expect(parts.length).toBeGreaterThan(0)
      const b = bounds(parts)
      // within footprint (small tolerance for proud seams)
      expect(b.minX).toBeGreaterThanOrEqual(-dims.w/2 - 0.05)
      expect(b.maxX).toBeLessThanOrEqual(dims.w/2 + 0.05)
      expect(b.minZ).toBeGreaterThanOrEqual(-dims.d/2 - 0.05)
      expect(b.maxZ).toBeLessThanOrEqual(dims.d/2 + 0.05)
      // base on/above floor, top within height
      expect(b.minY).toBeGreaterThanOrEqual(-0.001)
      expect(b.maxY).toBeLessThanOrEqual(dims.h + 0.05)
    }
  })
})
```

- [ ] **Step 2: Run test → fails**

- [ ] **Step 3: Implement** `furniture-procedural.tsx` with `proceduralPartBoxes` (the recipes above) and the component:
```tsx
"use client"

import type { Archetype } from "@/lib/three/furniture-models"

export type Part = { size: [number, number, number]; pos: [number, number, number]; rounded?: boolean }

export function proceduralPartBoxes(
  archetype: Archetype,
  dims: { w: number; d: number; h: number }
): Part[] {
  const { w, d, h } = dims
  // ... implement each recipe from the plan, returning parts that satisfy the bounds test.
  // (Implementer: code each archetype branch per the recipes; keep all parts within the footprint and y∈[0,h].)
}

export function ProceduralFurniture({
  archetype,
  dims,
  color,
}: {
  archetype: Archetype
  dims: { w: number; d: number; h: number }
  color: string
}) {
  const parts = proceduralPartBoxes(archetype, dims)
  return (
    <group>
      {parts.map((p, i) => (
        <mesh key={i} position={p.pos} castShadow receiveShadow>
          <boxGeometry args={p.size} />
          <meshStandardMaterial color={color} roughness={0.85} metalness={archetype === "appliance" ? 0.3 : 0} />
        </mesh>
      ))}
    </group>
  )
}
```
Implement every archetype branch in `proceduralPartBoxes` per the recipes so the bounds test passes for all 10.

- [ ] **Step 4: Run test → passes** (`npx vitest run src/lib/three/furniture-procedural-dims.test.ts`)

- [ ] **Step 5: Commit**
```bash
rtk git add src/components/preview-3d/furniture-procedural.tsx src/lib/three/furniture-procedural-dims.test.ts
rtk git commit -m "feat(3d): procedural furniture archetypes (sized to footprint)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `<FurnitureModel>` render component

**Files:**
- Create: `src/components/preview-3d/furniture-model.tsx`
- Test: `src/components/preview-3d/furniture-model.test.tsx` (logic-level smoke; see below)

**Interfaces:**
- Consumes: `resolveFurnitureSource` (Task 2), `computeFitTransform` (Task 1), `ProceduralFurniture` (Task 3), `PlacedFurniture` type, `SHARED_COLORS`, and `interiorFurnitureColor` (export it from house-model — see Task 5 note; for Task 4, import a local copy or accept `color` as a prop).
- Produces: `<FurnitureModel item position rotationDeg selected color onSelect onHoverChange />`
  - `position: [number,number,number]` — group placed so the model base is at the floor slab top.
  - renders GLB (Suspense fallback procedural; ErrorBoundary → procedural) | procedural | box, plus a selection cage when `selected`.

**Design notes for the implementer:**
- `GlbModel({ url, dims })`: `const { scene } = useGLTF(url, "/draco/")`; clone via `const cloned = useMemo(() => scene.clone(true), [scene])`; compute bbox: `const { size, center } = useMemo(() => { const b = new THREE.Box3().setFromObject(cloned); const s = new THREE.Vector3(), c = new THREE.Vector3(); b.getSize(s); b.getCenter(c); return { size:[s.x,s.y,s.z], center:[c.x,c.y,c.z] } }, [cloned])`; `const fit = computeFitTransform({size,center}, dims)`; render `<group position={fit.position} scale={fit.scale}><primitive object={cloned} /></group>`.
- Wrap GLB in `<Suspense fallback={<ProceduralFurniture .../>}>`.
- ErrorBoundary (class component, local) catching render/load errors → render `<ProceduralFurniture .../>`.
- Selection cage: `selected && <lineSegments position={[0, dims.h/2, 0]}><edgesGeometry args={[new THREE.BoxGeometry(dims.w, dims.h, dims.d)]} /><lineBasicMaterial color={SHARED_COLORS.selected} /></lineSegments>` (memoize the geometry; dispose on unmount).
- The outer group carries `rotation={[0, -(rotationDeg) * Math.PI/180, 0]}` and `position`. Interaction handlers (`onClick` → stopPropagation + onSelect; `onPointerOver`/`onPointerOut` → onHoverChange) go on an invisible hitbox mesh sized to dims (`<mesh position={[0,dims.h/2,0]} visible={false}><boxGeometry args={[dims.w,dims.h,dims.d]} /></mesh>`) so clicks work regardless of model shape.
- `dims = { w: item.widthM, d: item.depthM, h: sceneHeight }` where `sceneHeight` follows the existing `sceneFurnitureHeight(item)` rules (decor flat, tv-55, clamp) — accept it as a prop `dims` computed by the caller (Task 5), so this component stays presentational.

**Test (`furniture-model.test.tsx`)** — render-free logic: this component is R3F (needs a canvas), so do NOT mount it in jsdom. Instead unit-test the only branching helper you extract: a pure `selectionCageArgs(dims)` or simply re-assert `resolveFurnitureSource` integration is covered by Task 2. Add a minimal test that imports the module and asserts `FurnitureModel` is a function (guards against import/JSX syntax errors and circular imports):
```tsx
import { describe, expect, it } from "vitest"
import { FurnitureModel } from "./furniture-model"

describe("FurnitureModel module", () => {
  it("exports a component without throwing on import", () => {
    expect(typeof FurnitureModel).toBe("function")
  })
})
```
(Real rendering is verified by the Task 6 Playwright e2e — that is the meaningful integration test for R3F.)

- [ ] **Step 1: Write the failing import test** → run → fails (module missing).
- [ ] **Step 2: Implement `furniture-model.tsx`** per the design notes. Run `npx tsc --noEmit` → 0 errors.
- [ ] **Step 3: Run** `npx vitest run src/components/preview-3d/furniture-model.test.tsx` → passes.
- [ ] **Step 4: Commit**
```bash
rtk git add src/components/preview-3d/furniture-model.tsx src/components/preview-3d/furniture-model.test.tsx
rtk git commit -m "feat(3d): FurnitureModel — GLB/procedural/box with fit + fallback + selection

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Integrate into the scene + draco + preload

**Files:**
- Modify: `src/components/preview-3d/house-model.tsx`
- Create: `public/draco/` (copy decoder from `node_modules/three/examples/jsm/libs/draco/`)
- Test: relies on Task 6 e2e + existing unit suite + tsc/build.

**Steps:**
- [ ] **Step 1: Copy the draco decoder** so `useGLTF(url, "/draco/")` resolves locally:
```bash
mkdir -p public/draco
cp node_modules/three/examples/jsm/libs/draco/draco_decoder.js public/draco/
cp node_modules/three/examples/jsm/libs/draco/draco_decoder.wasm public/draco/
cp node_modules/three/examples/jsm/libs/draco/draco_wasm_wrapper.js public/draco/ 2>/dev/null || true
```
Verify the files exist in `public/draco/`.

- [ ] **Step 2: Export `interiorFurnitureColor`** from `house-model.tsx` (add `export` to the existing function at line ~234) so `FurnitureModel`/`ProceduralFurniture` callers share the palette. Run tsc.

- [ ] **Step 3: Replace the furniture render block.** In `house-model.tsx`, the block `roomPlan.furniture.map((item) => { ... return (<group key={item.id}><mesh ...><boxGeometry .../>...</mesh>{showInteriorLabels && <Html.../>}</group>) })` (lines ~148–198). Replace the inner `<mesh>...</mesh>` (the furniture box, NOT the `<Html>` label) with:
```tsx
<FurnitureModel
  item={item}
  position={pos}
  rotationDeg={item.rotationDeg}
  selected={selected}
  color={interiorFurnitureColor(item)}
  dims={{ w: item.widthM, d: item.depthM, h: height }}
  onSelect={() => { selectRoom(room.id); selectFurniture(item.id) }}
  onHoverChange={(hovering) => setCursor(hovering ? "pointer" : "auto")}
/>
```
where `pos`, `height`, `selected` are the existing computed values. IMPORTANT: the existing `pos` puts the box CENTER at `slabTopY + yOffset + height/2`. `FurnitureModel` places its base at the group origin, so change the y of `pos` passed to it to the floor base: `posBase = [pos[0], slabTopY + sceneFurnitureYOffset(item), pos[2]]`. Keep the `<Html>` label exactly as-is.

- [ ] **Step 4: Preload registered models.** Add near the top of `HouseModel` (client component): call `preloadRegisteredModels()` once — e.g. a module-level `registeredModelUrls().forEach((u) => useGLTF.preload(u))` guarded to run once, or inside a `React.useEffect(() => { registeredModelUrls().forEach((u) => useGLTF.preload(u)) }, [])`. Import `useGLTF` from `@react-three/drei`.

- [ ] **Step 5: Verify** `npx tsc --noEmit` → 0; `npx vitest run` → all green; `npm run build` → succeeds (middleware warning only).

- [ ] **Step 6: Commit**
```bash
rtk git add src/components/preview-3d/house-model.tsx public/draco
rtk git commit -m "feat(3d): render furniture via FurnitureModel; draco decoder + preload

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: End-to-end (Playwright) + screenshot + full verification

**Files:**
- Create: `e2e/interior-3d-models.spec.ts`
- Test artifacts: `e2e/artifacts/preview-3d-glb.png`

**Interfaces:** uses the existing auth setup (storageState) + demo project `proj-demo-8x8`.

- [ ] **Step 1: Write the e2e test**
```ts
import { test, expect } from "@playwright/test"

const DEMO = "proj-demo-8x8"

test.describe("Interior 3D models (GLB hybrid)", () => {
  test("preview-3d renders furniture without console errors and a GLB item can be added", async ({ page }) => {
    const errors: string[] = []
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()) })
    page.on("pageerror", (e) => errors.push(String(e)))

    await page.goto(`/app/projects/${DEMO}/preview-3d`)
    // Scene mounts (canvas) or graceful fallback — must not be a crash.
    const canvas = page.locator("canvas")
    const fallback = page.getByText("Gagal memuat preview 3D")
    await expect(canvas.or(fallback)).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText("Interior 3D editor")).toBeVisible({ timeout: 30_000 })

    // Add a GLB-backed item (Kasur Queen → /models/bed.glb).
    const add = page.getByTestId("preview-3d-interior-add")
    await add.getByTestId("preview-3d-interior-add-search").fill("kasur")
    await add.getByRole("button", { name: /Tambah Kasur Queen/ }).click()
    await expect(page.getByTestId("preview-active-furniture").getByText("Kasur Queen")).toBeVisible()

    // Give GLB a moment to load, then snapshot for visual review.
    await page.waitForTimeout(2500)
    await page.screenshot({ path: "e2e/artifacts/preview-3d-glb.png", fullPage: false })

    // No uncaught/console errors from model loading.
    const modelErrors = errors.filter((e) => !/favicon|ResizeObserver/i.test(e))
    expect(modelErrors, modelErrors.join("\n")).toEqual([])

    // Scene still alive after adding the model.
    await expect(canvas.or(fallback)).toBeVisible()
  })
})
```

- [ ] **Step 2: Run the new e2e test**
Run: `npx playwright test e2e/interior-3d-models.spec.ts`
Expected: PASS. (If WebGL is unavailable in the runner, the `canvas.or(fallback)` assertion still passes via fallback and the console-error check still guards regressions.)

- [ ] **Step 3: Run the FULL e2e suite (no regression)**
Run: `npx playwright test`
Expected: all pass (esp. the existing "Interior in 3D preview" test).

- [ ] **Step 4: Full unit + build gate**
Run: `npx vitest run` (all green), `npx tsc --noEmit` (0), `npm run build` (succeeds).

- [ ] **Step 5: Commit**
```bash
rtk git add e2e/interior-3d-models.spec.ts e2e/artifacts/preview-3d-glb.png
rtk git commit -m "test(3d): e2e preview-3d GLB furniture renders without console errors

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Manual / Morning Verification
1. `npx playwright test e2e/interior-3d-models.spec.ts` — green; open `e2e/artifacts/preview-3d-glb.png` to see the realistic bed model in the room.
2. `npm run dev` → open a project's `/preview-3d`, add Kasur Queen (GLB bed), Sofa (GLB armchair), and e.g. a wardrobe (procedural) — confirm: models sit on the floor, fit the footprint, rotate correctly, selection cage shows on click, no blank/box-flash beyond the brief load.
3. Items without a model (e.g. kitchen set, toilet) show the clean procedural archetype, not a plain box.

## Notes / Risks
- Procedural quality is conservative-stylized (composed boxes); verified via the bounds test + screenshot, not pixel-match.
- Large GLBs (armchair 18MB) load slowly; Suspense shows the procedural model meanwhile — that is the intended "seamless" behavior. Compression (gltf-transform) is an optional follow-up.
- Whole-scene GLBs (apartment/hallway) are intentionally NOT registered.
- Drag-in-3D and picker thumbnails are deliberately out of scope (separate specs).
