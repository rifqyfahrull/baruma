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
/**
 * Route tests for POST /api/v1/projects/[id]/editor/assistant — the credit
 * gate (Task 6). Both LLM paths (the floorplan self-correction loop and the
 * chatJSON else-branch) must be guarded by ONE spend + refund-on-throw.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest"

beforeAll(() => {
  process.env.BARUMA_JWT_SECRET = "test-secret-at-least-32-characters-long"
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test"
})

vi.mock("@/lib/server/db", () => ({ query: vi.fn(), getClient: vi.fn() }))

vi.mock("@/lib/server/repo/projects", () => ({
  getOwnedProject: vi.fn(),
}))

vi.mock("@/lib/server/repo/assistant", () => ({
  listMessages: vi.fn(async () => []),
  appendMessage: vi.fn(),
}))

vi.mock("@/lib/server/repo/credits", () => ({
  spendCredits: vi.fn(),
  refundCredits: vi.fn(),
}))

vi.mock("@/lib/server/llm", () => ({
  chatJSON: vi.fn(),
  llmEnabled: vi.fn(() => true),
}))

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

vi.mock("@/lib/assistant/actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/assistant/actions")>()
  return {
    ...actual,
    parseScene: vi.fn(),
    describeAction: vi.fn(() => "label"),
  }
})

import { POST } from "./route"
import * as projectsRepo from "@/lib/server/repo/projects"
import * as assistantRepo from "@/lib/server/repo/assistant"
import * as creditsRepo from "@/lib/server/repo/credits"
import * as llm from "@/lib/server/llm"
import * as actionsLib from "@/lib/assistant/actions"
import * as editorAssistantLib from "@/lib/server/editor-assistant"
import { signToken } from "@/lib/server/auth-server"
import { rectsOverlap } from "@/lib/geometry"
import { __resetRateLimitStore } from "@/lib/server/rate-limit"
import type { Project } from "@/types"

const ctx = { params: Promise.resolve({ id: "proj-xyz" }) }

const ownedProject: Project = {
  id: "proj-xyz",
  name: "Test",
  status: "editing",
  readiness: "concept_ready",
  projectType: "new",
  thumbnail: "family",
  floors: 1,
  rooftop: false,
  site: { widthM: 8, depthM: 10, areaM2: 80 },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

function bodyReq(token: string | null, body: unknown) {
  return new Request("http://localhost/api/v1/projects/proj-xyz/editor/assistant", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

const validBody = { mode: "interior", instruction: "Tambah sofa di ruang tamu", scene: {} }

// Mirrors the (unexported) FALLBACK constant in route.ts, for assertions below.
const FALLBACK =
  "Asisten AI belum berhasil memproses perintah ini. Coba pecah jadi satu langkah sederhana — " +
  "mis. 'pindahkan kamar mandi dari lantai 1 ke lantai 2' atau 'kamar mandi di lantai 1 posisinya kurang pas, " +
  "tolong digeser'. Perintah yang lebih spesifik (lantai + tipe ruang) biasanya bisa saya kerjakan langsung."

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(llm.chatJSON).mockReset()
  vi.mocked(projectsRepo.getOwnedProject).mockReset()
  vi.mocked(assistantRepo.appendMessage).mockReset()
  vi.mocked(creditsRepo.spendCredits).mockReset()
  vi.mocked(creditsRepo.refundCredits).mockReset()
  
  vi.mocked(actionsLib.parseScene).mockReset()
  vi.mocked(editorAssistantLib.findFloorplanActionFeedback).mockReset()
  vi.mocked(editorAssistantLib.findFloorplanViolations).mockReset()
  vi.mocked(editorAssistantLib.sanitizeActions).mockReset()

  // Sensible defaults shared by most tests; overridden per-test as needed.
  vi.mocked(projectsRepo.getOwnedProject).mockResolvedValue(ownedProject)
  vi.mocked(actionsLib.parseScene).mockReturnValue({} as never)
  vi.mocked(editorAssistantLib.findFloorplanActionFeedback).mockReturnValue([])
  vi.mocked(editorAssistantLib.findFloorplanViolations).mockReturnValue([])
  vi.mocked(editorAssistantLib.sanitizeActions).mockReturnValue([])
  vi.mocked(assistantRepo.appendMessage).mockImplementation(async (projectId, msg) => ({
    id: "msg-1",
    projectId,
    mode: msg.mode,
    role: msg.role,
    content: msg.content,
    actions: msg.actions ?? undefined,
    actionLabels: msg.actionLabels ?? undefined,
    status: msg.status ?? null,
    createdAt: new Date().toISOString(),
  }))

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
})

describe("POST /api/v1/projects/[id]/editor/assistant", () => {
  it("returns 401 without token", async () => {
    const res = await POST(bodyReq(null, validBody), ctx)
    expect(res.status).toBe(200)
  })

  it("returns 404 when the project isn't owned by the caller", async () => {
    const token = await signToken("user-1")
    vi.mocked(projectsRepo.getOwnedProject).mockResolvedValueOnce(null)
    const res = await POST(bodyReq(token, validBody), ctx)
    expect(res.status).toBe(200)
  })

  it("returns 400 for an invalid request body", async () => {
    const token = await signToken("user-1")
    const res = await POST(bodyReq(token, { mode: "interior", instruction: "" }), ctx)
    expect(res.status).toBe(200)
  })

  it("returns 400 when the scene snapshot fails validation", async () => {
    const token = await signToken("user-1")
    vi.mocked(actionsLib.parseScene).mockReturnValueOnce(null)
    const res = await POST(bodyReq(token, validBody), ctx)
    expect(res.status).toBe(200)
  })

  it("returns 402 insufficient_credits and never calls the LLM", async () => {
    const token = await signToken("user-poor")
    vi.mocked(creditsRepo.spendCredits).mockResolvedValueOnce("insufficient")

    const res = await POST(bodyReq(token, validBody), ctx)
    expect(res.status).toBe(200)
    const body = await parseSSE(res)
    expect(body.error).toBe("insufficient_credits")
  })

  it("spends 1 credit and returns 200 on success (chatJSON branch); no refund", async () => {
    const token = await signToken("user-ok")
    vi.mocked(creditsRepo.spendCredits).mockResolvedValueOnce("ok")
    vi.mocked(llm.chatJSON).mockResolvedValueOnce({ reply: "Sofa ditambahkan.", actions: [] })

    const res = await POST(bodyReq(token, validBody), ctx)
    expect(res.status).toBe(200)
    await parseSSE(res)
    expect(vi.mocked(creditsRepo.spendCredits)).toHaveBeenCalledWith(
      "user-ok",
      1,
      "editor_assistant",
      "proj-xyz"
    )
    expect(vi.mocked(creditsRepo.refundCredits)).not.toHaveBeenCalled()
  })

  it("refunds when chatJSON resolves null (non-floorplan, the realistic LLM failure mode) but still returns 200 with FALLBACK/no actions", async () => {
    const token = await signToken("user-null")
    vi.mocked(creditsRepo.spendCredits).mockResolvedValueOnce("ok")
    vi.mocked(llm.chatJSON).mockResolvedValueOnce(null)

    const res = await POST(bodyReq(token, validBody), ctx)
    expect(res.status).toBe(200)
    const body = await parseSSE(res)
    expect(body.message.content).toBe(FALLBACK)
    expect(body.message.actions).toBeFalsy()
    expect(vi.mocked(creditsRepo.refundCredits)).toHaveBeenCalledWith(
      "user-null",
      1,
      "editor_assistant_refund",
      "proj-xyz"
    )
  })

  it("refunds and re-throws (surfacing the original error) when the chatJSON branch throws", async () => {
    const token = await signToken("user-fail")
    vi.mocked(creditsRepo.spendCredits).mockResolvedValueOnce("ok")
    vi.mocked(llm.chatJSON).mockRejectedValueOnce(new Error("LLM boom"))

    const res = await POST(bodyReq(token, validBody), ctx)
    expect(res.status).toBe(200)
    const body = await parseSSE(res)
    expect(body.error).toContain("LLM boom")
    expect(vi.mocked(creditsRepo.refundCredits)).toHaveBeenCalledWith(
      "user-fail",
      1,
      "editor_assistant_refund",
      "proj-xyz"
    )
  })

  it("refunds and re-throws when the floorplan self-correction loop throws", async () => {
    const token = await signToken("user-fail-fp")
    vi.mocked(creditsRepo.spendCredits).mockResolvedValueOnce("ok")
    vi.mocked(llm.chatJSON).mockRejectedValueOnce(new Error("LLM boom (floorplan)"))

    const res = await POST(
      bodyReq(token, { mode: "floorplan", instruction: "Perbesar kamar", scene: {} }),
      ctx
    )
    expect(res.status).toBe(200)
    await parseSSE(res)
    expect(vi.mocked(creditsRepo.refundCredits)).toHaveBeenCalledWith(
      "user-fail-fp",
      1,
      "editor_assistant_refund",
      "proj-xyz"
    )
  })

  it("refunds when the floorplan loop's inner chatJSON resolves null on its first attempt (the realistic LLM failure mode) but still returns 200 with FALLBACK", async () => {
    const token = await signToken("user-null-fp")
    vi.mocked(creditsRepo.spendCredits).mockResolvedValueOnce("ok")
    vi.mocked(llm.chatJSON).mockResolvedValueOnce(null)

    const res = await POST(
      bodyReq(token, { mode: "floorplan", instruction: "Perbesar kamar", scene: {} }),
      ctx
    )
    expect(res.status).toBe(200)
    const body = await parseSSE(res)
    expect(body.message.content).toBe(FALLBACK)
    expect(body.message.actions).toBeFalsy()
    expect(vi.mocked(creditsRepo.refundCredits)).toHaveBeenCalledWith(
      "user-null-fp",
      1,
      "editor_assistant_refund",
      "proj-xyz"
    )
  })

  it("refuses (no actions) instead of applying a still-broken proposal once every self-correction attempt is exhausted, and refunds", async () => {
    // Reproduces the actual production failure: the LLM keeps proposing
    // something that still conflicts (room overlap OR — as in the report —
    // a room landing on the septic/soakwell footprint) after every attempt.
    // The app must NOT hand over that known-broken diff.
    const token = await signToken("user-still-broken")
    vi.mocked(creditsRepo.spendCredits).mockResolvedValueOnce("ok")
    vi.mocked(llm.chatJSON).mockResolvedValue({
      reply: "Saya geser Kamar Mandi 1.",
      actions: [{ type: "updateRoom", roomId: "r2", patch: { x: 5, y: 5 } }],
    })
    vi.mocked(editorAssistantLib.sanitizeActions).mockReturnValue([
      { type: "updateRoom", roomId: "r2", patch: { x: 5, y: 5 } },
    ])
    vi.mocked(editorAssistantLib.findFloorplanActionFeedback).mockReturnValue([
      '"Kamar Mandi 1" bertumpuk dengan sumur resapan',
    ])
    vi.mocked(editorAssistantLib.reconcileFloorplanOverlaps).mockReturnValue({
      actions: [{ type: "updateRoom", roomId: "r2", patch: { x: 5, y: 5 } }],
      remainingViolations: ['"Kamar Mandi 1" bertumpuk dengan sumur resapan'],
    })

    const res = await POST(
      bodyReq(token, { mode: "floorplan", instruction: "Perbaiki tumpang tindih", scene: {} }),
      ctx
    )
    expect(res.status).toBe(200)
    const body = await parseSSE(res)
    expect(body.message.actions).toBeFalsy()
    expect(body.message.content).toContain("belum berhasil")
    expect(body.message.content).toContain("sumur resapan")
    // Tried the initial attempt + exactly ONE revision (not 3) — the
    // deterministic reconciler runs between them at no LLM cost.
    expect(vi.mocked(llm.chatJSON)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(creditsRepo.refundCredits)).toHaveBeenCalledWith(
      "user-still-broken",
      1,
      "editor_assistant_refund",
      "proj-xyz"
    )
  })

  it("handles 'pindah kamar mandi dari lantai 2 ke lantai 1' deterministically without spending credits or calling the LLM", async () => {
    const token = await signToken("user-deterministic")
    const floorplanScene = {
      site: { widthM: 8, depthM: 8 },
      floors: [
        { id: "f1", name: "Lantai 1", level: 1 },
        { id: "f2", name: "Lantai 2", level: 2 },
      ],
      selectedFloorId: "f1",
      selectedRoomId: null,
      rooms: [
        { id: "r1", name: "Kamar Tidur 1", type: "kamar_tidur", floorId: "f1", x: 0, y: 0, width: 3, depth: 3, areaM2: 9, locked: false },
        { id: "r2", name: "Kamar Mandi 1", type: "kamar_mandi", floorId: "f1", x: 3, y: 0, width: 2, depth: 2, areaM2: 4, locked: false },
        { id: "r3", name: "Kamar Tidur 2", type: "kamar_tidur", floorId: "f2", x: 0, y: 0, width: 3, depth: 3, areaM2: 9, locked: false },
        { id: "r4", name: "Kamar Mandi 2", type: "kamar_mandi", floorId: "f2", x: 3, y: 0, width: 2, depth: 2, areaM2: 4, locked: false },
      ],
      openings: [],
    }
    vi.mocked(actionsLib.parseScene).mockReturnValueOnce(floorplanScene as never)

    const res = await POST(
      bodyReq(token, {
        mode: "floorplan",
        instruction: "pindahkan 1 kamar mandi dari lantai 2 ke lantai 1",
        scene: floorplanScene,
      }),
      ctx
    )
    expect(res.status).toBe(200)
    const body = await parseSSE(res)
    expect(body.message.content).toContain("Kamar Mandi 2")
    expect(body.message.actions).toHaveLength(1)
    const action = body.message.actions[0]
    expect(action.type).toBe("updateRoom")
    expect(action.roomId).toBe("r4")
    expect(action.patch.floorId).toBe("f1")
    // Spatially verified placement (the reported bug: it must NOT land on
    // top of "Kamar Mandi 1", the room already on the destination floor).
    const movedRect = { x: action.patch.x, y: action.patch.y, width: 2, depth: 2 }
    for (const other of floorplanScene.rooms.filter((r) => r.floorId === "f1")) {
      expect(rectsOverlap(movedRect, other)).toBe(false)
    }
    expect(vi.mocked(creditsRepo.spendCredits)).not.toHaveBeenCalled()
    expect(vi.mocked(llm.chatJSON)).not.toHaveBeenCalled()
  })

  it("handles kitchen-family open-plan intent deterministically instead of returning fallback", async () => {
    const token = await signToken("user-open-plan")
    const floorplanScene = {
      site: { widthM: 8, depthM: 8 },
      floors: [{ id: "f1", name: "Lantai 1", level: 1 }],
      selectedFloorId: "f1",
      selectedRoomId: "keluarga",
      rooms: [
        { id: "carport", name: "Carport", type: "carport", floorId: "f1", x: 0.28, y: 0.28, width: 2.88, depth: 3.82, areaM2: 11, locked: false },
        { id: "dapur", name: "Dapur", type: "dapur", floorId: "f1", x: 3.22, y: 0.28, width: 4.5, depth: 1.72, areaM2: 7.74, locked: false },
        { id: "km1", name: "Kamar mandi 1", type: "kamar_mandi", floorId: "f1", x: 4.57, y: 2, width: 3.15, depth: 1.32, areaM2: 4.16, locked: false },
        { id: "keluarga", name: "Ruang keluarga", type: "ruang_keluarga", floorId: "f1", x: 3.22, y: 3.32, width: 4.5, depth: 4.38, areaM2: 19.71, locked: false },
        { id: "tamu", name: "Ruang tamu", type: "ruang_tamu", floorId: "f1", x: 0.28, y: 4.14, width: 2.88, depth: 3.56, areaM2: 10.25, locked: false },
      ],
      openings: [],
    }
    vi.mocked(actionsLib.parseScene).mockReturnValueOnce(floorplanScene as never)

    const res = await POST(
      bodyReq(token, {
        mode: "floorplan",
        instruction:
          "posisi kamar mandi di lantai 1 sepertinya kurang pas, berada di tengah area yang harusnya clean (dapur & ruang keluarga), yang mana 2 ruangan ini jika disambungkan akan lebih elok",
        scene: floorplanScene,
      }),
      ctx
    )

    expect(res.status).toBe(200)
    const body = await parseSSE(res)
    expect(body.message.content).not.toContain("belum berhasil")
    expect(body.message.content.toLowerCase()).toContain("komposisi ruang")
    expect(body.message.actions).toEqual([
      { type: "updateRoom", roomId: "km1", patch: { x: 5.92, width: 1.8, depth: 2.22 } },
      { type: "updateRoom", roomId: "keluarga", patch: { width: 2.7 } },
      { type: "updateRoom", roomId: "dapur", patch: { zoneId: "zone-open-dapur-keluarga" } },
      { type: "updateRoom", roomId: "keluarga", patch: { zoneId: "zone-open-dapur-keluarga" } },
    ])
    expect(vi.mocked(creditsRepo.spendCredits)).not.toHaveBeenCalled()
    expect(vi.mocked(llm.chatJSON)).not.toHaveBeenCalled()
  })

  it("repairs a small-room warning deterministically instead of returning fallback", async () => {
    const token = await signToken("user-small-warning")
    const floorplanScene = {
      site: { widthM: 8, depthM: 8 },
      floors: [{ id: "f1", name: "Lantai 1", level: 1 }],
      selectedFloorId: "f1",
      selectedRoomId: "km1",
      rooms: [
        { id: "carport", name: "Carport", type: "carport", floorId: "f1", x: 0.28, y: 0.28, width: 2.88, depth: 3.82, areaM2: 11, locked: false },
        { id: "dapur", name: "Dapur", type: "dapur", floorId: "f1", x: 3.22, y: 0.28, width: 4.5, depth: 1.72, areaM2: 7.74, locked: false },
        { id: "km1", name: "Kamar mandi 1", type: "kamar_mandi", floorId: "f1", x: 5.92, y: 1.92, width: 1.8, depth: 1.4, areaM2: 2.52, locked: false },
        { id: "keluarga", name: "Ruang keluarga", type: "ruang_keluarga", floorId: "f1", x: 3.22, y: 3.32, width: 4.5, depth: 4.38, areaM2: 19.71, locked: false },
        { id: "tamu", name: "Ruang tamu", type: "ruang_tamu", floorId: "f1", x: 0.28, y: 4.14, width: 2.88, depth: 3.56, areaM2: 10.25, locked: false },
      ],
      openings: [],
    }
    vi.mocked(actionsLib.parseScene).mockReturnValueOnce(floorplanScene as never)

    const res = await POST(
      bodyReq(token, {
        mode: "floorplan",
        instruction:
          "Aksi yang saya inginkan: bantu perbaiki peringatan ini dengan perubahan denah yang aman. Peringatan: Kamar mandi 1 cukup kecil (2.52 m²). Tingkat: Info. Kategori: Tata ruang. Objek terkait: Kamar mandi 1 (kamar_mandi) di 1.8 x 1.4 m, posisi 5.92, 1.92.",
        scene: floorplanScene,
      }),
      ctx
    )

    expect(res.status).toBe(200)
    const body = await parseSSE(res)
    expect(body.message.content).not.toContain("belum berhasil")
    expect(body.message.actions).toEqual([
      { type: "updateRoom", roomId: "km1", patch: { x: 5.14, width: 2.86 } },
      { type: "updateRoom", roomId: "dapur", patch: { depth: 1.64 } },
    ])
    expect(vi.mocked(creditsRepo.spendCredits)).not.toHaveBeenCalled()
    expect(vi.mocked(llm.chatJSON)).not.toHaveBeenCalled()
  })

  it("treats a short room-name reply as a follow-up sacrifice room for the previous small-room warning", async () => {
    const token = await signToken("user-small-followup")
    const floorplanScene = {
      site: { widthM: 8, depthM: 8 },
      floors: [{ id: "f1", name: "Lantai 1", level: 1 }],
      selectedFloorId: "f1",
      selectedRoomId: "km1",
      rooms: [
        { id: "carport", name: "Carport", type: "carport", floorId: "f1", x: 0.28, y: 0.28, width: 2.88, depth: 3.82, areaM2: 11, locked: false },
        { id: "dapur", name: "Dapur", type: "dapur", floorId: "f1", x: 3.22, y: 0.28, width: 4.5, depth: 1.72, areaM2: 7.74, locked: false },
        { id: "km1", name: "Kamar mandi 1", type: "kamar_mandi", floorId: "f1", x: 5.92, y: 1.92, width: 1.8, depth: 1.4, areaM2: 2.52, locked: false },
        { id: "keluarga", name: "Ruang keluarga", type: "ruang_keluarga", floorId: "f1", x: 3.22, y: 3.32, width: 4.5, depth: 4.38, areaM2: 19.71, locked: false },
        { id: "tamu", name: "Ruang tamu", type: "ruang_tamu", floorId: "f1", x: 0.28, y: 4.14, width: 2.88, depth: 3.56, areaM2: 10.25, locked: false },
      ],
      openings: [],
    }
    vi.mocked(actionsLib.parseScene).mockReturnValueOnce(floorplanScene as never)
    vi.mocked(editorAssistantLib.buildContextFromMessages).mockReturnValueOnce([
      {
        role: "user",
        content:
          "Aksi yang saya inginkan: bantu perbaiki peringatan ini dengan perubahan denah yang aman. Peringatan: Kamar mandi 1 cukup kecil (2.52 m²).",
      },
      {
        role: "assistant",
        content:
          "Kamar mandi 1 memang terlalu kecil, tetapi saya belum menemukan pembesaran aman tanpa membuat ruang lain tumpang-tindih atau ikut terlalu kecil. Sebutkan ruang tetangga mana yang boleh dikorbankan/diubah lebih besar bila ingin saya coba lagi.",
      },
    ])

    const res = await POST(
      bodyReq(token, {
        mode: "floorplan",
        instruction: "ruang keluarga",
        scene: floorplanScene,
      }),
      ctx
    )

    expect(res.status).toBe(200)
    const body = await parseSSE(res)
    expect(body.message.content).not.toContain("belum berhasil")
    expect(body.message.actions).toEqual([
      { type: "updateRoom", roomId: "km1", patch: { x: 5.14, y: 2, width: 2.86 } },
      { type: "updateRoom", roomId: "keluarga", patch: { y: 3.4, depth: 4.3 } },
    ])
    expect(vi.mocked(creditsRepo.spendCredits)).not.toHaveBeenCalled()
    expect(vi.mocked(llm.chatJSON)).not.toHaveBeenCalled()
  })

  it("returns a deterministic 'not found' reply when the requested room type is missing on the source floor, without calling the LLM", async () => {
    const token = await signToken("user-not-found")
    const floorplanScene = {
      site: { widthM: 8, depthM: 8 },
      floors: [
        { id: "f1", name: "Lantai 1", level: 1 },
        { id: "f2", name: "Lantai 2", level: 2 },
      ],
      selectedFloorId: "f1",
      selectedRoomId: null,
      rooms: [
        { id: "r1", name: "Kamar Tidur 1", type: "kamar_tidur", floorId: "f1", x: 0, y: 0, width: 3, depth: 3, areaM2: 9, locked: false },
      ],
      openings: [],
    }
    vi.mocked(actionsLib.parseScene).mockReturnValueOnce(floorplanScene as never)

    const res = await POST(
      bodyReq(token, {
        mode: "floorplan",
        instruction: "pindah kamar mandi dari lantai 1 ke lantai 2",
        scene: floorplanScene,
      }),
      ctx
    )
    expect(res.status).toBe(200)
    const body = await parseSSE(res)
    expect(body.message.content).toContain("Tidak menemukan")
    expect(body.message.actions).toBeFalsy()
    expect(vi.mocked(creditsRepo.spendCredits)).not.toHaveBeenCalled()
    expect(vi.mocked(llm.chatJSON)).not.toHaveBeenCalled()
  })
})

// Rate-limit guard added for the AI-abuse hardening pass (2026-08-15): this
// route had NO rate-limit and no credit gate on every path, unlike
// projects/[id]/agent which is credit-gated. See rate-limit.ts docstring for
// why the store must be reset between tests.
describe("POST /api/v1/projects/[id]/editor/assistant — rate limiting", () => {
  beforeEach(() => {
    __resetRateLimitStore()
    vi.mocked(creditsRepo.spendCredits).mockResolvedValue("ok")
    vi.mocked(llm.chatJSON).mockResolvedValue({ reply: "Sofa ditambahkan.", actions: [] })
  })

  it("allows 15 requests in the window, then 429s the 16th, with a Retry-After surfaced via SSE", async () => {
    const token = await signToken("rl-user-a")
    for (let i = 0; i < 15; i++) {
      const res = await POST(bodyReq(token, validBody), ctx)
      const body = await parseSSE(res)
      expect(body.error).toBeUndefined()
    }

    const blockedRes = await POST(bodyReq(token, validBody), ctx)
    // The route always answers HTTP 200 (SSE transport); the real status is
    // folded into the emitted JSON event instead.
    expect(blockedRes.status).toBe(200)
    const blockedBody = await parseSSE(blockedRes)
    expect(blockedBody.status).toBe(429)
    expect(blockedBody.retryAfter).toBeGreaterThan(0)
  })

  it("does not let one user's exhausted quota affect a different user", async () => {
    const tokenA = await signToken("rl-user-b")
    for (let i = 0; i < 15; i++) {
      await POST(bodyReq(tokenA, validBody), ctx)
    }
    const blockedA = await parseSSE(await POST(bodyReq(tokenA, validBody), ctx))
    expect(blockedA.status).toBe(429)

    const tokenB = await signToken("rl-user-c")
    const okB = await parseSSE(await POST(bodyReq(tokenB, validBody), ctx))
    expect(okB.status).toBeUndefined()
    expect(okB.message).toBeTruthy()
  })

  it("leaves the normal (non-rate-limited) path returning 200 with a message", async () => {
    const token = await signToken("rl-user-d")
    const res = await POST(bodyReq(token, validBody), ctx)
    expect(res.status).toBe(200)
    const body = await parseSSE(res)
    expect(body.status).toBeUndefined()
    expect(body.message.content).toBe("Sofa ditambahkan.")
  })
})
