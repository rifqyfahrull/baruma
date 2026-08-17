async function parseSSE(res: Response) { 
  const text = await res.text(); 
  const lines = text.split('\n'); 
  let finalResult = null; 
  for (const line of lines) { 
    if (line.startsWith('data: ')) { 
      const d = line.slice(6); 
      if (d === '[DONE]') continue; 
      try { 
        const p = JSON.parse(d); 
        if (p.type === 'result') finalResult = p.data; 
        else if (p.type === 'error') return p; 
      } catch(e){} 
    } 
  } 
  return finalResult; 
}
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/server/auth-server", () => ({ requireUser: vi.fn(async () => ({ userId: "u1" })) }))
vi.mock("@/lib/server/repo/projects", () => ({
  getOwnedProject: vi.fn(async () => ({
    id: "p1", name: "Rumah", style: "modern", site: { widthM: 8, depthM: 12, areaM2: 96 },
  })),
}))
vi.mock("@/lib/server/repo/briefs", () => ({
  getBriefPayload: vi.fn(async () => ({
    summary: "Rumah keluarga", site: { widthM: 8, depthM: 12 }, building: { floors: 2 },
    priorities: [], spaceProgram: [], constraints: [], risks: [],
  })),
}))
vi.mock("@/lib/server/repo/layouts", () => ({ getLayoutPayload: vi.fn(async () => null) }))
vi.mock("@/lib/server/repo/interiors", () => ({ getInteriorPayload: vi.fn(async () => null) }))
vi.mock("@/lib/server/repo/assistant", () => ({
  claimTurn: vi.fn(), completeTurn: vi.fn(), failTurn: vi.fn(), listMessages: vi.fn(async () => []),
}))
vi.mock("@/lib/server/repo/credits", () => ({
  spendCreditsOnce: vi.fn(async () => "ok"), refundCreditsOnce: vi.fn(async () => "ok"),
}))
vi.mock("@/lib/server/llm", () => ({
  llmEnabled: vi.fn(() => false), chatText: vi.fn(), chatJSON: vi.fn(), askAssistant: vi.fn(),
}))
vi.mock("@/app/api/v1/projects/[id]/editor/assistant/route", () => ({
  EDITOR_AGENT_FALLBACK: "fallback",
  EDITOR_AGENT_FALLBACK_NO_LLM: "not configured",
  contextualFloorplanInstruction: vi.fn((instruction: string) => instruction),
  runFloorplanAgentPass: vi.fn(),
}))

import { POST } from "./route"
import * as assistantRepo from "@/lib/server/repo/assistant"
import * as creditsRepo from "@/lib/server/repo/credits"
import * as llm from "@/lib/server/llm"
import * as layoutsRepo from "@/lib/server/repo/layouts"
import * as briefsRepo from "@/lib/server/repo/briefs"
import * as editorAssistantRoute from "@/app/api/v1/projects/[id]/editor/assistant/route"
import { __resetRateLimitStore } from "@/lib/server/rate-limit"

const userMessage = {
  id: "u-msg", projectId: "p1", mode: "brief" as const, surface: "brief" as const,
  turnId: "turn-1", clientRequestId: "req-12345678", requestState: "pending" as const,
  role: "user" as const, content: "halo", createdAt: "2026-07-12T00:00:00Z",
}

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/api/v1/projects/p1/agent", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer test" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/v1/projects/[id]/agent", () => {
  beforeEach(() => {
  vi.clearAllMocks()
    vi.clearAllMocks()
    // requireUser is mocked to always return the same "u1" in this file, so
    // without a reset the per-user rate guard (scope "editor-assistant")
    // would accumulate across unrelated tests and eventually 429 them.
    __resetRateLimitStore()
    vi.mocked(assistantRepo.claimTurn).mockResolvedValue({ kind: "claimed", message: userMessage })
    vi.mocked(assistantRepo.completeTurn).mockImplementation(async (_user, reply) => ({
      id: "a-msg", projectId: "p1", role: "assistant", createdAt: "2026-07-12T00:00:01Z",
      ...reply,
    }))
    vi.mocked(llm.llmEnabled).mockReturnValue(false)
    vi.mocked(llm.askAssistant).mockReset()
  })

  it("persists a Brief reply in the same project thread without charging when LLM is disabled", async () => {
    vi.mocked(llm.llmEnabled).mockReturnValue(false)
    const response = await POST(request({
      surface: "brief", requestedMode: "brief", instruction: "halo", clientRequestId: "req-12345678",
    }), { params: Promise.resolve({ id: "p1" }) })

    expect(response.status).toBe(200)
    expect(await parseSSE(response)).toMatchObject({ message: { mode: "brief", content: "not configured" } })
    expect(assistantRepo.completeTurn).toHaveBeenCalledOnce()
    expect(creditsRepo.spendCreditsOnce).not.toHaveBeenCalled()
  })

  it("returns an already-completed duplicate without running or charging again", async () => {
    vi.mocked(assistantRepo.claimTurn).mockResolvedValue({
      kind: "completed",
      message: { ...userMessage, requestState: "completed" },
      reply: { ...userMessage, id: "a1", role: "assistant", content: "cached", requestState: null },
    })
    const response = await POST(request({
      surface: "brief", requestedMode: "brief", instruction: "halo", clientRequestId: "req-12345678",
    }), { params: Promise.resolve({ id: "p1" }) })

    expect(await parseSSE(response)).toMatchObject({ duplicate: true, message: { content: "cached" } })
    expect(assistantRepo.completeTurn).not.toHaveBeenCalled()
    expect(creditsRepo.spendCreditsOnce).not.toHaveBeenCalled()
  })

  it("reserves credit before calling the Brief LLM", async () => {
    vi.mocked(llm.llmEnabled).mockReturnValue(true)
    vi.mocked(llm.askAssistant).mockResolvedValue("jawaban")
    const response = await POST(request({
      surface: "brief", requestedMode: "brief", instruction: "halo", clientRequestId: "req-12345678",
    }), { params: Promise.resolve({ id: "p1" }) })

    expect(response.status).toBe(200)
    await parseSSE(response)
    expect(creditsRepo.spendCreditsOnce).toHaveBeenCalledWith("u1", 1, "project_agent", "req-12345678")
    expect(vi.mocked(creditsRepo.spendCreditsOnce).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(llm.askAssistant).mock.invocationCallOrder[0])
  })

  it("routes a floorplan-mode instruction that misses the deterministic matchers to runFloorplanAgentPass", async () => {
    // Closes the "the two routes could silently drift in how they call the
    // shared function, and nothing would catch it" gap — every prior test
    // in this file only exercised brief mode.
    const floorplanScene = {
      site: { widthM: 8, depthM: 8 },
      floors: [{ id: "f1", name: "Lantai 1", level: 1 }],
      selectedFloorId: "f1",
      selectedRoomId: null,
      rooms: [
        { id: "r1", name: "Kamar Tidur", type: "kamar_tidur", floorId: "f1", x: 0, y: 0, width: 3, depth: 3, areaM2: 9, locked: false },
      ],
      openings: [],
    }
    vi.mocked(layoutsRepo.getLayoutPayload).mockResolvedValueOnce(
      { versionId: "v1" } as unknown as Awaited<ReturnType<typeof layoutsRepo.getLayoutPayload>>,
    )
    vi.mocked(llm.llmEnabled).mockReturnValue(true)
    vi.mocked(editorAssistantRoute.runFloorplanAgentPass).mockResolvedValue({
      rawContent: null, reply: "Baik, saya pertimbangkan filosofinya.", actions: [], llmFailed: false,
      plannerNote: "1. Dengarkan dulu, jangan ubah apa pun.",
    } as never)

    const response = await POST(request({
      surface: "editor",
      requestedMode: "floorplan",
      // Deliberately avoids every deterministic keyword (small-room/overlap/
      // soakwell/open-plan/floor-move/add-delete-room/daylight/access/opening)
      // so it falls through handleFloorplanInstruction to the LLM path.
      instruction: "Aku ingin dengar pendapatmu soal filosofi denah ini",
      clientRequestId: "req-12345678",
      liveScene: { mode: "floorplan", versionId: "v1", payload: floorplanScene },
    }), { params: Promise.resolve({ id: "p1" }) })

    expect(response.status).toBe(200)
    const body = await parseSSE(response)
    expect(body.message.content).toBe("Baik, saya pertimbangkan filosofinya.")

    // Rencana Agent Utama sampai ke UI (persisted) — kartu "Agent Utama" di panel.
    expect(body.message.plannerNote).toBe("1. Dengarkan dulu, jangan ubah apa pun.")
    expect(assistantRepo.completeTurn).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ plannerNote: "1. Dengarkan dulu, jangan ubah apa pun." })
    )

    expect(editorAssistantRoute.runFloorplanAgentPass).toHaveBeenCalledOnce()
    const call = vi.mocked(editorAssistantRoute.runFloorplanAgentPass).mock.calls[0]
    const [calledScene, calledInstruction, calledHistory] = call
    expect(calledScene).toMatchObject({ rooms: [expect.objectContaining({ id: "r1" })] })
    expect(typeof calledInstruction).toBe("string")
    expect(Array.isArray(calledHistory)).toBe(true)
    const onProgress = call[call.length - 1]
    expect(typeof onProgress).toBe("function")
  })

  it("MEMBANGUN denah kosong secara DETERMINISTIK via buildInitialFloorplan (tanpa LLM/kredit)", async () => {
    // Regresi proj-modern-tropis-1 (2026-08-02): jalur /agent selama ini TIDAK
    // memanggil buildInitialFloorplan, jadi "buatkan denah sesuai brief" jatuh
    // ke LLM (yang tak sanggup menyusun koordinat / malah klarifikasi asing).
    // Kini build deterministik wajib mengambil alih: ada aksi, tanpa LLM/kredit.
    const emptyPayload = {
      site: { widthM: 8, depthM: 12 },
      floors: [], selectedFloorId: null, selectedRoomId: null, rooms: [], openings: [],
    }
    vi.mocked(layoutsRepo.getLayoutPayload).mockResolvedValueOnce(
      { versionId: "v1" } as unknown as Awaited<ReturnType<typeof layoutsRepo.getLayoutPayload>>,
    )
    vi.mocked(briefsRepo.getBriefPayload).mockResolvedValueOnce({
      summary: "Rumah keluarga", site: { widthM: 8, depthM: 12 }, building: { floors: 1 },
      priorities: [], constraints: [], risks: [],
      spaceProgram: [{ id: "sp1", roomType: "ruang_tamu", name: "Ruang Tamu", required: true, quantity: 1 }],
    } as never)
    vi.mocked(llm.llmEnabled).mockReturnValue(true)

    const response = await POST(request({
      surface: "editor",
      requestedMode: "floorplan",
      instruction: "buatkan denah sesuai brief",
      clientRequestId: "req-12345678",
      liveScene: { mode: "floorplan", versionId: "v1", payload: emptyPayload },
    }), { params: Promise.resolve({ id: "p1" }) })

    expect(response.status).toBe(200)
    const body = await parseSSE(response)
    // Ada AKSI bangun (addRoom), bukan sekadar jawaban teks.
    expect(body.message.actions).toBeTruthy()
    const roomActions = body.message.actions.filter((a: { type: string }) => a.type === "addRoom")
    expect(roomActions.length).toBeGreaterThan(0)
    // Tidak boleh menempuh jalur LLM dan tidak boleh memungut kredit.
    expect(editorAssistantRoute.runFloorplanAgentPass).not.toHaveBeenCalled()
    expect(vi.mocked(creditsRepo.spendCreditsOnce)).not.toHaveBeenCalled()
  })

  // AI-abuse hardening (2026-08-15): rate guard sits ABOVE claimTurn/credit
  // spend, sharing scope "editor-assistant" with editor/assistant/route.ts.
  describe("rate limiting", () => {
    it("429s the 16th request from the same user within the window; earlier ones proceed normally", async () => {
      for (let i = 0; i < 15; i++) {
        const res = await POST(request({
          surface: "brief", requestedMode: "brief", instruction: "halo", clientRequestId: `req-rl-${i}`,
        }), { params: Promise.resolve({ id: "p1" }) })
        expect(res.status).toBe(200)
        const body = await parseSSE(res)
        expect(body.status).toBeUndefined()
      }

      const blocked = await POST(request({
        surface: "brief", requestedMode: "brief", instruction: "halo", clientRequestId: "req-rl-blocked",
      }), { params: Promise.resolve({ id: "p1" }) })
      expect(blocked.status).toBe(200) // SSE transport: real status folded into the JSON event.
      const body = await parseSSE(blocked)
      expect(body.status).toBe(429)
      expect(body.retryAfter).toBeGreaterThan(0)
    })

    it("never spends credit on a 429 — the guard runs before claimTurn/spendCreditsOnce", async () => {
      vi.mocked(llm.llmEnabled).mockReturnValue(true)
      vi.mocked(llm.askAssistant).mockResolvedValue("jawaban")

      for (let i = 0; i < 15; i++) {
        const res = await POST(request({
          surface: "brief", requestedMode: "brief", instruction: "halo", clientRequestId: `req-credit-${i}`,
        }), { params: Promise.resolve({ id: "p1" }) })
        // The route streams SSE: POST() resolves as soon as the Response is
        // constructed, NOT once runLogic finishes. Drain the body so every
        // iteration's spendCreditsOnce call actually lands before we move on
        // — otherwise a later call can race past the mockClear() below.
        await parseSSE(res)
      }
      vi.mocked(creditsRepo.spendCreditsOnce).mockClear()
      vi.mocked(assistantRepo.claimTurn).mockClear()

      const blocked = await POST(request({
        surface: "brief", requestedMode: "brief", instruction: "halo", clientRequestId: "req-credit-blocked",
      }), { params: Promise.resolve({ id: "p1" }) })
      const body = await parseSSE(blocked)
      expect(body.status).toBe(429)
      expect(creditsRepo.spendCreditsOnce).not.toHaveBeenCalled()
      expect(assistantRepo.claimTurn).not.toHaveBeenCalled()
    })
  })
})
