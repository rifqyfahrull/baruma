import { z } from "zod"
import { requireUser } from "@/lib/server/auth-server"
import { getOwnedProject, updateProjectSite } from "@/lib/server/repo/projects"
import { getBriefPayload, patchBrief } from "@/lib/server/repo/briefs"
import { ok, err, handleError } from "@/lib/server/response"
import type { Site } from "@/types"

/** Shallow-validate PATCH body: must be a non-null object (no arrays). */
const patchBodySchema = z
  .record(z.string(), z.unknown())
  .refine((v) => !Array.isArray(v), { message: "Body must be an object, not an array" })

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const { userId } = await requireUser(request)
    const { id } = await ctx.params
    const project = await getOwnedProject(id, userId)
    if (!project) return err(404, "Project not found")
    const brief = await getBriefPayload(id)
    if (!brief) return err(404, "Brief not found")
    return ok(brief)
  } catch (e) {
    return handleError(e)
  }
}

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const { userId } = await requireUser(request)
    const { id } = await ctx.params
    const project = await getOwnedProject(id, userId)
    if (!project) return err(404, "Project not found")

    let rawBody: unknown
    try {
      rawBody = await request.json()
    } catch {
      return err(400, "Invalid JSON body")
    }

    const parsed = patchBodySchema.safeParse(rawBody)
    if (!parsed.success) {
      return err(400, parsed.error.issues[0]?.message ?? "Invalid request body")
    }

    const updated = await patchBrief(id, parsed.data as Parameters<typeof patchBrief>[1])
    if (!updated) return err(404, "Brief not found")

    // Project.site (read by the design audit engine) must stay in sync with
    // Brief.site — see updateProjectSite for why this can't be skipped.
    const sitePatch = (parsed.data as { site?: unknown }).site
    if (sitePatch && typeof sitePatch === "object") {
      await updateProjectSite(id, userId, sitePatch as Site)
    }

    return ok(updated)
  } catch (e) {
    return handleError(e)
  }
}
