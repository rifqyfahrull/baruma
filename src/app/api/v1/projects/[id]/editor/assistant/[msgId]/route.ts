import { z } from "zod"

import { requireUser } from "@/lib/server/auth-server"
import { getOwnedProject } from "@/lib/server/repo/projects"
import { ok, err, handleError } from "@/lib/server/response"
import { setMessageStatus } from "@/lib/server/repo/assistant"

const bodySchema = z.object({ status: z.enum(["applied", "dismissed"]) })

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string; msgId: string }> }
): Promise<Response> {
  try {
    const { userId } = await requireUser(request)
    const { id, msgId } = await ctx.params
    const project = await getOwnedProject(id, userId)
    if (!project) return err(404, "Project not found")

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return err(400, "Invalid JSON body")
    }
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) return err(400, "Invalid status")

    await setMessageStatus(id, msgId, parsed.data.status)
    return ok({ ok: true })
  } catch (e) {
    return handleError(e)
  }
}
