# Spatial Design — Open-plan Zones + Split-level Elevation

**Date:** 2026-06-29
**Status:** Design (awaiting review)
**Covers:** capability-audit items #3 (open-space / fewer interior walls) and #4 (split-level), planned as one cohesive feature (shared code surface), shippable in stages.

## Context / Problem

The editor models every room as a walled rectangle on a single per-floor elevation:
- **3D** ([build-model.ts](../../../src/lib/three/build-model.ts)) draws 4 walls per room unless its `type` is in `OPEN_TYPES`; every room on a floor shares one slab elevation (`baseY`).
- **2D** ([plan-canvas.tsx](../../../src/components/editor/plan-canvas.tsx)) draws each room as a stroked rect (the implicit "wall").

So a customer **cannot** express an **open-plan** area (living+dining+kitchen with no walls between, exterior walls kept) nor a **split-level** (one area lower/higher than another — the ±0.00 / −0.05 / −0.20 of a real working drawing). This feature adds both.

**Confirmed decisions:** open-plan via **zones** (rooms sharing a zone drop walls between them) · split-level via **free per-room elevation, snapped to ergonomic riser steps with an out-of-range warning** · **±0.00 elevation label shown on every room** · **colored zone tint** in 2D · **full per-edge risers** in 3D (not a plinth).

## Non-goals (v1)

- Auto-generating stairs between levels (only a visual riser + warning).
- Light dividers / "satir" partitions (separate future item).
- Lighting control (audit item #2, separate).
- Merging same-zone rooms into a single room entity (they stay separate rooms; only walls/visuals change).

## Data model — `Room` (in [types/index.ts](../../../src/types/index.ts)), both optional → backward-compatible

```ts
zoneId?: string        // rooms sharing a zoneId form one open-plan area
levelOffsetM?: number  // elevation offset vs the room's floor slab (default 0); + up, - down
```

**No DB migration:** `DesignLayout` is persisted as a JSONB payload (like interiors); optional new `Room` fields need no schema change. Older layouts simply lack them (treated as `undefined`/0).

## Geometry helpers (in [src/lib/geometry](../../../src/lib/geometry))

- `roomsAdjacentOnSide(room, side, others): Room | null` — returns the room sharing `room`'s given edge (colinear boundary within tolerance + overlapping span). Used by both wall-skipping and riser computation.
- `RISER_M = 0.18` (typical comfortable riser); `COMFORT_MAX_M = 0.20` (single-step limit).
- `snapLevelOffset(m): number` — round to nearest multiple of `RISER_M` (so 0, ±0.18, ±0.36…). `0` stays `0`.
- `levelStepWarning(m): string | null` — non-null when a single jump exceeds `COMFORT_MAX_M` (needs stairs) — surfaced as a soft warning, never blocks.

## 3D rendering ([build-model.ts](../../../src/lib/three/build-model.ts))

Per floor, group rooms; compute per-room `roomBaseY = slabTopY + (room.levelOffsetM ?? 0)`.

- **Open-plan walls:** for each of a room's 4 sides, skip the wall when `roomsAdjacentOnSide` returns a neighbor with the **same `zoneId`** (both non-null). Exterior edges and edges to different/no-zone rooms keep their wall. Tiles, furniture, labels, openings unchanged by zoning.
- **Split-level placement:** the room's tile / walls (`wallCenterY` from `roomBaseY`) / furniture / label all shift by `levelOffsetM`.
- **Per-edge risers:** for each room edge, the elevation on the other side is the neighbor's `levelOffsetM` (if a neighbor shares that edge) else `0` (the floor slab). When `room.levelOffsetM > otherSide`, emit a new `riser` prim along that edge spanning the height difference (top at this room's tile, bottom at the other side) — so each step is drawn once, by the higher room. Risers are independent of zoning (an open same-zone boundary can still have a step).

New `PrimKind` member `"riser"` (rendered as a box, like walls).

## 2D rendering ([plan-canvas.tsx](../../../src/components/editor/plan-canvas.tsx) / [dimension-layer.tsx](../../../src/components/editor/dimension-layer.tsx))

- **Colored zone tint:** a `ZONE_COLORS` palette; rooms with a `zoneId` get the zone's tint fill (overriding the type fill) so a zone reads as one colored area. A small zone badge/legend is optional.
- **Open boundary line:** the shared edge between two same-zone rooms renders as a **dashed light line** instead of a solid wall stroke.
- **Elevation label on every room:** each room shows its elevation, unit-aware, **including ±0.00** (e.g. `±0,00 m`, `−0,18 m`, `−180 mm`). Added to the room label block (alongside name/area), gated by the same min-size as the area label. New `formatElevation(m, unit)` in [format.ts](../../../src/lib/format.ts) (signed; `±0,00` for zero).

## Editor UI ([editor-inspector.tsx](../../../src/components/editor/editor-inspector.tsx))

Room inspector gains:
- **Zona** control — assign the room to a zone (pick an existing zone present in the layout, create new, or clear). Zones identified by their color swatch.
- **Elevasi** numeric input (in the active unit) → writes `levelOffsetM` via `snapLevelOffset`; shows `levelStepWarning` text when out of comfortable range.

Both write through the existing `updateRoom` store action (it already merges arbitrary `Partial<Room>` patches).

## AI Assistant ([actions.ts](../../../src/lib/assistant/actions.ts) + [editor-assistant.ts](../../../src/lib/server/editor-assistant.ts))

- Extend the floorplan `updateRoom` `patch` schema with `zoneId?: string` and `levelOffsetM?: number`.
- `sanitizeFloorplan`: validate `zoneId` (non-empty string) and `levelOffsetM` (finite; apply `snapLevelOffset`).
- `describeAction`: label zone/elevation changes (e.g. "Gabungkan ke zona open-plan", "Turunkan elevasi → −0,18 m").
- The existing self-correcting loop + preview-then-apply cover it. Prompt: document that multiple rooms can be set to the same `zoneId` to form an open-plan area, and `levelOffsetM` for split-level.

## Validation ([validation.ts](../../../src/lib/validation.ts)) — light

- Soft warning when a room's `levelStepWarning` is non-null (jump beyond comfortable single step → suggest stairs).
- (Optional) info when a `zoneId` is used by non-adjacent rooms (a "zone" that isn't contiguous). Non-blocking.

## Testing

- `roomsAdjacentOnSide` — shared-edge detection (adjacent, non-adjacent, partial overlap).
- `snapLevelOffset` / `levelStepWarning` — snapping + threshold.
- `formatElevation` — signed values incl `±0,00` across units.
- `buildModel` — same-zone interior wall skipped; exterior wall kept; `levelOffsetM` shifts tile/walls; riser emitted once on the higher side; riser also on an open same-zone stepped boundary.
- AI `sanitizeFloorplan` — `zoneId` kept; `levelOffsetM` snapped; bad values dropped.

## Sequencing (one spec, 3 shippable stages)

1. **Data + rendering** — `Room` fields, geometry helpers + tests, `build-model` (walls/risers/offset), `plan-canvas`/dimension-layer (tint, dashed open boundary, ±0.00 label), `formatElevation`. The core visual capability.
2. **Editor inspector** — Zona + Elevasi controls.
3. **AI Assistant** — `zoneId`/`levelOffsetM` in `updateRoom`, sanitizer, prompt, describe.

## Rollout

No DB migration. Mock + HTTP both work (layout is JSONB). Verify with `rtk tsc` · `npx vitest run` · `npx next build`; manual: assign a zone to 2–3 adjacent rooms (walls drop, tint shows, dashed boundary) and set an elevation (3D step + 2D ±0.00 labels), incl. via the AI assistant.
