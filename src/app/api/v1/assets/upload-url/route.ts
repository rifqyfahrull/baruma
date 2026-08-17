import { requireUser } from "@/lib/server/auth-server"
import { requirePlanFeature } from "@/lib/server/entitlements"
import { ok, err, handleError } from "@/lib/server/response"
import { storageEnabled, assetKey, assetPublicUrl } from "@/lib/server/storage"
import { z } from "zod"

const bodySchema = z.object({
  projectId: z.string(),
  filename: z.string().min(1).refine((f) => f.endsWith(".glb"), "Hanya file GLB yang didukung"),
  contentType: z.string(),
  fileSizeBytes: z.number().max(100 * 1024 * 1024, "Ukuran file maksimal 100MB"),
})

export async function POST(request: Request): Promise<Response> {
  try {
    const { userId } = await requireUser(request)
    // Feature gate — checked before the storage-config check: a 403 telling a
    // free-plan user this feature is locked is clearer than a 503 about
    // storage config they have no reason to know about.
    await requirePlanFeature(userId, "glbUpload")

    let raw: unknown
    try { raw = await request.json() } catch { return err(400, "Invalid JSON body") }
    const parsed = bodySchema.safeParse(raw)
    if (!parsed.success) return err(400, parsed.error.issues[0]?.message ?? "Invalid input")

    const { projectId, filename } = parsed.data

    if (!storageEnabled()) {
      return err(503, "Object storage belum dikonfigurasi")
    }

    const key = assetKey(userId, projectId, filename)
    // Same-origin proxy PUT/GET (private bucket, no CORS needed): the browser
    // uploads to our route, which streams to R2 with server-side signing.
    const uploadUrl = `/api/v1/assets/file/${key}`
    const fileUrl = assetPublicUrl(key)

    return ok({ uploadUrl, fileUrl, expiresIn: 900 })
  } catch (e) {
    return handleError(e)
  }
}
