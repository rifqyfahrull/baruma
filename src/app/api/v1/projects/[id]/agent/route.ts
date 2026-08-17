import { requireUser } from "@/lib/server/auth-server"
import { getOwnedProject } from "@/lib/server/repo/projects"
import { getBriefPayload, upsertBrief } from "@/lib/server/repo/briefs"
import { getLayoutPayload } from "@/lib/server/repo/layouts"
import { getInteriorPayload } from "@/lib/server/repo/interiors"
import {
  claimTurn,
  completeTurn,
  failTurn,
  listMessages,
} from "@/lib/server/repo/assistant"
import { refundCreditsOnce, spendCreditsOnce } from "@/lib/server/repo/credits"
import { err, errCode, handleError, ok } from "@/lib/server/response"
import { rateLimitGuard } from "@/lib/server/rate-limit"
import { askAssistant, chatJSON, llmEnabled } from "@/lib/server/llm"
import { buildAssistantContextBlocks, formatExistingLayoutNote, buildBriefFromLayout, mapAuditFindingsToRisks } from "@/lib/server/brief-assistant-context"
import {
  describeAction,
  parseScene,
  projectAgentRequestSchema,
  type AssistantAction,
  type AssistantMessage,
  type AssistantMode,
  type FloorplanAction,
  type FloorplanScene,
  type InteriorScene,
} from "@/lib/assistant/actions"
import { floorplanSceneFromLayout, interiorSceneFromPlan } from "@/lib/assistant/scene"
import { applySavedInterior, generateInteriorPlan, interiorStyleFromHouseStyle } from "@/lib/interior/plan"
import {
  retrieveDesignKnowledge,
  formatDesignKnowledgeNote,
  sceneKnowledgeNote,
} from "@/lib/server/repo/design-knowledge"
import { appMechanicsNote } from "@/lib/server/repo/app-knowledge"
import { answerKnowledgeQuestion } from "@/lib/server/knowledge-answer"
import { answerFeatureQuestion } from "@/lib/assistant/feature-catalog"
import { searchAssetsForAgent, formatAssetSuggestionsNote, wantsAssetSuggestions } from "@/lib/server/repo/asset-search"
import {
  buildContextFromMessages,
  buildMessages,
  findFloorplanActionFeedback,
  sanitizeActions,
} from "@/lib/server/editor-assistant"
import { handleFloorplanInstruction } from "@/lib/assistant/deterministic"
import { buildInitialFloorplan } from "@/lib/server/initial-floorplan"
import { auditDesign } from "@/lib/audit/design-audit"
import { formatAuditReply, isDesignAuditIntent, summarizeAuditForPrompt } from "@/lib/audit/audit-intent"
import {
  EDITOR_AGENT_FALLBACK,
  EDITOR_AGENT_FALLBACK_NO_LLM,
  contextualFloorplanInstruction,
  runFloorplanAgentPass,
} from "@/app/api/v1/projects/[id]/editor/assistant/route"
import { clarificationReply, routeAgentIntent } from "@/lib/server/project-agent"

export const maxDuration = 120;
const BRIEF_FALLBACK = "Maaf, AI Agent sedang sibuk. Coba lagi sebentar ya."

function responseForExisting(claim: Awaited<ReturnType<typeof claimTurn>>) {
  if (claim.kind === "completed" && claim.reply) return ok({ message: claim.reply, duplicate: true })
  if (claim.kind === "processing") return ok({ pending: true, message: claim.message })
  if (claim.kind === "failed") return err(409, "Permintaan sebelumnya gagal. Coba kirim ulang.")
  return null
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const { userId } = await requireUser(request)
    const { id } = await ctx.params
    if (!(await getOwnedProject(id, userId))) return err(404, "Project not found")
    return ok({ messages: await listMessages(id) })
  } catch (error) {
    return handleError(error)
  }
}

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
          // SSE has no HTTP-status/header channel to the client, so a 429's
          // Retry-After header is folded into the JSON payload instead — see
          // the mirrored guard in editor/assistant/route.ts.
          const retryAfter = response.headers.get("Retry-After")
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'error',
            error: body?.error ?? 'Error',
            status: response.status,
            ...(retryAfter ? { retryAfter: Number(retryAfter) } : {}),
          })}\n\n`))
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

async function runLogic(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
  onProgress?: (message: string) => void,
): Promise<Response> {
  let claimedMessageId: string | null = null
  let claimedUserMessage: AssistantMessage | null = null
  let creditReserved = false
  let userIdForRefund: string | null = null
  let requestIdForRefund: string | null = null
  let projectIdForFailure: string | null = null

  try {
    const { userId } = await requireUser(request)
    userIdForRefund = userId

    // Rate guard ABOVE the credit gate: credits cap total volume, not
    // request rate, so a paid/credited user could otherwise still hammer the
    // LLM at will. Placed before claimTurn/spendCreditsOnce so a 429 never
    // touches credits. Same shape (and shared `scope`, so the budget is
    // shared) as the guard in editor/assistant/route.ts — see that file's
    // comment for the ~1-turn-per-20s sizing rationale and the pm2
    // cluster -i 2 (per-instance limiter → effective ceiling ≈2×) caveat.
    const userLimited = rateLimitGuard(request, {
      scope: "editor-assistant",
      limit: 15,
      windowMs: 5 * 60_000,
      keyExtra: userId,
    })
    if (userLimited) return userLimited

    const { id } = await ctx.params
    projectIdForFailure = id
    const project = await getOwnedProject(id, userId)
    if (!project) return err(404, "Project not found")

    let raw: unknown
    try {
      raw = await request.json()
    } catch {
      return err(400, "Invalid JSON body")
    }
    const parsed = projectAgentRequestSchema.safeParse(raw)
    if (!parsed.success) return err(400, parsed.error.issues[0]?.message ?? "Invalid request body")
    const input = parsed.data
    const allPreviousMessages = await listMessages(id)
    const lastMsg = allPreviousMessages.length > 0 ? allPreviousMessages[allPreviousMessages.length - 1] : null
    const previousMode = lastMsg?.mode

    const decision = routeAgentIntent(input, previousMode)
    const mode: AssistantMode = decision.kind === "route" ? decision.mode : "brief"
    const claim = await claimTurn({
      projectId: id,
      clientRequestId: input.clientRequestId,
      mode,
      surface: input.surface,
      content: input.instruction,
    })
    const existingResponse = responseForExisting(claim)
    if (existingResponse) return existingResponse
    claimedMessageId = claim.message.id
    claimedUserMessage = claim.message

    if (decision.kind === "clarify") {
      const message = await completeTurn(claim.message, {
        mode: "brief",
        surface: input.surface,
        content: clarificationReply(decision.suggestedModes),
      })
      return ok({ message, routedMode: "brief", clarification: true })
    }

    const historyMessages = allPreviousMessages.filter((message) => message.id !== claim.message.id)
    const history = buildContextFromMessages(historyMessages)
    const layout = mode === "brief" || mode === "floorplan" || mode === "interior"
      ? await getLayoutPayload(id)
      : null
    const brief = await getBriefPayload(id)

    let reply = ""
    let actions: AssistantAction[] = []
    let scene: FloorplanScene | InteriorScene | null = null
    let llmFailed = false
    let plannerNote: string | undefined

    // Rekomendasi aset NYATA: bila pengguna minta model/produk
    // (gate intent) — cari aset relevan (via enrichment describe) & suntikkan
    // ke prompt semua mode (brief, floorplan, interior). Gagal-diam.
    let assetSuggestionsNote: string | undefined
    try {
      if (wantsAssetSuggestions(input.instruction)) {
        const assets = await searchAssetsForAgent(input.instruction)
        if (assets.length) assetSuggestionsNote = formatAssetSuggestionsNote(assets)
      }
    } catch {
      /* asset grounding opsional — jangan gagalkan turn */
    }

    const reserveCredit = async (): Promise<Response | null> => {
      const spend = await spendCreditsOnce(userId, 1, "project_agent", input.clientRequestId)
      if (spend === "insufficient") {
        await failTurn(id, claim.message.id)
        return errCode(402, "insufficient_credits", "Kredit AI Anda telah habis. Upgrade plan untuk melanjutkan.")
      }
      creditReserved = true
      return null
    }

    if (mode === "brief") {
      // Pertanyaan KEMAMPUAN FITUR ("fitur apa saja yang ada?", "ada fitur
      // mezzanine?") dijawab deterministik dari kamus fitur (tanpa LLM, tanpa
      // kredit) sebelum agent brief dipanggil — konsisten dengan floorplan &
      // interior di bawah. Null → lanjut pipeline brief normal.
      const briefFeatureAnswer = answerFeatureQuestion(input.instruction)
      if (briefFeatureAnswer) {
        reply = briefFeatureAnswer
      } else if (!llmEnabled()) {
        reply = EDITOR_AGENT_FALLBACK_NO_LLM
      } else {
        let standardsNote: string | undefined
        if (layout && brief) {
          standardsNote = summarizeAuditForPrompt(auditDesign({ project, layout, brief }))
        }
        let designKnowledgeNote: string | undefined
        try {
          const rows = await retrieveDesignKnowledge(input.instruction)
          if (rows.length) designKnowledgeNote = formatDesignKnowledgeNote(rows)
        } catch {
          /* knowledge grounding opsional — jangan gagalkan turn */
        }
        const creditError = await reserveCredit()
        if (creditError) return creditError
        const existingLayoutNote = formatExistingLayoutNote(layout, project.site)
        const contextBlocks = buildAssistantContextBlocks({
          brief, history, standardsNote, designKnowledgeNote, assetSuggestionsNote, existingLayoutNote,
        })
        const answer = await askAssistant({
          userId, text: input.instruction, contextBlocks,
        })
        llmFailed = answer === null
        reply = answer ?? BRIEF_FALLBACK

        const isBriefSaveIntent = /setuju|buat\s*brief|generate\s*brief|simpan\s*brief|sesuai\s*denah|\bya\b/i.test(input.instruction)
        const isRiskIntent = /analisa|risiko|risk|catatan\s*risiko|audit/i.test(input.instruction)

        if (layout && (isBriefSaveIntent || isRiskIntent || !brief)) {
          let targetBrief = brief ?? buildBriefFromLayout(id, layout, project.site)
          const auditRes = auditDesign({ project, layout, brief: targetBrief })
          const mappedRisks = mapAuditFindingsToRisks(auditRes.findings)
          targetBrief = {
            ...targetBrief,
            risks: mappedRisks.length > 0 ? mappedRisks : targetBrief.risks,
          }
          await upsertBrief(id, targetBrief).catch(() => null)
        }
      }
    } else if (mode === "floorplan") {
      if (!layout) {
        reply = "Denah proyek belum tersedia. Pilih alternatif atau buat denah terlebih dahulu."
      } else {
        const live = input.liveScene?.mode === "floorplan" && input.liveScene.versionId === layout.versionId
          ? parseScene("floorplan", input.liveScene.payload)
          : null
        scene = (live as FloorplanScene | null) ?? floorplanSceneFromLayout(layout, project.site)

        if (isDesignAuditIntent(input.instruction)) {
          reply = formatAuditReply(auditDesign({ project, layout, brief }))
        } else {
          const effectiveInstruction = contextualFloorplanInstruction(input.instruction, history)
          let llmInstruction = effectiveInstruction

          // MEMBANGUN DENAH (kanvas kosong / reset eksplisit) secara DETERMINISTIK.
          // Regresi proj-modern-tropis-1 (2026-08-02): jalur AGENT ini selama ini
          // TIDAK memanggil buildInitialFloorplan, jadi "buatkan denah sesuai brief"
          // jatuh ke LLM yang tak sanggup menyusun koordinat (mentok 90s atau justru
          // membalas klarifikasi asing di tengah perintah membangun). Solver geometri
          // sudah tervalidasi (generateLayout) — pakai dulu; LLM hanya menangani
          // niat yang memang tidak deterministic. Dijalankan SEBELUM handler edit
          // karena matchAddRoom bisa ikut cocok dengan kalimat membangun.
          const initial = buildInitialFloorplan(effectiveInstruction, scene as FloorplanScene, project, brief)
          let deterministicMatched = initial.matched
          if (initial.matched) {
            reply = initial.reply
            actions = initial.actions
          } else {
            const deterministic = handleFloorplanInstruction(effectiveInstruction, scene as FloorplanScene)
            deterministicMatched = deterministic.matched
            if (deterministic.matched) {
              reply = deterministic.reply
              actions = deterministic.actions
              const feedback = actions.length
                ? findFloorplanActionFeedback(scene as FloorplanScene, actions as FloorplanAction[], effectiveInstruction)
                : []
              if (feedback.length) {
                deterministicMatched = false
                actions = []
                llmInstruction += `\n\nCatatan validator internal: ${feedback.join("; ")}. Cari solusi lain yang aman.`
              }
            }
          }
          if (!deterministicMatched) {
            // Pertanyaan KEMAMPUAN FITUR dijawab deterministik dari kamus fitur
            // (tanpa LLM, tanpa kredit) sebelum pipeline edit & knowledge Q&A.
            const featureAnswer = answerFeatureQuestion(input.instruction)
            if (featureAnswer) {
              reply = featureAnswer
            } else {
              const qa = await answerKnowledgeQuestion(input.instruction)
              if (qa) {
                const creditError = await reserveCredit()
                if (creditError) return creditError
                reply = qa
              } else if (!llmEnabled()) {
                reply = EDITOR_AGENT_FALLBACK_NO_LLM
              } else {
                const creditError = await reserveCredit()
                if (creditError) return creditError
                const planNote = await sceneKnowledgeNote(scene, llmInstruction)
                const mechNote = await appMechanicsNote(llmInstruction)
                const result = await runFloorplanAgentPass(
                  scene, llmInstruction, history, planNote, mechNote, assetSuggestionsNote, brief, undefined, onProgress,
                )
                reply = result.rawContent ?? result.reply
                actions = result.actions
                llmFailed = !!result.llmFailed
                plannerNote = result.plannerNote
              }
            }
          }
        }
      }
    } else {
      if (!layout) {
        reply = "Denah belum tersedia, jadi interior belum dapat ditata."
      } else {
        const live = input.liveScene?.mode === "interior" && input.liveScene.versionId === layout.versionId
          ? parseScene("interior", input.liveScene.payload)
          : null
        if (live) {
          scene = live as InteriorScene
        } else {
          const saved = await getInteriorPayload(id)
          const plan = saved && saved.versionId === layout.versionId
            ? applySavedInterior(layout, saved, { projectId: id })
            : generateInteriorPlan(layout, {
                projectId: id,
                versionId: layout.versionId,
                style: interiorStyleFromHouseStyle(project.style),
              })
          scene = interiorSceneFromPlan(plan, layout)
        }
        const featureAnswer = answerFeatureQuestion(input.instruction)
        if (featureAnswer) {
          reply = featureAnswer
        } else {
          const interiorQa = await answerKnowledgeQuestion(input.instruction)
          if (interiorQa) {
            const creditError = await reserveCredit()
            if (creditError) return creditError
            reply = interiorQa
          } else if (!llmEnabled()) {
            reply = EDITOR_AGENT_FALLBACK_NO_LLM
          } else {
            const creditError = await reserveCredit()
            if (creditError) return creditError
            const messages = buildMessages(
              "interior", scene, input.instruction, history,
              await sceneKnowledgeNote(scene, input.instruction),
              await appMechanicsNote(input.instruction),
              assetSuggestionsNote,
              brief,
            )
            const output = await chatJSON<{ reply?: string; actions?: unknown[]; needs_clarify?: unknown[]; options?: unknown[] }>(messages)
            llmFailed = output === null
            const rawContent = (output?.needs_clarify || output?.options) ? JSON.stringify(output) : null
            reply = rawContent ?? (typeof output?.reply === "string" && output.reply.trim()
              ? output.reply.trim()
              : EDITOR_AGENT_FALLBACK)
            actions = sanitizeActions("interior", Array.isArray(output?.actions) ? output.actions : [], scene)
          }
        }
      }
    }

    if (creditReserved && llmFailed) {
      await refundCreditsOnce(userId, 1, "project_agent_refund", input.clientRequestId)
      creditReserved = false
    }

    const labels = scene ? actions.map((action) => describeAction(action, scene!)) : []
    const message = await completeTurn(claim.message, {
      mode,
      surface: input.surface,
      content: reply,
      plannerNote,
      actions: actions.length ? actions : null,
      actionLabels: labels.length ? labels : null,
      status: actions.length ? "proposed" : null,
    })
    return ok({ message, routedMode: mode })
  } catch (error) {
    if (creditReserved && userIdForRefund && requestIdForRefund) {
      try {
        await refundCreditsOnce(userIdForRefund, 1, "project_agent_refund", requestIdForRefund)
      } catch {
        // Preserve the original error; ledger reconciliation remains auditable.
      }
    }
    if (claimedUserMessage && projectIdForFailure) {
      try {
        await completeTurn(claimedUserMessage, {
          mode: claimedUserMessage.mode,
          surface: claimedUserMessage.surface ?? "project",
          content: "Maaf, terjadi kendala saat memproses pesan ini. Tidak ada perubahan yang diterapkan. Silakan coba lagi.",
        })
      } catch {
        try {
          await failTurn(projectIdForFailure, claimedMessageId!)
        } catch {
          // Preserve the original error.
        }
      }
    }
    return handleError(error)
  }
}
