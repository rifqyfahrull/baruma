import { z } from "zod"
import { requireUser } from "@/lib/server/auth-server"
import { getOwnedProject } from "@/lib/server/repo/projects"
import { getBriefPayload } from "@/lib/server/repo/briefs"
import { getLayoutPayload, insertLayoutIfAbsent } from "@/lib/server/repo/layouts"
import { insertComment, assembleReview } from "@/lib/server/repo/review"
import { ok, err, handleError } from "@/lib/server/response"
import { generateLayout } from "@/lib/mock/layout"
import { generateReview } from "@/lib/mock/review"

const schema = z.object({ body: z.string().min(1) })

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const { userId } = await requireUser(request)
    const { id } = await ctx.params
    const project = await getOwnedProject(id, userId)
    if (!project) return err(404, "Project not found")

    const rawBody = await request.json()
    const parsed = schema.safeParse(rawBody)
    if (!parsed.success) {
      return err(400, parsed.error.issues[0]?.message ?? "Invalid request")
    }

    await insertComment(id, parsed.data.body)

    const brief = await getBriefPayload(id)
    if (!brief) return err(404, "Brief not found")
    let layout = await getLayoutPayload(id)
    if (!layout) {
      layout = generateLayout(project, brief)
      layout = (await insertLayoutIfAbsent(id, project.currentVersionId ?? `ver-${id}`, layout)).layout
    }
    const generated = generateReview(project, brief, layout)
    const review = await assembleReview({
      projectId: id,
      versionId: project.currentVersionId ?? `ver-${id}`,
      generatedWarnings: generated.warnings,
      generatedChecklist: generated.checklist,
      aiSummary: generated.aiSummary,
    })
    return ok(review)
  } catch (e) {
    return handleError(e)
  }
}
