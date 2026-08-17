import { requireUser, requireAdmin } from "@/lib/server/auth-server"
import { getOwnedProject } from "@/lib/server/repo/projects"
import { ok, err, handleError } from "@/lib/server/response"
import {
  featureFlagConfigsFromEnv,
  resolveFeatureCapabilities,
} from "@/lib/features"

/**
 * Typed capability set untuk rollout fitur eksterior (roadmap §21).
 *
 * Server adalah satu-satunya penentu: role admin (DB-fresh via requireAdmin)
 * + konfigurasi env + stable hash `flag + projectId`. Client hanya memakai
 * hasilnya untuk menampilkan/menyembunyikan creation UI — data existing tetap
 * dibaca dan dirender walau flag off.
 */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const { userId } = await requireUser(request)
    const { id } = await ctx.params
    const project = await getOwnedProject(id, userId)
    if (!project) return err(404, "Project not found")

    let isAdmin = false
    try {
      await requireAdmin(request)
      isAdmin = true
    } catch {
      isAdmin = false
    }

    return ok(
      resolveFeatureCapabilities(id, featureFlagConfigsFromEnv(process.env), {
        isAdmin,
      })
    )
  } catch (e) {
    return handleError(e)
  }
}
