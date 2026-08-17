/**
 * "Perbaiki semua yang bisa" — the one-command, layperson-facing culmination of
 * the audit→fix trilogy (phase 3). Applies every SAFE, deterministic standards
 * fix at once: enlarge undersized rooms (SNI 03-1733), add daylight windows
 * (SNI 03-6572), relocate a misplaced soakwell (SNI 8456).
 *
 * Accuracy matters here: the fixes INTERACT. Enlarging a room changes which
 * wall is exterior (so the daylight fix must see the enlarged rect) and can
 * consume the open ground a soakwell would move to. So this does NOT run the
 * three generators on one snapshot — it runs them SEQUENTIALLY against a scene
 * that is re-simulated after each stage, producing a single conflict-free
 * action set.
 */
import type { FloorplanAction, FloorplanScene } from "@/lib/assistant/actions"
import { proposeSoakwellRelocation } from "@/lib/assistant/design-strategies"
import { daylightFixes, roomSizeFixes } from "./auto-fix"
import { reflowFixes, type ReflowFix } from "./reflow"

export type SafeFixResult = {
  actions: FloorplanAction[]
  applied: { rooms: number; windows: number; soakwell: number }
  /** Rooms fixed by RESHUFFLING neighbours (reflow) — with who had to give way. */
  reflowed: ReflowFix[]
  /** Room names that couldn't be fixed even by reflow (truly stuck). */
  blocked: { rooms: string[]; windowsLandlocked: string[]; soakwell: boolean }
}

/** Apply a fix action set to a CLONE of the scene so the next stage sees the
 *  result. Handles exactly the action kinds the safe fixers emit. */
export function simulateFixesOnScene(scene: FloorplanScene, actions: FloorplanAction[]): FloorplanScene {
  const rooms = scene.rooms.map((r) => ({ ...r }))
  const openings = scene.openings.map((o) => ({ ...o }))
  const sanitation = scene.sanitation
    ? {
        ...scene.sanitation,
        septicTank: scene.sanitation.septicTank ? { ...scene.sanitation.septicTank } : undefined,
        soakwell: scene.sanitation.soakwell ? { ...scene.sanitation.soakwell } : undefined,
        controlBoxes: scene.sanitation.controlBoxes?.map((b) => ({ ...b })),
      }
    : scene.sanitation
  const roomById = new Map(rooms.map((r) => [r.id, r]))
  let synthetic = 0

  for (const a of actions) {
    if (a.type === "updateRoom") {
      const room = roomById.get(a.roomId)
      if (room) Object.assign(room, a.patch)
    } else if (a.type === "addOpening") {
      openings.push({ id: `sim-op-${synthetic++}`, roomId: a.roomId, side: a.side, type: a.openingType, positionM: a.positionM })
    } else if (a.type === "moveSanitationObject" && sanitation) {
      if (a.kind === "soakwell" && sanitation.soakwell) {
        sanitation.soakwell = { ...sanitation.soakwell, x: a.x, y: a.y }
      } else if (a.kind === "septicTank" && sanitation.septicTank) {
        sanitation.septicTank = { ...sanitation.septicTank, x: a.x, y: a.y }
      } else if (a.kind === "controlBox" && sanitation.controlBoxes && a.ref != null && sanitation.controlBoxes[a.ref]) {
        sanitation.controlBoxes[a.ref] = { ...sanitation.controlBoxes[a.ref], x: a.x, y: a.y }
      }
    }
  }
  return { ...scene, rooms, openings, sanitation }
}

/** Collect every safe standards fix for the scene as one conflict-free action
 *  set, deriving each stage from the previous stage's simulated result. */
export function collectSafeFixes(scene: FloorplanScene): SafeFixResult {
  const actions: FloorplanAction[] = []

  // 1. Enlarge undersized rooms first — it moves walls the later stages read.
  const size = roomSizeFixes(scene)
  const sizeActions = size.fixes.map((f) => f.action)
  actions.push(...sizeActions)
  let stage = simulateFixesOnScene(scene, sizeActions)

  // 1b. REFLOW: rooms still deficient (undersized OR too narrow) get another
  //     chance by shrinking compliant neighbours along one axis — the "menata
  //     ulang denah" the pipeline previously refused to do. Runs on the
  //     simulated stage so it sees stage-1 enlargements.
  const reflow = reflowFixes(stage)
  actions.push(...reflow.actions)
  stage = simulateFixesOnScene(stage, reflow.actions)

  // 2. Daylight on the enlarged scene (exterior walls may have changed).
  const day = daylightFixes(stage)
  const dayActions = day.fixes.map((f) => f.action)
  actions.push(...dayActions)
  stage = simulateFixesOnScene(stage, dayActions)

  // 3. Relocate a misplaced soakwell on the final scene (open ground may have
  //    shrunk after enlargement).
  let soakwell = 0
  const soakProposal = proposeSoakwellRelocation(stage)
  if (soakProposal && soakProposal.actions.length > 0) {
    actions.push(...soakProposal.actions)
    soakwell = soakProposal.actions.filter((a) => a.type === "moveSanitationObject").length
  }

  return {
    actions,
    applied: { rooms: size.fixes.length, windows: day.fixes.length, soakwell },
    reflowed: reflow.fixes,
    blocked: {
      // Only rooms that even the reflow stage couldn't solve stay blocked.
      rooms: reflow.stillBlocked.map((r) => r.name),
      windowsLandlocked: day.landlocked.map((r) => r.name),
      soakwell: false,
    },
  }
}
