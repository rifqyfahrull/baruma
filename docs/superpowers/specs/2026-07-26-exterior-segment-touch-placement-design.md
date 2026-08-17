# Exterior Segment Touch Placement Fix — Design

## Problem

On the 2D floorplan editor's touchscreen tab, users struggle to add a fence
(and other segment-shaped exterior elements: `boundary_wall`, `sliding_gate`,
`swing_gate`, `pedestrian_gate`), and the fence does not render in the 2D
editor after placement. The same elements placed from the 3D editor's facade
template feature work fine.

## Root Cause

`onBackgroundDown` in `src/components/editor/plan-canvas.tsx:1678-1693`
handles placement for the "exterior" tool. For segment-kind elements it does:

```ts
const el = makeSegmentElement(
  k,
  { x: round2(wx), y: round2(wy) },
  { x: round2(wx), y: round2(wy) }, // end === start
);
addExteriorElement(el);
...
drag.current = { kind: "exteriorSegment", ... }; // waits for a drag to set the real end point
```

A single tap creates a segment with `start === end` (zero length), which is
saved to the layout immediately. In `exterior-canvas.tsx:195-210` this renders
as an SVG `<line>` — and a zero-length `<line>` does not render in any
mainstream browser (long-standing SVG behavior). So the element exists in
state but is invisible until the user completes a drag gesture that moves the
endpoint away from the start point.

Every other exterior element kind (`BOX_KINDS`, `portal_frame`,
`exterior_stair`, `SURFACE_KINDS`, `ASSET_KINDS`) gets a non-degenerate
default size from its factory function on a single tap
(`makeBoxElement`/`boxDefaults()`, `makeFrameElement`, `makeStairElement`,
etc.) — segments are the only kind requiring an additional drag to become
visible at all.

On a touchscreen, a tap that doesn't drift into a drag is the common case
(more so than with a mouse, where a slight cursor move during click is
typical), so this scenario is hit far more often on tablets — matching the
report exactly. The 3D editor's facade-template feature
(`facade-templates.ts`, `segment()` helper) always supplies an explicit
non-zero `start`/`end` pair, so it never exhibits this problem — matching
"3D editor works fine."

This is not a "fence can't be created" bug; it's "segment elements have no
default length on tap," unlike every sibling exterior-element kind.

## Fix

**Approach: default length on tap** — align segment placement with the
existing pattern already used for every other exterior element kind
(box/frame/stair/surface/asset defaults, and `OPENING_KIND_META.defaultWidthM`
for openings). A single tap creates a segment with a sensible default length
extending east from the tap point, immediately visible and editable. The
existing endpoint-drag handles remain available for repositioning/resizing
afterward — no change to that interaction.

### 1. `src/lib/exterior/factories.ts`

Add a small lookup, following the same shape as the existing `boxDefaults()`:

```ts
function segmentDefaultLengthM(kind: ExteriorSegmentKind): number {
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

Export it (`export function segmentDefaultLengthM(...)`) so
`plan-canvas.tsx` can reuse it. `makeSegmentElement` itself is unchanged —
callers still pass explicit `start`/`end`; this only changes what
`plan-canvas.tsx` passes in for the single-tap case.

### 2. `src/components/editor/plan-canvas.tsx`

In `onBackgroundDown`'s `isSegmentKind(k)` branch, replace the degenerate
`end` with a point `segmentDefaultLengthM(k)` metres east of the tap point,
clamped to the site's east edge (same clamp pattern used elsewhere in this
file, e.g. asset envelope placement):

```ts
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
}
```

The existing `exteriorSegment` drag-to-adjust behavior is untouched — a user
who taps-and-drags in one continuous gesture still ends the segment exactly
where they release, because `onUp`/`processMove` already overwrite `end` via
`dragExteriorTo` during the drag. This change only affects what happens when
no drag occurs (tap-only), and the initial `end` used before any drag input
arrives.

### 3. `src/components/editor/editor-inspector.tsx` — `SegmentFields`

Add a "Panjang (m)" field alongside the existing "Tebal (m)" field (same grid,
same `Field`/`Input`/`onBlur`-commit pattern as `commitThickness`). Committing
a new length recomputes `end` by keeping `start` fixed and the segment's
current direction (angle) unchanged, only extending/shrinking along that
direction — mirroring how `commitHeight`/`commitThickness` work for their
respective single-value fields:

```ts
const currentLength = segmentLength(element.start, element.end);
const [length, setLength] = React.useState(String(currentLength.toFixed(2)));

const commitLength = () => {
  const v = Number(length);
  if (!Number.isFinite(v) || v <= 0 || Math.abs(v - currentLength) < 0.001) return;
  const dx = element.end.x - element.start.x;
  const dy = element.end.y - element.start.y;
  const len = Math.hypot(dx, dy) || 1; // guard divide-by-zero for any pre-existing degenerate data
  const ux = dx / len;
  const uy = dy / len;
  updateExteriorElement(element.id, {
    end: {
      x: round2(element.start.x + ux * v),
      y: round2(element.start.y + uy * v),
    },
  });
};
```

`segmentLength` and `round2` are NOT currently imported in
`editor-inspector.tsx` (verified: neither name appears in this file's import
list). Add:

```ts
import { round2, segmentLength } from "@/lib/exterior/geometry";
```

Note there are two `round2` implementations in the codebase
(`@/lib/exterior/geometry.ts` and `@/lib/geometry/index.ts`, the latter
already imported in this file for `snapLevelOffset`/`levelStepWarning`). Use
the `@/lib/exterior/geometry` one for this field, since `segmentLength` (also
needed here) only exists there and both functions round to the same
precision — keeps the segment-length logic self-contained to one import
source.

Box/Surface/Stair/Portal field groups are untouched.

## Testing

- **`plan-canvas.test.tsx`**: single `pointerDown`+`pointerUp` at the same
  coordinates (no movement, simulating a tap) with `pendingExteriorKind` set
  to `"fence"`, `"boundary_wall"`, and one gate kind — assert the resulting
  element has `segmentLength(start, end) > 0` matching the expected default,
  and that placing near the site's east edge clamps `end.x` to `site.widthM`
  rather than overflowing.
- **`editor-inspector.test.tsx`** (or wherever `SegmentFields`/
  `ExteriorInspector` is already tested): committing a new "Panjang (m)" value
  updates `end` while preserving `start` and the original direction; entering
  an invalid value (0, negative, non-numeric) leaves the element unchanged.
- **Regression**: existing drag-based segment placement/resize tests
  (`plan-canvas.test.tsx`, `exterior-canvas.test.tsx`) must continue passing
  unmodified — this fix only changes the tap-only (no-drag) starting state.

## Out of scope

- No changes to `exterior-canvas.tsx` rendering, `validation.ts`
  (`MIN_SEGMENT_LENGTH_M` stays at 0.2 m — the new defaults are well above
  it), or the 3D/`facade-templates.ts` path (already correct).
- No change to non-segment exterior element placement (already correct).
- No two-tap or draw-mode interaction redesign — out of scope per the chosen
  approach.
