# Editor Alignment Guides / Object-Snap — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While resizing or moving a room in the 2D editor, snap the moving edge/room to nearby rooms' edges, center-lines, the site bounds, and equal-size positions — with guide lines — overriding grid-snap within a small zoom-aware threshold.

**Architecture:** A pure geometry module (`alignment.ts`) computes snap candidates and results. `editor-store`'s `dragResize`/`dragRoomTo` call it (object-snap beats grid-snap) and record transient `alignmentGuides`. `plan-canvas` passes a zoom-aware `tol` and renders the guide lines.

**Tech Stack:** zustand · SVG 2D canvas · vitest. No new deps, no DB migration.

## Global Constraints

- Spec: [docs/superpowers/specs/2026-06-29-editor-alignment-guides-design.md](../specs/2026-06-29-editor-alignment-guides-design.md).
- Applies to BOTH resize and move. Candidates: neighbor edges + neighbor center-lines + site bounds (0 / dim / dim÷2) + equal-size (resize only). Object-snap wins within `tol`; else grid-snap (existing) when `snapEnabled`; `tol` is passed from the canvas as `SNAP_PX / pxPerMeter` (SNAP_PX = 8) so it's zoom-aware and below half a grid cell.
- Guides are transient — set during a drag, cleared on `beginDrag`/`endDrag`. Rooms only (not openings). Locked rooms unaffected.
- `Rect = { x, y, width, depth }` is exported from `@/lib/geometry`; `Room` is structurally assignable to it. Verify `rtk tsc` · `npx vitest run` · `npx next build`.

---

## File Structure

- Create `src/lib/geometry/alignment.ts` — pure snap helpers + `SnapCandidate`/`SnapResult` types.
- Modify `src/stores/editor-store.ts` — `dragResize`/`dragRoomTo` object-snap + `tol` param + `alignmentGuides` state + clearing.
- Modify `src/components/editor/plan-canvas.tsx` — pass `tol`, render guide lines + "=" badge.

---

## Task 1: Pure alignment geometry (`alignment.ts`)

**Files:**
- Create: `src/lib/geometry/alignment.ts`
- Test: `src/lib/geometry/alignment.test.ts`

**Interfaces:**
- Consumes: `Rect` from `./index`.
- Produces: `SnapKind`, `SnapCandidate`, `SnapResult`; `snapAxis(value, candidates, tol)`; `resizeCandidatesX/Y(room, others, site, edge)`; `moveCandidatesX/Y(others, site)`; `snapMove(pos, size, candidates, tol)`.

- [ ] **Step 1: Write the failing test** — `src/lib/geometry/alignment.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import {
  snapAxis, resizeCandidatesX, resizeCandidatesY, moveCandidatesX, snapMove,
} from "./alignment"

const site = { widthM: 10, depthM: 12 }

describe("snapAxis", () => {
  it("snaps to the nearest candidate within tol", () => {
    const r = snapAxis(3.27, [{ value: 3.3, kind: "edge" }, { value: 5, kind: "edge" }], 0.1)
    expect(r.value).toBeCloseTo(3.3, 5)
    expect(r.guide?.kind).toBe("edge")
  })
  it("does not snap when all candidates are outside tol", () => {
    const r = snapAxis(3.27, [{ value: 3.6, kind: "edge" }], 0.1)
    expect(r.value).toBe(3.27)
    expect(r.guide).toBeNull()
  })
})

describe("resizeCandidatesX", () => {
  const room = { x: 1, y: 1, width: 4, depth: 3 }
  const others = [{ x: 2, y: 6, width: 3.27, depth: 2 }]
  it("includes the neighbor's left/right/center + site bounds", () => {
    const vals = resizeCandidatesX(room, others, site, "right").map((c) => c.value)
    expect(vals).toEqual(expect.arrayContaining([2, 5.27, 3.635, 0, 10, 5]))
  })
  it("adds an equal-width position for the moving right edge (x + other.width)", () => {
    const eq = resizeCandidatesX(room, others, site, "right").find((c) => c.kind === "equal")!
    expect(eq.value).toBeCloseTo(room.x + 3.27, 5) // 4.27 → width becomes 3.27
  })
  it("equal-width for the left edge keeps the right edge fixed", () => {
    const eq = resizeCandidatesX(room, others, site, "left").find((c) => c.kind === "equal")!
    expect(eq.value).toBeCloseTo(room.x + room.width - 3.27, 5) // 5 - 3.27 = 1.73
  })
})

describe("resizeCandidatesY", () => {
  it("includes neighbor top/bottom/center on the Y axis", () => {
    const vals = resizeCandidatesY({ x: 0, y: 0, width: 2, depth: 2 }, [{ x: 0, y: 4, width: 2, depth: 3 }], site, "bottom").map((c) => c.value)
    expect(vals).toEqual(expect.arrayContaining([4, 7, 5.5]))
  })
})

describe("moveCandidatesX", () => {
  it("has edges + center + site but NO equal-size", () => {
    const cands = moveCandidatesX([{ x: 2, y: 0, width: 4, depth: 2 }], site)
    expect(cands.some((c) => c.kind === "equal")).toBe(false)
    expect(cands.map((c) => c.value)).toEqual(expect.arrayContaining([2, 6, 4, 0, 10, 5]))
  })
})

describe("snapMove", () => {
  it("shifts the room so its nearest reference (left/right/center) lands on a candidate", () => {
    // room x=5 width=3 → left 5, right 8, center 6.5; candidate 9 within tol 1.5 → align right edge → x=6
    const r = snapMove(5, 3, [{ value: 9, kind: "edge" }], 1.5)
    expect(r.value).toBeCloseTo(6, 5)
    expect(r.guide?.value).toBe(9)
  })
  it("returns the position unchanged when nothing is within tol", () => {
    const r = snapMove(5, 3, [{ value: 20, kind: "edge" }], 0.2)
    expect(r.value).toBe(5)
    expect(r.guide).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/geometry/alignment.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — create `src/lib/geometry/alignment.ts`:

```ts
import type { Rect } from "./index"

export type SnapKind = "edge" | "center" | "site" | "equal"
export type SnapCandidate = { value: number; kind: SnapKind }
export type SnapResult = { value: number; guide: SnapCandidate | null }

type Site = { widthM: number; depthM: number }

/** Nearest candidate within tol wins; else value unchanged. */
export function snapAxis(value: number, candidates: SnapCandidate[], tol: number): SnapResult {
  let best: SnapCandidate | null = null
  let bestD = tol
  for (const c of candidates) {
    const d = Math.abs(c.value - value)
    if (d <= bestD) {
      bestD = d
      best = c
    }
  }
  return best ? { value: best.value, guide: best } : { value, guide: null }
}

function edgesX(others: Rect[]): SnapCandidate[] {
  return others.flatMap((o) => [
    { value: o.x, kind: "edge" as const },
    { value: o.x + o.width, kind: "edge" as const },
    { value: o.x + o.width / 2, kind: "center" as const },
  ])
}
function edgesY(others: Rect[]): SnapCandidate[] {
  return others.flatMap((o) => [
    { value: o.y, kind: "edge" as const },
    { value: o.y + o.depth, kind: "edge" as const },
    { value: o.y + o.depth / 2, kind: "center" as const },
  ])
}
function siteX(site: Site): SnapCandidate[] {
  return [
    { value: 0, kind: "site" },
    { value: site.widthM, kind: "site" },
    { value: site.widthM / 2, kind: "site" },
  ]
}
function siteY(site: Site): SnapCandidate[] {
  return [
    { value: 0, kind: "site" },
    { value: site.depthM, kind: "site" },
    { value: site.depthM / 2, kind: "site" },
  ]
}

export function resizeCandidatesX(room: Rect, others: Rect[], site: Site, edge: "left" | "right"): SnapCandidate[] {
  const out = [...edgesX(others), ...siteX(site)]
  for (const o of others) {
    out.push({ value: edge === "right" ? room.x + o.width : room.x + room.width - o.width, kind: "equal" })
  }
  return out
}
export function resizeCandidatesY(room: Rect, others: Rect[], site: Site, edge: "top" | "bottom"): SnapCandidate[] {
  const out = [...edgesY(others), ...siteY(site)]
  for (const o of others) {
    out.push({ value: edge === "bottom" ? room.y + o.depth : room.y + room.depth - o.depth, kind: "equal" })
  }
  return out
}
export function moveCandidatesX(others: Rect[], site: Site): SnapCandidate[] {
  return [...edgesX(others), ...siteX(site)]
}
export function moveCandidatesY(others: Rect[], site: Site): SnapCandidate[] {
  return [...edgesY(others), ...siteY(site)]
}

/** Move a rect on one axis: match its left(pos)/right(pos+size)/center against candidates,
 *  snap to the nearest in-tol one, and return the adjusted position + the matched guide. */
export function snapMove(pos: number, size: number, candidates: SnapCandidate[], tol: number): SnapResult {
  const refs = [pos, pos + size, pos + size / 2]
  let best: SnapCandidate | null = null
  let bestPos = pos
  let bestD = tol
  for (const ref of refs) {
    for (const c of candidates) {
      const d = Math.abs(c.value - ref)
      if (d <= bestD) {
        bestD = d
        best = c
        bestPos = pos + (c.value - ref)
      }
    }
  }
  return best ? { value: bestPos, guide: best } : { value: pos, guide: null }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/geometry/alignment.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/geometry/alignment.ts src/lib/geometry/alignment.test.ts
git commit -m "feat(editor): pure alignment/object-snap geometry helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Store object-snap + guides (`editor-store`)

**Files:**
- Modify: `src/stores/editor-store.ts`
- Test: `src/stores/editor-store.test.ts`

**Interfaces:**
- Consumes: Task 1 helpers.
- Produces: `dragResize(id, handle, mx, my, tol?)`, `dragRoomTo(id, x, y, tol?)`, `alignmentGuides: { x: number[]; y: number[]; equalX: number[]; equalY: number[] }`.

- [ ] **Step 1: Write the failing test** — append to `src/stores/editor-store.test.ts` (it already loads a layout in `beforeEach`; if not, load one):

```ts
import { useEditorStore } from "./editor-store"

describe("editor-store object-snap", () => {
  const layout = () => ({
    id: "l", projectId: "p", versionId: "v",
    floors: [{ id: "f1", level: 1, name: "L1", heightM: 3 }],
    rooms: [
      { id: "a", floorId: "f1", name: "A", type: "kamar_tidur", x: 1, y: 1, width: 4, depth: 3, areaM2: 12 },
      { id: "b", floorId: "f1", name: "B", type: "dapur", x: 2, y: 6, width: 3.27, depth: 2, areaM2: 6.54 },
    ],
    walls: [], openings: [], stairs: [], pools: [], validation: { passed: true, issues: [] },
  })
  const site = { widthM: 10, depthM: 12 }

  it("resize snaps the moving edge to a neighbor edge (beating grid) and records a guide", () => {
    useEditorStore.getState().loadLayout(layout() as never, site, [])
    useEditorStore.getState().beginDrag()
    // drag room A's right edge (handle 'e') to 5.27 → neighbor B's right edge (2+3.27) within tol
    useEditorStore.getState().dragResize("a", "e", 5.29, 2.5, 0.1)
    const a = useEditorStore.getState().layout!.rooms.find((r) => r.id === "a")!
    expect(a.x + a.width).toBeCloseTo(5.27, 5) // snapped to B's right edge, not grid (5.0/5.5)
    expect(useEditorStore.getState().alignmentGuides.x).toContain(5.27)
  })

  it("beginDrag and endDrag clear the guides", () => {
    useEditorStore.getState().loadLayout(layout() as never, site, [])
    useEditorStore.getState().beginDrag()
    useEditorStore.getState().dragRoomTo("a", 2, 6.05, 0.2) // near B — will produce guides
    useEditorStore.getState().endDrag()
    expect(useEditorStore.getState().alignmentGuides.x).toHaveLength(0)
    expect(useEditorStore.getState().alignmentGuides.y).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/stores/editor-store.test.ts`
Expected: FAIL — `alignmentGuides` undefined / snap not applied.

- [ ] **Step 3: Implement** — in `src/stores/editor-store.ts`:

(a) imports:
```ts
import {
  moveCandidatesX, moveCandidatesY, resizeCandidatesX, resizeCandidatesY, snapAxis, snapMove,
} from "@/lib/geometry/alignment"
```
(b) `EditorState` type: add
```ts
  alignmentGuides: { x: number[]; y: number[]; equalX: number[]; equalY: number[] }
```
and change the two drag signatures to accept an optional tol:
```ts
  dragRoomTo: (id: string, x: number, y: number, tol?: number) => void
  dragResize: (id: string, handle: HandleId, mx: number, my: number, tol?: number) => void
```
(c) initial state: add `alignmentGuides: { x: [], y: [], equalX: [], equalY: [] },`
(d) `beginDrag`: also reset guides:
```ts
    beginDrag: () => {
      const { layout } = get()
      set({ _dragBase: layout ? clone(layout) : null, _dragPushed: false, alignmentGuides: { x: [], y: [], equalX: [], equalY: [] } })
    },
```
(e) replace `dragRoomTo`:
```ts
    dragRoomTo: (id, x, y, tol = 0) => {
      const { snapEnabled, gridSize, layout, site } = get()
      const gx: number[] = [], gy: number[] = []
      live((l) => {
        const room = l.rooms.find((r) => r.id === id)
        if (!room || room.locked || !site) return
        const others = l.rooms.filter((r) => r.floorId === room.floorId && r.id !== id)
        const rx = snapMove(x, room.width, moveCandidatesX(others, site), tol)
        const ry = snapMove(y, room.depth, moveCandidatesY(others, site), tol)
        const fx = rx.guide ? rx.value : snapEnabled ? snap(x, gridSize) : x
        const fy = ry.guide ? ry.value : snapEnabled ? snap(y, gridSize) : y
        if (rx.guide) gx.push(round2(rx.guide.value))
        if (ry.guide) gy.push(round2(ry.guide.value))
        room.x = round2(fx)
        room.y = round2(fy)
      })
      set({ alignmentGuides: { x: gx, y: gy, equalX: [], equalY: [] } })
    },
```
(f) replace `dragResize`:
```ts
    dragResize: (id, handle, mx, my, tol = 0) => {
      const { snapEnabled, gridSize, site } = get()
      const gx: number[] = [], gy: number[] = [], eqx: number[] = [], eqy: number[] = []
      live((l) => {
        const room = l.rooms.find((r) => r.id === id)
        if (!room || room.locked) return
        const others = l.rooms.filter((r) => r.floorId === room.floorId && r.id !== id)
        const rect = { x: room.x, y: room.y, width: room.width, depth: room.depth }
        let sx = mx, sy = my
        if (site && (handle.includes("w") || handle.includes("e"))) {
          const edge = handle.includes("w") ? "left" : "right"
          const res = snapAxis(mx, resizeCandidatesX(rect, others, site, edge), tol)
          sx = res.guide ? res.value : snapEnabled ? snap(mx, gridSize) : mx
          if (res.guide) (res.guide.kind === "equal" ? eqx : gx).push(round2(res.value))
        } else {
          sx = snapEnabled ? snap(mx, gridSize) : mx
        }
        if (site && (handle.includes("n") || handle.includes("s"))) {
          const edge = handle.includes("n") ? "top" : "bottom"
          const res = snapAxis(my, resizeCandidatesY(rect, others, site, edge), tol)
          sy = res.guide ? res.value : snapEnabled ? snap(my, gridSize) : my
          if (res.guide) (res.guide.kind === "equal" ? eqy : gy).push(round2(res.value))
        } else {
          sy = snapEnabled ? snap(my, gridSize) : my
        }
        const r = applyResize(rect, handle, sx, sy, MIN_ROOM)
        room.x = round2(r.x)
        room.y = round2(r.y)
        room.width = round2(r.width)
        room.depth = round2(r.depth)
        room.areaM2 = roomArea(room.width, room.depth)
      })
      set({ alignmentGuides: { x: gx, y: gy, equalX: eqx, equalY: eqy } })
    },
```
(g) `endDrag`: also clear guides — in its `set(...)` add `alignmentGuides: { x: [], y: [], equalX: [], equalY: [] }` (both branches).

- [ ] **Step 4: Run test + types**

Run: `npx vitest run src/stores/editor-store.test.ts` then `rtk tsc`
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/stores/editor-store.ts src/stores/editor-store.test.ts
git commit -m "feat(editor): object-snap in drag/resize + alignment guides state

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Canvas — pass tol + render guides (`plan-canvas`)

**Files:**
- Modify: `src/components/editor/plan-canvas.tsx`

**Interfaces:**
- Consumes: `dragResize`/`dragRoomTo` (now accept `tol`); `alignmentGuides`.

- [ ] **Step 1: Pass a zoom-aware tol** — in `plan-canvas.tsx`:

(a) near the top module constants add:
```ts
const SNAP_PX = 8
```
(b) add a selector with the other store hooks:
```ts
  const alignmentGuides = useEditorStore((s) => s.alignmentGuides)
```
(c) in the rAF move handler, pass `tol = SNAP_PX / pxPerMeter` to both drag calls:
```ts
    if (d.kind === "move") dragRoomTo(d.id, wx - d.offX, wy - d.offY, SNAP_PX / pxPerMeter)
    else if (d.kind === "resize") dragResize(d.id, d.handle, wx, wy, SNAP_PX / pxPerMeter)
```
(Add `pxPerMeter` to that `useCallback`'s dependency array.)

- [ ] **Step 2: Render the guide lines** — inside the main `<svg>`, after the rooms layer (near the selection handles), add a guides layer that spans the full site:

```tsx
      {/* Alignment guides (transient, during drag) */}
      <g pointerEvents="none">
        {[
          ...alignmentGuides.x.map((v) => ({ v, equal: false })),
          ...alignmentGuides.equalX.map((v) => ({ v, equal: true })),
        ].map(({ v, equal }, i) => (
          <g key={`gx-${i}`}>
            <line
              x1={toX(v)} y1={toY(0)} x2={toX(v)} y2={toY(site.depthM)}
              stroke="#e11d80" strokeWidth={1} strokeDasharray="4 3"
            />
            {equal && (
              <text x={toX(v) + 3} y={toY(0) + 12} fontSize={11} fontWeight={700} fill="#e11d80">=</text>
            )}
          </g>
        ))}
        {[
          ...alignmentGuides.y.map((v) => ({ v, equal: false })),
          ...alignmentGuides.equalY.map((v) => ({ v, equal: true })),
        ].map(({ v, equal }, i) => (
          <g key={`gy-${i}`}>
            <line
              x1={toX(0)} y1={toY(v)} x2={toX(site.widthM)} y2={toY(v)}
              stroke="#e11d80" strokeWidth={1} strokeDasharray="4 3"
            />
            {equal && (
              <text x={toX(0) + 3} y={toY(v) - 3} fontSize={11} fontWeight={700} fill="#e11d80">=</text>
            )}
          </g>
        ))}
      </g>
```
(`toX`/`toY`/`site` are already in scope in this component. The arrays are empty except during a drag, so nothing renders otherwise.)

- [ ] **Step 3: Verify**

Run: `rtk tsc` then `npx next build`
Expected: 0 errors; build succeeds. Manual: drag a room's edge near a neighbor → the edge snaps exactly to the neighbor's edge/center and a magenta guide line shows; when the width matches a neighbor's, an "=" appears; grid-snap no longer blocks off-grid alignment; moving a room aligns its edges/center to neighbors.

- [ ] **Step 4: Commit**

```bash
git add src/components/editor/plan-canvas.tsx
git commit -m "feat(editor): render alignment guides + pass zoom-aware snap tol

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Full verification

- [ ] **Step 1: tsc + tests + build**

Run: `rtk tsc` · `npx vitest run` · `npx next build`
Expected: tsc clean; all tests pass; build succeeds.

- [ ] **Step 2: Manual smoke (mock mode)**

`npx next dev`, 2D editor: resize a room's edge toward a neighbor → snaps to the neighbor's edge/center + magenta guide; drag until the widths match → "=" badge + equal width; move a room so its edge/center aligns to another → guide; toggle grid-snap on → alignment still wins near a neighbor (off-grid alignment now possible).

- [ ] **Step 3: Final commit (if fixes)**

```bash
git add -A && git commit -m "test(editor): verify alignment guides / object-snap

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** edges + center-lines + site + equal-size candidates → T1 (`resize/moveCandidates*`, `edgesX/Y` include center, `siteX/Y` include dim÷2). Resize + move → T2 (`dragResize`/`dragRoomTo`). Object-snap beats grid within tol → T2 (guide?value : gridSnap). Zoom-aware tol → T3 (`SNAP_PX/pxPerMeter`). Guides + "=" badge → T3. Transient/cleared → T2 (`beginDrag`/`endDrag`). Testing → T1 (helpers) + T2 (store override + clearing). ✓

**Placeholder scan:** none — full code throughout.

**Type consistency:** `SnapCandidate`/`SnapResult`/`snapAxis`/`resizeCandidatesX/Y`/`moveCandidatesX/Y`/`snapMove` identical across T1 (defs) ↔ T2 (uses). `alignmentGuides: { x; y; equalX; equalY }` identical across T2 (state) ↔ T3 (render). `dragResize(...,tol?)`/`dragRoomTo(...,tol?)` signatures match T2 (def) ↔ T3 (call). `tol = 0` default keeps any other caller safe (snapAxis with tol 0 → no object-snap → grid only).

**Note for implementers:** (T2) compute guide arrays in outer-scope `let`s and `set({alignmentGuides})` AFTER `live(...)` (mirrors the `addRoom` newId pattern) — don't put the guide `set` inside the `live` mutator. (T3) place the guides `<g>` so it renders above room fills but the `pointerEvents="none"` keeps it from stealing drags.
