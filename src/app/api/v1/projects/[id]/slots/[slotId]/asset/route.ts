import { requireUser } from "@/lib/server/auth-server"
import { getOwnedProject } from "@/lib/server/repo/projects"
import { getInteriorPayload, upsertInterior } from "@/lib/server/repo/interiors"
import { ok, err, handleError } from "@/lib/server/response"

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string; slotId: string }> }
): Promise<Response> {
  try {
    const { userId } = await requireUser(_request)
    const { id: projectId, slotId } = await ctx.params
    const project = await getOwnedProject(projectId, userId)
    if (!project) return err(404, "Project not found")

    const saved = await getInteriorPayload(projectId)
    if (!saved) return err(404, "No interior plan found")

    let found = false
    const updatedRooms = saved.rooms.map((room) => ({
      ...room,
      furniture: room.furniture.map((item) => {
        if (item.id === slotId) {
          found = true
          return {
            ...item,
            modelAssetId: null,
            modelUrl: null,
            fitMode: null,
            materialMode: null,
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

    return ok({ slotId, status: "placeholder" })
  } catch (e) {
    return handleError(e)
  }
}
