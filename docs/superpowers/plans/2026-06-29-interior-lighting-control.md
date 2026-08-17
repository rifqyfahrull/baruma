# Interior Lighting Control + Real 3D Lights + AI Parity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make per-room lighting fixtures user-editable (add/move/edit/remove like furniture), render them as real lights in a new per-room R3F scene, and give the interior AI assistant full parity over lighting.

**Architecture:** Pure builders (`makeLight`/`lightPriceFor`/`fixtureToLight`) in a focused `interior/lighting.ts`; room-plan helpers (`addLightToRoom`…) in `interior/plan.ts` next to the furniture ones (so budget recomputes identically); undo-aware `interior-store` actions mirroring furniture; a real R3F `InteriorRoomScene` replacing the CSS-mock preview; 2D canvas markers + a lighting inspector; and 4 new interior AI actions across schema/sanitize/describe/apply/prompt.

**Tech Stack:** Next.js 16 · zustand · zod · `@react-three/fiber` + `@react-three/drei` (already used by `preview-3d/house-model.tsx`) · vitest.

## Global Constraints

- Spec: [docs/superpowers/specs/2026-06-29-interior-lighting-control-design.md](../specs/2026-06-29-interior-lighting-control-design.md).
- No DB migration (interiors persist as JSONB; `LightingFixture` unchanged). No new npm deps. `nanoid` already present.
- Keep the existing fixture model: 6 types (`downlight|pendant|wall_lamp|indirect|task|outdoor`), `colorTemperature` ∈ `warm|neutral|cool`. **No** brightness/lumens field.
- Lighting CRUD goes through `updateRoomPlan` (one undo entry, recomputes budget+warnings). The budget line treats `fixture.priceRange` as the **line total** for its `qty` (matching `buildRoomBudget`), so `priceRange` must be recomputed as per-unit × qty whenever type/qty changes.
- UI copy Bahasa Indonesia. Verify `rtk tsc` · `npx vitest run` · `npx next build`.
- AI parity: after Task 6, "Asisten Interior" can add/move/edit/remove lighting — no lighting capability without an AI path.

---

## File Structure

- Create `src/lib/interior/lighting.ts` — `LIGHT_COLORS`, `lightPriceFor`, `makeLight`, `fixtureToLight`, `LightDesc` (pure) + test.
- Modify `src/lib/interior/plan.ts` — `addLightToRoom`/`moveLightInRoom`/`updateLightInRoom`/`removeLightFromRoom` + test.
- Modify `src/stores/interior-store.ts` — `addLight`/`moveLight`/`updateLight`/`removeLight` + `selectedLightId`/`selectLight` + test.
- Create `src/components/interior/interior-room-scene.tsx` — real R3F per-room scene (replaces the CSS mock).
- Modify `src/components/interior/interior-workspace.tsx` — use `InteriorRoomScene`; 2D lighting markers; "Tambah lampu" picker; lighting inspector.
- Modify `src/lib/assistant/actions.ts`, the interior sanitizer/prompt, `src/lib/assistant/apply.ts` (+ test) — AI parity.

---

## Task 1: Pure lighting builders (`lighting.ts`)

**Files:**
- Create: `src/lib/interior/lighting.ts`
- Test: `src/lib/interior/lighting.test.ts`

**Interfaces:**
- Consumes: `LightingFixture`, `Room`, `PriceRange` from `@/types`; `nanoid`.
- Produces: `LIGHT_COLORS: Record<colorTemp,string>`; `lightPriceFor(type, qty): PriceRange`; `makeLight(type, room, colorTemperature?): LightingFixture`; `fixtureToLight(f, room): LightDesc`; `type LightDesc`.

- [ ] **Step 1: Write the failing test** — `src/lib/interior/lighting.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { makeLight, lightPriceFor, fixtureToLight, LIGHT_COLORS } from "./lighting"
import type { Room } from "@/types"

const room: Room = { id: "r1", floorId: "f1", name: "Kamar", type: "kamar_tidur", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 }

describe("lightPriceFor", () => {
  it("scales the per-unit price by qty", () => {
    const one = lightPriceFor("downlight", 1)
    const three = lightPriceFor("downlight", 3)
    expect(three.low).toBe(one.low * 3)
    expect(three.high).toBe(one.high * 3)
  })
})

describe("makeLight", () => {
  it("creates a centered fixture with type defaults and qty 1", () => {
    const l = makeLight("pendant", room)
    expect(l.id).toMatch(/^light-/)
    expect(l.roomId).toBe("r1")
    expect(l.type).toBe("pendant")
    expect(l.qty).toBe(1)
    expect(l.x).toBeCloseTo(2, 5)   // room.width/2
    expect(l.y).toBeCloseTo(1.5, 5) // room.depth/2
    expect(l.colorTemperature).toBe("warm")
    expect(l.priceRange).toEqual(lightPriceFor("pendant", 1))
    expect(l.heightM).toBeGreaterThan(0)
  })
  it("honors an explicit color temperature", () => {
    expect(makeLight("downlight", room, "cool").colorTemperature).toBe("cool")
  })
})

describe("fixtureToLight", () => {
  it("maps downlight to a downward spot, colored + intensity scaled by qty", () => {
    const f = makeLight("downlight", room, "warm")
    f.qty = 2
    const d = fixtureToLight(f, room)
    expect(d.kind).toBe("spot")
    expect(d.color).toBe(LIGHT_COLORS.warm)
    expect(d.position[0]).toBeCloseTo(2 - room.width / 2, 5)  // centered scene coords
    expect(d.position[2]).toBeCloseTo(1.5 - room.depth / 2, 5)
    expect(d.target?.[1]).toBe(0)
    const single = fixtureToLight({ ...f, qty: 1 }, room)
    expect(d.intensity).toBeGreaterThan(single.intensity)
  })
  it("maps pendant to a point light", () => {
    expect(fixtureToLight(makeLight("pendant", room), room).kind).toBe("point")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/interior/lighting.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `src/lib/interior/lighting.ts`:

```ts
/** Pure helpers for interior lighting fixtures: pricing, construction, and 3D light mapping. */
import { nanoid } from "nanoid"

import type { LightingFixture, PriceRange, Room } from "@/types"

type LightType = LightingFixture["type"]
type ColorTemp = LightingFixture["colorTemperature"]

export const LIGHT_COLORS: Record<ColorTemp, string> = {
  warm: "#ffd9a8",
  neutral: "#fff2e0",
  cool: "#cfe0ff",
}

const PER_UNIT: Record<LightType, PriceRange> = {
  downlight: { low: 180_000, mid: 350_000, high: 900_000 },
  pendant: { low: 350_000, mid: 900_000, high: 2_800_000 },
  wall_lamp: { low: 150_000, mid: 300_000, high: 700_000 },
  indirect: { low: 250_000, mid: 600_000, high: 1_500_000 },
  task: { low: 120_000, mid: 250_000, high: 600_000 },
  outdoor: { low: 200_000, mid: 450_000, high: 1_200_000 },
}

const HEIGHT_M: Record<LightType, number> = {
  downlight: 2.6, pendant: 2.4, indirect: 2.6, wall_lamp: 1.8, task: 0.75, outdoor: 2.2,
}

const BASE_INTENSITY: Record<LightType, number> = {
  downlight: 6, pendant: 8, indirect: 5, wall_lamp: 4, task: 3, outdoor: 7,
}

export function lightPriceFor(type: LightType, qty: number): PriceRange {
  const u = PER_UNIT[type]
  const n = Math.max(1, Math.round(qty))
  return { low: u.low * n, mid: u.mid * n, high: u.high * n }
}

export function makeLight(type: LightType, room: Room, colorTemperature: ColorTemp = "warm"): LightingFixture {
  return {
    id: `light-${nanoid(8)}`,
    roomId: room.id,
    type,
    x: room.width / 2,
    y: room.depth / 2,
    heightM: HEIGHT_M[type],
    colorTemperature,
    qty: 1,
    priceRange: lightPriceFor(type, 1),
  }
}

export type LightDesc = {
  kind: "spot" | "point"
  color: string
  intensity: number
  position: [number, number, number]
  target?: [number, number, number]
  castShadow: boolean
}

export function fixtureToLight(f: LightingFixture, room: Room): LightDesc {
  const kind: LightDesc["kind"] =
    f.type === "downlight" || f.type === "task" || f.type === "outdoor" ? "spot" : "point"
  // center room at origin (scene coords); three.js Y is up, plan y maps to scene z
  const px = f.x - room.width / 2
  const pz = f.y - room.depth / 2
  const intensity = BASE_INTENSITY[f.type] * Math.max(1, Math.round(f.qty))
  return {
    kind,
    color: LIGHT_COLORS[f.colorTemperature],
    intensity,
    position: [px, f.heightM, pz],
    target: kind === "spot" ? [px, 0, pz] : undefined,
    castShadow: f.type === "downlight" || f.type === "pendant",
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/interior/lighting.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/interior/lighting.ts src/lib/interior/lighting.test.ts
git commit -m "feat(interior): pure lighting builders + 3D light mapping

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Room-plan lighting helpers (`plan.ts`)

**Files:**
- Modify: `src/lib/interior/plan.ts`
- Test: `src/lib/interior/plan.test.ts`

**Interfaces:**
- Consumes: `makeLight`/`lightPriceFor` (Task 1); existing `buildRoomBudget(room, furniture, materials, lighting)`; `clamp` from `@/lib/geometry`.
- Produces: `addLightToRoom(room, plan, type, colorTemp?)`, `moveLightInRoom(room, plan, lightId, x, y)`, `updateLightInRoom(room, plan, lightId, patch)`, `removeLightFromRoom(room, plan, lightId)` — each returns a new `RoomInteriorPlan` with recomputed `budgetEstimate`.

- [ ] **Step 1: Write the failing test** — append to `src/lib/interior/plan.test.ts`:

```ts
import { addLightToRoom, moveLightInRoom, updateLightInRoom, removeLightFromRoom } from "./plan"
// (reuse the file's existing room/plan fixtures; if none exported, build via generateRoomInterior)

describe("room-plan lighting helpers", () => {
  const room = { id: "r1", floorId: "f1", name: "Kamar", type: "kamar_tidur", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 } as const
  const base = generateRoomInterior(room as never, { rooms: [room] } as never, "scandinavian")

  it("addLightToRoom appends a fixture and grows the lighting budget lines", () => {
    const before = base.budgetEstimate.lines.filter((l) => l.category === "lighting").length
    const next = addLightToRoom(room as never, base, "task")
    expect(next.lighting.length).toBe(base.lighting.length + 1)
    const after = next.budgetEstimate.lines.filter((l) => l.category === "lighting").length
    expect(after).toBe(before + 1)
  })

  it("updateLightInRoom recomputes priceRange from type+qty", () => {
    const added = addLightToRoom(room as never, base, "downlight")
    const id = added.lighting.at(-1)!.id
    const next = updateLightInRoom(room as never, added, id, { qty: 3 })
    const f = next.lighting.find((l) => l.id === id)!
    expect(f.qty).toBe(3)
    expect(f.priceRange).toEqual(lightPriceFor("downlight", 3))
  })

  it("moveLightInRoom clamps to the room; removeLightFromRoom drops it", () => {
    const added = addLightToRoom(room as never, base, "pendant")
    const id = added.lighting.at(-1)!.id
    const moved = moveLightInRoom(room as never, added, id, 99, -5)
    const m = moved.lighting.find((l) => l.id === id)!
    expect(m.x).toBeLessThanOrEqual(room.width)
    expect(m.y).toBeGreaterThanOrEqual(0)
    const removed = removeLightFromRoom(room as never, moved, id)
    expect(removed.lighting.some((l) => l.id === id)).toBe(false)
  })
})
```
(Import `lightPriceFor` from `./lighting` in the test.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/interior/plan.test.ts`
Expected: FAIL — helpers not exported.

- [ ] **Step 3: Implement** — add to `src/lib/interior/plan.ts` (near `addFurnitureToRoom`; import `makeLight`, `lightPriceFor` from `./lighting` and `clamp` from `@/lib/geometry` if not already):

```ts
export function addLightToRoom(
  room: Room, plan: RoomInteriorPlan, type: LightingFixture["type"], colorTemp?: LightingFixture["colorTemperature"]
): RoomInteriorPlan {
  const light = makeLight(type, room, colorTemp ?? plan.lighting[0]?.colorTemperature ?? "warm")
  const lighting = [...plan.lighting, light]
  return { ...plan, lighting, budgetEstimate: buildRoomBudget(room, plan.furniture, plan.materials, lighting) }
}

export function moveLightInRoom(room: Room, plan: RoomInteriorPlan, lightId: string, x: number, y: number): RoomInteriorPlan {
  const lighting = plan.lighting.map((l) =>
    l.id === lightId ? { ...l, x: clamp(x, 0, room.width), y: clamp(y, 0, room.depth) } : l
  )
  return { ...plan, lighting, budgetEstimate: buildRoomBudget(room, plan.furniture, plan.materials, lighting) }
}

export function updateLightInRoom(
  room: Room, plan: RoomInteriorPlan, lightId: string,
  patch: Partial<Pick<LightingFixture, "type" | "colorTemperature" | "qty" | "heightM">>
): RoomInteriorPlan {
  const lighting = plan.lighting.map((l) => {
    if (l.id !== lightId) return l
    const type = patch.type ?? l.type
    const qty = patch.qty != null ? Math.max(1, Math.round(patch.qty)) : l.qty
    return {
      ...l, type, qty,
      colorTemperature: patch.colorTemperature ?? l.colorTemperature,
      heightM: patch.heightM != null && patch.heightM > 0 ? patch.heightM : l.heightM,
      priceRange: lightPriceFor(type, qty),
    }
  })
  return { ...plan, lighting, budgetEstimate: buildRoomBudget(room, plan.furniture, plan.materials, lighting) }
}

export function removeLightFromRoom(room: Room, plan: RoomInteriorPlan, lightId: string): RoomInteriorPlan {
  const lighting = plan.lighting.filter((l) => l.id !== lightId)
  return { ...plan, lighting, budgetEstimate: buildRoomBudget(room, plan.furniture, plan.materials, lighting) }
}
```
(Ensure `LightingFixture` is imported in `plan.ts` — it already uses the type in `buildRoomBudget`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/interior/plan.test.ts` then `rtk tsc`
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/interior/plan.ts src/lib/interior/plan.test.ts
git commit -m "feat(interior): room-plan lighting add/move/update/remove helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Store lighting actions + selection

**Files:**
- Modify: `src/stores/interior-store.ts`
- Test: `src/stores/interior-store.test.ts` (create if absent)

**Interfaces:**
- Consumes: `addLightToRoom`/`moveLightInRoom`/`updateLightInRoom`/`removeLightFromRoom` (Task 2); existing `updateRoomPlan`.
- Produces (on `useInteriorStore`): `selectedLightId: string|null`, `selectLight(id)`, `addLight(roomId, type)`, `moveLight(roomId, lightId, x, y)`, `updateLight(roomId, lightId, patch)`, `removeLight(roomId, lightId)`.

- [ ] **Step 1: Write the failing test** — `src/stores/interior-store.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest"
import { useInteriorStore } from "./interior-store"
import type { DesignLayout } from "@/types"

const layout: DesignLayout = {
  id: "l", projectId: "p", versionId: "v",
  floors: [{ id: "f1", level: 1, name: "Lantai 1", heightM: 3 }],
  rooms: [{ id: "r1", floorId: "f1", name: "Kamar", type: "kamar_tidur", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 }],
  walls: [], openings: [], stairs: [], pools: [], validation: { passed: true, issues: [] },
}

beforeEach(() => useInteriorStore.getState().load({ projectId: "p", layout, style: "scandinavian", initialRoomId: "r1" }))

describe("interior-store lighting", () => {
  it("addLight appends + selects; undo restores", () => {
    const before = useInteriorStore.getState().plan!.rooms[0].lighting.length
    useInteriorStore.getState().addLight("r1", "pendant")
    const st = useInteriorStore.getState()
    expect(st.plan!.rooms[0].lighting.length).toBe(before + 1)
    expect(st.selectedLightId).toBe(st.plan!.rooms[0].lighting.at(-1)!.id)
    useInteriorStore.getState().undo()
    expect(useInteriorStore.getState().plan!.rooms[0].lighting.length).toBe(before)
  })

  it("updateLight changes qty; removeLight clears selection", () => {
    useInteriorStore.getState().addLight("r1", "downlight")
    const id = useInteriorStore.getState().plan!.rooms[0].lighting.at(-1)!.id
    useInteriorStore.getState().updateLight("r1", id, { qty: 4 })
    expect(useInteriorStore.getState().plan!.rooms[0].lighting.find((l) => l.id === id)!.qty).toBe(4)
    useInteriorStore.getState().removeLight("r1", id)
    expect(useInteriorStore.getState().selectedLightId).toBeNull()
  })

  it("selectLight clears furniture selection", () => {
    useInteriorStore.getState().selectFurniture("x")
    useInteriorStore.getState().selectLight("y")
    expect(useInteriorStore.getState().selectedFurnitureId).toBeNull()
    expect(useInteriorStore.getState().selectedLightId).toBe("y")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/stores/interior-store.test.ts`
Expected: FAIL — `addLight is not a function`.

- [ ] **Step 3: Implement** — in `src/stores/interior-store.ts`:

(a) import the helpers from `@/lib/interior/plan`:
```ts
  addLightToRoom, moveLightInRoom, updateLightInRoom, removeLightFromRoom,
```
(b) import the light type: add `LightingFixture` to the `@/types` import.
(c) `InteriorState` type: add
```ts
  selectedLightId: string | null
  selectLight: (id: string | null) => void
  addLight: (roomId: string, type: LightingFixture["type"]) => void
  moveLight: (roomId: string, lightId: string, x: number, y: number) => void
  updateLight: (roomId: string, lightId: string, patch: Partial<Pick<LightingFixture, "type" | "colorTemperature" | "qty" | "heightM">>) => void
  removeLight: (roomId: string, lightId: string) => void
```
(d) initial state: add `selectedLightId: null,` and make `selectFurniture` also clear the light:
```ts
  selectFurniture: (id) => set({ selectedFurnitureId: id, selectedLightId: null }),
```
(e) actions (near furniture):
```ts
    selectLight: (id) => set({ selectedLightId: id, selectedFurnitureId: null }),

    addLight: (roomId, type) =>
      updateRoomPlan(
        set, get, roomId,
        (room, plan) => addLightToRoom(room, plan, type),
        (nextRoom) => ({ selectedRoomId: roomId, selectedLightId: nextRoom.lighting.at(-1)?.id ?? null, selectedFurnitureId: null })
      ),

    moveLight: (roomId, lightId, x, y) =>
      updateRoomPlan(set, get, roomId, (room, plan) => moveLightInRoom(room, plan, lightId, x, y)),

    updateLight: (roomId, lightId, patch) =>
      updateRoomPlan(set, get, roomId, (room, plan) => updateLightInRoom(room, plan, lightId, patch),
        () => ({ selectedLightId: lightId })),

    removeLight: (roomId, lightId) =>
      updateRoomPlan(set, get, roomId, (room, plan) => removeLightFromRoom(room, plan, lightId),
        () => ({ selectedLightId: get().selectedLightId === lightId ? null : get().selectedLightId })),
```

- [ ] **Step 4: Run test + types**

Run: `npx vitest run src/stores/interior-store.test.ts` then `rtk tsc`
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/stores/interior-store.ts src/stores/interior-store.test.ts
git commit -m "feat(interior): store lighting CRUD + selection

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Real per-room R3F scene (`InteriorRoomScene`)

**Files:**
- Create: `src/components/interior/interior-room-scene.tsx`
- Modify: `src/components/interior/interior-workspace.tsx` (swap `InteriorRoomPreview` → `InteriorRoomScene`)

**Interfaces:**
- Consumes: `fixtureToLight`/`LIGHT_COLORS` (Task 1); store `selectFurniture`/`selectLight`/`selectedFurnitureId`/`selectedLightId`; `getInteriorStyle`; `furnitureColor`.

- [ ] **Step 1: Implement the scene** — create `src/components/interior/interior-room-scene.tsx`. Mirror the R3F setup in [preview-3d/house-model.tsx](../../../src/components/preview-3d/house-model.tsx) for imports (`Canvas` from `@react-three/fiber`; `OrbitControls`, `PerspectiveCamera` from `@react-three/drei`). Center the room at the origin (scene coords = plan coord − halfDim); three.js Y is up; plan `y` → scene `z`.

```tsx
"use client"

import { Canvas } from "@react-three/fiber"
import { OrbitControls, PerspectiveCamera } from "@react-three/drei"

import type { Room, RoomInteriorPlan } from "@/types"
import { fixtureToLight } from "@/lib/interior/lighting"
import { getInteriorStyle } from "@/lib/interior/presets"
import { furnitureColor } from "@/components/interior/interior-workspace-helpers" // see note
import { useInteriorStore } from "@/stores/interior-store"

const WALL_H = 2.8

export function InteriorRoomScene({ room, plan }: { room: Room; plan: RoomInteriorPlan }) {
  const style = getInteriorStyle(plan.style)
  const selectedFurnitureId = useInteriorStore((s) => s.selectedFurnitureId)
  const selectedLightId = useInteriorStore((s) => s.selectedLightId)
  const selectFurniture = useInteriorStore((s) => s.selectFurniture)
  const selectLight = useInteriorStore((s) => s.selectLight)
  const w = room.width
  const d = room.depth

  return (
    <div className="relative min-h-[30rem] overflow-hidden rounded-lg border bg-card">
      <Canvas shadows dpr={[1, 2]}>
        <PerspectiveCamera makeDefault position={[w * 0.9, WALL_H * 1.8, d * 1.4]} fov={50} />
        <OrbitControls target={[0, 0.6, 0]} maxPolarAngle={Math.PI / 2.1} />
        <ambientLight intensity={0.25} />
        <directionalLight position={[w, WALL_H * 2, d]} intensity={0.5} castShadow />

        {/* floor */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[w, d]} />
          <meshStandardMaterial color={style.colors.primary} />
        </mesh>
        {/* back + left walls */}
        <mesh position={[0, WALL_H / 2, -d / 2]} receiveShadow>
          <boxGeometry args={[w, WALL_H, 0.05]} />
          <meshStandardMaterial color={style.colors.secondary} />
        </mesh>
        <mesh position={[-w / 2, WALL_H / 2, 0]} receiveShadow>
          <boxGeometry args={[0.05, WALL_H, d]} />
          <meshStandardMaterial color={style.colors.secondary} />
        </mesh>

        {/* furniture */}
        {plan.furniture.map((item, i) => (
          <mesh
            key={item.id}
            position={[item.x - w / 2, 0.3, item.y - d / 2]}
            castShadow
            onClick={(e) => { e.stopPropagation(); selectFurniture(item.id) }}
          >
            <boxGeometry args={[Math.max(0.3, item.widthM), 0.6, Math.max(0.3, item.depthM)]} />
            <meshStandardMaterial
              color={furnitureColor(item, style, i)}
              emissive={item.id === selectedFurnitureId ? "#3b82f6" : "#000000"}
              emissiveIntensity={item.id === selectedFurnitureId ? 0.4 : 0}
            />
          </mesh>
        ))}

        {/* lights + source markers */}
        {plan.lighting.map((f) => {
          const L = fixtureToLight(f, room)
          return (
            <group key={f.id}>
              {L.kind === "spot" ? (
                <spotLight position={L.position} intensity={L.intensity} color={L.color} angle={0.7} penumbra={0.5} castShadow={L.castShadow} />
              ) : (
                <pointLight position={L.position} intensity={L.intensity} color={L.color} castShadow={L.castShadow} />
              )}
              <mesh
                position={L.position}
                onClick={(e) => { e.stopPropagation(); selectLight(f.id) }}
              >
                <sphereGeometry args={[f.id === selectedLightId ? 0.12 : 0.08, 12, 12]} />
                <meshStandardMaterial color={L.color} emissive={L.color} emissiveIntensity={f.id === selectedLightId ? 1.5 : 0.8} />
              </mesh>
            </group>
          )
        })}
      </Canvas>
      <div className="absolute left-4 top-4 rounded-md bg-background/90 px-3 py-2 text-sm shadow-sm">
        <p className="font-medium">3D room — lighting</p>
        <p className="text-xs text-muted-foreground">{plan.lighting.length} titik lampu • {plan.furniture.length} furniture</p>
      </div>
    </div>
  )
}
```

Note on `furnitureColor`: it is currently a local function in `interior-workspace.tsx`. **Export it** from there (add `export`) and import it in the scene, OR move it to a shared module. Pick the smaller change: add `export function furnitureColor(...)` in `interior-workspace.tsx` and import `{ furnitureColor }` from `"@/components/interior/interior-workspace"` (delete the placeholder `interior-workspace-helpers` import above). Confirm the exact signature before wiring.

- [ ] **Step 2: Swap the preview** — in `interior-workspace.tsx`, replace the `<InteriorRoomPreview room={room} plan={roomPlan} />` usage with `<InteriorRoomScene room={room} plan={roomPlan} />` (import it). Delete the now-unused `InteriorRoomPreview` function (and any imports only it used, e.g. `Box` if unused elsewhere — verify first).

- [ ] **Step 3: Verify**

Run: `rtk tsc` then `npx next build`
Expected: 0 errors; build succeeds. Manual: the room preview is now a real 3D scene; fixtures emit colored light; clicking a furniture box or a light marker selects it.

- [ ] **Step 4: Commit**

```bash
git add src/components/interior/interior-room-scene.tsx src/components/interior/interior-workspace.tsx
git commit -m "feat(interior): real R3F per-room scene with live lights

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: 2D markers + "Tambah lampu" + lighting inspector (`interior-workspace.tsx`)

**Files:**
- Modify: `src/components/interior/interior-workspace.tsx`

**Interfaces:**
- Consumes: store `addLight`/`moveLight`/`selectLight`/`updateLight`/`removeLight`/`selectedLightId`; `LIGHT_COLORS`; `ROOM`/light type labels.

- [ ] **Step 1: 2D markers in `InteriorCanvas`** — after the `plan.furniture.map(...)` block, render lighting markers using the same SVG coord scale the furniture uses (`scale`, the room→px transform already in the component). Each marker: a small `<circle r=10>` at the fixture's `(x,y)` scaled, `fill={LIGHT_COLORS[f.colorTemperature]}`, stroke when selected, `onPointerDown` starts a drag that calls `moveLight(room.id, f.id, wx, wy)` (mirror the furniture drag handler already in the component), `onClick` → `selectLight(f.id)`. Add a small icon/`<text>` of `qty` when `qty > 1`. (Reuse the exact pointer→world math the furniture drag uses.)

- [ ] **Step 2: "Tambah lampu" picker** — near the `FurnitureQuickAdd` usage in the room view, add a dropdown (reuse `DropdownMenu` from `@/components/ui/dropdown-menu`) labeled "Tambah lampu" listing the 6 types with Bahasa labels:
```ts
const LIGHT_LABELS: Record<LightingFixture["type"], string> = {
  downlight: "Downlight", pendant: "Lampu gantung", wall_lamp: "Lampu dinding",
  indirect: "Lampu tidak langsung", task: "Lampu kerja", outdoor: "Lampu luar",
}
```
Each item → `addLight(room.id, type)`.

- [ ] **Step 3: Lighting inspector** — when `selectedLightId` matches a fixture in the active room, render an inspector block (next to / instead of the furniture inspector) with:
  - Tipe: `Select` over the 6 types → `updateLight(room.id, id, { type })`.
  - Color temperature: a 3-button segmented (warm/neutral/cool) → `updateLight(room.id, id, { colorTemperature })`.
  - Jumlah: number input (min 1) → `updateLight(room.id, id, { qty })`.
  - Tinggi (m): number input → `updateLight(room.id, id, { heightM })`.
  - "Hapus lampu" button → `removeLight(room.id, id)`.
  Follow the existing furniture-inspector layout/components in this file.

- [ ] **Step 4: Verify**

Run: `rtk tsc` then `npx next build`
Expected: 0 errors; build succeeds. Manual: "Tambah lampu" → marker on 2D canvas + light in 3D; drag marker moves it; inspector edits type/temp/qty/height (3D updates); remove works.

- [ ] **Step 5: Commit**

```bash
git add src/components/interior/interior-workspace.tsx
git commit -m "feat(interior): 2D lighting markers + add-light picker + inspector

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: AI parity (interior lighting actions)

**Files:**
- Modify: `src/lib/assistant/actions.ts`
- Modify: the interior sanitizer + prompt (locate: the function validating interior actions against the interior scene — grep `sanitizeInterior` / `interiorActionSchema` consumers; likely in `src/lib/server/editor-assistant.ts` or a sibling)
- Modify: `src/lib/assistant/apply.ts`
- Test: the interior sanitizer's test file (same file the existing interior-action tests live in)

**Interfaces:**
- Consumes: store `addLight`/`moveLight`/`updateLight`/`removeLight`.
- Produces: 4 new `InteriorAction` variants.

- [ ] **Step 1: Extend the schema** — in `src/lib/assistant/actions.ts`, add a light-type enum + 4 variants to `interiorActionSchema`:
```ts
const lightTypeSchema = z.enum(["downlight", "pendant", "wall_lamp", "indirect", "task", "outdoor"])
const colorTempSchema = z.enum(["warm", "neutral", "cool"])
// inside interiorActionSchema discriminated union:
  z.object({ type: z.literal("addLight"), roomId: z.string().min(1), lightType: lightTypeSchema }),
  z.object({ type: z.literal("moveLight"), roomId: z.string().min(1), lightId: z.string().min(1), x: z.number().finite(), y: z.number().finite() }),
  z.object({ type: z.literal("updateLight"), roomId: z.string().min(1), lightId: z.string().min(1),
    patch: z.object({ lightType: lightTypeSchema.optional(), colorTemperature: colorTempSchema.optional(), qty: z.number().int().positive().optional(), heightM: z.number().finite().positive().optional() }) }),
  z.object({ type: z.literal("removeLight"), roomId: z.string().min(1), lightId: z.string().min(1) }),
```

- [ ] **Step 2: describeAction** — add cases:
```ts
    case "addLight": return `Tambah lampu ${action.lightType}`
    case "moveLight": return "Pindahkan lampu"
    case "updateLight": return "Ubah lampu"
    case "removeLight": return "Hapus lampu"
```

- [ ] **Step 3: Write the failing test** — in the interior sanitizer's test file, append a test asserting the 4 actions sanitize and validate ids against the interior scene (valid `roomId`/`lightId` kept, ghost ids dropped, enums valid). Model it on the existing interior `addFurniture`/`removeFurniture` sanitize tests in that file (reuse its scene fixture; if the fixture lacks lighting, add one fixture inline).

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run <interior sanitizer test file>`
Expected: FAIL — new actions dropped.

- [ ] **Step 5: Sanitizer + prompt** — in the interior sanitizer, mirror the furniture validation: for the 4 light actions confirm `roomId` exists; for move/update/remove confirm `lightId` exists in that room's `lighting`; clamp `x/y` to the room; enums already enforced by schema. Drop actions that fail. In the interior prompt, document the 4 lighting actions (Bahasa) so the model knows it can manage lighting.

- [ ] **Step 6: apply** — in `src/lib/assistant/apply.ts` `applyInteriorActions`, add dispatch:
```ts
      else if (a.type === "addLight") store.addLight(a.roomId, a.lightType)
      else if (a.type === "moveLight") store.moveLight(a.roomId, a.lightId, a.x, a.y)
      else if (a.type === "updateLight") store.updateLight(a.roomId, a.lightId, {
        type: a.patch.lightType, colorTemperature: a.patch.colorTemperature, qty: a.patch.qty, heightM: a.patch.heightM,
      })
      else if (a.type === "removeLight") store.removeLight(a.roomId, a.lightId)
```
(Build the `updateLight` patch excluding undefined keys if the store copies verbatim — follow whatever the existing furniture apply does; map `lightType`→`type`.)

- [ ] **Step 7: Run tests + types**

Run: `npx vitest run <interior sanitizer test file>` then `rtk tsc`
Expected: PASS; tsc 0.

- [ ] **Step 8: Commit**

```bash
git add src/lib/assistant/actions.ts src/lib/assistant/apply.ts src/lib/server/editor-assistant.ts <test file>
git commit -m "feat(assistant): interior lighting parity (addLight/moveLight/updateLight/removeLight)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Full verification

- [ ] **Step 1: tsc + tests + build**

Run: `rtk tsc` · `npx vitest run` · `npx next build`
Expected: tsc clean; all tests pass; build succeeds.

- [ ] **Step 2: Manual (mock mode)**

`npx next dev`, interior workspace for a room: "Tambah lampu" → pendant (2D marker + warm light in 3D); drag the marker; switch color temp to cool (3D tint shifts); bump qty (brighter, budget grows); remove it. Via "Asisten Interior": "tambah downlight di kamar tidur", "ubah lampu jadi cool", "hapus lampu" — each previews + applies.

- [ ] **Step 3: Final commit (if fixes)**

```bash
git add -A && git commit -m "test(interior): verify lighting control + 3D + AI parity

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** Stage 1 store CRUD → T1 (pure builders) + T2 (room-plan helpers) + T3 (store actions). Stage 2 mapping+scene → T1 (`fixtureToLight`) + T4 (R3F scene). Stage 3 2D markers + inspector → T5. Stage 4 AI parity → T6. Verification → T7. Every spec section maps to a task. ✓

**Placeholder scan:** none — concrete code/commands throughout. Two implementer-locate items are explicitly flagged with how to find them: the interior sanitizer/prompt file (grep) and `furnitureColor`'s export.

**Type consistency:** `addLight(roomId,type)`/`moveLight(roomId,lightId,x,y)`/`updateLight(roomId,lightId,patch)`/`removeLight(roomId,lightId)`/`selectedLightId`/`selectLight` identical across T3 (store), T4/T5 (components), T6 (apply). Room-plan helpers `addLightToRoom`/`moveLightInRoom`/`updateLightInRoom`/`removeLightFromRoom` match T2↔T3. `makeLight`/`lightPriceFor`/`fixtureToLight`/`LIGHT_COLORS`/`LightDesc` match T1↔T2↔T4. AI action shapes (`addLight{roomId,lightType}`, `moveLight{roomId,lightId,x,y}`, `updateLight{roomId,lightId,patch{lightType?,colorTemperature?,qty?,heightM?}}`, `removeLight{roomId,lightId}`) identical across T6 schema/describe/apply; `lightType`→`type` mapping handled only in apply.

**Notes for implementers:** (T4) confirm `furnitureColor`'s real signature before importing; reuse the house-model R3F import style. (T5) reuse the exact furniture pointer→world drag math already in `InteriorCanvas`. (T6) the interior sanitizer/prompt location must be grepped, not assumed.
