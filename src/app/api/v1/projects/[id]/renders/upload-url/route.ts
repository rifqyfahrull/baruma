import { requireUser } from "@/lib/server/auth-server"
import { getOwnedProject } from "@/lib/server/repo/projects"
import { ok, err, handleError } from "@/lib/server/response"
import { storageEnabled, renderInputKey } from "@/lib/server/storage"
import { z } from "zod"

/**
 * POST /api/v1/projects/[id]/renders/upload-url — signed-upload leg utk input
 * AI Render (beauty/depth pass, PNG). Meniru pola
 * assets/upload-url/route.ts: uploadUrl adalah proxy same-origin
 * (/api/v1/assets/file/<key>), bukan URL S3 langsung — bucket tetap privat,
 * tak butuh CORS. Hanya PNG (bukan GLB) yang diterima di sini.
 */
const bodySchema = z.object({
  filename: z.string().min(1),
  contentType: z.literal("image/png"),
})

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const { userId } = await requireUser(request)
    const { id: projectId } = await ctx.params
    const project = await getOwnedProject(projectId, userId)
    if (!project) return err(404, "Project not found")

    let raw: unknown
    try {
      raw = await request.json()
    } catch {
      return err(400, "Invalid JSON body")
    }
    const parsed = bodySchema.safeParse(raw)
    if (!parsed.success) return err(400, parsed.error.issues[0]?.message ?? "Invalid input")

    if (!storageEnabled()) {
      return err(503, "Object storage belum dikonfigurasi")
    }

    const key = renderInputKey(userId, projectId, parsed.data.filename)
    const uploadUrl = `/api/v1/assets/file/${key}`

    return ok({ key, uploadUrl })
  } catch (e) {
    return handleError(e)
  }
}
