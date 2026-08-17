import { requireUser } from "@/lib/server/auth-server"
import { getOwnedProject } from "@/lib/server/repo/projects"
import { getAlternatives } from "@/lib/server/repo/alternatives"
import { ok, err, handleError } from "@/lib/server/response"

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const { userId } = await requireUser(request)
    const { id } = await ctx.params
    const project = await getOwnedProject(id, userId)
    if (!project) return err(404, "Project not found")
    const alternatives = await getAlternatives(id)
    return ok(alternatives)
  } catch (e) {
    return handleError(e)
  }
}
