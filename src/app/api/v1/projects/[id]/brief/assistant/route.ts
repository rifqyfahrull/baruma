import { z } from "zod"

import { requireUser } from "@/lib/server/auth-server"
import { getOwnedProject } from "@/lib/server/repo/projects"
import { getBriefPayload } from "@/lib/server/repo/briefs"
import { getLayoutPayload } from "@/lib/server/repo/layouts"
import { spendCredits, refundCredits } from "@/lib/server/repo/credits"
import { ok, err, errCode, handleError } from "@/lib/server/response"
import { rateLimitGuard } from "@/lib/server/rate-limit"
import { askAgentLab } from "@/lib/server/agent-lab"
import { buildAssistantContextBlocks } from "@/lib/server/brief-assistant-context"
import { auditDesign } from "@/lib/audit/design-audit"
import { summarizeAuditForPrompt } from "@/lib/audit/audit-intent"

const bodySchema = z.object({
  question: z.string().trim().min(1, "Pertanyaan tidak boleh kosong").max(1000),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(4000),
      })
    )
    .max(20)
    .optional(),
})

const FALLBACK = "Maaf, asisten AI sedang sibuk. Coba lagi sebentar ya."
const AGENT_SLUG = "baruma-assistant"

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const { userId } = await requireUser(request)

    // 10/menit/user — percakapan brief wajar (tanya-jawab beruntun), ketat
    // terhadap spam pertanyaan yang tiap kalinya memotong kredit & memanggil LLM.
    const limited = rateLimitGuard(request, {
      scope: "brief-assistant",
      limit: 10,
      windowMs: 60_000,
      keyExtra: userId,
    })
    if (limited) return limited

    const { id } = await ctx.params
    const project = await getOwnedProject(id, userId)
    if (!project) return err(404, "Project not found")

    const brief = await getBriefPayload(id)
    if (!brief) return err(404, "Brief not found")

    let rawBody: unknown
    try {
      rawBody = await request.json()
    } catch {
      return err(400, "Invalid JSON body")
    }

    const parsed = bodySchema.safeParse(rawBody)
    if (!parsed.success) {
      return err(400, parsed.error.issues[0]?.message ?? "Invalid request body")
    }

    // Credit gate — reserved BEFORE calling the LLM, refunded if it throws.
    const spend = await spendCredits(userId, 1, "brief_assistant", id)
    if (spend === "insufficient") {
      return errCode(
        402,
        "insufficient_credits",
        "Kredit AI Anda telah habis. Upgrade plan untuk melanjutkan."
      )
    }

    // Ground the assistant in the real, computed standards status when a
    // layout exists — so "apakah desain saya sudah bagus/sesuai standar?"
    // is answered from facts, not the model's guesses. Strictly best-effort:
    // any failure loading/auditing the layout just omits the note and never
    // blocks the answer.
    let standardsNote: string | undefined
    try {
      const layout = await getLayoutPayload(id)
      if (layout) standardsNote = summarizeAuditForPrompt(auditDesign({ project, layout, brief }))
    } catch {
      standardsNote = undefined
    }

    const contextBlocks = buildAssistantContextBlocks({
      brief,
      history: parsed.data.history ?? [],
      standardsNote,
    })
    let answer: string | null
    try {
      answer = await askAgentLab(AGENT_SLUG, {
        userId,
        text: parsed.data.question,
        contextBlocks,
      })
    } catch (e) {
      await refundCredits(userId, 1, "brief_assistant_refund", id)
      throw e
    }
    if (answer === null) {
      // The realistic LLM failure mode: askAgentLab swallows HTTP/timeout/parse
      // errors (and clarify/refuse) internally and resolves to null instead of
      // throwing. Refund here too, without changing the graceful FALLBACK below.
      await refundCredits(userId, 1, "brief_assistant_refund", id)
    }

    return ok({ answer: answer ?? FALLBACK })
  } catch (e) {
    return handleError(e)
  }
}
