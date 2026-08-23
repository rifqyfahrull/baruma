/**
 * Public comment box on a share link (WS-D §2) — NO auth, so the poster
 * types their own display name instead of getting "Kamu" (that literal is
 * reserved for the owner's own authenticated comments elsewhere).
 * Rate-limited 5/min/IP (`rateLimitGuard`) — the only write surface an
 * anonymous visitor gets on this route.
 */
import { z } from "zod"
import { getShareLinkByToken } from "@/lib/server/repo/share-links"
import { insertComment } from "@/lib/server/repo/review"
import { ok, err, handleError } from "@/lib/server/response"
import { rateLimitGuard } from "@/lib/server/rate-limit"

const schema = z.object({
  name: z.string().trim().min(1).max(60),
  body: z.string().trim().min(1).max(2000),
})

export async function POST(
  request: Request,
  ctx: { params: Promise<{ token: string }> }
): Promise<Response> {
  try {
    const limited = rateLimitGuard(request, {
      scope: "share-comment",
      limit: 5,
      windowMs: 60_000,
    })
    if (limited) return limited

    const { token } = await ctx.params
    const link = await getShareLinkByToken(token)
    if (!link) return err(404, "Tautan tidak ditemukan atau sudah dinonaktifkan")

    const raw = await request.json()
    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      return err(400, parsed.error.issues[0]?.message ?? "Invalid input")
    }

    const comment = await insertComment(link.projectId, parsed.data.body, parsed.data.name)
    return ok(comment)
  } catch (e) {
    return handleError(e)
  }
}
