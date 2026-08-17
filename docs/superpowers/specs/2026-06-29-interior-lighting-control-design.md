# Interior: Manual Lighting Control + Real Per-Room 3D Lights + AI Parity

**Date:** 2026-06-29
**Status:** Design (awaiting review)
**Covers:** capability-audit item #2 (lighting control). Makes per-room lighting fixtures user-editable (CRUD like furniture), renders them as **real lights** in a new per-room R3F scene, and gives the AI "Asisten Interior" full parity over lighting.

## Context / Problem

Lighting today is **generated-only and read-only**:
- `LightingFixture` ([types/index.ts](../../../src/types/index.ts)) already has `{id, roomId, type(downlight|pendant|wall_lamp|indirect|task|outdoor), x, y, heightM, colorTemperature(warm|neutral|cool), qty, priceRange}` and lives in `RoomInteriorPlan.lighting[]`.
- It is produced by `suggestLighting` ([interior/plan.ts](../../../src/lib/interior/plan.ts)) and only regenerated on **style change**. `useInteriorStore` ([interior-store.ts](../../../src/stores/interior-store.ts)) has full furniture CRUD (`addFurniture`/`moveFurniture`/`rotateFurniture`/`removeFurniture`) + undo, but **no lighting actions**.
- The interior workspace ([interior-workspace.tsx](../../../src/components/interior/interior-workspace.tsx)) shows lighting only as a read-only InfoCard ("N titik lampu disarankan"). Its `InteriorRoomPreview` is a **CSS pseudo-3D mock** (skewed divs), not WebGL.
- The interior AI assistant exposes `addFurniture/moveFurniture/rotateFurniture/removeFurniture/setStyle/resetRoom` ([actions.ts](../../../src/lib/assistant/actions.ts) `interiorActionSchema`) — **no lighting**.

**Goal:** users (and the AI) can place, move, edit, and remove light fixtures per room, and **see them as real 3D lights** in a per-room scene.

**Confirmed decisions:** full CRUD mirroring furniture · **real 3D lights** in a **new per-room R3F scene** (replacing the CSS mock) · 2D canvas markers + inspector · AI "Asisten Interior" masters lighting · keep the existing fixture model (6 types + warm/neutral/cool; **no** new brightness/lumens field).

## Non-goals (v1)

- Photometric accuracy / IES profiles / lumen math.
- Lighting in the main whole-house 3D preview (the new lights live in the per-room interior scene only).
- Dimming schedules / scenes / switching circuits.
- New DB migration (interiors persist as a JSONB payload — `LightingFixture` is unchanged).

## Stage 1 — Store: lighting CRUD ([interior-store.ts](../../../src/stores/interior-store.ts))

Mirror the furniture actions, reusing the existing `updateRoomPlan(set, get, roomId, (room, plan, state) => …)` helper (it clones, pushes one undo entry, and recomputes warnings + budget via `buildRoomBudget(room, furniture, materials, lighting)`).

A pure builder `makeLight(type, room, style): LightingFixture` (new, in [interior/plan.ts](../../../src/lib/interior/plan.ts) or a small `interior/lighting.ts`): id `light-${nanoid(8)}`, `roomId = room.id`, default `x/y` = room center, `heightM` by type (ceiling types ≈ room ceiling/2.6; wall_lamp ≈ 1.8; task ≈ 0.75), `colorTemperature` from the style's default (else `"warm"`), `qty` 1, `priceRange` by type via a `lightingPriceRange(type)` helper factored from the existing `suggestLighting` price logic.

Actions added to `InteriorState`:
- `addLight(roomId, type): void` — append `makeLight(...)`; select it.
- `moveLight(roomId, lightId, x, y): void` — clamp x/y to `[0, room.width]`/`[0, room.depth]`.
- `updateLight(roomId, lightId, patch: Partial<Pick<LightingFixture, "type"|"colorTemperature"|"qty"|"heightM">>): void`.
- `removeLight(roomId, lightId): void`.
- `selectedLightId: string | null` + `selectLight(id|null)`. Selecting a light clears `selectedFurnitureId` and vice-versa (single selection).

All go through `updateRoomPlan` (undo + budget recompute), except the pure-selection setters.

## Stage 2 — `fixtureToLight` mapping + real per-room R3F scene

**Pure helper** `fixtureToLight(fixture, room)` (in `interior/lighting.ts`) → a plain descriptor (no three.js import):
```ts
type LightDesc = {
  kind: "spot" | "point"
  color: string          // by colorTemperature: warm #ffd9a8, neutral #fff2e0, cool #cfe0ff
  intensity: number      // base-by-type × qty, clamped
  position: [number, number, number]   // room-local (x, heightM, y) → centered scene coords
  target?: [number, number, number]    // for spot (downlights aim at floor below)
  castShadow: boolean    // only the highest-intensity 1-2 fixtures, decided by the scene
}
```
Mapping: downlight/task → `spot` aimed straight down; pendant/indirect → `point`; wall_lamp → `point` offset toward the nearest wall; outdoor → `spot`. Tested purely (color, kind, position centering, intensity×qty).

**New component** `InteriorRoomScene` ([components/interior/interior-room-scene.tsx](../../../src/components/interior/interior-room-scene.tsx)) — a real R3F `<Canvas shadows>` (reuse `@react-three/fiber` + `@react-three/drei` already used by [preview-3d/house-model.tsx](../../../src/components/preview-3d/house-model.tsx)):
- Room shell: floor plane (room.width × room.depth) + 4 walls at ceiling height, materials from the style palette.
- Furniture: simple boxes at each `furniture.x/y`, sized `widthM × depthM`, colored via the existing `furnitureColor`; clicking selects (`selectFurniture`).
- Lights: a low `ambientLight` + one shadow-casting key `directionalLight` for legibility; then one light per fixture built from `fixtureToLight` (color/intensity/position), with `castShadow` only where the helper flags it. A small emissive marker mesh at each fixture position; click → `selectLight`.
- `OrbitControls` (drei), `PerspectiveCamera` angled like the house preview.
- Selected fixture/furniture gets a highlight (emissive/ring).

`InteriorRoomPreview` is replaced by `InteriorRoomScene` in the workspace; the side panel keeps the FurnitureQuickAdd + InfoCards (the "Lighting" InfoCard count stays, now reflecting live edits).

## Stage 3 — 2D canvas markers + lighting inspector ([interior-workspace.tsx](../../../src/components/interior/interior-workspace.tsx))

- **`InteriorCanvas`**: after the furniture pass, render `plan.lighting` as markers — a small circle/icon per fixture at its x/y (icon hints the type; fill/ring tinted by colorTemperature), draggable (`moveLight`, same pointer pattern as furniture), click → `selectLight`. Show `qty` as a badge when > 1.
- A **"Tambah lampu"** control (near FurnitureQuickAdd) = a type dropdown (6 types, Bahasa labels) → `addLight(room.id, type)` (placed at room center, selected).
- **Lighting inspector** (shown when `selectedLightId` is set, in the inspector column): Tipe (Select, 6), Color temperature (warm/neutral/cool segmented), Jumlah (number ≥ 1), Tinggi (m, number) → `updateLight`; a Hapus button → `removeLight`. Mirrors the furniture inspector's placement.

## Stage 4 — AI parity ([actions.ts](../../../src/lib/assistant/actions.ts), interior sanitizer/prompt, [apply.ts](../../../src/lib/assistant/apply.ts))

Add to `interiorActionSchema`:
- `{ type: "addLight", roomId, lightType: enum(6) }`
- `{ type: "moveLight", roomId, lightId, x, y }`
- `{ type: "updateLight", roomId, lightId, patch: { lightType?, colorTemperature?(warm|neutral|cool), qty?, heightM? } }`
- `{ type: "removeLight", roomId, lightId }`

(`lightType`/`colorTemperature` named to avoid colliding with the room `type`/`patch` schemas.)

Updates:
- **Interior sanitizer** (the function that validates interior actions against the interior scene — same place that already validates `roomId`/`furnitureId`): validate `roomId` exists, `lightId` exists in that room's lighting (for move/update/remove), enums valid, clamp `x/y` to room, `qty ≥ 1`, `heightM` finite > 0.
- **`describeAction`**: labels — "Tambah lampu <tipe>", "Pindahkan lampu", "Ubah lampu", "Hapus lampu".
- **`applyInteriorActions`** ([apply.ts](../../../src/lib/assistant/apply.ts)): dispatch the 4 actions to the store (`addLight`/`moveLight`/`updateLight`/`removeLight`); map `lightType`→`type` for the store patch.
- **Interior prompt**: document that the assistant can add/move/edit/remove lighting fixtures per room.

## Testing

- Store: `addLight` (default by type, selects, undo restores), `moveLight` (clamp), `updateLight` (patch type/temp/qty/height + budget recompute), `removeLight`; single-selection swap with furniture.
- `fixtureToLight`: kind/color/intensity(×qty)/position for each of the 6 types.
- `sanitizeInterior`: lighting actions — membership validation (bad roomId/lightId dropped), enum + clamp.
- `describeAction`: labels for the 4 new actions.
- Existing interior tests stay green.

## Rollout

No DB migration. Verify `rtk tsc` · `npx vitest run` · `npx next build`. Manual: open the interior workspace for a room → "Tambah lampu" → pendant appears (2D marker + a real warm light in the 3D scene); drag it, change color temp to cool (3D tint shifts), bump qty (brighter); remove it; then via "Asisten Interior": "tambah downlight di kamar tidur", "ubah lampu jadi cool", "hapus lampu" — each previews + applies.

## Sequencing (one spec, 4 shippable stages, in order 1→4)

Store CRUD → mapping helper + real R3F scene → 2D markers + inspector → AI parity. Stage 1 underpins 3 & 4; Stage 2's scene is independently testable via the pure `fixtureToLight`.
