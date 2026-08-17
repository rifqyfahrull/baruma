import { requireUser } from "@/lib/server/auth-server"
import { getOwnedProject, updateProject, deleteProject } from "@/lib/server/repo/projects"
import { ok, err, handleError } from "@/lib/server/response"
import { renameProjectSchema } from "@/lib/schemas/project"

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const { userId } = await requireUser(request)
    const { id } = await ctx.params
    const project = await getOwnedProject(id, userId)
    if (!project) return err(404, "Project not found")
    return ok(project)
  } catch (e) {
    return handleError(e)
  }
}

/** Ganti nama project — satu-satunya field PATCH yang didukung saat ini. */
export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const { userId } = await requireUser(request)
    const { id } = await ctx.params

    let rawBody: unknown
    try {
      rawBody = await request.json()
    } catch {
      return err(400, "Invalid JSON body")
    }

    const parsed = renameProjectSchema.safeParse(rawBody)
    if (!parsed.success) {
      return err(400, parsed.error.issues[0]?.message ?? "Invalid request body")
    }

    const updated = await updateProject(id, userId, { name: parsed.data.name })
    if (!updated) return err(404, "Project not found")
    return ok(updated)
  } catch (e) {
    return handleError(e)
  }
}

export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const { userId } = await requireUser(request)
    const { id } = await ctx.params
    const deleted = await deleteProject(id, userId)
    if (!deleted) return err(404, "Project not found")
    return ok({ deleted: true })
  } catch (e) {
    return handleError(e)
  }
}
