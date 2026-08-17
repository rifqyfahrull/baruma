# Spatial Design (Open-plan Zones + Split-level) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let rooms form open-plan zones (no walls between same-zone neighbors) and sit at per-room split-level elevations, rendered in 3D (skipped walls + per-edge risers) and 2D (colored zone tint + dashed open boundaries + an elevation label on every room), settable from the inspector and the AI assistant.

**Architecture:** Two optional `Room` fields (`zoneId`, `levelOffsetM`) drive pure geometry helpers (`roomsAdjacentOnSide`, `snapLevelOffset`) consumed by the 3D primitive builder and the 2D canvas. No DB migration — `DesignLayout` is a JSONB payload. Shipped in 3 stages: data+rendering, inspector, AI.

**Tech Stack:** Next.js 16 · React Three Fiber (primitive boxes from `build-model.ts`) · SVG 2D canvas · zod · zustand · vitest.

## Global Constraints

- Spec: [docs/superpowers/specs/2026-06-29-spatial-design-openplan-splitlevel-design.md](../specs/2026-06-29-spatial-design-openplan-splitlevel-design.md).
- `Room.zoneId?: string`, `Room.levelOffsetM?: number` — both optional, default absent/0; **no DB migration** (layout is JSONB).
- Open-plan = same `zoneId` neighbors drop the wall *between* them; exterior + cross-zone walls stay. Risers are independent of zoning.
- Split-level: free value **snapped to multiples of `RISER_M = 0.18` m**; soft warning when `|offset| > COMFORT_MAX_M = 0.20` m. v1 is visual only (no auto-stairs).
- 2D: elevation label on **every** room incl. baseline (`±0 m`); zones get a **colored tint**; same-zone shared edges drawn **dashed**.
- All UI copy Bahasa Indonesia. No new npm deps. Verify with `rtk tsc` · `npx vitest run` · `npx next build`.

---

## File Structure

- Modify `src/types/index.ts` — add the two `Room` fields.
- Modify `src/lib/format.ts` — add `formatElevation`.
- Modify `src/lib/geometry/index.ts` — `roomsAdjacentOnSide`, `RISER_M`, `COMFORT_MAX_M`, `snapLevelOffset`, `levelStepWarning` (+ test file `src/lib/geometry/levels.test.ts`).
- Modify `src/lib/three/build-model.ts` — per-room elevation, same-zone wall skip, per-edge risers, `"riser"` PrimKind (+ tests `src/lib/three/build-model.test.ts`).
- Modify `src/components/preview-3d/house-model.tsx` — render the `"riser"` kind.
- Modify `src/components/editor/plan-canvas.tsx` — zone tint, dashed open boundaries, per-room elevation label; add `src/lib/editor/zones.ts` (`zoneColor`).
- Modify `src/components/editor/editor-inspector.tsx` — Zona + Elevasi controls.
- Modify `src/lib/assistant/actions.ts` + `src/lib/server/editor-assistant.ts` (+ tests) — `zoneId`/`levelOffsetM` in `updateRoom`.

---

## Task 1: Room fields + `formatElevation`

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/lib/format.ts`
- Test: `src/lib/format.test.ts`

**Interfaces:**
- Produces: `Room.zoneId?: string`, `Room.levelOffsetM?: number`; `formatElevation(meters: number, unit: LengthUnit): string`.

- [ ] **Step 1: Add the Room fields** — in `src/types/index.ts`, inside the `Room` type, after `requiresVentilation?: boolean`:

```ts
  /** Open-plan grouping: rooms sharing a zoneId render with no walls between them. */
  zoneId?: string
  /** Split-level elevation offset (metres) relative to the room's floor slab; + up, - down. */
  levelOffsetM?: number
```

- [ ] **Step 2: Write the failing test** — append to `src/lib/format.test.ts` (add `formatElevation` to the existing import from `@/lib/format`):

```ts
  it("formats elevation with a sign, baseline ±, and unit", () => {
    expect(formatElevation(0, "m")).toBe("±0 m")
    expect(formatElevation(-0.18, "m")).toBe("-0,18 m")
    expect(formatElevation(0.18, "m")).toBe("+0,18 m")
    expect(formatElevation(-0.18, "mm")).toBe("-180 mm")
  })
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/format.test.ts`
Expected: FAIL — `formatElevation is not a function`.

- [ ] **Step 4: Implement** — in `src/lib/format.ts`, after `formatLengthPair`:

```ts
/** Signed elevation label for split-level, e.g. "±0 m", "-0,18 m", "+180 mm". */
export function formatElevation(meters: number, unit: LengthUnit): string {
  const sign = meters > 0 ? "+" : meters < 0 ? "-" : "±"
  return `${sign}${formatLength(Math.abs(meters), unit)}`
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/format.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/types/index.ts src/lib/format.ts src/lib/format.test.ts
git commit -m "feat(spatial): Room zone/level fields + formatElevation

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Geometry helpers (adjacency + level snapping)

**Files:**
- Modify: `src/lib/geometry/index.ts`
- Test: `src/lib/geometry/levels.test.ts`

**Interfaces:**
- Consumes: existing `Side`, `round2` from this module.
- Produces: `roomsAdjacentOnSide<T extends EdgeRect>(room: EdgeRect, side: Side, others: T[], tol?): T | null`; `RISER_M`, `COMFORT_MAX_M`; `snapLevelOffset(m: number): number`; `levelStepWarning(m: number): string | null`. Where `EdgeRect = { x: number; y: number; width: number; depth: number }`.

- [ ] **Step 1: Write the failing test** — create `src/lib/geometry/levels.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { roomsAdjacentOnSide, snapLevelOffset, levelStepWarning } from "./index"

const r = (x: number, y: number, width: number, depth: number, id = "") => ({ x, y, width, depth, id })

describe("roomsAdjacentOnSide", () => {
  it("finds the room sharing the east edge with overlap", () => {
    const a = r(0, 0, 3, 3)
    const b = r(3, 0, 3, 3, "b")
    expect(roomsAdjacentOnSide(a, "e", [b])?.id).toBe("b")
    expect(roomsAdjacentOnSide(b, "w", [a as never]) ).not.toBeNull()
  })
  it("returns null when edges don't touch or don't overlap", () => {
    const a = r(0, 0, 3, 3)
    expect(roomsAdjacentOnSide(a, "e", [r(4, 0, 3, 3, "far")])).toBeNull() // gap
    expect(roomsAdjacentOnSide(a, "e", [r(3, 5, 3, 3, "noovl")])).toBeNull() // no y-overlap
  })
})

describe("snapLevelOffset / levelStepWarning", () => {
  it("snaps to multiples of the riser height", () => {
    expect(snapLevelOffset(0)).toBe(0)
    expect(snapLevelOffset(-0.16)).toBe(-0.18)
    expect(snapLevelOffset(0.2)).toBe(0.18)
    expect(snapLevelOffset(-0.35)).toBe(-0.36)
  })
  it("warns only when beyond one comfortable step", () => {
    expect(levelStepWarning(-0.18)).toBeNull()
    expect(levelStepWarning(-0.36)).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/geometry/levels.test.ts`
Expected: FAIL — exports not found.

- [ ] **Step 3: Implement** — append to `src/lib/geometry/index.ts`:

```ts
/* ── Split-level + open-plan adjacency ── */

export const RISER_M = 0.18 // typical comfortable stair riser
export const COMFORT_MAX_M = 0.2 // a single step taller than this should be stairs

/** Snap a free elevation offset to a whole number of comfortable risers. */
export function snapLevelOffset(m: number): number {
  if (!Number.isFinite(m)) return 0
  return round2(Math.round(m / RISER_M) * RISER_M)
}

/** Soft warning when a level change exceeds one comfortable step (needs stairs). */
export function levelStepWarning(m: number): string | null {
  return Math.abs(m) > COMFORT_MAX_M ? "Beda tinggi > 20 cm — sebaiknya pakai tangga." : null
}

type EdgeRect = { x: number; y: number; width: number; depth: number }

/** The room in `others` that shares `room`'s given edge (collinear within `tol`
 *  and with an overlapping span), or null. */
export function roomsAdjacentOnSide<T extends EdgeRect>(
  room: EdgeRect,
  side: Side,
  others: T[],
  tol = 0.05
): T | null {
  const overlap = (a0: number, a1: number, b0: number, b1: number) =>
    a0 < b1 - tol && a1 > b0 + tol
  for (const o of others) {
    if (side === "n" && Math.abs(o.y + o.depth - room.y) <= tol &&
        overlap(room.x, room.x + room.width, o.x, o.x + o.width)) return o
    if (side === "s" && Math.abs(o.y - (room.y + room.depth)) <= tol &&
        overlap(room.x, room.x + room.width, o.x, o.x + o.width)) return o
    if (side === "w" && Math.abs(o.x + o.width - room.x) <= tol &&
        overlap(room.y, room.y + room.depth, o.y, o.y + o.depth)) return o
    if (side === "e" && Math.abs(o.x - (room.x + room.width)) <= tol &&
        overlap(room.y, room.y + room.depth, o.y, o.y + o.depth)) return o
  }
  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/geometry/levels.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/geometry/index.ts src/lib/geometry/levels.test.ts
git commit -m "feat(spatial): adjacency + level-offset geometry helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: 3D model — zone walls, level offset, per-edge risers

**Files:**
- Modify: `src/lib/three/build-model.ts`
- Modify: `src/components/preview-3d/house-model.tsx`
- Test: `src/lib/three/build-model.test.ts`

**Interfaces:**
- Consumes: `roomsAdjacentOnSide` (Task 2); `Room.zoneId`/`levelOffsetM` (Task 1).
- Produces: `Prim` of `kind: "riser"`; wall ids `w-<roomId>-<side>` (unchanged); riser ids `riser-<roomId>-<side>`.

- [ ] **Step 1: Add `"riser"` to `PrimKind`** — in `src/lib/three/build-model.ts`, add `| "riser"` to the `PrimKind` union, and import the helper:

```ts
import { clamp, openingSegment, parseOpeningWall, roomsAdjacentOnSide } from "@/lib/geometry"
```

- [ ] **Step 2: Write the failing test** — create `src/lib/three/build-model.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { buildModel } from "./build-model"
import type { DesignLayout, Project, Room } from "@/types"

const room = (over: Partial<Room>): Room => ({
  id: "r", floorId: "f1", name: "R", type: "ruang_tamu",
  x: 0, y: 0, width: 3, depth: 3, areaM2: 9, ...over,
})
const layout = (rooms: Room[]): DesignLayout => ({
  id: "l", projectId: "p", versionId: "v",
  floors: [{ id: "f1", level: 1, name: "Lantai 1", heightM: 3 }],
  rooms, walls: [], openings: [], stairs: [], pools: [],
  validation: { passed: true, issues: [] },
})
const project = { rooftop: false, name: "P" } as unknown as Project
const opts = { exploded: false, showRoof: false, showFurniture: false }
const site = { widthM: 6, depthM: 3 }

describe("buildModel — zones + split-level", () => {
  it("drops the wall between two same-zone neighbors but keeps exterior walls", () => {
    const rooms = [
      room({ id: "a", x: 0, y: 0, width: 3, depth: 3, zoneId: "z1" }),
      room({ id: "b", x: 3, y: 0, width: 3, depth: 3, zoneId: "z1" }),
    ]
    const ids = buildModel(layout(rooms), site, project, opts).prims.map((p) => p.id)
    expect(ids).not.toContain("w-a-e") // shared edge with same-zone b → skipped
    expect(ids).not.toContain("w-b-w")
    expect(ids).toContain("w-a-w") // exterior wall kept
    expect(ids).toContain("w-b-e")
  })

  it("keeps the wall between neighbors in different zones", () => {
    const rooms = [
      room({ id: "a", x: 0, y: 0, width: 3, depth: 3, zoneId: "z1" }),
      room({ id: "b", x: 3, y: 0, width: 3, depth: 3, zoneId: "z2" }),
    ]
    const ids = buildModel(layout(rooms), site, project, opts).prims.map((p) => p.id)
    expect(ids).toContain("w-a-e")
  })

  it("emits a riser on the higher room's stepped edge", () => {
    const rooms = [
      room({ id: "a", x: 0, y: 0, width: 3, depth: 3, levelOffsetM: 0.18 }),
      room({ id: "b", x: 3, y: 0, width: 3, depth: 3, levelOffsetM: 0 }),
    ]
    const prims = buildModel(layout(rooms), site, project, opts).prims
    expect(prims.some((p) => p.id === "riser-a-e" && p.kind === "riser")).toBe(true)
    expect(prims.some((p) => p.id === "riser-b-w")).toBe(false) // lower side draws nothing
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/three/build-model.test.ts`
Expected: FAIL (walls not skipped / no riser).

- [ ] **Step 4: Implement** — in `build-model.ts`, replace the room loop body (the block from `for (const room of rooms) {` through its closing `}`, currently lines ~100–172) with:

```ts
    const SIDES = ["n", "s", "w", "e"] as const

    for (const room of rooms) {
      const rx = room.x + room.width / 2 - cx
      const rz = room.y + room.depth / 2 - cz
      const isPool = room.type === "kolam"
      const isOpen = OPEN_TYPES.includes(room.type)
      const offset = room.levelOffsetM ?? 0
      const roomTopY = slabTopY + offset
      const roomWallCenterY = roomTopY + WALL_H / 2
      const w = room.width
      const d = room.depth
      const t = WALL_T
      const others = rooms.filter((o) => o.id !== room.id)

      prims.push({
        id: `tile-${room.id}`,
        kind: isPool ? "pool" : room.type === "taman" ? "garden" : "tile",
        floorId: floor.id,
        roomId: room.id,
        name: room.name,
        pos: [rx, isPool ? roomTopY - 0.05 : roomTopY + 0.02, rz],
        args: [w, isPool ? 0.3 : 0.05, d],
      })

      // Per-edge risers: drawn by the higher room down to the neighbor (or slab).
      if (offset !== 0 || others.some((o) => (o.levelOffsetM ?? 0) !== offset)) {
        for (const side of SIDES) {
          const neighbor = roomsAdjacentOnSide(room, side, others)
          const otherOffset = neighbor?.levelOffsetM ?? 0
          if (offset <= otherOffset + 1e-6) continue
          const h = offset - otherOffset
          const yC = slabTopY + otherOffset + h / 2
          const pos: [number, number, number] =
            side === "n" ? [rx, yC, room.y - cz]
            : side === "s" ? [rx, yC, room.y + d - cz]
            : side === "w" ? [room.x - cx, yC, rz]
            : [room.x + w - cx, yC, rz]
          const args: [number, number, number] =
            side === "n" || side === "s" ? [w, h, t] : [t, h, d]
          prims.push({ id: `riser-${room.id}-${side}`, kind: "riser", floorId: floor.id, roomId: room.id, pos, args })
        }
      }

      if (!isOpen) {
        for (const side of SIDES) {
          const neighbor = roomsAdjacentOnSide(room, side, others)
          // open-plan: skip wall between same-zone neighbors
          if (neighbor && room.zoneId && neighbor.zoneId === room.zoneId) continue
          const pos: [number, number, number] =
            side === "n" ? [rx, roomWallCenterY, room.y - cz]
            : side === "s" ? [rx, roomWallCenterY, room.y + d - cz]
            : side === "w" ? [room.x - cx, roomWallCenterY, rz]
            : [room.x + w - cx, roomWallCenterY, rz]
          const args: [number, number, number] =
            side === "n" || side === "s" ? [w + t, WALL_H, t] : [t, WALL_H, d + t]
          prims.push({ id: `w-${room.id}-${side}`, kind: "wall", floorId: floor.id, pos, args })
        }

        if (opts.showFurniture) {
          prims.push({
            id: `f-${room.id}`,
            kind: "furniture",
            floorId: floor.id,
            pos: [rx, roomTopY + 0.25, rz],
            args: [clamp(room.width * 0.45, 0.6, 1.6), 0.5, clamp(room.depth * 0.45, 0.6, 1.6)],
          })
        }
      }

      labels.push({
        id: `lbl-${room.id}`,
        floorId: floor.id,
        roomId: room.id,
        name: room.name,
        pos: [rx, roomTopY + (isOpen ? 0.6 : WALL_H * 0.62), rz],
      })
    }
```

(The opening loop below stays; openings still position from `slabTopY` — acceptable for v1.)

- [ ] **Step 5: Render the riser kind** — in `src/components/preview-3d/house-model.tsx`, in the material/kind switch (where `case "wall": return preset.wall`), add:

```ts
      case "riser": return preset.wall
```

And include `"riser"` wherever walls set `castShadow` (the line `castShadow={p.kind === "wall" || p.kind === "roof"}` becomes `castShadow={p.kind === "wall" || p.kind === "riser" || p.kind === "roof"}`).

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/lib/three/build-model.test.ts` then `rtk tsc`
Expected: PASS; tsc 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/three/build-model.ts src/lib/three/build-model.test.ts src/components/preview-3d/house-model.tsx
git commit -m "feat(spatial): 3D open-plan walls + split-level risers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: 2D canvas — zone tint, dashed open boundaries, elevation label

**Files:**
- Create: `src/lib/editor/zones.ts`
- Modify: `src/components/editor/plan-canvas.tsx`
- Test: `src/lib/editor/zones.test.ts`

**Interfaces:**
- Consumes: `roomsAdjacentOnSide` (Task 2), `formatElevation` (Task 1), `Room` fields.
- Produces: `zoneColor(zoneId: string): string` (stable hex per zone).

- [ ] **Step 1: Write the failing test** — create `src/lib/editor/zones.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { zoneColor } from "./zones"

describe("zoneColor", () => {
  it("is stable per id and varies across ids", () => {
    expect(zoneColor("z1")).toBe(zoneColor("z1"))
    expect(zoneColor("z1")).not.toBe(zoneColor("z2"))
    expect(zoneColor("z1")).toMatch(/^#[0-9a-fA-F]{6}$/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/editor/zones.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `zones.ts`** — create `src/lib/editor/zones.ts`:

```ts
/** Stable tint per open-plan zone id (for the 2D canvas). */
const ZONE_COLORS = ["#2F5D50", "#8B6F47", "#6F92A3", "#9A5A35", "#446B5B", "#7B5234"]

export function zoneColor(zoneId: string): string {
  let h = 0
  for (let i = 0; i < zoneId.length; i++) h = (h * 31 + zoneId.charCodeAt(i)) | 0
  return ZONE_COLORS[Math.abs(h) % ZONE_COLORS.length]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/editor/zones.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into `plan-canvas.tsx`** — three edits:

(a) imports:
```ts
import { formatElevation } from "@/lib/format"
import { roomsAdjacentOnSide } from "@/lib/geometry"
import { zoneColor } from "@/lib/editor/zones"
```

(b) In `RoomRect`, after the `<rect …>` element, when the room has a zone, overlay a tint and (gated by size, beside the area `<tspan>`) add an elevation `<tspan>`. Replace the room-label `<text>` block's area tspan group with one that also renders elevation, and add the zone tint rect. Pass `unit` (the store's `dimensionUnit`) and the full `rooms` array into `RoomRect` as new props so it can compute the zone fill and the dashed shared edges. Concretely, extend `RoomRect`'s props with `zoneFill: string | null`, `elevationLabel: string`, and render:

```tsx
      {zoneFill && (
        <rect x={toX(room.x)} y={toY(room.y)} width={w} height={d} fill={zoneFill} opacity={0.18} className="pointer-events-none" />
      )}
```
and inside the existing label `<text>`, add a third tspan under the area line:
```tsx
          <tspan x={toX(room.x + room.width / 2)} dy={13} className="fill-muted-foreground text-[9px]">
            {elevationLabel}
          </tspan>
```

(c) In `PlanCanvas`, compute and pass the new props, and after the rooms `.map`, draw dashed lines on same-zone shared edges:
```tsx
      {rooms.map((room) => (
        <RoomRect
          key={room.id}
          room={room}
          /* …existing props… */
          zoneFill={room.zoneId ? zoneColor(room.zoneId) : null}
          elevationLabel={formatElevation(room.levelOffsetM ?? 0, dimensionUnit)}
        />
      ))}

      {/* dashed boundaries between same-zone neighbours */}
      {rooms.flatMap((room) =>
        (["e", "s"] as const).flatMap((side) => {
          const nb = roomsAdjacentOnSide(room, side, rooms.filter((o) => o.id !== room.id))
          if (!nb || !room.zoneId || nb.zoneId !== room.zoneId) return []
          const x1 = side === "e" ? toX(room.x + room.width) : toX(room.x)
          const y1 = side === "e" ? toY(room.y) : toY(room.y + room.depth)
          const x2 = side === "e" ? toX(room.x + room.width) : toX(room.x + room.width)
          const y2 = side === "e" ? toY(room.y + room.depth) : toY(room.y + room.depth)
          return [
            <line key={`open-${room.id}-${side}`} x1={x1} y1={y1} x2={x2} y2={y2}
              className="stroke-background" strokeWidth={2.5} strokeDasharray="5 4" />,
          ]
        })
      )}
```

(Only sides `e`/`s` are walked so each shared edge is drawn once.) Read `dimensionUnit` from the store alongside the existing `showDimensions` selector.

- [ ] **Step 6: Verify**

Run: `rtk tsc` then `npx vitest run src/lib/editor/zones.test.ts`
Expected: tsc 0 errors; test passes.

- [ ] **Step 7: Commit**

```bash
git add src/lib/editor/zones.ts src/lib/editor/zones.test.ts src/components/editor/plan-canvas.tsx
git commit -m "feat(spatial): 2D zone tint, dashed open boundaries, elevation labels

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Inspector controls (Zona + Elevasi)

**Files:**
- Modify: `src/components/editor/editor-inspector.tsx`

**Interfaces:**
- Consumes: `updateRoom` (store), `snapLevelOffset`/`levelStepWarning` (Task 2), `formatElevation` (Task 1), `zoneColor` (Task 4).

- [ ] **Step 1: Implement** — in `RoomInspector` (`src/components/editor/editor-inspector.tsx`), add imports at top of the file:

```ts
import { snapLevelOffset, levelStepWarning } from "@/lib/geometry"
import { zoneColor } from "@/lib/editor/zones"
```

Then inside `RoomInspector`, read the layout's existing zones and add controls before the final `<Separator />`/delete button:

```tsx
  const allRooms = useEditorStore((s) => s.layout?.rooms ?? [])
  const zones = Array.from(new Set(allRooms.map((r) => r.zoneId).filter(Boolean))) as string[]
  const [elev, setElev] = React.useState(String(Math.round((room.levelOffsetM ?? 0) * 100)))

  const commitElev = () => {
    const cm = Number(elev)
    if (!Number.isFinite(cm)) return
    const snapped = snapLevelOffset(cm / 100)
    if (snapped !== (room.levelOffsetM ?? 0)) updateRoom(room.id, { levelOffsetM: snapped })
    setElev(String(Math.round(snapped * 100)))
  }
```

```tsx
      <Separator />

      <Field label="Zona open-plan">
        <div className="flex flex-wrap gap-1.5">
          {zones.map((z) => (
            <button key={z} type="button" onClick={() => updateRoom(room.id, { zoneId: z })}
              className={cn("flex items-center gap-1 rounded-md border px-2 py-1 text-xs",
                room.zoneId === z && "border-primary bg-primary/10")}>
              <span className="size-3 rounded-full" style={{ background: zoneColor(z) }} /> {z}
            </button>
          ))}
          <button type="button" onClick={() => updateRoom(room.id, { zoneId: `zona-${zones.length + 1}` })}
            className="rounded-md border px-2 py-1 text-xs hover:bg-muted">+ Zona baru</button>
          {room.zoneId && (
            <button type="button" onClick={() => updateRoom(room.id, { zoneId: undefined })}
              className="rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-muted">Lepas</button>
          )}
        </div>
      </Field>

      <Field label="Elevasi (cm dari lantai)">
        <Input type="number" step={1} value={elev} disabled={room.locked}
          onChange={(e) => setElev(e.target.value)} onBlur={commitElev} />
      </Field>
      {levelStepWarning(room.levelOffsetM ?? 0) && (
        <p className="text-xs text-warning">{levelStepWarning(room.levelOffsetM ?? 0)}</p>
      )}
```

(`cn` is already imported in this file. `Field`, `Input`, `Separator`, `useEditorStore`, `updateRoom` already in scope.)

- [ ] **Step 2: Verify**

Run: `rtk tsc` then `npx next build`
Expected: 0 errors; build succeeds. Manually: select a room → set Elevasi 18 → value snaps and 3D shows a step; assign two adjacent rooms the same zone → wall drops + tint + dashed boundary.

- [ ] **Step 3: Commit**

```bash
git add src/components/editor/editor-inspector.tsx
git commit -m "feat(spatial): inspector Zona + Elevasi controls

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: AI assistant — zone + elevation in `updateRoom`

**Files:**
- Modify: `src/lib/assistant/actions.ts`
- Modify: `src/lib/server/editor-assistant.ts`
- Test: `src/lib/server/editor-assistant.test.ts`

**Interfaces:**
- Consumes: `snapLevelOffset` (Task 2), `roomPatchSchema` (existing).
- Produces: `updateRoom.patch.zoneId?`, `updateRoom.patch.levelOffsetM?`.

- [ ] **Step 1: Extend the patch schema** — in `src/lib/assistant/actions.ts`, add to `roomPatchSchema` (after `floorId`):

```ts
  zoneId: z.string().min(1).max(40).optional(),
  levelOffsetM: z.number().finite().optional(),
```

- [ ] **Step 2: Write the failing test** — append to `src/lib/server/editor-assistant.test.ts` (in the `sanitizeActions (floorplan)` describe):

```ts
  it("keeps zoneId and snaps levelOffsetM", () => {
    const out = sanitizeActions(
      "floorplan",
      [{ type: "updateRoom", roomId: "r1", patch: { zoneId: "zona-1", levelOffsetM: -0.16 } }],
      fpScene
    ) as FloorplanAction[]
    expect(out).toHaveLength(1)
    if (out[0].type === "updateRoom") {
      expect(out[0].patch.zoneId).toBe("zona-1")
      expect(out[0].patch.levelOffsetM).toBe(-0.18) // snapped to a riser multiple
    }
  })
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/server/editor-assistant.test.ts`
Expected: FAIL — `levelOffsetM` not snapped (stays -0.16).

- [ ] **Step 4: Implement snap in the sanitizer** — in `src/lib/server/editor-assistant.ts`, import `snapLevelOffset`:

```ts
import { rectsOverlap, round2, snapLevelOffset } from "@/lib/geometry"
```

In `sanitizeFloorplan`, inside the `if (a.type === "updateRoom")` block, after the existing clamps and before the empty-patch check, add:

```ts
      if (patch.levelOffsetM != null) patch.levelOffsetM = snapLevelOffset(patch.levelOffsetM)
```

- [ ] **Step 5: Document in the prompt + describe** — in `buildFloorplanMessages`, extend the `updateRoom` patch description to include `zoneId(id zona open-plan; samakan beberapa ruang untuk satu area terbuka)` and `levelOffsetM(meter, split-level; +naik/-turun)`. In `describeAction` (in `actions.ts`), add to the `updateRoom` parts:

```ts
      if (p.zoneId) parts.push(`zona → ${p.zoneId}`)
      if (p.levelOffsetM != null) parts.push(`elevasi → ${p.levelOffsetM} m`)
```

- [ ] **Step 6: Run tests + types**

Run: `npx vitest run src/lib/server/editor-assistant.test.ts` then `rtk tsc`
Expected: PASS; tsc 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/assistant/actions.ts src/lib/server/editor-assistant.ts src/lib/server/editor-assistant.test.ts
git commit -m "feat(spatial): AI assistant sets zone + split-level

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Full verification

- [ ] **Step 1: Type-check, tests, build**

Run: `rtk tsc` · `npx vitest run` · `npx next build`
Expected: tsc clean; all tests pass (incl. Tasks 1–6 additions); build succeeds.

- [ ] **Step 2: Manual (mock mode — local default)**

`npx next dev`, open a multi-room project's 2D editor:
- Assign two adjacent rooms the same zone → dashed boundary + shared tint in 2D; open 3D → the wall between them is gone, exterior walls remain.
- Set a room's Elevasi to 18 → 2D shows `+0,18 m` (others `±0 m`); 3D shows a step/riser. Set 40 → snaps to 0,36 and a warning shows.
- In the assistant ("Asisten Denah"): "jadikan ruang tamu dan dapur satu zona open-plan" and "turunkan kamar mandi 18 cm" → preview lists the actions → Terapkan reflects in 2D/3D.

- [ ] **Step 3: Final commit (if fixes)**

```bash
git add -A && git commit -m "test(spatial): verify open-plan + split-level end-to-end

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** Room fields (T1) · adjacency + snap/warn helpers (T2) · 3D zone-wall-skip + level offset + per-edge risers (T3) · 2D colored tint + dashed open boundary + ±0 elevation label on every room (T4) · inspector Zona + Elevasi (T5) · AI `zoneId`/`levelOffsetM` + snap + prompt/describe (T6) · validation warning surfaced via `levelStepWarning` in inspector (T5; build-model risers independent of zoning per spec) · testing (T1–3,4,6,7) · no-migration/JSONB (Global Constraints). ✓

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `zoneId`/`levelOffsetM` identical across T1 type, T3 build-model, T4 canvas, T5 inspector, T6 schema/sanitizer. `roomsAdjacentOnSide`/`snapLevelOffset`/`levelStepWarning` signatures match between T2 (def) and T3/T4/T5/T6 (use). `formatElevation(meters, unit)` matches between T1 and T4. `"riser"` PrimKind matches between T3 build-model and T3 house-model.
