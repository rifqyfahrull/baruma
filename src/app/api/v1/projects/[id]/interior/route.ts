import { requireUser } from "@/lib/server/auth-server"
import { getOwnedProject } from "@/lib/server/repo/projects"
import { getInteriorPayload, upsertInterior } from "@/lib/server/repo/interiors"
import { ok, err, handleError } from "@/lib/server/response"
import { savedInteriorSchema } from "@/lib/schemas/interior"

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const { userId } = await requireUser(request)
    const { id } = await ctx.params
    const project = await getOwnedProject(id, userId)
    if (!project) return err(404, "Project not found")

    const saved = await getInteriorPayload(id)
    return ok(saved)
  } catch (e) {
    return handleError(e)
  }
}

export async function PUT(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const { userId } = await requireUser(request)
    const { id } = await ctx.params
    const project = await getOwnedProject(id, userId)
    if (!project) return err(404, "Project not found")

    let raw: unknown
    try {
      raw = await request.json()
    } catch {
      return err(400, "Invalid JSON body")
    }
    const parsed = savedInteriorSchema.safeParse(raw)
    if (!parsed.success) return err(400, "Invalid interior payload")

    const saved = await upsertInterior(id, parsed.data.versionId, parsed.data)
    return ok(saved)
  } catch (e) {
    return handleError(e)
  }
}
