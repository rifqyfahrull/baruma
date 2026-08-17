# Editor: Alignment Guides / Object-Snap (Smart Guides)

**Date:** 2026-06-29
**Status:** Design (awaiting review)
**Covers:** making it easy to size/position a room to line up exactly with nearby rooms — the pain that grid-snap alone can't solve (neighbor edges are often off-grid, and grid-snap actively fights precise alignment).

## Context / Problem

In the 2D editor, resizing and moving a room snap ONLY to the grid:
- `dragResize(id, handle, mx, my)` and `dragRoomTo(id, x, y)` ([editor-store.ts](../../../src/stores/editor-store.ts)) apply `snap(v, gridSize)` (gridSize 0.5 m) to the pointer, then `applyResize`/set position.
- So a room whose edge sits at, say, x = 3.27 m (off-grid) can never be matched — the dragged edge snaps to 3.0/3.5. Turning grid-snap ON makes precise alignment to a neighbor HARDER, not easier.

Users want: while dragging a handle (or moving a room), the moving edge should **snap to the nearest reference line** of neighboring rooms and show a **guide**, exactly like Figma/design tools.

**Confirmed decisions:** applies to **both resize and move** · snap to **edges + equal-size + center-lines** + site bounds · show **guide lines** (+ an "=" badge for equal-size) · object-snap **overrides grid-snap** within a small, zoom-aware threshold.

## Non-goals (v1)

- Snapping openings (doors/windows), stairs, or pools — rooms only.
- Multi-select alignment / distribute.
- Angular/rotational guides (rooms are axis-aligned rectangles).
- Persisting guides — they are transient, drawn only during a drag.
- No DB migration / data-layer change.

## Reference lines (candidates), on the active floor

For the axis being dragged, candidates are world coordinates:
- **Neighbor edges:** every other room's left (`x`), right (`x+width`), top (`y`), bottom (`y+depth`).
- **Neighbor center-lines:** every other room's center-x (`x+width/2`) and center-y (`y+depth/2`).
- **Site bounds:** `0`, `widthM`, `widthM/2` (x); `0`, `depthM`, `depthM/2` (y).
- **Equal-size (resize only):** the moving-edge position that makes the dragged room's width/depth exactly equal a neighbor's — e.g. dragging the right edge, candidate `x + neighbor.width` (⇒ equal width). Tagged so the UI can show an "=" badge.

The nearest candidate within the threshold wins; ties → smallest delta.

## Threshold & priority

- **Zoom-aware:** the plan-canvas computes `tol = SNAP_PX / pxPerMeter` (e.g. `SNAP_PX = 8`) so the snap "feel" is constant on screen at any zoom, and passes `tol` into the drag actions.
- **Priority:** if a candidate is within `tol`, snap to it (object-snap wins, even off-grid). Otherwise, if `snapEnabled`, apply grid-snap; else raw. `tol` is kept below half a grid cell so the two don't fight.

## Architecture (small, testable units)

**Pure geometry — `src/lib/geometry/alignment.ts`:**
- `snapAxis(value, candidates, tol): { value, guide }` — nearest candidate within `tol` (returns it + the guide coord), else `{ value, guide: null }`.
- Candidate collectors that gather the reference coordinates above for a given rect + others + site, for resize (per moving edge, incl. equal-size) and for move (edges + centers, no equal-size). Each candidate carries its coord and a `kind` (`edge` | `center` | `site` | `equal`) for guide styling / the "=" badge.
- A move resolver that, per axis, considers the room's left/right/center against candidates and returns the best single offset + guide.

**Store — `editor-store`:**
- `dragResize`/`dragRoomTo` gain a `tol` argument; internally: object-snap first (via the helpers), else grid-snap (existing), then `applyResize`/set position. Locked rooms unaffected.
- New transient state `alignmentGuides: { x: number[]; y: number[]; equalX: number[]; equalY: number[] }` set during a drag when snaps occur; cleared in `beginDrag` and `endDrag`.

**View — `plan-canvas`:**
- Compute `tol = SNAP_PX / pxPerMeter`; pass to `dragResize`/`dragRoomTo`.
- Render `alignmentGuides`: a thin highlighted line spanning the viewport at each guide x/y; equal-size guides get an "=" badge near the matched edge. Cleared when the drag ends (state empties).

## Testing

- `snapAxis`: snaps within `tol` to the nearest candidate; no snap outside `tol`; picks nearest on ties.
- Candidate collectors: include neighbor edges + center-lines + site bounds; resize adds the correct equal-size position for each moving edge; move excludes equal-size.
- Move resolver: aligns the room's nearest reference (left/right/center) to a candidate, returns the offset + guide.
- Override behavior: within `tol`, object-snap beats grid-snap; outside, grid-snap still applies (a small store-level test on `dragResize`/`dragRoomTo`).
- Manual: resize carport's edge near ruang-tamu → edge snaps + guide + "=" badge when widths match; move a room so its center aligns to another → center guide; grid-snap no longer blocks off-grid alignment.

## Rollout

No DB migration. Verify `rtk tsc` · `npx vitest run` · `npx next build`; manual smoke above.

## Sequencing (one spec, 3 shippable stages, in order 1→3)

1. **Geometry** — `alignment.ts` (`snapAxis`, candidate collectors, move resolver) + tests. Pure, no UI.
2. **Store** — `dragResize`/`dragRoomTo` object-snap + `tol` + `alignmentGuides` state + clearing; tests for the override behavior.
3. **Canvas** — pass `tol`, render guide lines + "=" badge.
