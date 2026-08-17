import { requireUser } from "@/lib/server/auth-server"
import { requirePlanFeature } from "@/lib/server/entitlements"
import { ok, err, handleError } from "@/lib/server/response"
import { createUserAsset, createIngestionJob } from "@/lib/server/repo/assets"
import { z } from "zod"
import { nanoid } from "nanoid"

const bodySchema = z.object({
  projectId: z.string(),
  // Optional: library-mode upload (langsung ke My Library, tanpa attach slot).
  roomId: z.string().optional(),
  slotId: z.string().optional(),
  expectedCategory: z.string(),
  fileUrl: z.string(),
  originalFilename: z.string(),
  sourceName: z.string().optional(),
  sourceUrl: z.string().optional(),
})

export async function POST(request: Request): Promise<Response> {
  try {
    const { userId } = await requireUser(request)
    // Feature gate — same rationale as upload-url: check plan entitlement
    // before doing any work.
    await requirePlanFeature(userId, "glbUpload")

    let raw: unknown
    try { raw = await request.json() } catch { return err(400, "Invalid JSON body") }
    const parsed = bodySchema.safeParse(raw)
    if (!parsed.success) return err(400, parsed.error.issues[0]?.message ?? "Invalid input")

    const { projectId, roomId, slotId, expectedCategory, fileUrl, originalFilename, sourceName, sourceUrl } = parsed.data

    // fileUrl akan disimpan sebagai model_url lalu dimuat useGLTF & dijadikan
    // href unduh. Klien tak boleh mengarahkannya ke origin/asal sembarang
    // (SSRF/penyalahgunaan). Wajib proxy same-origin milik user & proyek ini.
    const expectedPrefix = `/api/v1/assets/file/uploads/${userId}/${projectId}/`
    if (!fileUrl.startsWith(expectedPrefix) || !fileUrl.endsWith(".glb") || fileUrl.includes("..")) {
      return err(400, "fileUrl tidak valid")
    }

    const assetId = `asset-${nanoid(12)}`
    await createUserAsset(assetId, userId, {
      name: originalFilename.replace(/\.glb$/i, ""),
      category: expectedCategory,
      originalFilename,
      modelUrl: fileUrl,
      fileSizeBytes: 0, // will be updated after client analysis
      sourceName,
      sourceUrl,
    })

    const jobId = `job-${nanoid(12)}`
    await createIngestionJob(jobId, userId, {
      assetId,
      projectId,
      roomId,
      slotId,
      expectedCategory,
    })

    return ok({ jobId, assetId, status: "uploaded" }, 201)
  } catch (e) {
    return handleError(e)
  }
}
