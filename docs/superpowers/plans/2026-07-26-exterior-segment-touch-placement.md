# Exterior Segment Touch Placement Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix segment-kind exterior elements (fence, boundary_wall, sliding_gate, swing_gate, pedestrian_gate) so a single tap on the 2D floorplan editor places a visible, non-zero-length element instead of an invisible zero-length one — and let users adjust length via a numeric input in the Properti panel, not just by dragging endpoints.

**Architecture:** Add a `segmentDefaultLengthM(kind)` lookup to the exterior element factory module, use it in `PlanCanvas`'s tap-placement handler to give the initial `end` point real distance from `start` (clamped to the site boundary), and add a "Panjang (m)" field to `SegmentFields` in `EditorInspector` that recomputes `end` along the segment's existing direction when committed.

**Tech Stack:** Next.js (App Router) / TypeScript / Zustand / Vitest + Testing Library (existing test stack, no new dependencies).

## Global Constraints

- **Root cause, not symptom:** the fix must give segments a non-degenerate default length on tap — do not "fix" this by only changing rendering to show zero-length lines as a dot.
- **No change to drag-to-adjust behavior:** a user who taps-and-drags in one continuous gesture must still end the segment exactly where they release (existing `exteriorSegment` drag path in `plan-canvas.tsx` stays untouched).
- **Default lengths (exact values):** `pedestrian_gate` → `1.2` m. `boundary_wall`, `fence`, `sliding_gate`, `swing_gate` → `3` m.
- **Clamp on placement:** the initial `end.x` must not exceed `site.widthM` (placing near the east edge must not overflow the site).
- **`MIN_SEGMENT_LENGTH_M` (0.2 m, in `src/lib/exterior/validation.ts`) is unchanged** — all new defaults (1.2 m, 3 m) are already well above it; do not touch this file.
- **No changes to:** `exterior-canvas.tsx` rendering, `facade-templates.ts` (3D template path — already correct), non-segment exterior element placement (box/frame/stair/surface/asset — already correct).
- **Testing rule (standing project rule):** every behavior change needs a real test that exercises actual store/component logic (not a mocked shortcut) — this repo's convention throughout `plan-canvas.test.tsx`/`editor-inspector.test.tsx` is to drive the real Zustand store (`useEditorStore`) and real rendered components via Testing Library, not to mock the store. Follow that pattern exactly; do not introduce mocks for `useEditorStore`.

## File Map

- Modify: `src/lib/exterior/factories.ts` — add exported `segmentDefaultLengthM(kind)`.
- Modify: `src/components/editor/plan-canvas.tsx` — use it in the `isSegmentKind(k)` tap-placement branch (~line 1678-1693).
- Test: `src/components/editor/plan-canvas.test.tsx` — new tests in the existing `describe("PlanCanvas — exterior elements", ...)` block.
- Modify: `src/components/editor/editor-inspector.tsx` — add "Panjang (m)" field to `SegmentFields` (~line 2243-2271), add `round2`/`segmentLength` import.
- Test: `src/components/editor/editor-inspector.test.tsx` — new `describe("EditorInspector — exterior segment fields", ...)` block (this file currently has zero exterior-element test coverage).

---

### Task 1: `segmentDefaultLengthM` in the factory module

**Files:**
- Modify: `src/lib/exterior/factories.ts`
- Test: `src/lib/exterior/factories.test.ts` (create — this file does not exist yet; `factories.ts` is currently exercised only indirectly through other files' tests)

**Interfaces:**
- Produces: `export function segmentDefaultLengthM(kind: ExteriorSegmentKind): number`. Consumed by Task 2 (`plan-canvas.tsx`).

- [ ] **Step 1: Write the failing test**

Create `src/lib/exterior/factories.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { segmentDefaultLengthM } from "@/lib/exterior/factories";

describe("segmentDefaultLengthM", () => {
  it("returns 1.2m for pedestrian_gate", () => {
    expect(segmentDefaultLengthM("pedestrian_gate")).toBe(1.2);
  });

  it("returns 3m for boundary_wall, fence, sliding_gate, and swing_gate", () => {
    expect(segmentDefaultLengthM("boundary_wall")).toBe(3);
    expect(segmentDefaultLengthM("fence")).toBe(3);
    expect(segmentDefaultLengthM("sliding_gate")).toBe(3);
    expect(segmentDefaultLengthM("swing_gate")).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Baruma && npx vitest run src/lib/exterior/factories.test.ts`
Expected: FAIL with `segmentDefaultLengthM is not a function` (or module has no exported member `segmentDefaultLengthM`).

- [ ] **Step 3: Write minimal implementation**

In `src/lib/exterior/factories.ts`, add this function after `makeSegmentElement` (which ends at line 82, right before `export function makeBoxElement`):

```ts
export function segmentDefaultLengthM(kind: ExteriorSegmentKind): number {
  switch (kind) {
    case "pedestrian_gate":
      return 1.2;
    case "boundary_wall":
    case "fence":
    case "sliding_gate":
    case "swing_gate":
    default:
      return 3;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Baruma && npx vitest run src/lib/exterior/factories.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/exterior/factories.ts src/lib/exterior/factories.test.ts
git commit -m "feat(exterior): add segmentDefaultLengthM lookup for tap-placement defaults"
```

---

### Task 2: Non-degenerate segment placement on tap in `PlanCanvas`

**Files:**
- Modify: `src/components/editor/plan-canvas.tsx`
- Test: `src/components/editor/plan-canvas.test.tsx`

**Interfaces:**
- Consumes: `segmentDefaultLengthM` (Task 1, from `@/lib/exterior/factories`).
- Produces: no new exports — this task changes `onBackgroundDown`'s internal behavior only. Later tasks do not depend on any new interface from this task (Task 3 is independent, editing a different file).

- [ ] **Step 1: Write the failing tests**

In `src/components/editor/plan-canvas.test.tsx`, add these tests inside the existing `describe("PlanCanvas — exterior elements", ...)` block (after the `"places additive box/frame exterior elements from the exterior tool"` test, which ends at line 416, right before the `"cancels pending exterior placement with Escape"` test):

```tsx
  it("places a fence with a non-zero default length on a single tap (no drag)", () => {
    useEditorStore
      .getState()
      .loadLayout(rooftopLayout(), { widthM: 10, depthM: 10 }, []);
    useEditorStore.getState().setTool("exterior");
    useEditorStore.getState().setPendingExteriorKind("fence");
    const { container } = render(<PlanCanvas />);
    const svg = container.querySelector("svg")!;

    // A tap: pointerDown then pointerUp at the SAME coordinates (no pointerMove in between).
    fireEvent.pointerDown(svg, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(svg, { pointerId: 1, clientX: 100, clientY: 100 });

    const fence = useEditorStore
      .getState()
      .layout?.exteriorElements?.find((element) => element.kind === "fence");
    expect(fence).toBeTruthy();
    expect(fence).toHaveProperty("start");
    expect(fence).toHaveProperty("end");
    const segment = fence as { start: { x: number; y: number }; end: { x: number; y: number } };
    const length = Math.hypot(segment.end.x - segment.start.x, segment.end.y - segment.start.y);
    expect(length).toBeCloseTo(3, 5); // fence default length
  });

  it("places a pedestrian_gate with its own (shorter) default length on tap", () => {
    useEditorStore
      .getState()
      .loadLayout(rooftopLayout(), { widthM: 10, depthM: 10 }, []);
    useEditorStore.getState().setTool("exterior");
    useEditorStore.getState().setPendingExteriorKind("pedestrian_gate");
    const { container } = render(<PlanCanvas />);
    const svg = container.querySelector("svg")!;

    fireEvent.pointerDown(svg, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(svg, { pointerId: 1, clientX: 100, clientY: 100 });

    const gate = useEditorStore
      .getState()
      .layout?.exteriorElements?.find((element) => element.kind === "pedestrian_gate");
    expect(gate).toBeTruthy();
    const segment = gate as { start: { x: number; y: number }; end: { x: number; y: number } };
    const length = Math.hypot(segment.end.x - segment.start.x, segment.end.y - segment.start.y);
    expect(length).toBeCloseTo(1.2, 5);
  });

  it("clamps the default-length endpoint to the site's east edge when tapping near it", () => {
    useEditorStore
      .getState()
      .loadLayout(rooftopLayout(), { widthM: 10, depthM: 10 }, []);
    useEditorStore.getState().setTool("exterior");
    useEditorStore.getState().setPendingExteriorKind("fence");
    const { container } = render(<PlanCanvas />);
    const svg = container.querySelector("svg")!;

    // PX_PER_METER-based pixel math is already established by the existing
    // "places additive box/frame..." test in this file, which taps at
    // clientX:180/220 on a fitted 10x10m site. Tap very close to the right
    // edge of the same 10x10 site (fence default length 3m would overflow
    // past site.widthM=10 unless clamped).
    fireEvent.pointerDown(svg, { pointerId: 1, clientX: 900, clientY: 100 });
    fireEvent.pointerUp(svg, { pointerId: 1, clientX: 900, clientY: 100 });

    const fence = useEditorStore
      .getState()
      .layout?.exteriorElements?.find((element) => element.kind === "fence");
    expect(fence).toBeTruthy();
    const segment = fence as { end: { x: number } };
    expect(segment.end.x).toBeLessThanOrEqual(10 + 1e-9);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Baruma && npx vitest run src/components/editor/plan-canvas.test.tsx -t "single tap"`
Expected: FAIL — the first new test fails because the placed fence has `start === end` (length 0, not ~3). The clamp test may pass by accident (0 ≤ 10) even before the fix — that's fine, it's asserting a property that must remain true after the fix too; it is not required to be red before Step 3 as long as the primary length assertions above it are red.

- [ ] **Step 3: Write minimal implementation**

In `src/components/editor/plan-canvas.tsx`:

1. Add `segmentDefaultLengthM` to the existing `@/lib/exterior/factories` import (currently at lines 53-61):

```tsx
import {
  makeAssetElement,
  makeBoxElement,
  makeFrameElement,
  makeRoofZone,
  makeSegmentElement,
  makeStairElement,
  makeSurfaceElement,
  segmentDefaultLengthM,
} from "@/lib/exterior/factories";
```

2. Replace the `isSegmentKind(k)` branch inside `onBackgroundDown` (currently lines 1678-1693):

```tsx
      if (isSegmentKind(k)) {
        const el = makeSegmentElement(
          k,
          { x: round2(wx), y: round2(wy) },
          { x: round2(wx), y: round2(wy) },
        );
        addExteriorElement(el);
        selectObject(el.id);
        beginDrag();
        drag.current = {
          kind: "exteriorSegment",
          id: el.id,
          start: { x: wx, y: wy },
          end: { x: wx, y: wy },
        };
        capture(e.pointerId);
      } else if (isBoxKind(k)) {
```

with:

```tsx
      if (isSegmentKind(k)) {
        const length = segmentDefaultLengthM(k);
        const endX = Math.min(round2(wx) + length, site.widthM);
        const el = makeSegmentElement(
          k,
          { x: round2(wx), y: round2(wy) },
          { x: round2(endX), y: round2(wy) },
        );
        addExteriorElement(el);
        selectObject(el.id);
        beginDrag();
        drag.current = {
          kind: "exteriorSegment",
          id: el.id,
          start: { x: wx, y: wy },
          end: { x: endX, y: wy },
        };
        capture(e.pointerId);
      } else if (isBoxKind(k)) {
```

(`site` is already in scope in this function — it's the same `site` used elsewhere in `onBackgroundDown`, e.g. the `roofZone` branch's `Math.min(6, site.widthM)`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Baruma && npx vitest run src/components/editor/plan-canvas.test.tsx`
Expected: PASS — all tests in this file, including the 3 new ones and all pre-existing ones (regression check: the drag-based exterior tests and the pre-existing `"places additive box/frame..."` test must still pass unmodified).

- [ ] **Step 5: Commit**

```bash
git add src/components/editor/plan-canvas.tsx src/components/editor/plan-canvas.test.tsx
git commit -m "fix(editor): give tap-placed exterior segments a non-zero default length"
```

---

### Task 3: "Panjang (m)" field in `SegmentFields`

**Files:**
- Modify: `src/components/editor/editor-inspector.tsx`
- Test: `src/components/editor/editor-inspector.test.tsx`

**Interfaces:**
- Consumes: `round2`, `segmentLength` (both from `@/lib/exterior/geometry`, not yet imported in this file).
- Produces: no new exports — internal UI change to `SegmentFields` only.

- [ ] **Step 1: Write the failing tests**

In `src/components/editor/editor-inspector.test.tsx`, add near the top (after the existing `rooftopLayout()` helper, which ends at line 37, before `afterEach(() => { cleanup() })` at line 39) a second fixture:

```ts
import { makeSegmentElement } from "@/lib/exterior/factories"

/** Same 8x8 rooftop layout, plus one boundary_wall segment for exterior-inspector tests. */
function segmentLayout(): DesignLayout {
  return {
    ...rooftopLayout(),
    exteriorElements: [
      makeSegmentElement(
        "boundary_wall",
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { id: "ext-seg-1" },
      ),
    ],
  }
}
```

(Add `makeSegmentElement` to a new import line near the existing `import { makeRoofZone } from "@/lib/exterior/factories"` at line 6 — combine into one import: `import { makeRoofZone, makeSegmentElement } from "@/lib/exterior/factories"`.)

Then add this new `describe` block at the end of the file (after the last existing `describe` block closes):

```tsx
describe("EditorInspector — exterior segment fields", () => {
  beforeEach(() => {
    useEditorStore.getState().loadLayout(segmentLayout(), { widthM: 10, depthM: 10 }, [])
    useEditorStore.getState().selectObject("ext-seg-1")
  })

  it("shows a Panjang (m) field pre-filled with the segment's current length", () => {
    render(<EditorInspector />)
    const input = screen.getByLabelText("Panjang (m)") as HTMLInputElement
    expect(input.value).toBe("3.00")
  })

  it("committing a new length extends the segment along its existing direction, keeping start fixed", () => {
    render(<EditorInspector />)
    const input = screen.getByLabelText("Panjang (m)")
    fireEvent.change(input, { target: { value: "5" } })
    fireEvent.blur(input)

    const segment = useEditorStore
      .getState()
      .layout!.exteriorElements!.find((el) => el.id === "ext-seg-1") as {
      start: { x: number; y: number }
      end: { x: number; y: number }
    }
    expect(segment.start).toEqual({ x: 0, y: 0 })
    expect(segment.end).toEqual({ x: 5, y: 0 })
  })

  it("ignores an invalid (zero) length and leaves the segment unchanged", () => {
    render(<EditorInspector />)
    const input = screen.getByLabelText("Panjang (m)")
    fireEvent.change(input, { target: { value: "0" } })
    fireEvent.blur(input)

    const segment = useEditorStore
      .getState()
      .layout!.exteriorElements!.find((el) => el.id === "ext-seg-1") as {
      start: { x: number; y: number }
      end: { x: number; y: number }
    }
    expect(segment.start).toEqual({ x: 0, y: 0 })
    expect(segment.end).toEqual({ x: 3, y: 0 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Baruma && npx vitest run src/components/editor/editor-inspector.test.tsx -t "exterior segment fields"`
Expected: FAIL — `screen.getByLabelText("Panjang (m)")` throws (no such label exists yet in `SegmentFields`).

- [ ] **Step 3: Write minimal implementation**

In `src/components/editor/editor-inspector.tsx`:

1. Add to the top-level imports (there is no existing import from `@/lib/exterior/geometry` in this file — add a new import line near the other `@/lib/exterior/*` imports at lines 87-89):

```ts
import { round2, segmentLength } from "@/lib/exterior/geometry";
```

2. Replace the `SegmentFields` function (currently lines 2243-2271):

```tsx
function SegmentFields({ element }: { element: ExteriorSegmentElement }) {
  const updateExteriorElement = useEditorStore((s) => s.updateExteriorElement);
  const [thickness, setThickness] = React.useState(
    String(element.thicknessM ?? 1),
  );

  const commitThickness = () => {
    const v = Number(thickness);
    if (Number.isFinite(v) && v > 0 && v !== (element.thicknessM ?? 1)) {
      updateExteriorElement(element.id, { thicknessM: v });
    }
  };

  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Tebal (m)">
        <Input
          type="number"
          step={0.05}
          min={0.05}
          value={thickness}
          disabled={element.locked}
          onChange={(e) => setThickness(e.target.value)}
          onBlur={commitThickness}
        />
      </Field>
    </div>
  );
}
```

with:

```tsx
function SegmentFields({ element }: { element: ExteriorSegmentElement }) {
  const updateExteriorElement = useEditorStore((s) => s.updateExteriorElement);
  const [thickness, setThickness] = React.useState(
    String(element.thicknessM ?? 1),
  );
  const currentLength = segmentLength(element.start, element.end);
  const [length, setLength] = React.useState(currentLength.toFixed(2));

  const commitThickness = () => {
    const v = Number(thickness);
    if (Number.isFinite(v) && v > 0 && v !== (element.thicknessM ?? 1)) {
      updateExteriorElement(element.id, { thicknessM: v });
    }
  };

  const commitLength = () => {
    const v = Number(length);
    if (!Number.isFinite(v) || v <= 0 || Math.abs(v - currentLength) < 0.001) {
      setLength(currentLength.toFixed(2));
      return;
    }
    const dx = element.end.x - element.start.x;
    const dy = element.end.y - element.start.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    updateExteriorElement(element.id, {
      end: {
        x: round2(element.start.x + ux * v),
        y: round2(element.start.y + uy * v),
      },
    });
  };

  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Panjang (m)">
        <Input
          type="number"
          step={0.1}
          min={0.1}
          value={length}
          disabled={element.locked}
          onChange={(e) => setLength(e.target.value)}
          onBlur={commitLength}
        />
      </Field>
      <Field label="Tebal (m)">
        <Input
          type="number"
          step={0.05}
          min={0.05}
          value={thickness}
          disabled={element.locked}
          onChange={(e) => setThickness(e.target.value)}
          onBlur={commitThickness}
        />
      </Field>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Baruma && npx vitest run src/components/editor/editor-inspector.test.tsx`
Expected: PASS — all tests in this file, including the 3 new ones and every pre-existing test (rooftop deck controls, etc.).

- [ ] **Step 5: Commit**

```bash
git add src/components/editor/editor-inspector.tsx src/components/editor/editor-inspector.test.tsx
git commit -m "feat(editor): add Panjang (m) input for exterior segment elements"
```

---

### Task 4: Full verification

**Files:** none (verification only).

**Interfaces:** Consumes Tasks 1-3.

- [ ] **Step 1: Run the full test suite**

Run: `cd Baruma && npx vitest run`
Expected: PASS — all test files pass, 0 failures (this confirms no regression anywhere else in the codebase from the three edits above).

- [ ] **Step 2: Type-check**

Run: `cd Baruma && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Manual smoke check (optional but recommended given this is a touch-interaction bug)**

Run: `cd Baruma && npm run dev`, open the 2D floorplan editor for any project with a layout, select the "Tambah elemen eksterior" tool → "Pagar", and single-click (no drag) on the canvas. Confirm a 3m fence line appears immediately and is selected. Open the Properti panel and confirm "Panjang (m)" shows `3.00`; change it to `5` and blur, confirm the line visibly extends.

- [ ] **Step 4: Commit is already done per-task — no additional commit here.** If all of Step 1-2 pass (and Step 3 if performed), this plan is complete.

---

## Self-Review

**Spec coverage:**
- Root cause fix (non-degenerate default length on tap) → Task 2.
- Per-kind default lengths (1.2m gate / 3m others) → Task 1.
- Clamp to site boundary → Task 2 (`Math.min(..., site.widthM)` + dedicated clamp test).
- Drag-to-adjust untouched → Task 2 only replaces the initial `end`/`drag.current` values; the drag/move logic elsewhere in `plan-canvas.tsx` (`processMove`'s `exteriorSegment` handling) is not touched by this plan, and existing drag tests re-run unmodified in Task 2 Step 4 as a regression check.
- "Panjang (m)" input in inspector → Task 3.
- Out-of-scope items (validation.ts, exterior-canvas.tsx rendering, facade-templates.ts, non-segment placement) → no task touches them, consistent with the spec.

**Placeholder scan:** No TBD/TODO. Every step has complete, exact code (full before/after blocks for edited functions, full new test file contents, full new describe blocks). No task says "similar to Task N" without repeating the code.

**Type consistency:** `segmentDefaultLengthM(kind: ExteriorSegmentKind): number` — defined in Task 1, imported and called identically in Task 2 (`segmentDefaultLengthM(k)` where `k: ExteriorSegmentKind` per the existing `isSegmentKind` type guard already in `plan-canvas.tsx`). `round2`/`segmentLength` imported in Task 3 from `@/lib/exterior/geometry` — verified during spec-writing that this is the correct, currently-unused-in-this-file import path (this file already imports an unrelated `round2` re-export path for other geometry helpers — `@/lib/exterior/geometry`'s `round2`/`segmentLength` were confirmed NOT already imported here, so the new import line in Task 3 Step 3 does not collide). `ExteriorSegmentElement`, `ExteriorElement` types were already imported in `editor-inspector.tsx` before this plan (visible in the existing top-of-file type import block) — no new type import needed there beyond the two functions.
