import { requireUser } from "@/lib/server/auth-server"
import { getOwnedProject, updateProject } from "@/lib/server/repo/projects"
import { getAlternatives } from "@/lib/server/repo/alternatives"
import { ok, err, handleError } from "@/lib/server/response"
import { nanoid } from "nanoid"

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string; altId: string }> }
): Promise<Response> {
  try {
    const { userId } = await requireUser(request)
    const { id, altId } = await ctx.params
    const project = await getOwnedProject(id, userId)
    if (!project) return err(404, "Project not found")

    const alts = await getAlternatives(id)
    const alt = alts.find((a) => a.id === altId)
    if (!alt) return err(404, "Alternative not found")

    const versionId = `ver-${nanoid(6)}`
    const updated = await updateProject(id, userId, {
      status: "editing",
      readiness: alt.readiness,
      thumbnail: alt.thumbnail,
      currentVersionId: versionId,
    })
    if (!updated) return err(404, "Project not found")
    return ok(updated)
  } catch (e) {
    return handleError(e)
  }
}
