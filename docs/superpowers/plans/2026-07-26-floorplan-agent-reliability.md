# Floorplan Agent Reliability, Speed & Clarity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the floorplan AI agent's worst-case sequential LLM calls from 3 to 2, resolve small room-overlap conflicts deterministically instead of asking the LLM to re-guess coordinates, stop leaking raw x/y coordinates into user-facing failure messages, and show incremental progress while the agent works — all realizing `docs/superpowers/specs/2026-07-26-floorplan-agent-reliability-design.md`.

**Architecture:** Replace the two parallel floorplan LLM paths (`runFloorplanLoop`, up to 3 sequential full-prompt retries; `runFloorplanToolLoop`, an unverified opt-in tool-calling path) with one `runFloorplanAgentPass`: 1 LLM call → pure geometric reconciler (`reconcileOverlappingRooms`, new sibling of the existing `reflowFixes` solver) → at most 1 LLM revision → reconciler again → humanized clarify message if still blocked. Split the shared Agent Lab slug so JSON action-generation stops paying for the `thinking` reasoning mode meant for prose Q&A. Add SSE `progress` events end-to-end (server emit → `reqSSE` client parse → Zustand store → panel display).

**Tech Stack:** Next.js (App Router) / TypeScript / Zod / vitest (Baruma repo). No agent-lab code changes required — only a new agent config (ops/provisioning).

## Global Constraints

- **Credit spend/refund semantics unchanged** (spec §8): 1x charge per user turn, refund on `llmFailed`, regardless of how many internal LLM sub-calls (1 or 2) `runFloorplanAgentPass` makes.
- **Resilience contract unchanged**: `chatJSON`/`askAgentLab` still return `null` on any upstream failure; routes still fall back to `EDITOR_AGENT_FALLBACK`/`EDITOR_AGENT_FALLBACK_NO_LLM`.
- **Worst-case sequential `chatJSON` calls for a floorplan turn: 2, not 3** (spec §3, §DoD-6) — verified via mock call-count assertions, not just prose.
- **No raw coordinates in user-facing `reply` text** (spec §7) — `x:`/`y:` coordinate parentheticals must never reach the message a homeowner reads.
- **Reconciler bound**: `reconcileOverlappingRooms` only auto-applies a fix when the required displacement is ≤ 30% of the moved room's own shorter side (spec §4) — otherwise leave for the LLM revision / clarify path. Never touches `locked` rooms.
- **Non-goals**: interior mode (already single-shot, no retry loop), Santrenize, any other agent-lab consumer, agent-lab Python code (no changes needed — `LLMConfig`/`CompleteRequest` already support everything this plan needs).
- **Out of scope, do not touch**: `enrich-alternatives.ts`, the design-audit (`auditDesign`/`isDesignAuditIntent`) branch in both routes, `askAgentLab`/brief-mode prose path.

## File Map

- Modify: `src/lib/audit/reflow.ts` — add `reconcileOverlappingRooms`.
- Modify: `src/lib/audit/reflow.test.ts` — tests for it.
- Modify: `src/lib/server/editor-assistant.ts` — add `reconcileFloorplanOverlaps`, `humanizeViolations`.
- Modify: `src/lib/server/editor-assistant.test.ts` — tests for both.
- Modify: `src/lib/server/llm.ts` — split `AGENT_SLUG` into `PROSE_SLUG`/`ACTIONS_SLUG`; remove `chatWithTools`/`RawToolCall`.
- Modify: `src/lib/server/llm.test.ts` — update slug assertions; remove `chatWithTools` tests.
- Delete: `src/lib/assistant/llm-tools.ts`, `src/lib/assistant/llm-tools.test.ts`.
- Modify: `src/app/api/v1/projects/[id]/editor/assistant/route.ts` — new `runFloorplanAgentPass` replaces `runFloorplanLoop` + `runFloorplanToolLoop`; SSE `progress` events.
- Modify: `src/app/api/v1/projects/[id]/editor/assistant/route.test.ts` — mock updates, call-count fix.
- Modify: `src/app/api/v1/projects/[id]/agent/route.ts` — call `runFloorplanAgentPass`; SSE `progress` events.
- Modify: `src/app/api/v1/projects/[id]/agent/route.test.ts` — mock rename.
- Modify: `src/lib/data/http.ts` — `reqSSE` gains `onProgress`; forwarded by `sendProjectAgentMessage`/`sendAssistantMessage`.
- Create: `src/lib/data/http.test.ts`.
- Modify: `src/lib/data/source.ts` — `DataSource` interface gains optional `onProgress` params.
- Modify: `src/stores/project-agent-ui-store.ts` — add `progressMessage` + `setProgressMessage`.
- Modify: `src/lib/api/hooks.ts` — `useSendProjectAgentMessage` wires progress into the store.
- Modify: `src/components/assistant/project-agent-panel.tsx` — show `progressMessage` in the pending indicator.
- Modify: `docs/ARCHITECTURE.md` — remove the stale "LLM_TOOLS opt-in belum sepenuhnya diverifikasi" line.

---

### Task 1: `reconcileOverlappingRooms` — deterministic pairwise overlap solver

**Files:**
- Modify: `src/lib/audit/reflow.ts` (append after `reflowFixes`)
- Test: `src/lib/audit/reflow.test.ts` (append)

**Interfaces:**
- Consumes: existing local helpers in `reflow.ts` (`rectsIntersect`, `meetsOwnStandard`, `round2`, `Rect`, `SceneRoom`, `sanitationObstaclesForFloor`, `ROOM_STANDARDS`).
- Produces: `export type OverlapReconcileResult = { actions: FloorplanAction[]; resolvedPairs: [string, string][]; stillBlocked: [string, string][] }` and `export function reconcileOverlappingRooms(scene: FloorplanScene, proposedRooms: SceneRoom[]): OverlapReconcileResult`. Consumed by Task 2.

- [ ] **Step 1: Write the failing tests** — first update the import line at the top of `src/lib/audit/reflow.test.ts`:

```typescript
import { reflowFixes, reconcileOverlappingRooms } from "./reflow"
```

Then append this new `describe` block:

```typescript
describe("reconcileOverlappingRooms — memisahkan ruang yang saling bertabrakan", () => {
  it("shrinks the room with more slack above its own standard, leaving the tighter room untouched", () => {
    // void1 (no SNI standard) overlaps kt (kamar_tidur, 16 m² — far above the
    // 9 m² minimum) by 1 m on the x axis. void1 has "infinite" slack (no
    // standard at all) so it yields; kt stays exactly where it was.
    const s = scene([
      r("void1", "void", 0, 0, 4, 4),
      r("kt", "kamar_tidur", 3, 0, 4, 4),
    ])
    const out = reconcileOverlappingRooms(s, s.rooms)

    expect(out.resolvedPairs).toEqual([["void1", "kt"]])
    expect(out.stillBlocked).toEqual([])
    const ktPatch = out.actions.find((a) => a.type === "updateRoom" && a.roomId === "kt")
    expect(ktPatch).toBeUndefined() // kt untouched
    const voidPatch = out.actions.find((a) => a.type === "updateRoom" && a.roomId === "void1")
    expect(voidPatch).toBeDefined()
    if (voidPatch?.type === "updateRoom") {
      expect(voidPatch.patch).toEqual({ x: 0, y: 0, width: 3, depth: 4 })
    }
  })

  it("leaves a pair unresolved when required displacement exceeds 30% of the moved room's short side", () => {
    // Two 3x3 kamar_tidur (exactly at their 9 m² minimum, zero slack each)
    // overlap by 2 m on the x axis — 2/3 = 66% of the short side, way over
    // the 30% cap on BOTH sides. Neither can safely absorb the fix.
    const s = scene([
      r("kt1", "kamar_tidur", 0, 0, 3, 3),
      r("kt2", "kamar_tidur", 1, 0, 3, 3),
    ])
    const out = reconcileOverlappingRooms(s, s.rooms)

    expect(out.stillBlocked).toEqual([["kt1", "kt2"]])
    expect(out.actions).toEqual([])
  })

  it("never moves a locked room, even when it has more slack", () => {
    // locked1 (locked, would otherwise be preferred — same slack as kt2) is
    // skipped; kt2 absorbs the 0.8 m x-axis overlap instead (20% of its 4 m
    // short side — within the 30% cap).
    const s = scene([
      r("locked1", "kamar_tidur", 0, 0, 4, 4, true),
      r("kt2", "kamar_tidur", 3.2, 0, 4, 4),
    ])
    const out = reconcileOverlappingRooms(s, s.rooms)

    expect(out.resolvedPairs).toEqual([["locked1", "kt2"]])
    const lockedPatch = out.actions.find((a) => a.type === "updateRoom" && a.roomId === "locked1")
    expect(lockedPatch).toBeUndefined()
    const kt2Patch = out.actions.find((a) => a.type === "updateRoom" && a.roomId === "kt2")
    expect(kt2Patch).toBeDefined()
    if (kt2Patch?.type === "updateRoom") {
      expect(kt2Patch.patch).toEqual({ x: 4, y: 0, width: 3.2, depth: 4 })
    }
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd "d:/Ngoding/expr/VibeCoding.id/Baruma" && npx vitest run src/lib/audit/reflow.test.ts`
Expected: FAIL — `reconcileOverlappingRooms is not a function` (or import error).

- [ ] **Step 3: Append the implementation to `src/lib/audit/reflow.ts`** (after the closing brace of `reflowFixes`, same file — reuses `Rect`, `SceneRoom`, `EPS`, `round2`, `rectsIntersect`, `meetsOwnStandard`, `sanitationObstaclesForFloor`, `ROOM_STANDARDS`, `RoomType` already imported/defined above in this file):

```typescript
export type OverlapReconcileResult = {
  actions: FloorplanAction[]
  /** Pairs [roomIdA, roomIdB] successfully separated. */
  resolvedPairs: [string, string][]
  /** Pairs where no safe fix was found within the displacement bound. */
  stillBlocked: [string, string][]
}

type Axis = "x" | "y"

/** Fraction of a room's own short side it may be displaced by, at most —
 *  keeps the reconciler from silently making large, surprising layout
 *  changes; anything bigger is left for the LLM revision / clarify path. */
const MAX_DISPLACEMENT_RATIO = 0.3

function overlapAmount(a: Rect, b: Rect): { axis: Axis; amount: number } | null {
  const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const overlapY = Math.min(a.y + a.depth, b.y + b.depth) - Math.max(a.y, b.y)
  if (overlapX <= EPS || overlapY <= EPS) return null
  return overlapX <= overlapY ? { axis: "x", amount: overlapX } : { axis: "y", amount: overlapY }
}

/** Slack above a room's own SNI minimum area — bigger slack, safer to shrink.
 *  Rooms with no standard (void, gudang, taman, ...) sort first (Infinity). */
function roomSlack(room: SceneRoom, rect: Rect): number {
  const spec = ROOM_STANDARDS[room.type as RoomType]
  if (!spec) return Infinity
  return rect.width * rect.depth - spec.minAreaM2
}

/** Shrink `mover` away from `anchor` along `axis` by `by` metres — the edge
 *  nearer the overlap recedes; the far edge is fixed, so the room's
 *  footprint only shrinks, never relocates into new territory. */
function pushAway(mover: Rect, anchor: Rect, axis: Axis, by: number): Rect {
  if (axis === "x") {
    return mover.x < anchor.x
      ? { ...mover, width: round2(mover.width - by) }
      : { ...mover, x: round2(mover.x + by), width: round2(mover.width - by) }
  }
  return mover.y < anchor.y
    ? { ...mover, depth: round2(mover.depth - by) }
    : { ...mover, y: round2(mover.y + by), depth: round2(mover.depth - by) }
}

function withinBounds(rect: Rect, site: { widthM: number; depthM: number }): boolean {
  return (
    rect.x >= -EPS &&
    rect.y >= -EPS &&
    rect.x + rect.width <= site.widthM + EPS &&
    rect.y + rect.depth <= site.depthM + EPS
  )
}

/** Try to separate one overlapping pair. Returns the single room that moved
 *  (with its corrected rect), or null when neither candidate is safe. */
function resolvePairOverlap(
  a: SceneRoom,
  rectA: Rect,
  b: SceneRoom,
  rectB: Rect,
  scene: FloorplanScene,
  sanitation: Rect[],
): { room: SceneRoom; rect: Rect } | null {
  const overlap = overlapAmount(rectA, rectB)
  if (!overlap) return null

  // Prefer moving whichever room has more slack above its own standard —
  // protect the room that's already closer to its SNI floor.
  const candidates = [
    { mover: a, moverRect: rectA, anchor: rectB, slack: roomSlack(a, rectA) },
    { mover: b, moverRect: rectB, anchor: rectA, slack: roomSlack(b, rectB) },
  ].sort((x, y) => y.slack - x.slack)

  for (const { mover, moverRect, anchor } of candidates) {
    if (mover.locked) continue
    const shortSide = Math.min(moverRect.width, moverRect.depth)
    if (overlap.amount > shortSide * MAX_DISPLACEMENT_RATIO) continue

    const moved = pushAway(moverRect, anchor, overlap.axis, overlap.amount)
    if (moved.width <= EPS || moved.depth <= EPS) continue
    if (!meetsOwnStandard(mover, moved)) continue
    if (!withinBounds(moved, scene.site)) continue
    if (sanitation.some((s) => rectsIntersect(moved, s))) continue

    return { room: mover, rect: moved }
  }
  return null
}

/**
 * Deterministic sibling of `reflowFixes`: where that solver grows ONE
 * undersized room by shrinking a neighbour, this one separates TWO rooms
 * that a proposal (usually the LLM's own) left overlapping each other.
 * Pure, synchronous, no DB/LLM — safe to run on every floorplan proposal
 * before ever asking the model to re-guess coordinates.
 */
export function reconcileOverlappingRooms(
  scene: FloorplanScene,
  proposedRooms: SceneRoom[],
): OverlapReconcileResult {
  const actions: FloorplanAction[] = []
  const resolvedPairs: [string, string][] = []
  const stillBlocked: [string, string][] = []
  const rectById = new Map<string, Rect>(
    proposedRooms.map((r) => [r.id, { x: r.x, y: r.y, width: r.width, depth: r.depth }]),
  )

  const byFloor = new Map<string, SceneRoom[]>()
  for (const room of proposedRooms) {
    const list = byFloor.get(room.floorId) ?? []
    list.push(room)
    byFloor.set(room.floorId, list)
  }

  for (const [floorId, list] of byFloor) {
    const sanitation = sanitationObstaclesForFloor(scene, floorId)
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]
        const b = list[j]
        const rectA = rectById.get(a.id)!
        const rectB = rectById.get(b.id)!
        if (!rectsIntersect(rectA, rectB)) continue

        const fixed = resolvePairOverlap(a, rectA, b, rectB, scene, sanitation)
        if (fixed) {
          rectById.set(fixed.room.id, fixed.rect)
          actions.push({
            type: "updateRoom",
            roomId: fixed.room.id,
            patch: { x: fixed.rect.x, y: fixed.rect.y, width: fixed.rect.width, depth: fixed.rect.depth },
          })
          resolvedPairs.push([a.id, b.id])
        } else {
          stillBlocked.push([a.id, b.id])
        }
      }
    }
  }

  return { actions, resolvedPairs, stillBlocked }
}
```

Also add `FloorplanAction` to the existing type-only import at the top of `reflow.ts` if not already present (it already imports `type { FloorplanAction, FloorplanScene } from "@/lib/assistant/actions"` — no change needed there).

- [ ] **Step 4: Run to verify it passes**

Run: `cd "d:/Ngoding/expr/VibeCoding.id/Baruma" && npx vitest run src/lib/audit/reflow.test.ts`
Expected: PASS — all reflow tests green (existing `reflowFixes` tests + the 3 new ones).

- [ ] **Step 5: Commit**

```bash
cd "d:/Ngoding/expr/VibeCoding.id/Baruma"
git add src/lib/audit/reflow.ts src/lib/audit/reflow.test.ts
git commit -m "feat(floorplan): deterministic pairwise overlap reconciler (reconcileOverlappingRooms)"
```

---

### Task 2: `reconcileFloorplanOverlaps` — scene/action orchestration wrapper

**Files:**
- Modify: `src/lib/server/editor-assistant.ts` (append near `findFloorplanActionFeedback`)
- Test: `src/lib/server/editor-assistant.test.ts` (append)

**Interfaces:**
- Consumes: `reconcileOverlappingRooms` (Task 1, `@/lib/audit/reflow`), `simulateFloorplanActions`, `findFloorplanActionFeedback` (both already in this file).
- Produces: `export function reconcileFloorplanOverlaps(scene: FloorplanScene, actions: FloorplanAction[], instruction: string): { actions: FloorplanAction[]; remainingViolations: string[] }`. Consumed by Task 6.

- [ ] **Step 1: Write the failing tests** — first add `reconcileFloorplanOverlaps` and `humanizeViolations` to the existing top-of-file import from `"./editor-assistant"`:

```typescript
import {
  buildMessages,
  findFloorplanActionFeedback,
  findFloorplanViolations,
  humanizeViolations,
  reconcileFloorplanOverlaps,
  sanitizeActions,
  simulateFloorplanActions,
  simulateSanitation,
  summarizeFloorplanIssues,
} from "./editor-assistant"
```

Then append this fixture and the new `describe` blocks (reuses the file's existing `fpScene`-style fixture conventions; adds a floorplan scene with two rooms):

```typescript
const overlapScene: FloorplanScene = {
  site: { widthM: 10, depthM: 10 },
  floors: [{ id: "f1", name: "Lantai 1", level: 1 }],
  selectedFloorId: "f1",
  selectedRoomId: null,
  rooms: [
    { id: "void1", name: "Void", type: "void", floorId: "f1", x: 0, y: 0, width: 4, depth: 4, areaM2: 16, locked: false },
    { id: "kt", name: "Kamar Tidur", type: "kamar_tidur", floorId: "f1", x: 5, y: 0, width: 4, depth: 4, areaM2: 16, locked: false },
  ],
  openings: [],
}

describe("reconcileFloorplanOverlaps", () => {
  it("merges a deterministic fix into the action list and clears the violation", () => {
    // Proposal moves void1 so its right edge lands 1m into kt (void1 becomes
    // 2..6, kt stays 5..9 → 1m x-axis overlap) — resolvable by shrinking
    // void1 (no standard, unlimited slack).
    const overlapping: FloorplanAction[] = [
      { type: "updateRoom", roomId: "void1", patch: { x: 2 } },
    ]

    const result = reconcileFloorplanOverlaps(overlapScene, overlapping, "geser void")

    expect(result.remainingViolations).toEqual([])
    // Original proposal action is preserved, plus a corrective patch for void1.
    expect(result.actions).toContainEqual({ type: "updateRoom", roomId: "void1", patch: { x: 2 } })
    const corrective = result.actions.filter(
      (a) => a.type === "updateRoom" && a.roomId === "void1" && "width" in (a.patch ?? {}),
    )
    expect(corrective.length).toBe(1)
  })

  it("returns the original violations untouched when the overlap is too large to reconcile", () => {
    const bigOverlap: FloorplanAction[] = [
      { type: "updateRoom", roomId: "kt", patch: { x: 0 } }, // kt 0..4 vs void1 0..4 → fully overlapping, both same standard-less/standard
    ]
    const result = reconcileFloorplanOverlaps(overlapScene, bigOverlap, "tumpuk penuh")

    expect(result.remainingViolations.length).toBeGreaterThan(0)
    expect(result.remainingViolations[0]).toContain("tumpang-tindih")
  })
})

describe("humanizeViolations", () => {
  it("strips x/y coordinate parentheticals but keeps room names and surrounding text", () => {
    const content = humanizeViolations([
      '"Kamar Mandi 1" (x:4.85, y:9.17, 2.87×2.55m) & "Workspace" (x:3.28, y:6.55, 4.44×3.42m) tumpang-tindih',
    ])
    expect(content).not.toContain("x:4.85")
    expect(content).not.toContain("y:9.17")
    const parsed = JSON.parse(content)
    expect(parsed.reply).toContain("Kamar Mandi 1")
    expect(parsed.reply).toContain("Workspace")
    expect(parsed.reply).toContain("tumpang-tindih")
  })

  it("offers room names as needs_clarify suggestion chips", () => {
    const content = humanizeViolations([
      '"Kamar Mandi 1" (x:4.85, y:9.17, 2.87×2.55m) & "Workspace" (x:3.28, y:6.55, 4.44×3.42m) tumpang-tindih',
    ])
    const parsed = JSON.parse(content)
    expect(parsed.needs_clarify[0].suggestions).toEqual(["Kamar Mandi 1", "Workspace"])
  })

  it("keeps non-coordinate context verbatim (sanitation-overlap messages have no parens)", () => {
    const content = humanizeViolations(['"Kamar Mandi 1" bertumpuk dengan sumur resapan'])
    expect(content).toContain("belum berhasil")
    expect(content).toContain("sumur resapan")
  })

  it("falls back to plain text (no clarify chips) when no room name is quotable", () => {
    const content = humanizeViolations(["ruang tidak cukup untuk sirkulasi"])
    expect(content).toContain("belum berhasil")
    expect(() => JSON.parse(content)).toThrow()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/server/editor-assistant.test.ts`
Expected: FAIL — `reconcileFloorplanOverlaps`/`humanizeViolations` not exported.

- [ ] **Step 3: Implement in `src/lib/server/editor-assistant.ts`** — add the import and the two functions near `findFloorplanActionFeedback`:

Add to the top import block:
```typescript
import { reconcileOverlappingRooms } from "@/lib/audit/reflow"
```

Append after `findFloorplanActionFeedback`:
```typescript
/**
 * Runs the deterministic pairwise-overlap reconciler over a proposed action
 * list and re-validates for real — so the caller learns, in one call,
 * whether the proposal is now clean or still needs an LLM revision.
 */
export function reconcileFloorplanOverlaps(
  scene: FloorplanScene,
  actions: FloorplanAction[],
  instruction: string,
): { actions: FloorplanAction[]; remainingViolations: string[] } {
  const rooms = simulateFloorplanActions(actions, scene)
  const { actions: patchActions } = reconcileOverlappingRooms(scene, rooms)
  const merged = [...actions, ...patchActions]
  const remainingViolations = findFloorplanActionFeedback(scene, merged, instruction)
  return { actions: merged, remainingViolations }
}

const COORD_PAREN_RE = /\s*\([^()]*\bx:[^()]*\)/gi
const QUOTED_NAME_RE = /"([^"]+)"/g

/**
 * Turns internal violation strings (built for the LLM, with raw x/y/width/
 * depth) into a homeowner-readable message: coordinates stripped, room
 * names kept, offered as tappable needs_clarify chips (same JSON-content
 * convention as `clarificationReply` in project-agent.ts) when any are found.
 */
export function humanizeViolations(violations: string[]): string {
  const cleaned = violations.map((v) => v.replace(COORD_PAREN_RE, "").replace(/\s{2,}/g, " ").trim())
  const names = [...new Set(cleaned.flatMap((v) => [...v.matchAll(QUOTED_NAME_RE)].map((m) => m[1])))]
  const body = cleaned.join("; ")
  const reply =
    `Saya belum berhasil menata ini tanpa tumpang-tindih (${body}). ` +
    "Coba perintah yang lebih spesifik — misalnya sebutkan ruang mana yang boleh saya perkecil atau pindahkan untuk memberi ruang."
  if (names.length === 0) return reply
  return JSON.stringify({
    reply,
    needs_clarify: [{ question: "Ruang mana yang boleh diperkecil/dipindah?", suggestions: names }],
  })
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/server/editor-assistant.test.ts`
Expected: PASS — all editor-assistant tests green.

- [ ] **Step 5: Commit**

```bash
cd "d:/Ngoding/expr/VibeCoding.id/Baruma"
git add src/lib/server/editor-assistant.ts src/lib/server/editor-assistant.test.ts
git commit -m "feat(floorplan): reconcileFloorplanOverlaps + humanizeViolations (no coordinates to end-user)"
```

---

### Task 3: Split Agent Lab slug (`PROSE_SLUG`/`ACTIONS_SLUG`); retire `chatWithTools`

**Files:**
- Modify: `src/lib/server/llm.ts`
- Modify: `src/lib/server/llm.test.ts`

**Interfaces:**
- Produces: `chatJSON` now posts to slug `baruma-floorplan-actions`; `chatText` still posts to `baruma-assistant`. `chatWithTools` and `RawToolCall` removed (verified unused outside this file).

- [ ] **Step 1: Update the failing/changed tests** — in `src/lib/server/llm.test.ts`:

Replace the URL assertion in `"parses JSON returned by Agent Lab"`:
```typescript
    expect(url).toBe("http://lab.local/v1/agents/baruma-floorplan-actions/complete")
```

Add a new test proving the slugs differ, right after the `chatText` test:
```typescript
  it("chatText uses the prose slug, distinct from chatJSON's actions slug", async () => {
    fetchMock.mockResolvedValue(response({ content: "halo", tool_calls: [] }))
    await chatText([{ role: "user", content: "x" }])
    const [url] = fetchMock.mock.calls[0]
    expect(url).toBe("http://lab.local/v1/agents/baruma-assistant/complete")
  })
```

Delete the entire `describe("chatWithTools through Agent Lab", ...)` block (both of its `it(...)` cases) and its import of `chatWithTools`:
```typescript
import { chatJSON, chatText, chatWithTools, llmEnabled } from "./llm"
```
becomes:
```typescript
import { chatJSON, chatText, llmEnabled } from "./llm"
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/server/llm.test.ts`
Expected: FAIL — URL mismatch (`chatJSON` still posts to `baruma-assistant`) and/or `chatWithTools` still exported (harmless but the deleted-test import would now be unused — TypeScript won't fail the test run for that, only the URL assertion needs to fail first).

- [ ] **Step 3: Modify `src/lib/server/llm.ts`**

Replace:
```typescript
const AGENT_SLUG = "baruma-assistant"
```
with:
```typescript
/** Prose Q&A (brief/knowledge advisory) — thinking ENABLED in Agent Lab for
 *  reasoning-quality answers. */
const PROSE_SLUG = "baruma-assistant"
/** Structured JSON action generation (floorplan/interior edits) — thinking
 *  DISABLED in Agent Lab; the hidden reasoning tokens a "thinking" model
 *  spends only compete with the JSON output budget and add latency, without
 *  helping a task that's really "follow the rules and emit valid actions". */
const ACTIONS_SLUG = "baruma-floorplan-actions"
```

In `chatJSON`, change:
```typescript
  const result = await completeAgentLab(AGENT_SLUG, {
    userId: SYSTEM_USER_ID,
    messages,
    responseFormat: "json",
  })
```
to:
```typescript
  const result = await completeAgentLab(ACTIONS_SLUG, {
    userId: SYSTEM_USER_ID,
    messages,
    responseFormat: "json",
  })
```

In `chatText`, change:
```typescript
  const result = await completeAgentLab(AGENT_SLUG, {
    userId: SYSTEM_USER_ID,
    messages,
    responseFormat: "text",
  })
```
to:
```typescript
  const result = await completeAgentLab(PROSE_SLUG, {
    userId: SYSTEM_USER_ID,
    messages,
    responseFormat: "text",
  })
```

Delete the `chatWithTools` function entirely, its `export type RawToolCall = AgentLabToolCall` line, and drop `AgentLabToolCall` from the `agent-lab` import if it's now unused in this file (it isn't used elsewhere in `llm.ts` once `RawToolCall`/`chatWithTools` are gone — confirm no other reference remains before removing the import).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/server/llm.test.ts`
Expected: PASS — all llm.ts tests green (chatJSON → actions slug, chatText → prose slug).

- [ ] **Step 5: Commit**

```bash
cd "d:/Ngoding/expr/VibeCoding.id/Baruma"
git add src/lib/server/llm.ts src/lib/server/llm.test.ts
git commit -m "feat(agent-lab): split prose vs actions slug (thinking off for JSON action generation)"
```

---

### Task 4: Retire the unverified tool-calling scaffolding

**Files:**
- Delete: `src/lib/assistant/llm-tools.ts`
- Delete: `src/lib/assistant/llm-tools.test.ts`

**Interfaces:** Nothing outside this pair of files references `FLOORPLAN_TOOLS`/`dispatchFloorplanTool` once Task 6 removes the last call site (`editor/assistant/route.ts`). This task only removes the files themselves; Task 6 removes the import.

- [ ] **Step 1: Confirm no other consumers before deleting**

Run: `cd "d:/Ngoding/expr/VibeCoding.id/Baruma" && grep -rn "llm-tools\|FLOORPLAN_TOOLS\|dispatchFloorplanTool" src --include="*.ts" --include="*.tsx" | grep -v "src/lib/assistant/llm-tools"`
Expected output: only `src/app/api/v1/projects/[id]/editor/assistant/route.ts` (removed in Task 6, which must run before or together with this deletion so the build doesn't break — do Task 6's import removal FIRST if executing tasks strictly in order would otherwise leave a dangling import; since this plan executes Task 4 before Task 6, hold this deletion's commit until immediately after Task 6's Step 3, OR do Steps 1-2 here now and defer Steps 3-5 (actual `rm` + commit) until Task 6 is done. Simplest: skip ahead and perform this deletion as part of Task 6 instead of a standalone commit — see Task 6 Step 3, which deletes these two files as part of its own diff.**

This task is a no-op placeholder folded into Task 6 (see Task 6 Step 3's file deletions) — do not create a separate commit here. Proceed to Task 5.

---

### Task 5: `runFloorplanAgentPass` — consolidated pipeline + SSE progress (editor/assistant route)

**Files:**
- Modify: `src/app/api/v1/projects/[id]/editor/assistant/route.ts`
- Modify: `src/app/api/v1/projects/[id]/editor/assistant/route.test.ts`
- Delete: `src/lib/assistant/llm-tools.ts`, `src/lib/assistant/llm-tools.test.ts` (folded in from Task 4)

**Interfaces:**
- Consumes: `reconcileFloorplanOverlaps`, `humanizeViolations` (Task 2); `chatJSON` (Task 3, now on `ACTIONS_SLUG`).
- Produces: `export async function runFloorplanAgentPass(scene: FloorplanScene, instruction: string, history: AssistantTurn[], knowledgeNote?: string, mechanicsNote?: string, assetNote?: string, brief?: Brief | null, reqStartTime?: number, onProgress?: (message: string) => void): Promise<{ reply: string; actions: FloorplanAction[]; rawContent?: string; llmFailed?: boolean }>`. Replaces `runFloorplanLoop` + `runFloorplanToolLoop` (both removed). Consumed by Task 6 (`agent/route.ts`).

- [ ] **Step 1: Update the failing test** — in `src/app/api/v1/projects/[id]/editor/assistant/route.test.ts`:

Add `reconcileFloorplanOverlaps` and `humanizeViolations` to the `editor-assistant` mock factory, with sensible defaults set in `beforeEach`:

```typescript
vi.mock("@/lib/server/editor-assistant", () => ({
  buildContextFromMessages: vi.fn(() => []),
  buildMessages: vi.fn(() => []),
  buildRevisionMessage: vi.fn(() => ""),
  findFloorplanActionFeedback: vi.fn(() => []),
  findFloorplanViolations: vi.fn(() => []),
  sanitizeActions: vi.fn(() => []),
  simulateFloorplanActions: vi.fn(() => ({})),
  simulateSanitation: vi.fn(() => undefined),
  reconcileFloorplanOverlaps: vi.fn(),
  humanizeViolations: vi.fn(),
}))
```

In `beforeEach`, after the existing reset/default block, add:
```typescript
  vi.mocked(editorAssistantLib.reconcileFloorplanOverlaps).mockReset()
  vi.mocked(editorAssistantLib.humanizeViolations).mockReset()
  // Default: reconciliation "succeeds" (no remaining violations) so tests
  // that don't care about the overlap-retry path never reach a 2nd chatJSON
  // call. Tests exercising the exhaustion path override this explicitly.
  vi.mocked(editorAssistantLib.reconcileFloorplanOverlaps).mockImplementation((_scene, actions) => ({
    actions,
    remainingViolations: [],
  }))
  // Default mirrors the OLD hardcoded fallback text byte-for-byte so existing
  // content assertions keep passing without change.
  vi.mocked(editorAssistantLib.humanizeViolations).mockImplementation(
    (violations: string[]) =>
      `Saya belum berhasil menata ini tanpa tumpang-tindih (${violations.join("; ")}). ` +
      "Coba perintah yang lebih spesifik — misalnya sebutkan ruang mana yang boleh saya perkecil atau pindahkan untuk memberi ruang.",
  )
```

In the `"refuses (no actions) instead of applying a still-broken proposal..."` test, add an explicit override right after the existing `findFloorplanActionFeedback` override, and change the call-count assertion:

```typescript
    vi.mocked(editorAssistantLib.findFloorplanActionFeedback).mockReturnValue([
      '"Kamar Mandi 1" bertumpuk dengan sumur resapan',
    ])
    vi.mocked(editorAssistantLib.reconcileFloorplanOverlaps).mockReturnValue({
      actions: [{ type: "updateRoom", roomId: "r2", patch: { x: 5, y: 5 } }],
      remainingViolations: ['"Kamar Mandi 1" bertumpuk dengan sumur resapan'],
    })
```
and:
```typescript
    // Tried the initial attempt + exactly ONE revision (not 3) — the
    // deterministic reconciler runs between them at no LLM cost.
    expect(vi.mocked(llm.chatJSON)).toHaveBeenCalledTimes(2)
```
(replacing the old `toHaveBeenCalledTimes(3)`).

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run "src/app/api/v1/projects/[id]/editor/assistant/route.test.ts"`
Expected: FAIL — mock factory references `reconcileFloorplanOverlaps`/`humanizeViolations` which don't exist yet on the real module (TypeScript/vitest mock shape mismatch) and the call-count assertion doesn't match the still-3x old implementation.

- [ ] **Step 3: Modify `src/app/api/v1/projects/[id]/editor/assistant/route.ts`**

Update the import list at the top — remove `chatWithTools` and the `llm-tools` import, add the two new editor-assistant functions:
```typescript
import { type ChatMsg, chatJSON, llmEnabled, sanitizeJsonString } from "@/lib/server/llm";
```
(drop `chatWithTools`). Delete this line entirely:
```typescript
import { FLOORPLAN_TOOLS, dispatchFloorplanTool } from "@/lib/assistant/llm-tools";
```
Add to the `editor-assistant` import:
```typescript
import {
  buildContextFromMessages,
  buildMessages,
  buildRevisionMessage,
  findFloorplanActionFeedback,
  reconcileFloorplanOverlaps,
  humanizeViolations,
  sanitizeActions,
} from "@/lib/server/editor-assistant";
```

Replace the `POST` function's stream `start()` body to add a progress emitter and thread it through:
```typescript
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  const reqClone = request.clone()
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const sendPing = setInterval(() => {
        controller.enqueue(encoder.encode('data: {"type":"ping"}\n\n'))
      }, 5000)
      const emitProgress = (message: string) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "progress", message })}\n\n`))
        } catch {
          /* stream may already be closing; progress is best-effort */
        }
      }

      try {
        const response = await runLogic(reqClone, ctx, emitProgress)
        if (response.status >= 400) {
          const body = await response.json().catch(() => null)
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: body?.error ?? 'Error', status: response.status })}\n\n`))
        } else {
          const body = await response.json()
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'result', data: body })}\n\n`))
        }
      } catch (e: any) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: e?.message ?? String(e) })}\n\n`))
      } finally {
        clearInterval(sendPing)
        controller.close()
      }
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive'
    }
  })
}
```

Change `runLogic`'s signature to accept the emitter:
```typescript
async function runLogic(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
  onProgress?: (message: string) => void,
): Promise<Response> {
```

In `runLogic`'s floorplan branch, replace this whole block (the `let res: ...` through the `res.llmFailed` assignment — everything from `const reqStartTime = Date.now()` down to `llmFailed = !!res.llmFailed;`):
```typescript
          const reqStartTime = Date.now();
          const planNote = await sceneKnowledgeNote(scene, llmInstruction);
          const mechNote = await appMechanicsNote(llmInstruction);
          let res: { reply: string; actions: unknown[]; rawContent?: string; llmFailed?: boolean } | null = null;
          
          if (process.env.LLM_TOOLS === "1") {
            res = await runFloorplanToolLoop(scene as FloorplanScene, llmInstruction, history, planNote, mechNote, undefined, undefined, reqStartTime);
          }
          
          // If tool loop failed/returned null, only fallback to self-correction loop
          // if we have enough time before Cloudflare's 60s timeout (need at least 25s for another LLM call).
          if (!res && Date.now() - reqStartTime < 90000) {
            res = await runFloorplanLoop(
              scene as FloorplanScene,
              llmInstruction,
              history,
              planNote,
              mechNote,
              undefined,
              undefined,
              reqStartTime
            );
          } else if (!res) {
            // Out of time to retry, return fallback immediately
            res = { reply: EDITOR_AGENT_FALLBACK, actions: [], llmFailed: true };
          }
          
          reply = res.rawContent ?? res.reply;
          actions = res.actions as any;
          llmFailed = !!res.llmFailed;
```
with:
```typescript
          const reqStartTime = Date.now();
          const planNote = await sceneKnowledgeNote(scene, llmInstruction);
          const mechNote = await appMechanicsNote(llmInstruction);
          const res = await runFloorplanAgentPass(
            scene as FloorplanScene,
            llmInstruction,
            history,
            planNote,
            mechNote,
            undefined,
            undefined,
            reqStartTime,
            onProgress,
          );
          reply = res.rawContent ?? res.reply;
          actions = res.actions as any;
          llmFailed = !!res.llmFailed;
```

Delete the entire `extractJsonObject` function and its `repairAndExtractJson` import comment block (the section starting `/** Extract the first {...} JSON object ... */` through the end of the `extractJsonObject` function body), and delete the entire `runFloorplanToolLoop` function.

Replace `runFloorplanLoop` entirely with `runFloorplanAgentPass`:
```typescript
/**
 * One floorplan agent turn: an initial LLM proposal, a deterministic overlap
 * reconciler (no LLM cost), and — only if that isn't enough — exactly ONE
 * LLM revision followed by the reconciler again. Worst case: 2 sequential
 * chatJSON calls, not 3; small overlaps never need a second model round-trip
 * at all.
 */
export async function runFloorplanAgentPass(
  scene: FloorplanScene,
  instruction: string,
  history: AssistantTurn[],
  knowledgeNote?: string,
  mechanicsNote?: string,
  assetNote?: string,
  brief?: Brief | null,
  reqStartTime?: number,
  onProgress?: (message: string) => void,
): Promise<{ reply: string; actions: FloorplanAction[]; rawContent?: string; llmFailed?: boolean }> {
  const messages: ChatMsg[] = buildMessages(
    "floorplan",
    scene,
    instruction,
    history,
    knowledgeNote,
    mechanicsNote,
    assetNote,
    brief,
  );

  onProgress?.("Meminta usulan denah ke AI…");
  const out = await chatJSON<{ reply?: string; actions?: unknown[]; needs_clarify?: unknown[]; options?: unknown[] }>(messages);
  if (!out) return { reply: EDITOR_AGENT_FALLBACK, actions: [], llmFailed: true };

  const reply = typeof out.reply === "string" && out.reply.trim() ? out.reply.trim() : EDITOR_AGENT_FALLBACK;
  const acts = sanitizeActions("floorplan", Array.isArray(out.actions) ? out.actions : [], scene) as FloorplanAction[];
  const rawContent = (out.needs_clarify || out.options) ? JSON.stringify(out) : undefined;
  if (acts.length === 0) return { reply, actions: [], rawContent };

  const violations = findFloorplanActionFeedback(scene, acts, instruction);
  if (violations.length === 0) return { reply, actions: acts, rawContent };

  onProgress?.("Menyesuaikan tata letak agar tidak tumpang-tindih…");
  const reconciled = reconcileFloorplanOverlaps(scene, acts, instruction);
  if (reconciled.remainingViolations.length === 0) {
    return { reply, actions: reconciled.actions, rawContent };
  }

  if (reqStartTime && Date.now() - reqStartTime >= 90000) {
    return { reply: humanizeViolations(reconciled.remainingViolations), actions: [], llmFailed: true };
  }

  onProgress?.("Meminta AI merevisi sekali lagi…");
  const revisionMessages: ChatMsg[] = [
    ...messages,
    { role: "assistant", content: JSON.stringify({ reply, actions: acts }) },
    { role: "user", content: buildRevisionMessage(reconciled.remainingViolations) },
  ];
  const out2 = await chatJSON<{ reply?: string; actions?: unknown[]; needs_clarify?: unknown[]; options?: unknown[] }>(revisionMessages);
  if (!out2) {
    return { reply: humanizeViolations(reconciled.remainingViolations), actions: [], llmFailed: true };
  }

  const reply2 = typeof out2.reply === "string" && out2.reply.trim() ? out2.reply.trim() : EDITOR_AGENT_FALLBACK;
  const acts2 = sanitizeActions("floorplan", Array.isArray(out2.actions) ? out2.actions : [], scene) as FloorplanAction[];
  const rawContent2 = (out2.needs_clarify || out2.options) ? JSON.stringify(out2) : undefined;
  if (acts2.length === 0) return { reply: reply2, actions: [], rawContent: rawContent2 };

  const violations2 = findFloorplanActionFeedback(scene, acts2, instruction);
  if (violations2.length === 0) return { reply: reply2, actions: acts2, rawContent: rawContent2 };

  onProgress?.("Menyesuaikan tata letak setelah revisi…");
  const reconciled2 = reconcileFloorplanOverlaps(scene, acts2, instruction);
  if (reconciled2.remainingViolations.length === 0) {
    return { reply: reply2, actions: reconciled2.actions, rawContent: rawContent2 };
  }

  onProgress?.("Belum berhasil menata otomatis");
  return { reply: humanizeViolations(reconciled2.remainingViolations), actions: [], llmFailed: true };
}
```

Delete the two files:
```bash
rm "d:/Ngoding/expr/VibeCoding.id/Baruma/src/lib/assistant/llm-tools.ts"
rm "d:/Ngoding/expr/VibeCoding.id/Baruma/src/lib/assistant/llm-tools.test.ts"
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run "src/app/api/v1/projects/[id]/editor/assistant/route.test.ts"`
Expected: PASS — all tests green, including the still-broken-after-exhaustion test now asserting exactly 2 `chatJSON` calls.

Also run the full suite once to catch any other file that imported the now-deleted `llm-tools.ts` or the removed exports:

Run: `npx vitest run`
Expected: PASS (no import errors elsewhere).

- [ ] **Step 5: Commit**

```bash
cd "d:/Ngoding/expr/VibeCoding.id/Baruma"
git add -A src/app/api/v1/projects/[id]/editor/assistant/route.ts \
  "src/app/api/v1/projects/[id]/editor/assistant/route.test.ts"
git rm src/lib/assistant/llm-tools.ts src/lib/assistant/llm-tools.test.ts
git commit -m "feat(floorplan): runFloorplanAgentPass replaces runFloorplanLoop+runFloorplanToolLoop; SSE progress events"
```

---

### Task 6: Wire `agent/route.ts` to `runFloorplanAgentPass` + SSE progress

**Files:**
- Modify: `src/app/api/v1/projects/[id]/agent/route.ts`
- Modify: `src/app/api/v1/projects/[id]/agent/route.test.ts`

**Interfaces:**
- Consumes: `runFloorplanAgentPass` (Task 5, exported from `editor/assistant/route.ts`).

- [ ] **Step 1: Update the mock** — in `src/app/api/v1/projects/[id]/agent/route.test.ts`, replace:
```typescript
vi.mock("@/app/api/v1/projects/[id]/editor/assistant/route", () => ({
  EDITOR_AGENT_FALLBACK: "fallback",
  EDITOR_AGENT_FALLBACK_NO_LLM: "not configured",
  contextualFloorplanInstruction: vi.fn((instruction: string) => instruction),
  runFloorplanLoop: vi.fn(),
  runFloorplanToolLoop: vi.fn(),
}))
```
with:
```typescript
vi.mock("@/app/api/v1/projects/[id]/editor/assistant/route", () => ({
  EDITOR_AGENT_FALLBACK: "fallback",
  EDITOR_AGENT_FALLBACK_NO_LLM: "not configured",
  contextualFloorplanInstruction: vi.fn((instruction: string) => instruction),
  runFloorplanAgentPass: vi.fn(),
}))
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run "src/app/api/v1/projects/[id]/agent/route.test.ts"`
Expected: FAIL — `route.ts` still imports `runFloorplanLoop`/`runFloorplanToolLoop`, which the mock factory no longer provides (`undefined is not a function` if the floorplan branch were reached, or a type/import error).

- [ ] **Step 3: Modify `src/app/api/v1/projects/[id]/agent/route.ts`**

Replace the import:
```typescript
import {
  EDITOR_AGENT_FALLBACK,
  EDITOR_AGENT_FALLBACK_NO_LLM,
  contextualFloorplanInstruction,
  runFloorplanLoop,
  runFloorplanToolLoop,
} from "@/app/api/v1/projects/[id]/editor/assistant/route"
```
with:
```typescript
import {
  EDITOR_AGENT_FALLBACK,
  EDITOR_AGENT_FALLBACK_NO_LLM,
  contextualFloorplanInstruction,
  runFloorplanAgentPass,
} from "@/app/api/v1/projects/[id]/editor/assistant/route"
```

Replace the floorplan branch's tool-loop-or-json-loop selection:
```typescript
              const toolResult = process.env.LLM_TOOLS === "1"
                ? await runFloorplanToolLoop(scene, llmInstruction, history, planNote, mechNote, assetSuggestionsNote, brief)
                : null
              const result = toolResult ?? await runFloorplanLoop(scene, llmInstruction, history, planNote, mechNote, assetSuggestionsNote, brief)
              reply = result.rawContent ?? result.reply
              actions = result.actions
              llmFailed = !!result.llmFailed
```
with:
```typescript
              const result = await runFloorplanAgentPass(
                scene, llmInstruction, history, planNote, mechNote, assetSuggestionsNote, brief, undefined, onProgress,
              )
              reply = result.rawContent ?? result.reply
              actions = result.actions
              llmFailed = !!result.llmFailed
```

Update the `POST` wrapper the same way as Task 5 — add `emitProgress` and thread it into `runLogic`:
```typescript
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  const reqClone = request.clone()
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const sendPing = setInterval(() => {
        controller.enqueue(encoder.encode('data: {"type":"ping"}\n\n'))
      }, 5000)
      const emitProgress = (message: string) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "progress", message })}\n\n`))
        } catch {
          /* stream may already be closing; progress is best-effort */
        }
      }

      try {
        const response = await runLogic(reqClone, ctx, emitProgress)
        if (response.status >= 400) {
          const body = await response.json().catch(() => null)
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: body?.error ?? 'Error', status: response.status })}\n\n`))
        } else {
          const body = await response.json()
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'result', data: body })}\n\n`))
        }
      } catch (e: any) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: e?.message ?? String(e) })}\n\n`))
      } finally {
        clearInterval(sendPing)
        controller.close()
      }
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive'
    }
  })
}
```

And change `runLogic`'s signature:
```typescript
async function runLogic(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
  onProgress?: (message: string) => void,
): Promise<Response> {
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run "src/app/api/v1/projects/[id]/agent/route.test.ts"`
Expected: PASS.

Run the full suite: `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd "d:/Ngoding/expr/VibeCoding.id/Baruma"
git add "src/app/api/v1/projects/[id]/agent/route.ts" "src/app/api/v1/projects/[id]/agent/route.test.ts"
git commit -m "feat(floorplan): agent route uses the consolidated runFloorplanAgentPass + SSE progress"
```

---

### Task 7: `docs/ARCHITECTURE.md` cleanup

**Files:**
- Modify: `docs/ARCHITECTURE.md`

**Interfaces:** None (documentation only).

- [ ] **Step 1: Remove the stale line**

Find and delete the line `- **AI LLM_TOOLS** opt-in belum sepenuhnya diverifikasi.` (docs/ARCHITECTURE.md:303) — the feature it refers to no longer exists (Task 5 deleted it).

- [ ] **Step 2: Commit**

```bash
cd "d:/Ngoding/expr/VibeCoding.id/Baruma"
git add docs/ARCHITECTURE.md
git commit -m "docs: remove stale LLM_TOOLS note (feature retired)"
```

---

### Task 8: Client SSE progress plumbing (`reqSSE`, `DataSource`)

**Files:**
- Modify: `src/lib/data/http.ts`
- Modify: `src/lib/data/source.ts`
- Create: `src/lib/data/http.test.ts`

**Interfaces:**
- Produces: `reqSSE<T>(method, path, body?, onProgress?: (message: string) => void): Promise<T>` (still module-private); `DataSource.sendProjectAgentMessage`/`sendAssistantMessage` gain an optional trailing `onProgress` param. Consumed by Task 9.

- [ ] **Step 1: Write the failing tests** — create `src/lib/data/http.test.ts`:

```typescript
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth/phantom-session", () => ({ getPhantomToken: vi.fn(() => null) }))

const fetchMock = vi.fn()
vi.stubGlobal("fetch", fetchMock)

import { httpSource } from "./http"
import type { ProjectAgentRequest } from "@/lib/assistant/actions"

function sseResponse(frames: unknown[]): Response {
  const body = frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join("")
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } })
}

const input: ProjectAgentRequest = {
  surface: "editor",
  requestedMode: "auto",
  instruction: "x",
  clientRequestId: "r1",
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.unstubAllEnvs())

describe("sendProjectAgentMessage — SSE progress", () => {
  it("invokes onProgress for each progress frame and resolves with the result message", async () => {
    fetchMock.mockResolvedValue(sseResponse([
      { type: "ping" },
      { type: "progress", message: "Meminta usulan denah ke AI…" },
      { type: "progress", message: "Menyesuaikan tata letak agar tidak tumpang-tindih…" },
      { type: "result", data: { message: { id: "m1", content: "ok" } } },
    ]))
    const seen: string[] = []
    const result = await httpSource.sendProjectAgentMessage("p1", input, (message) => seen.push(message))

    expect(seen).toEqual([
      "Meminta usulan denah ke AI…",
      "Menyesuaikan tata letak agar tidak tumpang-tindih…",
    ])
    expect(result).toEqual({ id: "m1", content: "ok" })
  })

  it("resolves correctly without an onProgress callback (backward compatible)", async () => {
    fetchMock.mockResolvedValue(sseResponse([
      { type: "result", data: { message: { id: "m2", content: "ok2" } } },
    ]))
    const result = await httpSource.sendProjectAgentMessage("p1", { ...input, clientRequestId: "r2" })
    expect(result).toEqual({ id: "m2", content: "ok2" })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd "d:/Ngoding/expr/VibeCoding.id/Baruma" && npx vitest run src/lib/data/http.test.ts`
Expected: FAIL — `sendProjectAgentMessage` doesn't accept/forward a 3rd argument yet, so `seen` stays empty (`onProgress` never called).

- [ ] **Step 3: Modify `src/lib/data/http.ts`**

Change `reqSSE`'s signature and its parse loop:
```typescript
async function reqSSE<T>(
  method: string,
  path: string,
  body?: unknown,
  onProgress?: (message: string) => void,
): Promise<T> {
```
Inside the `for (const line of lines)` loop, change:
```typescript
        try {
          const parsed = JSON.parse(dataStr)
          if (parsed.type === "result") {
            finalResult = parsed.data
          } else if (parsed.type === "error") {
            throw new Error(parsed.error)
          }
        } catch (e) {
          // Ignore invalid JSON chunks (like empty pings)
        }
```
to:
```typescript
        try {
          const parsed = JSON.parse(dataStr)
          if (parsed.type === "result") {
            finalResult = parsed.data
          } else if (parsed.type === "progress" && typeof parsed.message === "string") {
            onProgress?.(parsed.message)
          } else if (parsed.type === "error") {
            throw new Error(parsed.error)
          }
        } catch (e) {
          // Ignore invalid JSON chunks (like empty pings)
        }
```

Update the two call sites:
```typescript
  sendProjectAgentMessage: async (id, input) =>
    (await reqSSE<{ message: AssistantMessage }>("POST", `/projects/${id}/agent`, input)).message,
  sendAssistantMessage: async (id, input) =>
    (await reqSSE<{ message: AssistantMessage }>("POST", `/projects/${id}/editor/assistant`, input))
      .message,
```
to:
```typescript
  sendProjectAgentMessage: async (id, input, onProgress) =>
    (await reqSSE<{ message: AssistantMessage }>("POST", `/projects/${id}/agent`, input, onProgress)).message,
  sendAssistantMessage: async (id, input, onProgress) =>
    (await reqSSE<{ message: AssistantMessage }>("POST", `/projects/${id}/editor/assistant`, input, onProgress))
      .message,
```

- [ ] **Step 4: Modify `src/lib/data/source.ts`** — add the optional param to both method signatures in the `DataSource` interface:
```typescript
  sendAssistantMessage(
    projectId: string,
    input: SendAssistantMessageInput,
    onProgress?: (message: string) => void
  ): Promise<AssistantMessage>
```
and
```typescript
  sendProjectAgentMessage(
    projectId: string,
    input: ProjectAgentRequest,
    onProgress?: (message: string) => void
  ): Promise<AssistantMessage>
```
(No change needed to `src/lib/mock/index.ts` — TypeScript allows an implementation with fewer parameters to satisfy an interface method whose extra trailing parameters are optional.)

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/lib/data/http.test.ts`
Expected: PASS.

Run the full suite: `npx vitest run`
Expected: PASS (mock/index.ts and all existing http.ts callers unaffected).

- [ ] **Step 6: Commit**

```bash
cd "d:/Ngoding/expr/VibeCoding.id/Baruma"
git add src/lib/data/http.ts src/lib/data/source.ts src/lib/data/http.test.ts
git commit -m "feat(agent-panel): reqSSE emits progress events to an optional onProgress callback"
```

---

### Task 9: Show progress in `ProjectAgentPanel`

**Files:**
- Modify: `src/stores/project-agent-ui-store.ts`
- Modify: `src/lib/api/hooks.ts`
- Modify: `src/components/assistant/project-agent-panel.tsx`

**Interfaces:**
- Consumes: `onProgress` support in `data.sendProjectAgentMessage` (Task 8).
- Produces: `useProjectAgentUiStore` gains `progressMessage: string | null` + `setProgressMessage`.

This task is UI wiring with no new pure logic to unit-test in isolation (it's a Zustand store + a mutation hook + a JSX read) — verify by inspection + the manual E2E check in Task 11, matching how `send.isPending` (the analogous existing indicator) is verified today (no dedicated unit test either).

- [ ] **Step 1: Modify `src/stores/project-agent-ui-store.ts`**

```typescript
import { create } from "zustand"

import type { AssistantMode } from "@/lib/assistant/actions"

export type RequestedAgentMode = "auto" | AssistantMode

type ProjectAgentUiState = {
  open: boolean
  requestedMode: RequestedAgentMode
  draft: string
  draftNonce: number
  progressMessage: string | null
  setOpen: (open: boolean) => void
  setRequestedMode: (mode: RequestedAgentMode) => void
  injectDraft: (text: string, mode?: RequestedAgentMode) => void
  consumeDraft: () => void
  setProgressMessage: (message: string | null) => void
  reset: () => void
}

export const useProjectAgentUiStore = create<ProjectAgentUiState>((set) => ({
  open: false,
  requestedMode: "auto",
  draft: "",
  draftNonce: 0,
  progressMessage: null,
  setOpen: (open) => set({ open }),
  setRequestedMode: (requestedMode) => set({ requestedMode }),
  injectDraft: (text, requestedMode) => set((state) => ({
    open: true,
    requestedMode: requestedMode ?? state.requestedMode,
    draft: text,
    draftNonce: state.draftNonce + 1,
  })),
  consumeDraft: () => set({ draft: "" }),
  setProgressMessage: (progressMessage) => set({ progressMessage }),
  reset: () => set({ open: false, requestedMode: "auto", draft: "", draftNonce: 0, progressMessage: null }),
}))
```

- [ ] **Step 2: Modify `src/lib/api/hooks.ts`**

Add the store import near the other imports:
```typescript
import { useProjectAgentUiStore } from "@/stores/project-agent-ui-store"
```

Replace `useSendProjectAgentMessage`'s `mutationFn` and `onSettled`:
```typescript
export function useSendProjectAgentMessage(projectId: string) {
  const qc = useQueryClient()
  const setProgressMessage = useProjectAgentUiStore((state) => state.setProgressMessage)
  return useMutation({
    mutationFn: (input: ProjectAgentRequest) =>
      data.sendProjectAgentMessage(projectId, input, (message) => setProgressMessage(message)),
    onMutate: async (input) => {
      const key = queryKeys.assistant(projectId)
      await qc.cancelQueries({ queryKey: key })
      const previous = qc.getQueryData<AssistantMessage[]>(key) ?? []
      const surfaceMode = input.surface === "editor"
        ? "floorplan"
        : input.surface === "preview-3d" || input.surface === "furniture" || input.surface === "materials"
          ? "interior"
          : "brief"
      const mode = input.requestedMode === "auto" ? surfaceMode : input.requestedMode
      const optimistic: AssistantMessage = {
        id: `optimistic-${input.clientRequestId}`,
        projectId,
        mode,
        surface: input.surface,
        turnId: input.clientRequestId,
        clientRequestId: input.clientRequestId,
        requestState: "pending",
        role: "user",
        content: input.instruction,
        createdAt: new Date().toISOString(),
      }
      qc.setQueryData<AssistantMessage[]>(key, [...previous, optimistic])
      return { previous, key }
    },
    onError: (_error, _input, context) => {
      if (context) qc.setQueryData(context.key, context.previous)
    },
    onSuccess: (message, input, context) => {
      const key = context?.key ?? queryKeys.assistant(projectId)
      qc.setQueryData<AssistantMessage[]>(key, (current = []) => [
        ...current.map((item) => item.clientRequestId === input.clientRequestId && item.role === "user"
          ? { ...item, requestState: "completed" as const }
          : item),
        ...(current.some((item) => item.id === message.id) ? [] : [message]),
      ])
    },
    onSettled: () => {
      setProgressMessage(null)
      qc.invalidateQueries({ queryKey: queryKeys.assistant(projectId) })
    },
  })
}
```
(Only `mutationFn` and `onSettled` change; `onMutate`/`onError`/`onSuccess` are unchanged — shown in full above so the whole function is easy to diff against.)

- [ ] **Step 3: Modify `src/components/assistant/project-agent-panel.tsx`**

Add the store import:
```typescript
import { useProjectAgentUiStore, type RequestedAgentMode } from "@/stores/project-agent-ui-store"
```
already exists — just add a new selector alongside the existing ones (near `requestedMode`/`draft`):
```typescript
  const progressMessage = useProjectAgentUiStore((state) => state.progressMessage)
```

Replace the pending indicator block:
```tsx
        {send.isPending && (
          <div className="mr-4 flex items-center gap-2 py-2 text-sm text-muted-foreground" aria-live="polite">
            <Loader2 className="size-4 animate-spin text-primary" /> AI Agent sedang menyusun…
          </div>
        )}
```
with:
```tsx
        {send.isPending && (
          <div className="mr-4 flex items-center gap-2 py-2 text-sm text-muted-foreground" aria-live="polite">
            <Loader2 className="size-4 animate-spin text-primary" /> {progressMessage ?? "AI Agent sedang menyusun…"}
          </div>
        )}
```

- [ ] **Step 4: Type-check + full suite**

Run: `npx tsc --noEmit`
Expected: no new errors.

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd "d:/Ngoding/expr/VibeCoding.id/Baruma"
git add src/stores/project-agent-ui-store.ts src/lib/api/hooks.ts src/components/assistant/project-agent-panel.tsx
git commit -m "feat(agent-panel): show live progress text while the floorplan agent works"
```

---

### Task 10: Provision `baruma-floorplan-actions` in Agent Lab (ops)

**Files:** none (operational — backoffice provisioning).

**Interfaces:** Produces the live agent config that `ACTIONS_SLUG` (Task 3) posts to. Until this exists, `chatJSON` gets a 404/error from Agent Lab → `completeAgentLab` returns `null` → routes fall back to `EDITOR_AGENT_FALLBACK` exactly as they do for any other Agent Lab outage (no regression, just unavailable until provisioned).

- [ ] **Step 1: Create the agent** in the backoffice `https://tampil.dev/admin/agent-lab` (or the admin API on the droplet), agent `baruma-floorplan-actions`:
  - `retrieval_config`: `{"type":"none"}`
  - `llm_config`: `{"provider":"deepseek","model":"deepseek-v4-flash","temperature":0.2,"max_tokens":4096,"thinking":"disabled"}` — same model as `baruma-assistant`, but thinking OFF (this task's whole point) and a lower temperature (geometry-following, not prose creativity).
  - `system_prompt`: a short placeholder is sufficient — `"Kamu asisten teknis Baruma. Ikuti instruksi lengkap yang dikirim di pesan system per-request."` — the REAL, dynamic system prompt (action catalog + scene JSON) is sent per-request as the first message in `chatJSON`'s `messages` array; `/v1/agents/{slug}/complete` uses the caller's messages directly and does not prepend the agent's stored `system_prompt` (confirmed in `agent-lab/app/pipeline.py`'s `run_complete` — unlike `run_ask`, it does not call `build_system_prompt`).
  - `behavior_config`: defaults are fine (unused by `/complete`).
- [ ] **Step 2: Verify the existing product key's scope** covers the new slug — if the `baruma` product key was issued scoped to `["baruma-assistant"]` only, add `baruma-floorplan-actions` to its scope (or issue a second key and set a distinct env var if the backoffice doesn't support multi-slug scope edits — `AGENT_LAB_KEY` in Baruma's env stays a single value either way, since both `PROSE_SLUG` and `ACTIONS_SLUG` are read via the SAME `completeAgentLab`/`askAgentLab` helpers using the SAME `AGENT_LAB_KEY`).
- [ ] **Step 3: Smoke-test the new agent directly** (bypassing Baruma) to confirm thinking really is off and the endpoint responds:
```bash
curl -s -X POST https://agentlab.tampil.dev/v1/agents/baruma-floorplan-actions/complete \
  -H "content-type: application/json" -H "X-API-Key: <the baruma key>" \
  -d '{"user_id":"smoke-test","messages":[{"role":"user","content":"Balas JSON persis: {\"reply\":\"ok\",\"actions\":[]}"}],"response_format":"json"}'
```
Expected: `200` with a `content` field close to `{"reply":"ok","actions":[]}`, and — compared to the SAME prompt sent to `baruma-assistant` with `thinking:"enabled"` — a noticeably faster response (no hidden reasoning tokens).
- [ ] **Step 4: Note (no commit)** — record "baruma-floorplan-actions provisioned + smoke-tested, thinking confirmed off" in the progress ledger. No code/file changes in this task.

---

### Task 11: Full verification + manual E2E (DoD gate)

**Files:** none (verification).

**Interfaces:** Consumes everything above.

- [ ] **Step 1: Full suite green**

Run: `cd "d:/Ngoding/expr/VibeCoding.id/Baruma" && npx vitest run`
Expected: all tests pass, including the new/updated ones from Tasks 1-2, 3, 5, 6, 8.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual repro of the exact reported scenario** — with a dev server + authenticated session, reproduce the screenshot's flow: a 1-floor house, a single-bathroom instruction ("kamar mandinya satu saja, lantai satu saja") that previously produced the raw-coordinate "belum berhasil menata" failure after 3 slow attempts. Confirm:
  - Progress text appears in the panel while the agent works (not a silent freeze).
  - Either the layout resolves cleanly (deterministic reconciler or ≤2 LLM attempts succeed), OR the failure message names rooms in plain language with tappable suggestion chips and contains no `x:`/`y:` substrings.
  - Wall-clock time from send to final message is visibly lower than before (no longer waiting on up to 3 full-prompt, thinking-enabled round-trips).
- [ ] **Step 4: Record + finish** — capture the before/after latency observation and the final message screenshot/text in the PR description, then use `superpowers:finishing-a-development-branch` to decide merge/PR flow for this branch.

---

## Self-Review

**Spec coverage:**
- §3 (collapse to one pipeline, retire LLM_TOOLS) → Tasks 4-6.
- §4 (deterministic reconciler, 30% bound, locked/sanitation-safe) → Task 1.
- §5 (split agent-lab slug, thinking off for actions) → Task 3, Task 10.
- §6 (progress SSE) → Tasks 5, 6, 8, 9.
- §7 (humanized failure message, no coordinates, clarify chips) → Task 2.
- §8 (resilience/credit invariants) → Global Constraints + Task 5/6 preserve the exact spend/refund call sites (untouched).
- §9 (testing) → every task's Steps 1-4; Task 11 is the DoD gate.
- §10 (rollout/risk, kill-switch) → Task 10 Step 4 note; Global Constraints call out the null-on-failure fallback explicitly.
- Non-goals (interior, Santrenize, other agent-lab consumers) → not touched by any task (verified: interior mode's `chatJSON` call site in both routes is untouched by every diff above).

**Placeholder scan:** No TBD/TODO. Task 4 is intentionally a documentation/no-op placeholder folded into Task 5 — this is stated explicitly (not a silent gap) because deleting the files before their last import is removed would break the build if run out of order; Task 5's own Step 3 performs the actual deletion.

**Type consistency:** `OverlapReconcileResult` (Task 1) fields (`actions`, `resolvedPairs`, `stillBlocked`) match usage. `reconcileFloorplanOverlaps(scene, actions, instruction) → { actions, remainingViolations }` (Task 2) signature matches its Task 5 call site exactly (3 positional args, 2-key return, both destructured as `reconciled.actions`/`reconciled.remainingViolations`). `humanizeViolations(violations: string[]): string` (Task 2) matches its two Task 5 call sites. `runFloorplanAgentPass(scene, instruction, history, knowledgeNote?, mechanicsNote?, assetNote?, brief?, reqStartTime?, onProgress?)` (Task 5) matches both its `editor/assistant/route.ts` (Task 5) and `agent/route.ts` (Task 6) call sites — same 9-parameter order, `onProgress` last in both. `PROSE_SLUG`/`ACTIONS_SLUG` (Task 3) used consistently. `onProgress?: (message: string) => void` type identical across `runLogic`, `runFloorplanAgentPass`, `reqSSE`, `DataSource` methods, and the store's `setProgressMessage`.
