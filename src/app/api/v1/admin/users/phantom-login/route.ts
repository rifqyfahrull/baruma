import { phantomLoginSchema } from "@/lib/schemas/admin"
import { requireAdmin, signToken } from "@/lib/server/auth-server"
import { getProfileById } from "@/lib/server/repo/profiles"
import { err, handleError, ok } from "@/lib/server/response"

export const dynamic = "force-dynamic"

const PHANTOM_TTL_SECONDS = 15 * 60

export async function POST(request: Request): Promise<Response> {
  try {
    await requireAdmin(request)
    const body = await request.json().catch(() => null)
    const parsed = phantomLoginSchema.safeParse(body)
    if (!parsed.success) {
      return err(400, parsed.error.issues[0]?.message ?? "Input tidak valid")
    }

    const target = await getProfileById(parsed.data.profileId)
    if (!target) return err(404, "Profil tidak ditemukan")

    const token = await signToken(target.id, `${PHANTOM_TTL_SECONDS}s`)
    const hash = new URLSearchParams({
      phantom_token: token,
      phantom_profile_id: target.id,
      phantom_profile_name: target.name,
      phantom_profile_email: target.email,
    })
    return ok({
      url: `/app/dashboard#${hash.toString()}`,
      expiresAt: new Date(Date.now() + PHANTOM_TTL_SECONDS * 1000).toISOString(),
    })
  } catch (e) {
    return handleError(e)
  }
}
