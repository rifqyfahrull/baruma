import { requireUser } from "@/lib/server/auth-server"
import { getOwnedProject } from "@/lib/server/repo/projects"
import { getLayoutPayload } from "@/lib/server/repo/layouts"
import { getBriefPayload } from "@/lib/server/repo/briefs"
import { ok, err, handleError } from "@/lib/server/response"
import { auditDesign } from "@/lib/audit/design-audit"

/**
 * GET /api/v1/projects/:id/audit — grounded, deterministic design-standards
 * audit (SNI room/program, daylight, circulation, structural, sanitation,
 * KDB/KLB/GSB). Read-only, no credits: the numbers come from the layout, not
 * an LLM. The assistant + a future audit panel both read this.
 */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { userId } = await requireUser(request)
    const { id } = await ctx.params
    const project = await getOwnedProject(id, userId)
    if (!project) return err(404, "Project not found")

    const layout = await getLayoutPayload(id)
    if (!layout) return err(404, "Layout not found")
    const brief = await getBriefPayload(id)

    const audit = auditDesign({ project, layout, brief })
    return ok({ audit })
  } catch (e) {
    return handleError(e)
  }
}
