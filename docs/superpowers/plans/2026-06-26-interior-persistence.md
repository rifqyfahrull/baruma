# Interior Design Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Editan interior (style + penempatan furniture per ruang) tersimpan durable ke Postgres jsonb lewat data-layer yang sudah ada, dan dimuat kembali saat membuka project, dengan autosave debounce.

**Architecture:** Tabel khusus `project_interiors` (jsonb, 1:1 per project, keyed `version_id`), meniru pola `design_layouts`. Yang disimpan adalah *intent* (`SavedInterior`), bukan snapshot derived. Saat load: generate base plan dari layout lalu overlay furniture tersimpan + recompute warning/budget. Autosave debounce 800ms via hook, dengan indikator status.

**Tech Stack:** Next.js (App Router, route handlers), TypeScript, Zustand, TanStack Query, zod, node-postgres (`pg`), Vitest.

## Global Constraints

- **Next.js versi repo ini berbeda dari pengetahuan umum** — sebelum menulis route handler/konvensi App Router baru, baca guide di `node_modules/next/dist/docs/` (lihat `AGENTS.md`). Tiru pola route yang sudah ada di `src/app/api/v1/projects/[id]/layout/route.ts` daripada menebak API.
- **Pola data-layer wajib diikuti:** DataSource contract (`src/lib/data/source.ts`) → impl `mock` + `http` → TanStack Query hook. Jangan panggil `fetch`/`pg` langsung dari komponen.
- **Server-only:** `@/lib/server/db` & repo tidak boleh diimpor dari client component.
- **Test runner:** `npx vitest run <path>` untuk satu file. Route test pakai header `// @vitest-environment node`.
- **Persisten = intent saja:** simpan `{ schemaVersion, versionId, style, rooms:[{roomId, furniture[]}] }`. Jangan simpan budget/warning (derived).
- **Validitas interior diikat ke `layout.versionId`.** Mismatch → abaikan, generate fresh.
- **Indonesian UI copy** (indikator status, dll), konsisten dengan komponen sekitar.
- **Commit message format:** `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` di baris akhir.

---

### Task 1: `SavedInterior` schema + types

**Files:**
- Create: `src/lib/schemas/interior.ts`
- Test: `src/lib/schemas/interior.test.ts`

**Interfaces:**
- Produces:
  - `savedInteriorSchema` (zod) — validates the persisted payload.
  - `type SavedInterior = z.infer<typeof savedInteriorSchema>` — used by plan.ts, data-layer, store, hooks.

- [ ] **Step 1: Write the failing test**

Create `src/lib/schemas/interior.test.ts`:
```ts
import { describe, expect, it } from "vitest"

import { savedInteriorSchema, type SavedInterior } from "./interior"

const valid: SavedInterior = {
  schemaVersion: 1,
  versionId: "ver-1",
  style: "modern_tropical",
  rooms: [
    {
      roomId: "room-1",
      furniture: [
        {
          id: "placed-room-1-sofa-3-seat-0",
          furnitureId: "sofa-3-seat",
          roomId: "room-1",
          name: "Sofa 3 Dudukan",
          category: "seating",
          x: 0.35,
          y: 0.45,
          rotationDeg: 0,
          widthM: 2.1,
          depthM: 0.9,
          heightM: 0.85,
          locked: false,
          priceRange: { low: 4_500_000, mid: 7_000_000, high: 12_000_000 },
        },
      ],
    },
  ],
}

describe("savedInteriorSchema", () => {
  it("parses a valid payload (round-trip)", () => {
    const parsed = savedInteriorSchema.parse(valid)
    expect(parsed).toEqual(valid)
  })

  it("rejects an unknown style", () => {
    const bad = { ...valid, style: "not_a_style" }
    expect(savedInteriorSchema.safeParse(bad).success).toBe(false)
  })

  it("rejects a furniture item with a missing field", () => {
    const bad = structuredClone(valid)
    // @ts-expect-error intentionally drop a required field
    delete bad.rooms[0].furniture[0].widthM
    expect(savedInteriorSchema.safeParse(bad).success).toBe(false)
  })

  it("rejects an invalid rotationDeg", () => {
    const bad = structuredClone(valid)
    // @ts-expect-error invalid rotation
    bad.rooms[0].furniture[0].rotationDeg = 45
    expect(savedInteriorSchema.safeParse(bad).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/schemas/interior.test.ts`
Expected: FAIL — `Cannot find module "./interior"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/schemas/interior.ts`:
```ts
import { z } from "zod"

/**
 * Persisted interior "intent" (PRD interior persistence spec, 2026-06-26).
 * Stored as jsonb in project_interiors. Derived data (budget/warnings) is NOT
 * persisted — it is recomputed on load. `versionId` ties validity to the layout.
 */

export const interiorStyleEnum = z.enum([
  "modern_tropical",
  "warm_minimalist",
  "japandi",
  "scandinavian",
  "industrial",
  "luxury_compact",
  "family_cozy",
])

const priceRangeSchema = z.object({
  low: z.number(),
  mid: z.number(),
  high: z.number(),
})

const placedFurnitureSchema = z.object({
  id: z.string(),
  furnitureId: z.string(),
  roomId: z.string(),
  name: z.string(),
  category: z.string(),
  x: z.number(),
  y: z.number(),
  rotationDeg: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  widthM: z.number(),
  depthM: z.number(),
  heightM: z.number(),
  locked: z.boolean(),
  priceRange: priceRangeSchema,
})

const savedRoomSchema = z.object({
  roomId: z.string(),
  furniture: z.array(placedFurnitureSchema),
})

export const savedInteriorSchema = z.object({
  schemaVersion: z.literal(1),
  versionId: z.string(),
  style: interiorStyleEnum,
  rooms: z.array(savedRoomSchema),
})

export type SavedInterior = z.infer<typeof savedInteriorSchema>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/schemas/interior.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
rtk git add src/lib/schemas/interior.ts src/lib/schemas/interior.test.ts
rtk git commit -m "feat(interior): SavedInterior zod schema + types

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Plan hydration & serialization

**Files:**
- Modify: `src/lib/interior/plan.ts` (add two exported functions near the other exports; reuse internal `validateFurnitureInRoom`, `buildRoomBudget`, `combineBudget`)
- Test: `src/lib/interior/plan.test.ts` (append cases)

**Interfaces:**
- Consumes: `SavedInterior` from `@/lib/schemas/interior`; `generateInteriorPlan`, internal `validateFurnitureInRoom`, `buildRoomBudget`, `combineBudget` (same module).
- Produces:
  - `toSavedInterior(plan: InteriorPlan): SavedInterior`
  - `applySavedInterior(layout: DesignLayout, saved: SavedInterior, opts: { projectId: string }): InteriorPlan`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/interior/plan.test.ts`:
```ts
import { applySavedInterior, toSavedInterior } from "./plan"

describe("interior persistence (hydrate/serialize)", () => {
  it("round-trips: serialize a plan then re-apply preserves furniture placement", () => {
    const layout = makeLayout()
    const plan = generateInteriorPlan(layout, { projectId: "p1", style: "modern_tropical" })

    const saved = toSavedInterior(plan)
    expect(saved.schemaVersion).toBe(1)
    expect(saved.versionId).toBe(plan.versionId)
    expect(saved.style).toBe("modern_tropical")

    const hydrated = applySavedInterior(layout, saved, { projectId: "p1" })
    const room0 = hydrated.rooms[0]
    const savedRoom0 = saved.rooms.find((r) => r.roomId === room0.roomId)!
    expect(room0.furniture.map((f) => f.id)).toEqual(savedRoom0.furniture.map((f) => f.id))
    expect(hydrated.totalEstimate.midIDR).toBeGreaterThan(0)
  })

  it("reflects an edited furniture list (added item) after re-apply", () => {
    const layout = makeLayout()
    const living = layout.rooms.find((r) => r.type === "ruang_tamu")!
    const plan = generateInteriorPlan(layout, { projectId: "p1", style: "modern_tropical" })

    const saved = toSavedInterior(plan)
    const savedLiving = saved.rooms.find((r) => r.roomId === living.id)!
    const extra = { ...savedLiving.furniture[0], id: "placed-extra-1" }
    savedLiving.furniture.push(extra)

    const hydrated = applySavedInterior(layout, saved, { projectId: "p1" })
    const hydratedLiving = hydrated.rooms.find((r) => r.roomId === living.id)!
    expect(hydratedLiving.furniture.some((f) => f.id === "placed-extra-1")).toBe(true)
  })

  it("falls back to generated default for rooms absent from saved", () => {
    const layout = makeLayout()
    const plan = generateInteriorPlan(layout, { projectId: "p1", style: "modern_tropical" })
    const saved = toSavedInterior(plan)
    // Drop the first room from saved → it should regenerate from template.
    const droppedRoomId = saved.rooms[0].roomId
    saved.rooms = saved.rooms.filter((r) => r.roomId !== droppedRoomId)

    const hydrated = applySavedInterior(layout, saved, { projectId: "p1" })
    const room = hydrated.rooms.find((r) => r.roomId === droppedRoomId)!
    expect(room.furniture.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/interior/plan.test.ts`
Expected: FAIL — `applySavedInterior`/`toSavedInterior` not exported.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/interior/plan.ts`, add the import at the top (after existing imports):
```ts
import type { SavedInterior } from "@/lib/schemas/interior"
```

Then add these exported functions immediately after `generateInteriorPlan` (around line 95):
```ts
/** Serialize the editable interior intent for persistence. */
export function toSavedInterior(plan: InteriorPlan): SavedInterior {
  return {
    schemaVersion: 1,
    versionId: plan.versionId,
    style: plan.style,
    rooms: plan.rooms.map((room) => ({
      roomId: room.roomId,
      furniture: room.furniture,
    })),
  }
}

/**
 * Rebuild a full InteriorPlan from saved intent: generate the base plan for the
 * current layout/style, then overlay saved furniture per room and recompute
 * warnings + budget so derived data stays consistent with current pricing.
 * Rooms missing from `saved` keep their generated defaults.
 */
export function applySavedInterior(
  layout: DesignLayout,
  saved: SavedInterior,
  opts: { projectId: string }
): InteriorPlan {
  const base = generateInteriorPlan(layout, {
    projectId: opts.projectId,
    versionId: layout.versionId,
    style: saved.style,
  })
  const savedByRoom = new Map(saved.rooms.map((room) => [room.roomId, room.furniture]))

  const rooms = base.rooms.map((roomPlan) => {
    const savedFurniture = savedByRoom.get(roomPlan.roomId)
    const room = layout.rooms.find((r) => r.id === roomPlan.roomId)
    if (!savedFurniture || !room) return roomPlan
    return {
      ...roomPlan,
      furniture: savedFurniture,
      warnings: validateFurnitureInRoom(room, savedFurniture),
      budgetEstimate: buildRoomBudget(room, savedFurniture, roomPlan.materials, roomPlan.lighting),
    }
  })

  const totalEstimate = combineBudget(rooms.flatMap((room) => room.budgetEstimate.lines))
  return { ...base, rooms, totalEstimate, warnings: rooms.flatMap((room) => room.warnings) }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/interior/plan.test.ts`
Expected: PASS (original 4 + new 3 tests).

- [ ] **Step 5: Commit**

```bash
rtk git add src/lib/interior/plan.ts src/lib/interior/plan.test.ts
rtk git commit -m "feat(interior): hydrate/serialize helpers (applySavedInterior, toSavedInterior)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Persistence backend — migration, repo, API route

**Files:**
- Create: `db/migrations/0004_interior.sql`
- Create: `src/lib/server/repo/interiors.ts`
- Create: `src/app/api/v1/projects/[id]/interior/route.ts`
- Test: `src/app/api/v1/projects/[id]/interior/route.test.ts`

**Interfaces:**
- Consumes: `SavedInterior`, `savedInteriorSchema` (Task 1); `query` from `@/lib/server/db`; `requireUser`, `getOwnedProject`, `ok`, `err`, `handleError` (existing).
- Produces:
  - `getInteriorPayload(projectId: string): Promise<SavedInterior | null>`
  - `upsertInterior(projectId: string, versionId: string, payload: SavedInterior): Promise<SavedInterior>`
  - Route handlers `GET` / `PUT` at `/api/v1/projects/[id]/interior`.

- [ ] **Step 1: Write the migration (no test; applied manually)**

Create `db/migrations/0004_interior.sql`:
```sql
-- Interior design persistence (intent payload, 1:1 per project, keyed by version).
create table project_interiors (
  project_id text primary key references projects(id) on delete cascade,
  version_id text not null,
  payload    jsonb not null,            -- SavedInterior shape
  updated_at timestamptz not null default now()
);
create trigger project_interiors_updated before update on project_interiors
  for each row execute function set_updated_at();
```

- [ ] **Step 2: Write the repo**

Create `src/lib/server/repo/interiors.ts`:
```ts
/**
 * Typed queries for project_interiors table (jsonb payload, 1:1 with project).
 */
import { query } from "@/lib/server/db"
import type { SavedInterior } from "@/lib/schemas/interior"

export async function getInteriorPayload(
  projectId: string
): Promise<SavedInterior | null> {
  const res = await query<{ payload: SavedInterior }>(
    `SELECT payload FROM project_interiors WHERE project_id = $1`,
    [projectId]
  )
  return res.rows[0]?.payload ?? null
}

export async function upsertInterior(
  projectId: string,
  versionId: string,
  payload: SavedInterior
): Promise<SavedInterior> {
  const res = await query<{ payload: SavedInterior }>(
    `INSERT INTO project_interiors (project_id, version_id, payload)
     VALUES ($1, $2, $3)
     ON CONFLICT (project_id) DO UPDATE
       SET version_id = EXCLUDED.version_id,
           payload = EXCLUDED.payload,
           updated_at = now()
     RETURNING payload`,
    [projectId, versionId, JSON.stringify(payload)]
  )
  return res.rows[0].payload
}
```

- [ ] **Step 3: Write the failing route test**

Create `src/app/api/v1/projects/[id]/interior/route.test.ts`:
```ts
// @vitest-environment node
/**
 * Route tests for GET/PUT /api/v1/projects/[id]/interior
 */
import { describe, it, expect, vi, beforeAll } from "vitest"

beforeAll(() => {
  process.env.BARUMA_JWT_SECRET = "test-secret-at-least-32-characters-long"
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test"
})

vi.mock("@/lib/server/db", () => ({ query: vi.fn(), getClient: vi.fn() }))

vi.mock("@/lib/server/repo/projects", () => ({
  getOwnedProject: vi.fn(),
  listProjectsByOwner: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
}))

vi.mock("@/lib/server/repo/interiors", () => ({
  getInteriorPayload: vi.fn(),
  upsertInterior: vi.fn(),
}))

import { GET, PUT } from "./route"
import * as projectsRepo from "@/lib/server/repo/projects"
import * as interiorsRepo from "@/lib/server/repo/interiors"
import { signToken } from "@/lib/server/auth-server"
import type { SavedInterior } from "@/lib/schemas/interior"

const ctx = { params: Promise.resolve({ id: "proj-xyz" }) }

// Mirror the proven fixture shape from brief/route.test.ts exactly, typed via
// the repo's own return type so it can't drift from the Project shape.
const ownedProject: NonNullable<Awaited<ReturnType<typeof projectsRepo.getOwnedProject>>> = {
  id: "proj-xyz",
  name: "Test",
  status: "brief",
  readiness: "concept_ready",
  projectType: "new",
  thumbnail: "family",
  floors: 1,
  rooftop: false,
  site: { widthM: 8, depthM: 10, areaM2: 80 },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

const validPayload: SavedInterior = {
  schemaVersion: 1,
  versionId: "ver-1",
  style: "modern_tropical",
  rooms: [],
}

describe("PUT /api/v1/projects/[id]/interior", () => {
  it("returns 401 without token", async () => {
    const req = new Request("http://localhost/api/v1/projects/proj-xyz/interior", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validPayload),
    })
    expect((await PUT(req, ctx)).status).toBe(401)
  })

  it("returns 400 for an invalid payload", async () => {
    const token = await signToken("user-1")
    vi.mocked(projectsRepo.getOwnedProject).mockResolvedValueOnce(ownedProject)
    const req = new Request("http://localhost/api/v1/projects/proj-xyz/interior", {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ schemaVersion: 1, style: "nope" }),
    })
    expect((await PUT(req, ctx)).status).toBe(400)
  })

  it("returns 200 and persists a valid payload", async () => {
    const token = await signToken("user-2")
    vi.mocked(projectsRepo.getOwnedProject).mockResolvedValueOnce(ownedProject)
    vi.mocked(interiorsRepo.upsertInterior).mockResolvedValueOnce(validPayload)
    const req = new Request("http://localhost/api/v1/projects/proj-xyz/interior", {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(validPayload),
    })
    const res = await PUT(req, ctx)
    expect(res.status).toBe(200)
    expect(vi.mocked(interiorsRepo.upsertInterior)).toHaveBeenCalledWith(
      "proj-xyz",
      "ver-1",
      validPayload
    )
  })
})

describe("GET /api/v1/projects/[id]/interior", () => {
  it("returns 200 with null when no interior saved yet", async () => {
    const token = await signToken("user-3")
    vi.mocked(projectsRepo.getOwnedProject).mockResolvedValueOnce(ownedProject)
    vi.mocked(interiorsRepo.getInteriorPayload).mockResolvedValueOnce(null)
    const req = new Request("http://localhost/api/v1/projects/proj-xyz/interior", {
      headers: { authorization: `Bearer ${token}` },
    })
    const res = await GET(req, ctx)
    expect(res.status).toBe(200)
    expect(await res.json()).toBeNull()
  })

  it("returns 200 with the saved interior for owner", async () => {
    const token = await signToken("user-4")
    vi.mocked(projectsRepo.getOwnedProject).mockResolvedValueOnce(ownedProject)
    vi.mocked(interiorsRepo.getInteriorPayload).mockResolvedValueOnce(validPayload)
    const req = new Request("http://localhost/api/v1/projects/proj-xyz/interior", {
      headers: { authorization: `Bearer ${token}` },
    })
    const res = await GET(req, ctx)
    expect(res.status).toBe(200)
    expect((await res.json()).versionId).toBe("ver-1")
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run "src/app/api/v1/projects/[id]/interior/route.test.ts"`
Expected: FAIL — `./route` not found.

- [ ] **Step 5: Write the route handler**

Create `src/app/api/v1/projects/[id]/interior/route.ts`:
```ts
import { requireUser } from "@/lib/server/auth-server"
import { getOwnedProject } from "@/lib/server/repo/projects"
import { getInteriorPayload, upsertInterior } from "@/lib/server/repo/interiors"
import { ok, err, handleError } from "@/lib/server/response"
import { savedInteriorSchema } from "@/lib/schemas/interior"

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const { userId } = await requireUser(request)
    const { id } = await ctx.params
    const project = await getOwnedProject(id, userId)
    if (!project) return err(404, "Project not found")

    const saved = await getInteriorPayload(id)
    return ok(saved)
  } catch (e) {
    return handleError(e)
  }
}

export async function PUT(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const { userId } = await requireUser(request)
    const { id } = await ctx.params
    const project = await getOwnedProject(id, userId)
    if (!project) return err(404, "Project not found")

    let raw: unknown
    try {
      raw = await request.json()
    } catch {
      return err(400, "Invalid JSON body")
    }
    const parsed = savedInteriorSchema.safeParse(raw)
    if (!parsed.success) return err(400, "Invalid interior payload")

    const saved = await upsertInterior(id, parsed.data.versionId, parsed.data)
    return ok(saved)
  } catch (e) {
    return handleError(e)
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run "src/app/api/v1/projects/[id]/interior/route.test.ts"`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
rtk git add db/migrations/0004_interior.sql src/lib/server/repo/interiors.ts "src/app/api/v1/projects/[id]/interior/route.ts" "src/app/api/v1/projects/[id]/interior/route.test.ts"
rtk git commit -m "feat(interior): project_interiors table, repo, and GET/PUT route

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Data-source wiring — contract, mock, http, hooks

**Files:**
- Modify: `src/lib/data/source.ts` (add 2 methods to `DataSource`)
- Modify: `src/lib/mock/index.ts` (add `db.interiors`, `getInterior`, `saveInterior`)
- Modify: `src/lib/data/index.ts` (wire mock methods into `mockSource`)
- Modify: `src/lib/data/http.ts` (add http impls)
- Modify: `src/lib/api/keys.ts` (add `interior` key)
- Modify: `src/lib/api/hooks.ts` (add `useInterior`, `useSaveInterior`)
- Test: `src/lib/mock/interior.test.ts`

**Interfaces:**
- Consumes: `SavedInterior` (Task 1).
- Produces:
  - `DataSource.getInterior(projectId): Promise<SavedInterior | null>`
  - `DataSource.saveInterior(projectId, payload: SavedInterior): Promise<SavedInterior>`
  - `useInterior(projectId)` query hook, `useSaveInterior(projectId)` mutation hook.
  - `queryKeys.interior(projectId)`.

- [ ] **Step 1: Write the failing test (mock round-trip)**

Create `src/lib/mock/interior.test.ts`:
```ts
import { describe, expect, it } from "vitest"

import { getInterior, saveInterior } from "@/lib/mock"
import type { SavedInterior } from "@/lib/schemas/interior"

const payload: SavedInterior = {
  schemaVersion: 1,
  versionId: "ver-1",
  style: "japandi",
  rooms: [{ roomId: "room-1", furniture: [] }],
}

describe("mock interior persistence", () => {
  it("returns null before any save", async () => {
    expect(await getInterior("proj-empty-interior")).toBeNull()
  })

  it("persists and returns the saved interior within the session", async () => {
    await saveInterior("proj-i1", payload)
    const got = await getInterior("proj-i1")
    expect(got?.style).toBe("japandi")
    expect(got?.versionId).toBe("ver-1")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/mock/interior.test.ts`
Expected: FAIL — `getInterior`/`saveInterior` not exported from `@/lib/mock`.

- [ ] **Step 3: Add the DataSource contract methods**

In `src/lib/data/source.ts`, add the import (top, with other type imports):
```ts
import type { SavedInterior } from "@/lib/schemas/interior"
```
Then add inside the `DataSource` interface, right after the `saveLayout` line:
```ts
  getInterior(projectId: string): Promise<SavedInterior | null>
  saveInterior(projectId: string, payload: SavedInterior): Promise<SavedInterior>
```

- [ ] **Step 4: Add the mock implementation**

In `src/lib/mock/index.ts`:

(a) Add the import near the other type imports:
```ts
import type { SavedInterior } from "@/lib/schemas/interior"
```
(b) Add an `interiors` map to the `db` object (after the `layouts` line):
```ts
  interiors: {} as Record<string, SavedInterior>,
```
(c) Add the two functions right after `saveLayout` (around line 255):
```ts
export async function getInterior(projectId: string): Promise<SavedInterior | null> {
  await delay(300)
  return db.interiors[projectId] ? structuredClone(db.interiors[projectId]) : null
}

export async function saveInterior(
  projectId: string,
  payload: SavedInterior
): Promise<SavedInterior> {
  await delay(250)
  db.interiors[projectId] = structuredClone(payload)
  return structuredClone(db.interiors[projectId])
}
```

- [ ] **Step 5: Wire mock into `mockSource`**

In `src/lib/data/index.ts`, add inside the `mockSource` object (after `saveLayout: mock.saveLayout,`):
```ts
  getInterior: mock.getInterior,
  saveInterior: mock.saveInterior,
```

- [ ] **Step 6: Run mock test to verify it passes**

Run: `npx vitest run src/lib/mock/interior.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Add the http implementation**

In `src/lib/data/http.ts`:

(a) Add to the type import block:
```ts
import type { SavedInterior } from "@/lib/schemas/interior"
```
(b) Add inside the `httpSource` object, after the `saveLayout` lines:
```ts
  getInterior: (id) =>
    req<SavedInterior | null>("GET", `/projects/${id}/interior`),
  saveInterior: (id, payload) =>
    req<SavedInterior>("PUT", `/projects/${id}/interior`, payload),
```

- [ ] **Step 8: Add the query key + hooks**

(a) In `src/lib/api/keys.ts`, add after the `layout` line:
```ts
  interior: (projectId: string) => ["interior", projectId] as const,
```
(b) In `src/lib/api/hooks.ts`, add to the type import from `@/lib/data/source` (it already imports `BriefChatTurn`):
```ts
import type { BriefChatTurn } from "@/lib/data/source"
import type { SavedInterior } from "@/lib/schemas/interior"
```
Then add after the `useSaveLayout` block (around line 188):
```ts
/* ----- interior ----- */

export function useInterior(projectId: string) {
  return useQuery({
    queryKey: queryKeys.interior(projectId),
    queryFn: () => data.getInterior(projectId),
    enabled: !!projectId,
    staleTime: Infinity, // editing is local; refetch would clobber the draft
  })
}

export function useSaveInterior(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: SavedInterior) => data.saveInterior(projectId, payload),
    onSuccess: (saved) => {
      qc.setQueryData(queryKeys.interior(projectId), saved)
    },
  })
}
```

- [ ] **Step 9: Typecheck + full mock test**

Run: `npx tsc --noEmit`
Expected: no errors (contract, mock, http, hooks all consistent).
Run: `npx vitest run src/lib/mock/interior.test.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
rtk git add src/lib/data/source.ts src/lib/mock/index.ts src/lib/data/index.ts src/lib/data/http.ts src/lib/api/keys.ts src/lib/api/hooks.ts src/lib/mock/interior.test.ts
rtk git commit -m "feat(interior): data-source getInterior/saveInterior + hooks

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Store hydration + dirty flag

**Files:**
- Modify: `src/stores/interior-store.ts`
- Test: `src/stores/interior-store.test.ts` (create if absent)

**Interfaces:**
- Consumes: `applySavedInterior` (Task 2), `SavedInterior` (Task 1).
- Produces (additions to `InteriorState`):
  - `dirty: boolean`
  - `markSaved(): void`
  - `load` gains optional `saved?: SavedInterior`; hydrates via `applySavedInterior` when `saved.versionId === layout.versionId`, else generates fresh. Sets `dirty: false` on load.
  - All mutating actions (`setStyle`, `moveFurniture`, `rotateFurniture`, `removeFurniture`, `addFurniture`, `resetRoom`) set `dirty: true`.

- [ ] **Step 1: Write the failing test**

Create `src/stores/interior-store.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest"

import { useInteriorStore } from "./interior-store"
import { generateInteriorPlan, toSavedInterior } from "@/lib/interior/plan"
import { makeLayout } from "@/test-utils/fixtures"

function reset() {
  useInteriorStore.setState({
    projectId: null,
    layout: null,
    plan: null,
    style: "modern_tropical",
    selectedRoomId: null,
    selectedFurnitureId: null,
    dirty: false,
  })
}

describe("interior-store persistence", () => {
  beforeEach(reset)

  it("hydrates from a saved interior instead of regenerating", () => {
    const layout = makeLayout()
    const basePlan = generateInteriorPlan(layout, { projectId: "p1", style: "japandi" })
    const saved = toSavedInterior(basePlan)
    // mutate saved so we can detect it was used
    saved.rooms[0].furniture = saved.rooms[0].furniture.slice(0, 1)

    useInteriorStore.getState().load({ projectId: "p1", layout, style: "modern_tropical", saved })

    const state = useInteriorStore.getState()
    expect(state.style).toBe("japandi") // saved style wins
    const room0 = state.plan!.rooms.find((r) => r.roomId === saved.rooms[0].roomId)!
    expect(room0.furniture.length).toBe(1)
    expect(state.dirty).toBe(false)
  })

  it("ignores a saved interior whose versionId does not match the layout", () => {
    const layout = makeLayout()
    const basePlan = generateInteriorPlan(layout, { projectId: "p1", style: "japandi" })
    const saved = toSavedInterior(basePlan)
    saved.versionId = "stale-version"
    saved.rooms[0].furniture = []

    useInteriorStore.getState().load({ projectId: "p1", layout, style: "modern_tropical", saved })

    const state = useInteriorStore.getState()
    const room0 = state.plan!.rooms[0]
    expect(room0.furniture.length).toBeGreaterThan(0) // regenerated, not the emptied saved
  })

  it("marks the store dirty after a mutation and clean after markSaved", () => {
    const layout = makeLayout()
    useInteriorStore.getState().load({ projectId: "p1", layout, style: "modern_tropical" })
    expect(useInteriorStore.getState().dirty).toBe(false)

    const room = useInteriorStore.getState().plan!.rooms[0]
    useInteriorStore.getState().rotateFurniture(room.roomId, room.furniture[0].id)
    expect(useInteriorStore.getState().dirty).toBe(true)

    useInteriorStore.getState().markSaved()
    expect(useInteriorStore.getState().dirty).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/stores/interior-store.test.ts`
Expected: FAIL — `load` ignores `saved`; `dirty`/`markSaved` undefined.

- [ ] **Step 3: Update the store**

In `src/stores/interior-store.ts`:

(a) Add to imports:
```ts
import { applySavedInterior } from "@/lib/interior/plan"
import type { SavedInterior } from "@/lib/schemas/interior"
```
(b) Add to the `InteriorState` type:
```ts
  dirty: boolean
```
and update the `load` signature:
```ts
  load: (opts: {
    projectId: string
    layout: DesignLayout
    style: InteriorStyleId
    initialRoomId?: string
    saved?: SavedInterior
  }) => void
  markSaved: () => void
```
(c) Add `dirty: false,` to the initial state (after `selectedFurnitureId: null,`).

(d) Replace the `load` implementation body with:
```ts
  load: ({ projectId, layout, style, initialRoomId, saved }) => {
    const current = get()
    if (current.projectId === projectId && current.layout?.id === layout.id && current.plan) {
      if (initialRoomId) set({ selectedRoomId: initialRoomId })
      return
    }
    const useSaved = saved && saved.versionId === layout.versionId
    const plan = useSaved
      ? applySavedInterior(layout, saved, { projectId })
      : generateInteriorPlan(layout, { projectId, versionId: layout.versionId, style })
    set({
      projectId,
      layout,
      plan,
      style: plan.style,
      selectedRoomId: initialRoomId ?? plan.rooms[0]?.roomId ?? null,
      selectedFurnitureId: null,
      dirty: false,
    })
  },

  markSaved: () => set({ dirty: false }),
```

(e) Add `dirty: true` to `setStyle`'s `set({...})` call (the object that sets `style`, `plan`, `selectedRoomId`, `selectedFurnitureId`) — add the line `dirty: true,`.

(f) In the `updateRoomPlan` helper's final `set({...})`, add `dirty: true,`:
```ts
  set({
    plan: {
      ...state.plan,
      rooms,
      totalEstimate,
      warnings: rooms.flatMap((item) => item.warnings),
    },
    dirty: true,
    ...after?.(nextRoom),
  })
```
(This covers `moveFurniture`, `rotateFurniture`, `removeFurniture`, `addFurniture`, `resetRoom` since they all go through `updateRoomPlan`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/stores/interior-store.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
rtk git add src/stores/interior-store.ts src/stores/interior-store.test.ts
rtk git commit -m "feat(interior): store hydration from saved + dirty tracking

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Autosave hook + status indicator + load wiring

**Files:**
- Create: `src/hooks/use-interior-autosave.ts`
- Test: `src/hooks/use-interior-autosave.test.tsx`
- Modify: `src/components/preview-3d/preview-3d-view.tsx` (load `saved` via `useInterior`; mount autosave; pass status to controls)
- Modify: `src/components/preview-3d/preview-controls.tsx` (render save-status indicator)

**Interfaces:**
- Consumes: `useInteriorStore` (`plan`, `dirty`, `markSaved`), `useSaveInterior` (Task 4), `toSavedInterior` (Task 2).
- Produces:
  - `type SaveStatus = "idle" | "saving" | "saved" | "error"`
  - `useInteriorAutosave(projectId: string): SaveStatus`

- [ ] **Step 1: Write the failing test**

Create `src/hooks/use-interior-autosave.test.tsx`:
```ts
import * as React from "react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

const saveInterior = vi.fn(async (_id: string, payload: unknown) => payload)
vi.mock("@/lib/data", () => ({
  data: {
    saveInterior: (id: string, payload: unknown) => saveInterior(id, payload),
    getInterior: vi.fn(async () => null),
  },
}))

import { useInteriorAutosave } from "./use-interior-autosave"
import { useInteriorStore } from "@/stores/interior-store"
import { generateInteriorPlan } from "@/lib/interior/plan"
import { makeLayout } from "@/test-utils/fixtures"

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe("useInteriorAutosave", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    saveInterior.mockClear()
    const layout = makeLayout()
    const plan = generateInteriorPlan(layout, { projectId: "p1", style: "modern_tropical" })
    useInteriorStore.setState({ projectId: "p1", layout, plan, dirty: false, style: "modern_tropical" })
  })
  afterEach(() => vi.useRealTimers())

  it("saves once after a debounce when the store turns dirty", async () => {
    renderHook(() => useInteriorAutosave("p1"), { wrapper })
    expect(saveInterior).not.toHaveBeenCalled()

    act(() => {
      useInteriorStore.setState({ dirty: true })
    })
    // before debounce elapses: no save
    act(() => { vi.advanceTimersByTime(500) })
    expect(saveInterior).not.toHaveBeenCalled()
    // after debounce: exactly one save
    await act(async () => { vi.advanceTimersByTime(400) })
    expect(saveInterior).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/hooks/use-interior-autosave.test.tsx`
Expected: FAIL — `./use-interior-autosave` not found.

- [ ] **Step 3: Write the hook**

Create `src/hooks/use-interior-autosave.ts`:
```ts
"use client"

import * as React from "react"

import { useInteriorStore } from "@/stores/interior-store"
import { useSaveInterior } from "@/lib/api/hooks"
import { toSavedInterior } from "@/lib/interior/plan"

export type SaveStatus = "idle" | "saving" | "saved" | "error"

/**
 * Debounced autosave for interior edits. Watches the store's `dirty` flag and,
 * 800ms after the last change, persists the current plan via useSaveInterior.
 */
export function useInteriorAutosave(projectId: string): SaveStatus {
  const plan = useInteriorStore((s) => s.plan)
  const dirty = useInteriorStore((s) => s.dirty)
  const markSaved = useInteriorStore((s) => s.markSaved)
  const save = useSaveInterior(projectId)
  const [status, setStatus] = React.useState<SaveStatus>("idle")

  const saveRef = React.useRef(save)
  saveRef.current = save

  React.useEffect(() => {
    if (!dirty || !plan) return
    const handle = setTimeout(() => {
      setStatus("saving")
      saveRef.current.mutate(toSavedInterior(plan), {
        onSuccess: () => {
          markSaved()
          setStatus("saved")
        },
        onError: () => setStatus("error"),
      })
    }, 800)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, plan])

  return status
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/hooks/use-interior-autosave.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Wire saved-load + autosave into Preview3DView**

In `src/components/preview-3d/preview-3d-view.tsx`:

(a) Add imports:
```ts
import { useInterior } from "@/lib/api/hooks"
import { useInteriorAutosave, type SaveStatus } from "@/hooks/use-interior-autosave"
```
(b) Inside `Preview3DView`, after the existing store selectors, add:
```ts
  const { data: saved, isLoading: savedLoading } = useInterior(project.id)
  const saveStatus = useInteriorAutosave(project.id)
```
(c) Replace the interior-loading effect (the second `useEffect`, the one calling `loadInterior`) so it waits for the saved query to settle and passes `saved`:
```ts
  React.useEffect(() => {
    if (savedLoading) return
    const firstInteriorRoom = interiorRooms(layout)[0]?.id
    const requestedRoom = initialRoomId ?? firstInteriorRoom
    loadInterior({
      projectId: project.id,
      layout,
      style: interiorStyleFromHouseStyle(project.style),
      initialRoomId: requestedRoom,
      saved: saved ?? undefined,
    })
    if (requestedRoom) selectPreviewRoom(requestedRoom)
  }, [initialRoomId, layout, loadInterior, project.id, project.style, selectPreviewRoom, saved, savedLoading])
```
(d) Pass `saveStatus` to both `PreviewControls` instances (mobile drawer + desktop aside):
```tsx
<PreviewControls layout={layout} project={project} saveStatus={saveStatus} />
```

- [ ] **Step 6: Render the status indicator in PreviewControls**

In `src/components/preview-3d/preview-controls.tsx`:

(a) Extend the props type and signature:
```ts
import type { SaveStatus } from "@/hooks/use-interior-autosave"

export function PreviewControls({
  layout,
  project,
  saveStatus,
}: {
  layout: DesignLayout
  project: Project
  saveStatus: SaveStatus
}) {
```
(b) In the header row (the `div` with `Preview 3D` heading, around line 103-108), replace the `Badge` with a status-aware cluster:
```tsx
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-semibold">Preview 3D</h2>
        <SaveIndicator status={saveStatus} />
      </div>
```
(c) Add the `SaveIndicator` component at the bottom of the file (next to the other helpers):
```tsx
function SaveIndicator({ status }: { status: SaveStatus }) {
  const map: Record<SaveStatus, { label: string; className: string }> = {
    idle: { label: "Tersimpan", className: "text-muted-foreground" },
    saving: { label: "Menyimpan…", className: "text-muted-foreground" },
    saved: { label: "Tersimpan", className: "text-success" },
    error: { label: "Gagal menyimpan", className: "text-destructive" },
  }
  const { label, className } = map[status]
  return (
    <span
      className={cn("text-xs font-medium", className)}
      data-testid="interior-save-status"
      aria-live="polite"
    >
      {label}
    </span>
  )
}
```

- [ ] **Step 7: Typecheck, build, full test suite**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npx vitest run`
Expected: all tests PASS (existing + new).
Run: `npm run build`
Expected: build succeeds (warnings about deprecated `middleware` convention are pre-existing and acceptable).

- [ ] **Step 8: Commit**

```bash
rtk git add src/hooks/use-interior-autosave.ts src/hooks/use-interior-autosave.test.tsx src/components/preview-3d/preview-3d-view.tsx src/components/preview-3d/preview-controls.tsx
rtk git commit -m "feat(interior): debounced autosave + save-status indicator, load saved plan

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Manual Verification (after all tasks)

1. Apply migration: run `db/migrations/0004_interior.sql` against the central DB.
2. Run app in http mode (`NEXT_PUBLIC_API_URL` + `DATABASE_URL` set).
3. Open `/app/projects/<id>/preview-3d`, pick a room, add/move/rotate furniture, change style.
4. Watch the indicator: `Menyimpan…` → `Tersimpan`.
5. **Reload the page** → the edited furniture/style persists (not regenerated).
6. Select a different alternative (new layout version) → interior regenerates fresh (no stale data).

## Notes / Risks

- In **mock mode** (no `NEXT_PUBLIC_API_URL`), autosave persists only in session memory — reload resets. Durable persistence requires http mode + applied migration. This is expected and matches how layout behaves today.
- `DesignLayout.interiors?` (`src/types/index.ts:307`) stays unused; not touched by this plan.
- Autosave is debounced (800ms) to avoid a write per ±0.25 m nudge.
