import { requireUser } from "@/lib/server/auth-server"
import { ok, err, handleError } from "@/lib/server/response"
import { updateAssetMetadata } from "@/lib/server/repo/assets"

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ assetId: string }> }
): Promise<Response> {
  try {
    const { userId } = await requireUser(request)
    const { assetId } = await ctx.params

    let raw: unknown
    try { raw = await request.json() } catch { return err(400, "Invalid JSON body") }
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return err(400, "Body harus objek metadata")
    }

    const updated = await updateAssetMetadata(assetId, userId, raw as Record<string, unknown>)
    if (!updated) return err(404, "Asset not found or no fields to update")

    // Kembalikan hanya kolom yang aman/relevan — jangan bocorkan seluruh baris
    // internal (RETURNING *) ke klien.
    return ok({
      id: updated.id,
      name: updated.name,
      category: updated.category,
      widthM: updated.width_m,
      depthM: updated.depth_m,
      heightM: updated.height_m,
      status: updated.status,
    })
  } catch (e) {
    return handleError(e)
  }
}
