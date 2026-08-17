import { requireUser } from "@/lib/server/auth-server"
import { getOwnedProject } from "@/lib/server/repo/projects"
import { getInteriorPayload, upsertInterior } from "@/lib/server/repo/interiors"
import { getUserAsset } from "@/lib/server/repo/assets"
import { ok, err, handleError } from "@/lib/server/response"
import { z } from "zod"
import type { FitMode, MaterialMode } from "@/types"

const bodySchema = z.object({
  assetId: z.string(),
  fitMode: z.string().optional(),
  materialMode: z.string().optional(),
  materialMap: z.record(z.string(), z.string()).optional(),
})

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string; slotId: string }> }
): Promise<Response> {
  try {
    const { userId } = await requireUser(request)
    const { id: projectId, slotId } = await ctx.params
    const project = await getOwnedProject(projectId, userId)
    if (!project) return err(404, "Project not found")

    let raw: unknown
    try { raw = await request.json() } catch { return err(400, "Invalid JSON body") }
    const parsed = bodySchema.safeParse(raw)
    if (!parsed.success) return err(400, "Invalid input")

    const { assetId, fitMode, materialMode } = parsed.data

    // Resolve the asset (owner-scoped) — the furniture item must carry the
    // asset's modelUrl too: the 3D renderer loads `item.modelUrl`, so an
    // attachment that only records modelAssetId never shows up on screen.
    const asset = await getUserAsset(userId, assetId)
    if (!asset) return err(404, "Asset not found")

    const saved = await getInteriorPayload(projectId)
    if (!saved) return err(404, "No interior plan found")

    // Find the furniture item in the interior plan and attach the asset
    let found = false
    const updatedRooms = saved.rooms.map((room) => ({
      ...room,
      furniture: room.furniture.map((item) => {
        if (item.id === slotId) {
          found = true
          return {
            ...item,
            modelAssetId: assetId,
            modelUrl: asset.model_url,
            fitMode: (fitMode as FitMode) ?? null,
            materialMode: (materialMode as MaterialMode) ?? null,
            scaleFactor: null,
          }
        }
        return item
      }),
    }))

    if (!found) return err(404, "Slot not found in interior plan")

    await upsertInterior(projectId, saved.versionId, {
      ...saved,
      rooms: updatedRooms,
    })

    return ok({
      slotId,
      assetId,
      modelUrl: asset.model_url,
      consistencyScore: 85,
      warnings: [] as string[],
    })
  } catch (e) {
    return handleError(e)
  }
}
